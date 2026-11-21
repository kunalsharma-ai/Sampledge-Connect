import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { io, type Socket } from 'socket.io-client';
import {
  uuidv7,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type Session,
} from '@sampledge/contracts';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/config.js';

export interface Harness {
  app: INestApplication;
  url: string;
  dbName: string;
  close(): Promise<void>;
}

/** Boots the real API against real MongoDB + Redis (docker or CI services) on a throwaway database. */
export async function startHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const dbName = `sc_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cfg = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    MONGO_DB: dbName,
    RATE_LIMIT_DISABLED: 'true',
    LOG_LEVEL: 'error',
    ...overrides,
  });
  const app = await createApp(cfg);
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    app,
    url,
    dbName,
    async close() {
      await app.close();
      const c = await MongoClient.connect(cfg.MONGO_URL);
      await c.db(dbName).dropDatabase();
      await c.close();
    },
  };
}

export async function api<T = unknown>(
  h: Harness,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(h.url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export const device = (name = 'Test device') => ({
  deviceId: uuidv7(),
  name,
  platform: 'web' as const,
});

let slugCounter = 0;
export async function registerTenant(h: Harness, name = 'Acme Research') {
  const slug = `acme-${Date.now().toString(36)}-${slugCounter++}`;
  const password = 'correct horse battery staple';
  const res = await api<Session>(h, 'POST', '/v1/auth/register', {
    body: {
      organizationName: name,
      tenantSlug: slug,
      ownerName: 'Priya Owner',
      ownerEmail: `priya@${slug}.test`,
      password,
      device: device(),
    },
  });
  if (res.status !== 201)
    throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return { session: res.body, slug, password };
}

export async function inviteAndLogin(
  h: Harness,
  owner: Session,
  slug: string,
  displayName: string,
  role: 'member' | 'admin' | 'guest' = 'member',
) {
  const email = `${displayName.toLowerCase().replace(/\s+/g, '.')}@${slug}.test`;
  const temporaryPassword = 'temporary password 123';
  const inv = await api(h, 'POST', '/v1/users', {
    token: owner.accessToken,
    body: { email, displayName, role, temporaryPassword },
  });
  if (inv.status !== 201)
    throw new Error(`invite failed ${inv.status} ${JSON.stringify(inv.body)}`);
  const login = await api<Session>(h, 'POST', '/v1/auth/login', {
    body: { tenantSlug: slug, email, password: temporaryPassword, device: device() },
  });
  if (login.status !== 200) throw new Error(`login failed ${login.status}`);
  return login.body;
}

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connect(h: Harness, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s: ClientSocket = io(h.url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });
}

export function nextEvent<E extends keyof ServerToClientEvents>(
  s: ClientSocket,
  event: E,
  predicate: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
  timeoutMs = 4000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    const handler = (...args: Parameters<ServerToClientEvents[E]>) => {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      s.off(event, handler as never);
      resolve(args[0]);
    };
    s.on(event, handler as never);
  });
}
