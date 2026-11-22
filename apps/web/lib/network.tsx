'use client';
import * as React from 'react';
import { Dexie, type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { uuidv7, type NetworkChangedEvent } from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine } from './engine';

/**
 * SampConnect Network data on the web: every list is cached in IndexedDB (shown offline),
 * refreshed when the server says its scope changed (`network:changed`, sent to all your
 * devices) and on reconnect. Every action goes through a durable outbox: it is written to
 * IndexedDB first, sent when online, and replayed after a reconnect. Actions carry an
 * idempotency key, so a replay never does anything twice.
 */

type Scope = NetworkChangedEvent['scope'];

export interface NetworkAction {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Words for the Sync Center and toasts, e.g. "Connection request to Maria". */
  label: string;
  scopes: Scope[];
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** 'failed' when the server refused it (it won't be retried). */
  state: 'queued' | 'sending' | 'failed';
}

interface CacheRow {
  key: string;
  value: unknown;
  at: number;
}

class NetworkDb extends Dexie {
  cache!: EntityTable<CacheRow, 'key'>;
  outbox!: EntityTable<NetworkAction, 'id'>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ cache: 'key', outbox: 'id, createdAt' });
  }
}

interface NetworkContextValue {
  db: NetworkDb;
  online: boolean;
  /** GET with the cache: returns the cached value immediately, then fresh data. */
  refresh(path: string): Promise<void>;
  subscribe(scopes: Scope[], fn: () => void): () => void;
  /** Queue an action (durable), then try to send it. Resolves with the server result, or null if queued. */
  act<T = unknown>(
    a: Omit<NetworkAction, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'state'> & {
      id?: string;
    },
  ): Promise<T | null>;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
}

const NetworkContext = React.createContext<NetworkContextValue | null>(null);

export function useNetwork() {
  const ctx = React.useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork outside NetworkProvider');
  return ctx;
}

