import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { SessionManager, type SessionState, type StoredSession } from '../auth/session';
import { migrate } from '../db/migrations';
import { openExpoDriver } from '../db/expoDriver';
import { secureStorage } from '../db/secureStorage';
import { LocalStore } from '../db/store';
import type { SqlDriver } from '../db/driver';
import { expoPushToken } from '../lib/push';
import { RealtimeClient } from '../sync/realtime';
import { HttpTransport, NoServerTransport } from '../sync/transport';
import { DEMO_SELF, seedDemo } from './demoSeed';
import { ConnectEngine, type EngineState } from './engine';

interface Workspace {
  store: LocalStore;
  engine: ConnectEngine;
  selfId: string;
  /** Recovery notice when the cache had to be rebuilt on open. */
  recovered: boolean;
}

interface AppContextValue {
  sessionState: SessionState;
  session: StoredSession | null;
  sessions: SessionManager;
  workspace: Workspace | null;
  engineState: EngineState | null;
  /** Wipes local data for this account and signs out. */
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function randomHex(): string {
  return Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
}

const sessions: SessionManager = new SessionManager(
  secureStorage,
  (baseUrl) =>
    new HttpTransport({
      baseUrl,
      getAccessToken: (): Promise<string | undefined> => sessions.getAccessToken(),
    }),
);

/** Short, stable per-account file name (some SQLite VFSs, e.g. the browser one, reject long names). */
function shortHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function dbNameFor(state: SessionState, s: StoredSession | null): string | null {
  if (state === 'demo') return 'sampledge-demo.db';
  if ((state === 'active' || state === 'expired') && s)
    return `sampledge-${shortHash(`${s.tenant.tenantId}:${s.user.userId}`)}.db`;
  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const openDb = useRef<{ name: string; driver: SqlDriver; engine: ConnectEngine } | null>(null);

  useEffect(() => {
    const off = sessions.events.on('state', setSessionState);
    void sessions.load();
    return off;
  }, []);

  // Open (or switch) the per-account encrypted cache whenever the account changes.
  useEffect(() => {
    const name = dbNameFor(sessionState, sessions.current);
    if (openDb.current?.name === name) return;
    let cancelled = false;
    void (async () => {
      if (openDb.current) {
        openDb.current.engine.stop();
        await openDb.current.driver.close();
        openDb.current = null;
        setWorkspace(null);
        setEngineState(null);
      }
      if (!name) return;
      const driver = await openExpoDriver(name, await sessions.databaseKey(randomHex));
      const result = await migrate(driver);
      const demo = sessionState === 'demo';
      const s = sessions.current;
      const selfId = demo ? DEMO_SELF : s!.user.userId;
      const store = new LocalStore(driver, selfId);
      if (demo) await seedDemo(store);
      const api = demo
        ? new NoServerTransport()
        : new HttpTransport({
            baseUrl: s!.serverUrl,
            getAccessToken: () => sessions.getAccessToken(),
          });
      const realtime = demo
        ? null
        : new RealtimeClient(s!.serverUrl, store, () => sessions.getAccessToken());
      const engine = new ConnectEngine(store, api, sessions, realtime);
      if (cancelled) {
        await driver.close();
        return;
      }
      openDb.current = { name, driver, engine };
      engine.events.on('state', setEngineState);
      await engine.start();
      const net = await NetInfo.fetch();
      engine.setNetworkUp(!!net.isConnected && net.isInternetReachable !== false);
      setWorkspace({ store, engine, selfId, recovered: result.recovered });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionState]);

  // Connectivity and foreground triggers.
  useEffect(() => {
    if (!workspace) return;
    const offNet = NetInfo.addEventListener((s) =>
      workspace.engine.setNetworkUp(!!s.isConnected && s.isInternetReachable !== false),
    );
    const offApp = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        workspace.engine.setForeground(true);
        void registerPush(workspace.engine);
      } else if (st === 'background') workspace.engine.setForeground(false);
    });
    // Browsers that expose navigator.connection never fire NetInfo for a plain offline
    // switch, so the web preview also follows the window online/offline events.
    const win = Platform.OS === 'web' ? (globalThis as unknown as Window) : null;
    const up = () => workspace.engine.setNetworkUp(true);
    const down = () => workspace.engine.setNetworkUp(false);
    void registerPush(workspace.engine);
    win?.addEventListener('online', up);
    win?.addEventListener('offline', down);
    return () => {
      offNet();
      offApp.remove();
      win?.removeEventListener('online', up);
      win?.removeEventListener('offline', down);
    };
  }, [workspace]);

  const signOut = useCallback(async () => {
    const ws = openDb.current;
    if (ws) {
      await ws.engine.store.wipe();
    }
    await sessions.signOut();
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ sessionState, session: sessions.current, sessions, workspace, engineState, signOut }),
    [sessionState, workspace, engineState, signOut],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Registers this install for push when the build and the OS allow it (no-op otherwise). */
async function registerPush(engine: ConnectEngine): Promise<void> {
  const token = await expoPushToken().catch(() => null);
  if (token) await engine.registerPush(token, devicePlatform);
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function useWorkspace(): Workspace {
  const ws = useApp().workspace;
  if (!ws) throw new Error('No workspace open');
  return ws;
}

export const devicePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
