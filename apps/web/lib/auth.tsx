'use client';
import * as React from 'react';
import {
  NETWORK_TENANT_SLUG,
  isMfaChallenge,
  type LoginRequest,
  type LoginResponse,
  type MfaChallenge,
  type NetworkSignupRequest,
  type RegisterTenantRequest,
  type Session,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { API_URL } from './config';
import {
  clearSession,
  deviceInfo,
  loadSession,
  saveSession,
  type SessionSlot,
  type StoredSession,
} from './auth-store';

type Status = 'loading' | 'signed-out' | 'signed-in';
export type Space = 'work' | 'network';

const LS_SPACE = 'sampledge.space';

interface AuthContextValue {
  status: Status;
  /** The session the app is showing: your organization, or SampConnect Network. */
  session: StoredSession | null;
  /** The account you signed in with (an organization, or a personal network account). */
  primary: StoredSession | null;
  space: Space;
  /** True when this account is a personal SampConnect Network account (no organization). */
  personal: boolean;
  /** Returns a valid access token, refreshing when needed. Throws on network failure, null when signed out. */
  getAccessToken(): Promise<string | null>;
  /** Token for a specific slot (the organization while you are in the network, and back). */
  tokenFor(slot: SessionSlot): Promise<string | null>;
  /** Opens SampConnect Network: links this work account on first use (online), then switches. */
  enterNetwork(): Promise<void>;
  enterWork(): void;
  /** Resolves with a challenge when the account has two-step verification on. */
  login(input: Omit<LoginRequest, 'device'>): Promise<MfaChallenge | null>;
  verifyMfa(challengeId: string, code: string): Promise<void>;
  /** Finishes single sign-on with the one-time code from `#sso=`. */
  completeSso(code: string): Promise<void>;
  register(input: Omit<RegisterTenantRequest, 'device'>): Promise<void>;
  /** Free personal SampConnect Network account. */
  signupPersonal(input: Omit<NetworkSignupRequest, 'device'>): Promise<void>;
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

export const isNetworkSession = (s: { tenant: { slug: string } } | null | undefined) =>
  s?.tenant.slug === NETWORK_TENANT_SLUG;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>('loading');
  const [primary, setPrimary] = React.useState<StoredSession | null>(null);
  const [linked, setLinked] = React.useState<StoredSession | null>(null);
  const [space, setSpaceState] = React.useState<Space>('work');
  const [expired, setExpired] = React.useState(false);
  const access = React.useRef(new Map<SessionSlot, { token: string; expiresAt: number }>());
  const refreshing = React.useRef(new Map<SessionSlot, Promise<string | null>>());
  const slots = React.useRef(new Map<SessionSlot, StoredSession>());

  const setSpace = React.useCallback((s: Space) => {
    setSpaceState(s);
    try {
      localStorage.setItem(LS_SPACE, s);
    } catch {
      /* storage unavailable */
    }
  }, []);

  React.useEffect(() => {
    void Promise.all([loadSession('current'), loadSession('network')]).then(([p, n]) => {
      if (p) slots.current.set('current', p);
      if (n) slots.current.set('network', n);
      setPrimary(p);
      setLinked(n);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(LS_SPACE);
      } catch {
        /* ignore */
      }
      setSpaceState(isNetworkSession(p) || (saved === 'network' && n) ? 'network' : 'work');
      // Signed in even when offline: the cached workspace and outbox are usable without a token.
      setStatus(p ? 'signed-in' : 'signed-out');
    });
  }, []);

  const adopt = React.useCallback(async (s: Session, slot: SessionSlot = 'current') => {
    access.current.set(slot, {
      token: s.accessToken,
      expiresAt: Date.now() + s.accessTokenExpiresIn * 1000,
    });
    const stored = await saveSession(s, slot);
    slots.current.set(slot, stored);
    if (slot === 'current') {
      setPrimary(stored);
      setSpaceState(isNetworkSession(stored) ? 'network' : 'work');
    } else setLinked(stored);
    setExpired(false);
    setStatus('signed-in');
  }, []);

  const tokenFor = React.useCallback(
    async (slot: SessionSlot): Promise<string | null> => {
      const a = access.current.get(slot);
      if (a && a.expiresAt - Date.now() > 30_000) return a.token;
      const s = slots.current.get(slot);
      if (!s) return null;
      if (!refreshing.current.has(slot)) {
        refreshing.current.set(
          slot,
          (async () => {
            try {
              const next = await apiRequest<Session>('POST', '/v1/auth/refresh', {
                body: { refreshToken: s.refreshToken },
              });
              await adopt(next, slot);
              return next.accessToken;
            } catch (e) {
              if (e instanceof ApiFailure && e.status === 0) throw e; // offline: try again later
              access.current.delete(slot);
              if (slot === 'network' && slots.current.has('current')) {
                // The network link was revoked (e.g. the organization turned it off): forget it.
                slots.current.delete('network');
                setLinked(null);
                await clearSession('network');
                setSpaceState('work');
              } else setExpired(true);
              return null;
            } finally {
              refreshing.current.delete(slot);
            }
          })(),
        );
      }
      return refreshing.current.get(slot)!;
    },
    [adopt],
  );

  const activeSlot: SessionSlot =
    space === 'network' && linked && !isNetworkSession(primary) ? 'network' : 'current';
  const activeSlotRef = React.useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  const getAccessToken = React.useCallback(() => tokenFor(activeSlotRef.current), [tokenFor]);

  const enterNetwork = React.useCallback(async () => {
    if (isNetworkSession(slots.current.get('current'))) return setSpace('network');
    if (!slots.current.has('network')) {
      const token = await tokenFor('current');
      if (!token) throw new Error('Sign in again to open SampConnect Network');
      const s = await apiRequest<Session>('POST', '/v1/network/link', {
        token,
        body: { device: deviceInfo() },
      });
      await adopt(s, 'network');
    }
    setSpace('network');
  }, [adopt, setSpace, tokenFor]);

  const enterWork = React.useCallback(() => {
    if (!isNetworkSession(slots.current.get('current'))) setSpace('work');
  }, [setSpace]);

  const login = React.useCallback(
    async (input: Omit<LoginRequest, 'device'>) => {
      const r = await apiRequest<LoginResponse>('POST', '/v1/auth/login', {
        body: { ...input, device: deviceInfo() },
      });
      if (isMfaChallenge(r)) return r;
      await adopt(r);
      return null;
    },
    [adopt],
  );

  const verifyMfa = React.useCallback(
    async (challengeId: string, code: string) => {
      const s = await apiRequest<Session>('POST', '/v1/auth/mfa/verify', {
        body: { challengeId, code },
      });
      await adopt(s);
    },
    [adopt],
  );

  const completeSso = React.useCallback(
    async (code: string) => {
      const s = await apiRequest<Session>('POST', '/v1/auth/sso/exchange', { body: { code } });
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

  const signupPersonal = React.useCallback(
    async (input: Omit<NetworkSignupRequest, 'device'>) => {
      const s = await apiRequest<Session>('POST', '/v1/network/public/signup', {
        body: { ...input, device: deviceInfo() },
      });
      await adopt(s);
    },
    [adopt],
  );

  const logout = React.useCallback(async () => {
    for (const slot of ['network', 'current'] as const) {
      const token = access.current.get(slot)?.token;
      if (token) await apiRequest('POST', '/v1/auth/logout', { token }).catch(() => undefined);
    }
    access.current.clear();
    slots.current.clear();
    await clearSession();
    setPrimary(null);
    setLinked(null);
    setStatus('signed-out');
  }, []);

  const session = activeSlot === 'network' ? linked : primary;
  const personal = isNetworkSession(primary);
  const value = React.useMemo(
    () => ({
      status,
      session,
      primary,
      space: (personal ? 'network' : activeSlot === 'network' ? 'network' : 'work') as Space,
      personal,
      getAccessToken,
      tokenFor,
      enterNetwork,
      enterWork,
      login,
      verifyMfa,
      completeSso,
      register,
      signupPersonal,
      logout,
      expired,
    }),
    [
      status,
      session,
      primary,
      personal,
      activeSlot,
      getAccessToken,
      tokenFor,
      enterNetwork,
      enterWork,
      login,
      verifyMfa,
      completeSso,
      register,
      signupPersonal,
      logout,
      expired,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Where the browser goes to start single sign-on for a workspace. */
export function ssoStartUrl(slug: string) {
  const d = deviceInfo();
  const q = new URLSearchParams({
    returnTo: `${window.location.origin}/login`,
    deviceId: d.deviceId,
    deviceName: d.name,
    platform: d.platform,
  });
  return `${API_URL}/v1/auth/sso/${encodeURIComponent(slug)}/start?${q}`;
}
