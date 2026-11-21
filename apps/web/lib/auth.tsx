'use client';
import * as React from 'react';
import type { LoginRequest, RegisterTenantRequest, Session } from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import {
  clearSession,
  deviceInfo,
  loadSession,
  saveSession,
  type StoredSession,
} from './auth-store';

type Status = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: Status;
  session: StoredSession | null;
  /** Returns a valid access token, refreshing when needed. Throws on network failure, null when signed out. */
  getAccessToken(): Promise<string | null>;
  login(input: Omit<LoginRequest, 'device'>): Promise<void>;
  register(input: Omit<RegisterTenantRequest, 'device'>): Promise<void>;
  logout(): Promise<void>;
  /** Set when a refresh failed for auth reasons; the UI asks the user to sign in again. */
  expired: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>('loading');
  const [session, setSession] = React.useState<StoredSession | null>(null);
  const [expired, setExpired] = React.useState(false);
  const access = React.useRef<{ token: string; expiresAt: number } | null>(null);
  const refreshing = React.useRef<Promise<string | null> | null>(null);
  const sessionRef = React.useRef<StoredSession | null>(null);

  React.useEffect(() => {
    void loadSession().then((s) => {
      sessionRef.current = s;
      setSession(s);
      // Signed in even when offline: the cached workspace and outbox are usable without a token.
      setStatus(s ? 'signed-in' : 'signed-out');
    });
  }, []);

  const adopt = React.useCallback(async (s: Session) => {
    access.current = {
      token: s.accessToken,
      expiresAt: Date.now() + s.accessTokenExpiresIn * 1000,
    };
    const stored = await saveSession(s);
    sessionRef.current = stored;
    setSession(stored);
    setExpired(false);
    setStatus('signed-in');
  }, []);

  const getAccessToken = React.useCallback(async (): Promise<string | null> => {
    if (access.current && access.current.expiresAt - Date.now() > 30_000)
      return access.current.token;
    const s = sessionRef.current;
    if (!s) return null;
    if (!refreshing.current) {
      refreshing.current = (async () => {
        try {
          const next = await apiRequest<Session>('POST', '/v1/auth/refresh', {
            body: { refreshToken: s.refreshToken },
          });
          await adopt(next);
          return next.accessToken;
        } catch (e) {
          if (e instanceof ApiFailure && e.status === 0) throw e; // offline: try again later
          access.current = null;
          setExpired(true);
          return null;
        } finally {
          refreshing.current = null;
        }
      })();
    }
    return refreshing.current;
  }, [adopt]);

  const login = React.useCallback(
    async (input: Omit<LoginRequest, 'device'>) => {
      const s = await apiRequest<Session>('POST', '/v1/auth/login', {
        body: { ...input, device: deviceInfo() },
      });
      await adopt(s);
    },
    [adopt],
  );

  const register = React.useCallback(
    async (input: Omit<RegisterTenantRequest, 'device'>) => {
      const s = await apiRequest<Session>('POST', '/v1/auth/register', {
        body: { ...input, device: deviceInfo() },
      });
      await adopt(s);
    },
    [adopt],
  );

  const logout = React.useCallback(async () => {
    const token = access.current?.token;
    if (token) await apiRequest('POST', '/v1/auth/logout', { token }).catch(() => undefined);
    access.current = null;
    await clearSession();
    sessionRef.current = null;
    setSession(null);
    setStatus('signed-out');
  }, []);

  const value = React.useMemo(
    () => ({ status, session, getAccessToken, login, register, logout, expired }),
    [status, session, getAccessToken, login, register, logout, expired],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
