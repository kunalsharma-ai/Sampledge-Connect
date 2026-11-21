import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  IntegrationTestResult,
  IntegrationView,
  Session,
  SsoInfo,
} from '@sampledge/contracts';
import {
  api,
  device,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/**
 * A small OpenID Connect provider: discovery, JWKS, and a token endpoint that checks
 * client_secret_basic and the PKCE verifier, then signs an RS256 id_token.
 */
let idp: Server;
let issuer: string;
let privateKey: CryptoKey;
let jwk: JWK;
const codes = new Map<
  string,
  { email: string; nonce: string; challenge: string; redirectUri: string; claims: object }
>();
let audience = 'connect-client';
const CLIENT = 'Basic ' + Buffer.from('connect-client:shh-secret').toString('base64');

let h: Harness;
let owner: Session;
let slug: string;
let ravi: Session;
const WEB = 'http://localhost:3000';

const save = (values: Record<string, unknown>, enabled = true) =>
  api<IntegrationView>(h, 'PUT', '/v1/admin/integrations/sso.oidc', {
    token: owner.accessToken,
    body: {
      enabled,
      values: {
        issuer,
        clientId: 'connect-client',
        clientSecret: 'shh-secret',
        buttonLabel: 'Sign in with Northwind ID',
        allowedDomains: '',
        createUsers: false,
        allowPasswordLogin: true,
        ...values,
      },
    },
  });

/** Plays the browser: start → provider → callback. Returns where Connect sent the browser. */
async function signInAs(
  email: string,
  claims: object = {},
  mangle?: (state: string) => string,
  startQuery: Record<string, string> = { returnTo: `${WEB}/login` },
) {
  const qs = new URLSearchParams({
    deviceId: `dev-${randomBytes(4).toString('hex')}`,
    ...startQuery,
  });
  const start = await fetch(`${h.url}/v1/auth/sso/${slug}/start?${qs}`, { redirect: 'manual' });
  expect(start.status).toBe(302);
  const auth = new URL(start.headers.get('location')!);
  expect(auth.origin + auth.pathname).toBe(`${issuer}/authorize`);
  const p = auth.searchParams;
  expect(p.get('code_challenge_method')).toBe('S256');
  const code = randomBytes(12).toString('hex');
  codes.set(code, {
    email,
    nonce: p.get('nonce')!,
    challenge: p.get('code_challenge')!,
    redirectUri: p.get('redirect_uri')!,
    claims,
  });
  const state = mangle ? mangle(p.get('state')!) : p.get('state')!;
  const cb = await fetch(`${p.get('redirect_uri')}?code=${code}&state=${state}`, {
    redirect: 'manual',
  });
  expect(cb.status).toBe(302);
  return { location: cb.headers.get('location')!, state: p.get('state')!, code };
}
const hashParam = (loc: string, key: string) =>
  new URLSearchParams(new URL(loc).hash.slice(1)).get(key);
const exchange = (code: string) =>
  api<Session>(h, 'POST', '/v1/auth/sso/exchange', { body: { code } });

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer((req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        void (async () => {
          if (req.headers.authorization !== CLIENT) return json(401, { error: 'invalid_client' });
          const f = new URLSearchParams(raw);
          const c = codes.get(f.get('code') ?? '');
          codes.delete(f.get('code') ?? '');
          if (!c) return json(400, { error: 'invalid_grant' });
          const s256 = createHash('sha256')
            .update(f.get('code_verifier') ?? '')
            .digest('base64url');
          if (s256 !== c.challenge || f.get('redirect_uri') !== c.redirectUri)
            return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
          const idToken = await new SignJWT({
            email: c.email,
            email_verified: true,
            name: 'Lena Ortiz',
            nonce: c.nonce,
            ...c.claims,
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
            .setIssuer(issuer)
            .setAudience(audience)
            .setSubject(c.email)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey);
          json(200, { access_token: 'x', token_type: 'Bearer', id_token: idToken });
        })();
      });
      return;
    }
    json(404, {});
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;

  h = await startHarness({ CORS_ORIGINS: WEB });
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
});
afterAll(async () => {
  await h?.close();
  idp?.close();
});

