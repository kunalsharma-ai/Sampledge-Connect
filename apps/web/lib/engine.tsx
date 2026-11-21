'use client';
import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Conversation, UserSummary } from '@sampledge/contracts';
import {
  HttpSocketTransport,
  SyncEngine,
  dbNameFor,
  listConversationMessages,
  openConnectDb,
  wipeLocalData,
  type ConnectDb,
  type EngineState,
  type LocalMessage,
} from '@sampledge/offline';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { loadSession } from './auth-store';
import Dexie from 'dexie';
import { API_URL } from './config';

export type DirectoryEntry = UserSummary & { presence?: string };

interface EngineContextValue {
  db: ConnectDb;
  engine: SyncEngine;
  state: EngineState;
  directory: Map<string, DirectoryEntry>;
  refreshDirectory(): Promise<void>;
  /** Signs out and wipes this identity's local data. */
  signOut(): Promise<void>;
}

const EngineContext = React.createContext<EngineContextValue | null>(null);

export function useEngine() {
  const ctx = React.useContext(EngineContext);
  if (!ctx) throw new Error('useEngine outside EngineProvider');
  return ctx;
}

/**
 * Owns the identity's IndexedDB and the sync engine for the signed-in user.
 * Everything renders from IndexedDB (live queries), so the UI is identical online and offline.
 */
export function EngineProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const auth = useAuth();
  const [value, setValue] = React.useState<Omit<EngineContextValue, 'state' | 'directory'> | null>(
    null,
  );
  const [state, setState] = React.useState<EngineState | null>(null);
  const [directory, setDirectory] = React.useState<Map<string, DirectoryEntry>>(new Map());
  const session = auth.session;
  const getToken = auth.getAccessToken;
  const tokenRef = React.useRef(getToken);
  tokenRef.current = getToken;

  React.useEffect(() => {
    if (!session) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const { db } = await openConnectDb(dbNameFor(session.tenant.tenantId, session.user.userId));
      const transport = new HttpSocketTransport({
        baseUrl: API_URL,
        getAccessToken: () => tokenRef.current(),
      });
      const engine = new SyncEngine({
        db,
        transport,
        tenantId: session.tenant.tenantId,
        userId: session.user.userId,
        onSessionExpired: () => {
          // Try a refresh; the engine resumes when it succeeds, otherwise the user is asked to sign in.
          void tokenRef.current().then(
            (t) => t && engine.resume(),
            () => undefined,
          );
        },
      });
      await engine.start();
      if (disposed) return engine.stop();
      const unsub = engine.subscribe(setState);
      const online = () => engine.setNetworkAvailable(true);
      const offline = () => engine.setNetworkAvailable(false);
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      const onFocus = () =>
        document.visibilityState === 'visible' && navigator.onLine && void engine.syncNow();
      document.addEventListener('visibilitychange', onFocus);
      engine.setNetworkAvailable(navigator.onLine);
      void navigator.storage?.persist?.().catch(() => undefined);
      const quota = setInterval(() => void engine.enforceQuota(), 5 * 60_000);

      const cached = await db.meta.get('directory');
      if (cached)
        setDirectory(new Map((cached.value as DirectoryEntry[]).map((u) => [u.userId, u])));

      const refreshDirectory = async () => {
        try {
          const token = await tokenRef.current();
          if (!token) return;
          const users = await apiRequest<DirectoryEntry[]>('GET', '/v1/users', { token });
          await db.meta.put({ key: 'directory', value: users });
          setDirectory(new Map(users.map((u) => [u.userId, u])));
        } catch {
          /* offline or not permitted: keep cached directory */
        }
      };
      void refreshDirectory();

      const signOut = async () => {
        engine.stop();
        // Both spaces (organization and Sampledge Network) live on this device: wipe them all.
        const others = (await Promise.all([loadSession('current'), loadSession('network')]))
          .filter((s) => !!s)
          .flatMap((s) => [
            dbNameFor(s.tenant.tenantId, s.user.userId),
            `sampledge-connect:network:${s.tenant.tenantId}:${s.user.userId}`,
          ])
          .filter((n) => n !== db.name);
        await auth.logout();
        await wipeLocalData(db);
        await Promise.all(others.map((n) => Dexie.delete(n).catch(() => undefined)));
      };
      setValue({ db, engine, refreshDirectory, signOut });
      cleanup = () => {
        unsub();
        clearInterval(quota);
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
        document.removeEventListener('visibilitychange', onFocus);
        engine.stop();
        db.close();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
      setValue(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.tenant.tenantId, session?.user.userId]);

  if (!value || !state) return <>{fallback}</>;
  return (
    <EngineContext.Provider value={{ ...value, state, directory }}>
      {children}
    </EngineContext.Provider>
  );
}

export function useConversations(): Conversation[] | undefined {
  const { db } = useEngine();
  return useLiveQuery(() => db.conversations.toArray(), [db]);
}

export function useMessages(conversationId: string | null): LocalMessage[] | undefined {
  const { db } = useEngine();
  return useLiveQuery(
    () => (conversationId ? listConversationMessages(db, conversationId) : []),
    [db, conversationId],
  );
}

export function useReceipts(conversationId: string | null) {
  const { db } = useEngine();
  return useLiveQuery(
    () =>
      conversationId ? db.receipts.where('conversationId').equals(conversationId).toArray() : [],
    [db, conversationId],
  );
}

/** This device's not-yet-confirmed reaction changes for a conversation (for the optimistic overlay). */
export function usePendingReactions(conversationId: string | null) {
  const { db } = useEngine();
  return (
    useLiveQuery(
      () =>
        conversationId
          ? db.reactionQueue.filter((r) => r.conversationId === conversationId).toArray()
          : [],
      [db, conversationId],
    ) ?? []
  );
}

/** Unread = confirmed messages from others above my read watermark. */
export function useUnreadCounts(myUserId: string): Map<string, number> {
  const { db } = useEngine();
  return (
    useLiveQuery(async () => {
      const [msgs, receipts] = await Promise.all([db.messages.toArray(), db.receipts.toArray()]);
      const mine = new Map(
        receipts.filter((r) => r.userId === myUserId).map((r) => [r.conversationId, r.readUpTo]),
      );
      const out = new Map<string, number>();
      for (const m of msgs) {
        if (m.senderId === myUserId || m.serverSequence == null || m.deletedAt) continue;
        if (m.serverSequence > (mine.get(m.conversationId) ?? 0))
          out.set(m.conversationId, (out.get(m.conversationId) ?? 0) + 1);
      }
      return out;
    }, [db, myUserId]) ?? new Map()
  );
}
