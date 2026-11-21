import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  LoginResponse,
  MfaChallenge,
  MfaStatus,
  RecoveryCodes,
  Session,
  TotpSetup,
} from '@sampledge/contracts';
import { base32Decode, hotp, totpStep } from '../src/auth/totp.js';
import {
  api,
  device,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let slug: string;
let ravi: Session;
let secret: string;
let recovery: string[];
const RAVI_EMAIL = () => `ravi.kumar@${slug}.test`;
const RAVI_PW = 'temporary password 123';

/** A code for a given offset from now, in 30-second steps. */
const code = (offset = 0) => hotp(base32Decode(secret), totpStep() + offset);
const login = () =>
  api<LoginResponse>(h, 'POST', '/v1/auth/login', {
    body: { tenantSlug: slug, email: RAVI_EMAIL(), password: RAVI_PW, device: device() },
  });
const verify = (challengeId: string, c: string) =>
  api<Session>(h, 'POST', '/v1/auth/mfa/verify', { body: { challengeId, code: c } });
const status = (s: Session) => api<MfaStatus>(h, 'GET', '/v1/auth/mfa', { token: s.accessToken });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
});
afterAll(async () => {
  await h?.close();
});

describe('two-step verification (TOTP)', () => {
  it('is off by default; setup needs a matching first code', async () => {
    expect((await status(ravi)).body).toEqual({
      enabled: false,
      enabledAt: null,
      recoveryCodesLeft: 0,
      pending: false,
    });
    const s = await api<TotpSetup>(h, 'POST', '/v1/auth/mfa/totp/setup', {
      token: ravi.accessToken,
    });
    expect(s.status).toBe(200);
    secret = s.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(s.body.otpauthUrl).toContain(`secret=${secret}`);
    expect(s.body.qrSvg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect((await status(ravi)).body.pending).toBe(true);

    const bad = await api(h, 'POST', '/v1/auth/mfa/totp/enable', {
      token: ravi.accessToken,
      body: { code: '000000' === code() ? '111111' : '000000' },
    });
    expect(bad.status).toBe(400);
    const ok = await api<RecoveryCodes>(h, 'POST', '/v1/auth/mfa/totp/enable', {
      token: ravi.accessToken,
      body: { code: code() },
    });
    expect(ok.status).toBe(200);
    recovery = ok.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await status(ravi)).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
  });

  it('login stops at a challenge until a valid code is given', async () => {
    const r = await login();
    expect(r.status).toBe(200);
    const ch = r.body as MfaChallenge;
    expect(ch.mfaRequired).toBe(true);
    expect(ch).not.toHaveProperty('accessToken');

    expect((await verify(ch.challengeId, '123456')).status).toBe(401);
    // The setup code was already used: the next step's code is the earliest still accepted.
    const s = await verify(ch.challengeId, code(1));
    expect(s.status).toBe(200);
    expect(s.body.accessToken).toBeTruthy();
    // A challenge works once.
    expect((await verify(ch.challengeId, code(1))).status).toBe(401);
  });

  it('refuses a replayed code on a new challenge', async () => {
    const ch = (await login()).body as MfaChallenge;
    expect((await verify(ch.challengeId, code(1))).status).toBe(401);
    expect((await verify(ch.challengeId, code(0))).status).toBe(401);
  });

  it('accepts each recovery code once', async () => {
    const ch = (await login()).body as MfaChallenge;
    expect((await verify(ch.challengeId, recovery[0]!.toUpperCase())).status).toBe(200);
    const ch2 = (await login()).body as MfaChallenge;
    expect((await verify(ch2.challengeId, recovery[0]!)).status).toBe(401);
    expect((await status(ravi)).body.recoveryCodesLeft).toBe(9);
  });

  it('drops the challenge after five wrong codes', async () => {
    const ch = (await login()).body as MfaChallenge;
    for (let i = 0; i < 5; i++) await verify(ch.challengeId, `00000${i}`);
    const r = await verify(ch.challengeId, recovery[1]!);
    expect(r.status).toBe(401);
  });

  it('an admin can reset it; members cannot', async () => {
    const mia = await inviteAndLogin(h, owner, slug, 'Mia Chen');
    expect(
      (await api(h, 'POST', `/v1/users/${ravi.user.userId}/mfa/reset`, { token: mia.accessToken }))
        .status,
    ).toBe(403);
    expect(
      (
        await api(h, 'POST', `/v1/users/${ravi.user.userId}/mfa/reset`, {
          token: owner.accessToken,
        })
      ).status,
    ).toBe(204);
    const r = await login();
    expect((r.body as Session).accessToken).toBeTruthy();
  });

  it('turning it off needs the password and a code', async () => {
    const s = (
      await api<TotpSetup>(h, 'POST', '/v1/auth/mfa/totp/setup', { token: ravi.accessToken })
    ).body;
    secret = s.secret;
    await api(h, 'POST', '/v1/auth/mfa/totp/enable', {
      token: ravi.accessToken,
      body: { code: code() },
    });
    expect(
      (
        await api(h, 'POST', '/v1/auth/mfa/disable', {
          token: ravi.accessToken,
          body: { password: 'wrong', code: code(1) },
        })
      ).status,
    ).toBe(400);
    const off = await api<MfaStatus>(h, 'POST', '/v1/auth/mfa/disable', {
      token: ravi.accessToken,
      body: { password: RAVI_PW, code: code(1) },
    });
    expect(off.body.enabled).toBe(false);
  });
});
