import { createServer, type Server } from 'node:http';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  IntegrationTestResult,
  IntegrationView,
  PushStatus,
  Session,
} from '@sampledge/contracts';
import {
  api,
  device,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** Fake Expo endpoint: accepts the access token "good-token" only. */
let expo: Server;
let h: Harness;
let mongo: MongoClient;
let owner: Session;
let member: Session;
let other: Session;
let operator: Session;

const OPERATOR = `ops-${Date.now().toString(36)}@platform.test`;

const list = (s: Session, base = '/v1/admin/integrations') =>
  api<IntegrationView[]>(h, 'GET', base, { token: s.accessToken });
const find = async (s: Session, id: string, base?: string) =>
  (await list(s, base)).body.find((v) => v.provider.id === id)!;
const save = (s: Session, id: string, body: unknown, base = '/v1/admin/integrations') =>
  api<IntegrationView>(h, 'PUT', `${base}/${id}`, { token: s.accessToken, body });
const test = (s: Session, id: string, body: unknown = {}) =>
  api<IntegrationTestResult>(h, 'POST', `/v1/admin/integrations/${id}/test`, {
    token: s.accessToken,
    body,
  });
const status = (s: Session) =>
  api<PushStatus>(h, 'GET', '/v1/push/status', { token: s.accessToken });
const col = () => mongo.db(h.dbName).collection('integration_settings');

beforeAll(async () => {
  expo = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const ok = req.headers.authorization === 'Bearer good-token';
      res.statusCode = ok ? 200 : 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(ok ? { data: {} } : { errors: [{ message: 'bad token' }] }));
    });
  });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  const port = (expo.address() as { port: number }).port;
  // No PUSH_PROVIDER: push starts unconfigured, so everything below comes from the database.
  h = await startHarness({
    EXPO_PUSH_URL: `http://127.0.0.1:${port}/push/send`,
    PLATFORM_ADMIN_EMAILS: OPERATOR,
    SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  mongo = await MongoClient.connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017');
  const t = await registerTenant(h);
  owner = t.session;
  member = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  other = (await registerTenant(h, 'Other Co')).session;
  const reg = await api<Session>(h, 'POST', '/v1/auth/register', {
    body: {
      organizationName: 'Platform Ops',
      tenantSlug: `ops-${Date.now().toString(36)}`,
      ownerName: 'Ops',
      ownerEmail: OPERATOR,
      password: 'correct horse battery staple',
      device: device(),
    },
  });
  operator = reg.body;
});

afterAll(async () => {
  await h?.close();
  await mongo?.close();
  expo?.close();
});

