import { describe, expect, it } from 'vitest';
import type { Session } from '@sampledge/contracts';
import { TransportError, type ApiTransport } from '../sync/transport';
import { normaliseUrl, SessionManager, type SecretStorage } from './session';

function memorySecrets(): SecretStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}

const session = (token: string): Session => ({
  accessToken: token,
  accessTokenExpiresIn: 900,
  refreshToken: `refresh-${token}-xxxxxxxxxxxxxxxx`,
  user: {
    userId: 'u1',
    displayName: 'Dana Lee',
    email: 'dana@example.com',
    role: 'member',
    title: null,
    status: 'active',
  },
  tenant: { tenantId: 't1', slug: 'acme', name: 'Acme' },
  workspaceId: 'w1',
});

describe('SessionManager', () => {
  it('finishes single sign-on with the code and the app’s verifier', async () => {
    const calls: string[] = [];
    const urls: string[] = [];
    const api = {
      ssoExchange: async (code: string, verifier: string) => {
        calls.push(`${code}:${verifier}`);
        if (verifier !== 'v'.repeat(43)) throw new TransportError('no', 'api', 'UNAUTHENTICATED');
        return session('sso');
      },
    } as unknown as ApiTransport;
    const m = new SessionManager(
      memorySecrets(),
      (u) => (urls.push(u), api),
      () => 0,
    );
    await m.load();
    await expect(m.signInWithSso('connect.acme.com', 'code-1', 'x'.repeat(43))).rejects.toThrow();
    expect(m.state).toBe('signedOut');
    await m.signInWithSso('connect.acme.com', 'code-2', 'v'.repeat(43));
    expect(calls).toEqual([`code-1:${'x'.repeat(43)}`, `code-2:${'v'.repeat(43)}`]);
    expect(urls.every((u) => u === 'https://connect.acme.com')).toBe(true);
    expect(m.state).toBe('active');
    expect(m.current?.serverUrl).toBe('https://connect.acme.com');
    expect(await m.getAccessToken()).toBe('sso');
  });

  it('finishes a two-step sign-in with the code and keeps nothing before it', async () => {
    const calls: string[] = [];
    const api = {
      login: async () => ({
        mfaRequired: true as const,
        challengeId: 'challenge-123456',
        methods: ['totp', 'recovery'] as ('totp' | 'recovery')[],
        expiresAt: new Date(300_000).toISOString(),
      }),
      verifyMfa: async (id: string, code: string) => {
        calls.push(`${id}:${code}`);
        if (code !== '123456') throw new TransportError('wrong', 'api', 'UNAUTHENTICATED');
        return session('a');
      },
    } as unknown as ApiTransport;
    const secrets = memorySecrets();
    const m = new SessionManager(
      secrets,
      () => api,
      () => 0,
    );
    await m.load();
    const pending = await m.signIn({
      serverUrl: 'connect.acme.com',
      tenantSlug: 'acme',
      email: 'dana@example.com',
      password: 'pw',
      deviceName: 'Pixel',
      platform: 'android',
    });
    expect(pending?.challenge.challengeId).toBe('challenge-123456');
    expect(pending?.serverUrl).toBe('https://connect.acme.com');
    expect(m.state).toBe('signedOut');
    expect(m.current).toBeNull();

    await expect(m.verifyMfa(pending!, '000000')).rejects.toThrow();
    expect(m.state).toBe('signedOut');
    await m.verifyMfa(pending!, ' 123456 ');
    expect(calls).toEqual(['challenge-123456:000000', 'challenge-123456:123456']);
    expect(m.state).toBe('active');
    expect(await m.getAccessToken()).toBe('a');
  });

  it('signs in, refreshes before expiry and keeps tokens in secure storage', async () => {
    let clock = 0;
    let refreshResult: Session | Error = session('b');
    const api = {
      login: async () => session('a'),
      refresh: async () => {
        if (refreshResult instanceof Error) throw refreshResult;
        return refreshResult;
      },
    } as unknown as ApiTransport;
    const secrets = memorySecrets();
    const m = new SessionManager(
      secrets,
      () => api,
      () => clock,
    );
    await m.load();
    expect(m.state).toBe('signedOut');
    await m.signIn({
      serverUrl: 'connect.acme.com/',
      tenantSlug: 'acme',
      email: 'dana@example.com',
      password: 'pw',
      deviceName: 'Pixel',
      platform: 'android',
    });
    expect(m.state).toBe('active');
    expect(m.current?.serverUrl).toBe('https://connect.acme.com');
    expect(await m.getAccessToken()).toBe('a');

    clock = 900_000 - 30_000; // inside the refresh margin
    expect(await m.getAccessToken()).toBe('b');

    // Offline during refresh: keep the old token, stay signed in.
    clock += 900_000;
    refreshResult = new TransportError('offline', 'network');
    expect(await m.getAccessToken()).toBe('b');
    expect(m.state).toBe('active');

    // Refresh token rejected: session expired, but nothing is wiped.
    refreshResult = new TransportError('revoked', 'api', 'UNAUTHENTICATED');
    expect(await m.getAccessToken()).toBeUndefined();
    expect(m.state).toBe('expired');
    expect(m.current).not.toBeNull();

    // Reload from storage restores the session.
    const again = new SessionManager(
      secrets,
      () => api,
      () => clock,
    );
    expect(await again.load()).toBe('active');
  });

  it('keeps a stable device id', async () => {
    const secrets = memorySecrets();
    const m = new SessionManager(secrets, () => ({}) as ApiTransport);
    const id = await m.deviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await m.deviceId()).toBe(id);
  });
});

describe('normaliseUrl', () => {
  it('requires https except for local development hosts', () => {
    expect(normaliseUrl('connect.acme.com')).toBe('https://connect.acme.com');
    expect(normaliseUrl('http://localhost:4000/')).toBe('http://localhost:4000');
    expect(normaliseUrl('http://10.0.2.2:4000')).toBe('http://10.0.2.2:4000');
    expect(() => normaliseUrl('http://connect.acme.com')).toThrow(/https/);
  });
});
