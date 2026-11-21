import { Dexie, type EntityTable } from 'dexie';
import { uuidv7, type Session } from '@sampledge/contracts';

/** Persisted session (survives reloads and offline starts). The access token stays in memory only. */
export interface StoredSession {
  id: 'current';
  refreshToken: string;
  user: Session['user'];
  tenant: Session['tenant'];
  workspaceId: string;
}

class AuthDb extends Dexie {
  session!: EntityTable<StoredSession, 'id'>;
  constructor() {
    super('sampledge-connect:auth');
    this.version(1).stores({ session: 'id' });
  }
}

let db: AuthDb | null = null;
const authDb = () => (db ??= new AuthDb());

export async function loadSession(): Promise<StoredSession | null> {
  try {
    return (await authDb().session.get('current')) ?? null;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<StoredSession> {
  const row: StoredSession = {
    id: 'current',
    refreshToken: s.refreshToken,
    user: s.user,
    tenant: s.tenant,
    workspaceId: s.workspaceId,
  };
  await authDb().session.put(row);
  return row;
}

export async function clearSession() {
  await authDb().session.delete('current');
}

/** Stable per-installation device id. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('sampledge.deviceId');
    if (!id) {
      id = uuidv7();
      localStorage.setItem('sampledge.deviceId', id);
    }
    return id;
  } catch {
    return uuidv7();
  }
}

export function deviceInfo() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  const standalone =
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
  return {
    deviceId: deviceId(),
    name: `${browser}${os ? ` on ${os}` : ''}`,
    platform: standalone ? ('pwa' as const) : ('web' as const),
  };
}
