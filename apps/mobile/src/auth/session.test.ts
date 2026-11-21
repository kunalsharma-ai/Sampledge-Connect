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