describe('single sign-on (OIDC)', () => {
  it('is off until an admin saves the provider; the test reports the redirect URI', async () => {
    const off = await api<SsoInfo>(h, 'GET', `/v1/auth/sso/${slug}`);
    expect(off.body).toEqual({ enabled: false, label: null, passwordLogin: true });
    expect((await save({})).status).toBe(200);
    const t = await api<IntegrationTestResult>(h, 'POST', '/v1/admin/integrations/sso.oidc/test', {
      token: owner.accessToken,
      body: {},
    });
    expect(t.body.ok).toBe(true);
    expect(t.body.message).toContain('/v1/auth/sso/callback');
    const on = await api<SsoInfo>(h, 'GET', `/v1/auth/sso/${slug}`);
    expect(on.body).toEqual({
      enabled: true,
      label: 'Sign in with Northwind ID',
      passwordLogin: true,
    });
  });

  it('signs an existing member in; the one-time code works once', async () => {
    const r = await signInAs(ravi.user.email.toUpperCase());
    expect(r.location).toMatch(new RegExp(`^${WEB}/login#sso=`));
    const code = hashParam(r.location, 'sso')!;
    const s = await exchange(code);
    expect(s.status).toBe(200);
    expect(s.body.user.userId).toBe(ravi.user.userId);
    expect(s.body.accessToken).toBeTruthy();
    expect((await exchange(code)).status).toBe(401);
  });

  it('refuses a replayed or forged state', async () => {
    const r = await signInAs(ravi.user.email, {}, (s) => s + 'x');
    expect(hashParam(r.location, 'sso_error')).toMatch(/expired/);
  });

  it('refuses people who are not members unless auto-add is on', async () => {
    const r = await signInAs(`lena@${slug}.test`);
    expect(hashParam(r.location, 'sso_error')).toMatch(/don’t have an account/);
    await save({ createUsers: true, allowedDomains: `${slug}.test` });
    const ok = await signInAs(`lena@${slug}.test`);
    const s = await exchange(hashParam(ok.location, 'sso')!);
    expect(s.body.user).toMatchObject({ displayName: 'Lena Ortiz', role: 'member' });
  });

  it('enforces the domain allowlist and verified email', async () => {
    const r = await signInAs('someone@elsewhere.test');
    expect(hashParam(r.location, 'sso_error')).toMatch(/elsewhere\.test addresses/);
    const u = await signInAs(ravi.user.email, { email_verified: false });
    expect(hashParam(u.location, 'sso_error')).toMatch(/isn’t verified/);
  });

  it('rejects an identity token for another client', async () => {
    audience = 'someone-else';
    const r = await signInAs(ravi.user.email);
    audience = 'connect-client';
    expect(hashParam(r.location, 'sso_error')).toMatch(/didn’t verify/);
  });

  it('SSO-only workspaces refuse member passwords but not the owner’s', async () => {
    await save({ allowPasswordLogin: false, createUsers: true, allowedDomains: '' });
    expect((await api<SsoInfo>(h, 'GET', `/v1/auth/sso/${slug}`)).body.passwordLogin).toBe(false);
    const member = await api(h, 'POST', '/v1/auth/login', {
      body: {
        tenantSlug: slug,
        email: ravi.user.email,
        password: 'temporary password 123',
        device: device(),
      },
    });
    expect(member.status).toBe(403);
    const own = await api<Session>(h, 'POST', '/v1/auth/login', {
      body: {
        tenantSlug: slug,
        email: owner.user.email,
        password: 'correct horse battery staple',
        device: device(),
      },
    });
    expect(own.status).toBe(200);
  });

  it('only returns people to the web app’s own origins', async () => {
    const start = await fetch(
      `${h.url}/v1/auth/sso/${slug}/start?returnTo=${encodeURIComponent('https://evil.example/x')}`,
      { redirect: 'manual' },
    );
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cb = await fetch(`${h.url}/v1/auth/sso/callback?error=access_denied&state=${state}`, {
      redirect: 'manual',
    });
    expect(cb.headers.get('location')!.startsWith(`${WEB}/login#sso_error=`)).toBe(true);
  });
});

describe('single sign-on from the mobile app', () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const app = (extra: Record<string, string> = {}) => ({
    returnTo: 'sampledge://sso',
    platform: 'ios',
    deviceName: 'iPhone 17',
    codeChallenge: challenge,
    ...extra,
  });
  const mobileExchange = (code: string, codeVerifier?: string) =>
    api<Session>(h, 'POST', '/v1/auth/sso/exchange', { body: { code, codeVerifier } });

  beforeAll(async () => {
    await save({ allowPasswordLogin: true, createUsers: false, allowedDomains: '' });
  });

  it('returns to the app scheme and needs the app’s verifier to exchange', async () => {
    const r = await signInAs(ravi.user.email, {}, undefined, app());
    expect(r.location).toMatch(/^sampledge:\/\/sso#sso=/);
    const s = await mobileExchange(hashParam(r.location, 'sso')!, verifier);
    expect(s.status).toBe(200);
    expect(s.body.user.userId).toBe(ravi.user.userId);
    // The session works and is registered as an iPhone.
    const devices = await api<{ name: string; platform: string; current: boolean }[]>(
      h,
      'GET',
      '/v1/devices',
      { token: s.body.accessToken },
    );
    expect(devices.body.find((d) => d.current)).toMatchObject({
      name: 'iPhone 17',
      platform: 'ios',
    });
  });

  it('an intercepted code is useless without the verifier, and the session is revoked', async () => {
    const r = await signInAs(ravi.user.email, {}, undefined, app());
    const code = hashParam(r.location, 'sso')!;
    const wrong = randomBytes(32).toString('base64url');
    expect((await mobileExchange(code, wrong)).status).toBe(401);
    expect((await mobileExchange(code, verifier)).status).toBe(401); // single use
    const missing = await signInAs(ravi.user.email, {}, undefined, app());
    expect((await mobileExchange(hashParam(missing.location, 'sso')!)).status).toBe(401);
  });

  it('refuses an app return without a challenge, and other schemes', async () => {
    const noChallenge = await fetch(
      `${h.url}/v1/auth/sso/${slug}/start?returnTo=${encodeURIComponent('sampledge://sso')}`,
      { redirect: 'manual' },
    );
    expect(noChallenge.status).toBe(400);
    const r = await signInAs(ravi.user.email, {}, undefined, app({ returnTo: 'evilapp://sso' }));
    expect(r.location.startsWith(`${WEB}/login#sso=`)).toBe(true);
  });

  it('sends errors back to the app too', async () => {
    const r = await signInAs('someone@elsewhere.test', {}, undefined, app());
    expect(r.location).toMatch(/^sampledge:\/\/sso#sso_error=/);
  });
});
