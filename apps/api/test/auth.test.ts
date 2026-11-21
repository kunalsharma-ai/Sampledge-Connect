import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '@sampledge/contracts';
import { api, device, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('organization onboarding and auth', () => {
  it('registers a tenant with owner, workspace and #general', async () => {
    const { session } = await registerTenant(h);
    expect(session.user.role).toBe('owner');
    expect(session.accessTokenExpiresIn).toBe(900);
    const convs = await api<{ name: string; kind: string }[]>(h, 'GET', '/v1/conversations', {
      token: session.accessToken,
    });
    expect(convs.body.map((c) => c.name)).toEqual(['general']);
    const audit = await api<{ action: string }[]>(h, 'GET', '/v1/audit-logs', {
      token: session.accessToken,
    });
    expect(audit.body.map((a) => a.action)).toContain('tenant.created');
  });

  it('rejects a duplicate workspace slug with CONFLICT', async () => {
    const { slug } = await registerTenant(h);
    const res = await api<{ error: { code: string } }>(h, 'POST', '/v1/auth/register', {
      body: {
        organizationName: 'Other',
        tenantSlug: slug,
        ownerName: 'X',
        ownerEmail: 'x@x.test',
        password: 'another long password',
        device: device(),
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('validates registration input', async () => {
    const res = await api<{ error: { code: string } }>(h, 'POST', '/v1/auth/register', {
      body: { tenantSlug: 'Bad Slug!' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('logs in with the right password and gives a generic error otherwise', async () => {
    const { slug, password, session } = await registerTenant(h);
    const ok = await api<Session>(h, 'POST', '/v1/auth/login', {
      body: { tenantSlug: slug, email: session.user.email, password, device: device() },
    });
    expect(ok.status).toBe(200);
    const bad = await api<{ error: { message: string } }>(h, 'POST', '/v1/auth/login', {
      body: { tenantSlug: slug, email: session.user.email, password: 'wrong', device: device() },
    });
    const noUser = await api<{ error: { message: string } }>(h, 'POST', '/v1/auth/login', {
      body: { tenantSlug: slug, email: 'nobody@x.test', password: 'wrong', device: device() },
    });
    expect(bad.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(bad.body.error.message).toBe(noUser.body.error.message);
  });

  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const { session } = await registerTenant(h);
    const r1 = await api<Session>(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(session.refreshToken);
    // Replay of the rotated token = theft signal: whole session revoked.
    const replay = await api(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    expect(replay.status).toBe(401);
    const r2 = await api(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: r1.body.refreshToken },
    });
    expect(r2.status).toBe(401);
    const me = await api(h, 'GET', '/v1/me', { token: r1.body.accessToken });
    expect(me.status).toBe(401);
  });

  it('logout revokes the access token immediately', async () => {
    const { session } = await registerTenant(h);
    expect((await api(h, 'GET', '/v1/me', { token: session.accessToken })).status).toBe(200);
    expect((await api(h, 'POST', '/v1/auth/logout', { token: session.accessToken })).status).toBe(
      204,
    );
    expect((await api(h, 'GET', '/v1/me', { token: session.accessToken })).status).toBe(401);
  });

  it('rejects forged and missing tokens', async () => {
    expect((await api(h, 'GET', '/v1/me')).status).toBe(401);
    expect((await api(h, 'GET', '/v1/me', { token: 'eyJhbGciOiJub25lIn0.e30.' })).status).toBe(401);
  });
});