/** Which cached paths belong to a scope (refetched when it changes). */
const SCOPE_PATHS: Record<Scope, RegExp> = {
  profile: /^\/v1\/network\/(me|people)/,
  requests: /^\/v1\/network\/(requests|search|people)/,
  connections: /^\/v1\/network\/(connections|search|people|requests|statuses)/,
  follows: /^\/v1\/network\/(follows|search|people|statuses)/,
  blocks: /^\/v1\/network\/(blocks|search|people|connections|follows)/,
  statuses: /^\/v1\/network\/statuses/,
  communities: /^\/v1\/network\/communit/,
  invites: /^\/v1\/network\/invites/,
  reports: /^\/v1\/network\/communities\/[^/]+\/reports/,
};

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { session, getAccessToken } = useAuth();
  const { engine, state } = useEngine();
  const online = state.connectivity !== 'offline';
  // One cache per network identity (not per session object, which changes on every refresh).
  const dbName = `sampledge-connect:network:${session!.tenant.tenantId}:${session!.user.userId}`;
  const db = React.useMemo(() => new NetworkDb(dbName), [dbName]);
  const listeners = React.useRef(new Set<{ scopes: Scope[]; fn: () => void }>());
  const flushing = React.useRef<Promise<void> | null>(null);

  // Reopens on next use if this instance is still read after unmount (switching spaces).
  React.useEffect(() => () => db.close({ disableAutoOpen: false }), [db]);

  const refresh = React.useCallback(
    async (path: string) => {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      try {
        const value = await apiRequest('GET', path, { token });
        await db.cache.put({ key: path, value, at: Date.now() });
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 404) await db.cache.delete(path);
        // offline or refused: keep what we have
      }
    },
    [db, getAccessToken],
  );

  const emit = React.useCallback(
    (scopes: Scope[]) => {
      for (const l of listeners.current) if (l.scopes.some((s) => scopes.includes(s))) l.fn();
      // Cached paths for these scopes are refetched even when no screen is showing them.
      void db.cache
        .toCollection()
        .primaryKeys()
        .then((keys) => {
          for (const k of keys)
            if (scopes.some((s) => SCOPE_PATHS[s].test(String(k)))) void refresh(String(k));
        });
    },
    [db, refresh],
  );

  const flush = React.useCallback(async () => {
    if (flushing.current) return flushing.current;
    flushing.current = (async () => {
      try {
        const items = await db.outbox.orderBy('createdAt').toArray();
        for (const a of items) {
          if (a.state === 'failed') continue;
          const token = await getAccessToken().catch(() => null);
          if (!token) return;
          await db.outbox.update(a.id, { state: 'sending', attempts: a.attempts + 1 });
          try {
            await apiRequest(a.method, a.path, { token, body: a.body });
            await db.outbox.delete(a.id);
            emit(a.scopes);
          } catch (e) {
            const err = e instanceof ApiFailure ? e : null;
            if (!err || err.status === 0 || err.status >= 500 || err.status === 429) {
              await db.outbox.update(a.id, {
                state: 'queued',
                lastError: err?.error.message ?? 'Network error',
              });
              return; // keep order: try again after the next reconnect
            }
            await db.outbox.update(a.id, { state: 'failed', lastError: err.error.message });
            emit(a.scopes);
          }
        }
      } finally {
        flushing.current = null;
      }
    })();
    return flushing.current;
  }, [db, emit, getAccessToken]);

  // Live changes from the server, for every device of this person.
  React.useEffect(() => engine.onNetwork((e) => emit([e.scope])), [engine, emit]);
  // Back online: replay the outbox, then refresh everything cached.
  React.useEffect(() => {
    if (!online) return;
    void flush().then(() => emit(Object.keys(SCOPE_PATHS) as Scope[]));
  }, [online, flush, emit]);
  // Socket reconnected (live events may have been missed): replay and refetch the same way.
  React.useEffect(
    () =>
      engine.onChange((e) => {
        if (e.type === 'reconnected')
          void flush().then(() => emit(Object.keys(SCOPE_PATHS) as Scope[]));
      }),
    [engine, flush, emit],
  );

  const act = React.useCallback<NetworkContextValue['act']>(
    async (input) => {
      const a: NetworkAction = {
        ...input,
        id: input.id ?? uuidv7(),
        createdAt: Date.now(),
        attempts: 0,
        lastError: null,
        state: 'queued',
      };
      await db.outbox.put(a);
      if (!online) return null;
      const token = await getAccessToken().catch(() => null);
      if (!token) return null;
      // Earlier queued actions go first, so order is kept.
      const earlier = await db.outbox
        .where('createdAt')
        .below(a.createdAt)
        .filter((x) => x.state !== 'failed')
        .count();
      if (earlier) {
        await flush();
        return null;
      }
      await db.outbox.update(a.id, { state: 'sending', attempts: 1 });
      try {
        const r = await apiRequest(a.method, a.path, { token, body: a.body });
        await db.outbox.delete(a.id);
        emit(a.scopes);
        return r as never;
      } catch (e) {
        const err = e instanceof ApiFailure ? e : null;
        if (!err || err.status === 0 || err.status >= 500 || err.status === 429) {
          await db.outbox.update(a.id, {
            state: 'queued',
            lastError: err?.error.message ?? 'Network error',
          });
          return null;
        }
        await db.outbox.delete(a.id);
        throw e;
      }
    },
    [db, emit, flush, getAccessToken, online],
  );

  const value = React.useMemo<NetworkContextValue>(
    () => ({
      db,
      online,
      refresh,
      subscribe(scopes, fn) {
        const l = { scopes, fn };
        listeners.current.add(l);
        return () => listeners.current.delete(l);
      },
      act,
      async retry(id) {
        await db.outbox.update(id, { state: 'queued', lastError: null });
        await flush();
      },
      async discard(id) {
        await db.outbox.delete(id);
      },
    }),
    [db, online, refresh, act, flush],
  );
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/** Cached GET that refreshes on mount, on matching `network:changed` scopes and when back online. */
export function useNet<T>(
  path: string | null,
  scopes: Scope[],
): { data: T | undefined; loading: boolean; reload(): Promise<void> } {
  const net = useNetwork();
  const row = useLiveQuery(() => (path ? net.db.cache.get(path) : undefined), [net.db, path]);
  const [loading, setLoading] = React.useState(!!path);
  const key = scopes.join(',');
  const reload = React.useCallback(async () => {
    if (!path) return;
    await net.refresh(path);
    setLoading(false);
  }, [net, path]);
  React.useEffect(() => {
    if (!path) return;
    setLoading(true);
    void reload();
    return net.subscribe(key.split(',') as Scope[], () => void reload());
  }, [path, key, net, reload]);
  return { data: row?.value as T | undefined, loading: loading && !row, reload };
}

/** Actions still waiting to be sent (shown as "Queued" next to what they change). */
export function useNetworkOutbox(): NetworkAction[] {
  const net = useNetwork();
  return useLiveQuery(() => net.db.outbox.orderBy('createdAt').toArray(), [net.db]) ?? [];
}

export const newActionId = () => uuidv7();
