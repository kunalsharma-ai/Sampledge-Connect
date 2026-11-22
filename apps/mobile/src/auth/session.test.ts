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

const netSession = (token: string): Session => ({
  ...session(token),
  refreshToken: `refresh-${token}-xxxxxxxxxxxxxxxx`,
  user: { ...session(token).user, userId: 'nu1' },
  tenant: { tenantId: 'tn', slug: 'sampledge-network', name: 'SampConnect Network' },
  workspaceId: 'wn',
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

  it('opens SampConnect Network from a work account and switches spaces offline', async () => {
    let clock = 0;
    const links: unknown[] = [];
    let networkRefresh: Session | Error = { ...netSession('n2') };
    const api = {
      login: async () => session('w1'),
      linkNetwork: async (req: unknown) => (links.push(req), netSession('n1')),
      refresh: async (token: string) => {
        if (token.startsWith('refresh-n')) {
          if (networkRefresh instanceof Error) throw networkRefresh;
          return networkRefresh;
        }
        return session('w2');
      },
    } as unknown as ApiTransport;
    const secrets = memorySecrets();
    const m = new SessionManager(
      secrets,
      () => api,
      () => clock,
    );
    const spaces: string[] = [];
    m.events.on('space', (s) => spaces.push(s));
    await m.load();
    await m.signIn({
      serverUrl: 'connect.acme.com',
      tenantSlug: 'acme',
      email: 'dana@example.com',
      password: 'pw',
      deviceName: 'Pixel',
      platform: 'android',
    });
    expect(m.space).toBe('work');
    expect(m.isPersonal).toBe(false);

    await m.openNetwork({ name: 'Pixel', platform: 'android' });
    expect(links).toHaveLength(1);
    expect((links[0] as { device: { deviceId: string } }).device.deviceId).toBe(await m.deviceId());
    expect(m.space).toBe('network');
    expect(m.current?.tenant.slug).toBe('sampledge-network');
    expect(m.primary?.tenant.slug).toBe('acme');
    expect(await m.getAccessToken()).toBe('n1');
    expect(await m.primaryToken()).toBe('w1');

    // Back to work and in again: the link is made once.
    await m.openWork();
    expect(await m.getAccessToken()).toBe('w1');
    await m.openNetwork({ name: 'Pixel', platform: 'android' });
    expect(links).toHaveLength(1);
    expect(spaces).toEqual(['network', 'work', 'network']);

    // Restored after a restart, in the space you left it in.
    const again = new SessionManager(
      secrets,
      () => api,
      () => clock,
    );
    await again.load();
    expect(again.space).toBe('network');
    expect(again.current?.accessToken).toBe('n1');

    // Each space refreshes on its own.
    clock = 900_000 - 30_000;
    expect(await m.getAccessToken()).toBe('n2');

    // The organization turned the network off: the link is forgotten and work stays signed in.
    clock += 900_000;
    networkRefresh = new TransportError('revoked', 'api', 'UNAUTHENTICATED');
    expect(await m.getAccessToken()).toBeUndefined();
    expect(m.state).toBe('active');
    expect(m.space).toBe('work');
    expect(m.networkSession).toBeNull();
    expect(spaces.at(-1)).toBe('work');
    expect(secrets.data.has('sampledge.session.network.v1')).toBe(false);

    // Signing out forgets both.
    await m.openNetwork({ name: 'Pixel', platform: 'android' });
    await m.signOut();
    expect(m.current).toBeNull();
    expect([...secrets.data.keys()].filter((k) => k.startsWith('sampledge.session'))).toEqual([]);
  });

  it('a personal account lives in the network space only', async () => {
    const api = {
      signUpPersonal: async (req: { device: { deviceId: string }; displayName: string }) => {
        expect(req.device.deviceId).toMatch(/^[0-9a-f-]{36}$/);
        expect(req.displayName).toBe('Maria');
        return netSession('p1');
      },
    } as unknown as ApiTransport;
    const m = new SessionManager(
      memorySecrets(),
      () => api,
      () => 0,
    );
    await m.load();
    await m.signUpPersonal(
      'connect.acme.com',
      { displayName: 'Maria', email: 'maria@example.com', password: 'p'.repeat(12) },
      { name: 'iPhone', platform: 'ios' },
    );
    expect(m.isPersonal).toBe(true);
    expect(m.space).toBe('network');
    await m.openWork();
    expect(m.space).toBe('network');
    expect(await m.getAccessToken()).toBe('p1');
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