describe('admin integrations', () => {
  it('lists core providers and only lets integration managers see them', async () => {
    const r = await list(owner);
    expect(r.status).toBe(200);
    const ids = r.body.map((v) => v.provider.id);
    expect(ids).toEqual(expect.arrayContaining(['smtp', 'livekit', 'push.expo']));
    expect(r.body.find((v) => v.provider.id === 'smtp')).toMatchObject({
      enabled: false,
      source: null,
      saved: null,
    });
    expect((await list(member)).status).toBe(403);
    expect((await save(member, 'smtp', { enabled: false, values: {} })).status).toBe(403);
  });

  it('encrypts secrets at rest and never returns them', async () => {
    const r = await save(owner, 'smtp', {
      enabled: true,
      values: {
        host: 'smtp.northwind.example',
        port: '587',
        security: 'starttls',
        username: 'mailer',
        password: 'hunter2-very-secret',
        from: 'Connect <connect@northwind.example>',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, source: 'tenant' });
    expect(r.body.saved!.values.port).toBe(587);
    expect(r.body.saved!.secretsSet).toEqual(['password']);
    expect(JSON.stringify(r.body)).not.toContain('hunter2');
    expect(JSON.stringify((await list(owner)).body)).not.toContain('hunter2');

    const doc = await col().findOne({ tenantId: owner.tenant.tenantId, providerId: 'smtp' });
    expect(JSON.stringify(doc)).not.toContain('hunter2');
    expect(doc!.secrets.password).toMatch(/^v1:/);
    expect(doc!.values.password).toBeUndefined();
  });

  it('keeps omitted secrets, clears null ones, and validates before enabling', async () => {
    let r = await save(owner, 'smtp', {
      enabled: true,
      values: { host: 'mail.northwind.example' },
    });
    expect(r.status).toBe(200);
    expect(r.body.saved!.secretsSet).toEqual(['password']);
    expect(r.body.saved!.values.username).toBe('mailer');

    r = await save(owner, 'smtp', { enabled: false, values: { password: null } });
    expect(r.body.saved!.secretsSet).toEqual([]);

    const bad = await save(owner, 'smtp', { enabled: true, values: { port: 'abc' } });
    expect(bad.status).toBe(400);
    const badUrl = await save(owner, 'livekit', {
      enabled: true,
      values: { publicUrl: 'not a url' },
    });
    expect(badUrl.status).toBe(400);
    const incomplete = await save(owner, 'livekit', { enabled: true, values: {} });
    expect(incomplete.status).toBe(400);
    expect(JSON.stringify(incomplete.body)).toMatch(/before enabling/);
    expect((await save(owner, 'nope', { enabled: false, values: {} })).status).toBe(404);
  });

  it('isolates tenants', async () => {
    const theirs = await find(other, 'smtp');
    expect(theirs.saved).toBeNull();
    expect(theirs.enabled).toBe(false);
  });
});

describe('connection test and hot reload', () => {
  it('tests draft values without saving, then stored values, recording the result', async () => {
    const bad = await test(owner, 'push.expo', { values: { accessToken: 'wrong' } });
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ ok: false, message: expect.stringMatching(/401/) });
    const good = await test(owner, 'push.expo', { values: { accessToken: 'good-token' } });
    expect(good.body.ok).toBe(true);
    expect((await find(owner, 'push.expo')).saved).toBeNull();

    // Push is off until saved; saving turns it on without a restart.
    expect((await status(member)).body.enabled).toBe(false);
    await save(owner, 'push.expo', { enabled: true, values: { accessToken: 'good-token' } });
    expect((await status(member)).body).toMatchObject({ enabled: true, provider: 'expo' });

    const stored = await test(owner, 'push.expo');
    expect(stored.body.ok).toBe(true);
    expect((await find(owner, 'push.expo')).lastTest).toMatchObject({ ok: true });

    await save(owner, 'push.expo', { enabled: false, values: {} });
    expect((await status(member)).body.enabled).toBe(false);
  });

  it('reports a failed SMTP connection instead of throwing', async () => {
    const r = await test(owner, 'smtp', {
      values: { host: '127.0.0.1', port: 1, security: 'none' },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.message.length).toBeGreaterThan(0);
  });

  it('audit logs updates and tests', async () => {
    const logs = await mongo
      .db(h.dbName)
      .collection('audit_logs')
      .find({ tenantId: owner.tenant.tenantId, action: /^integration\./ })
      .toArray();
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('integration.updated');
    expect(actions).toContain('integration.tested');
    expect(JSON.stringify(logs)).not.toContain('hunter2');
    expect(logs.every((l) => l.actorId === owner.user.userId)).toBe(true);
  });
});

describe('platform defaults', () => {
  it('only lets platform operators change them', async () => {
    expect((await list(owner, '/v1/platform/integrations')).status).toBe(403);
    expect((await list(operator, '/v1/platform/integrations')).status).toBe(200);
  });

  it('applies to tenants without their own settings, and a tenant reset falls back to them', async () => {
    const r = await save(
      operator,
      'push.expo',
      { enabled: true, values: { accessToken: 'good-token' } },
      '/v1/platform/integrations',
    );
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('platform');

    // "other" has nothing of its own, so it inherits.
    expect((await find(other, 'push.expo')).source).toBe('platform');
    // The first tenant's own (disabled) row wins until it is reset.
    expect((await find(owner, 'push.expo')).enabled).toBe(false);
    const reset = await api<IntegrationView>(h, 'DELETE', '/v1/admin/integrations/push.expo', {
      token: owner.accessToken,
    });
    expect(reset.body).toMatchObject({ enabled: true, source: 'platform', saved: null });
    expect((await status(member)).body.enabled).toBe(true);
  });
});
