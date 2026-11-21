/**
 * Launch security checks that sweep the whole API surface, so a new route
 * can't ship without authentication or role checks by accident.
 * See docs/launch-readiness.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let routes: { method: string; path: string }[];
beforeAll(async () => {
  h = await startHarness();
  routes = listRoutes(h);
});
afterAll(() => h.close());

/**
 * Routes that answer without a session. Each one authenticates another way
 * (signed webhook, guest link token, signed file URL, Connect key) or is public on purpose.
 * Adding to this list needs a reason in the same change.
 */
const PUBLIC = new Set([
  'GET /health/live',
  'GET /health/ready',
  'GET /health/metrics', // METRICS_TOKEN bearer; 404 when unset
  'POST /v1/auth/register',
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  'POST /v1/auth/mfa/verify',
  'GET /v1/auth/sso/callback',
  'POST /v1/auth/sso/exchange',
  'GET /v1/auth/sso/:slug',
  'GET /v1/auth/sso/:slug/start',
  'GET /v1/billing/plans', // marketing page pricing
  'POST /v1/billing/stripe/webhook', // Stripe signature
  'GET /v1/branding/public/:slug', // sign-in page branding
  'POST /v1/calls/livekit/webhook', // LiveKit signature
  'POST /v1/connectors/webhooks/:key', // provider signature; unknown keys answer 404
  'GET /v1/connectors/webhooks/:key', // WeChat URL verification (signed query)
  'GET /v1/files/:tenantId/:id', // signed, expiring URL
  'GET /v1/recordings/export/:tenantId', // signed, expiring URL
  'GET /v1/book/:slug', // public booking page (rate limited)
  'GET /v1/book/:slug/slots',
  'POST /v1/book/:slug',
  'GET /v1/guest/:token', // guest link token
  'GET /v1/guest/:token/calendar.ics',
  'GET /v1/guest/:token/chat',
  'POST /v1/guest/:token/chat',
  'GET /v1/guest/:token/lobby',
  'POST /v1/guest/:token/lobby',
  'POST /v1/guest/:token/lobby/leave',
  'POST /v1/guest/:token/rsvp',
]);

/** Prefixes only owners/admins (or platform operators) may use. */
const ADMIN_ONLY = [
  /^\/v1\/admin\//,
  /^\/v1\/platform\//,
  // Linked records are for any member who can read the conversation; the rest is admin-only.
  /^\/v1\/integrations\/(?!records)/,
  /^PUT \/v1\/branding$/,
  /^POST \/v1\/billing\/(checkout|portal)$/,
];

function listRoutes(h: Harness) {
  const ex = h.app.getHttpAdapter().getInstance() as {
    router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  const out: { method: string; path: string }[] = [];
  for (const layer of ex.router.stack)
    if (layer.route)
      for (const m of Object.keys(layer.route.methods))
        out.push({ method: m.toUpperCase(), path: layer.route.path });
  return out;
}

const fill = (path: string) => path.replace(/:\w+/g, '0123456789abcdef01234567');

async function call(method: string, path: string, token?: string) {
  const res = await fetch(h.url + fill(path), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
    redirect: 'manual',
  });
  await res.arrayBuffer();
  return res.status;
}

describe('authentication on every route', () => {
  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('every non-public route answers 401 without a session', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const status = await call(r.method, r.path);
      if (status !== 401) leaks.push(`${status} ${key}`);
    }
    expect(leaks).toEqual([]);
  });

  it('every entry in the public list still exists', () => {
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect([...PUBLIC].filter((k) => !keys.has(k))).toEqual([]);
  });

  it('rejects forged, unsigned and garbage tokens', async () => {
    const owner = await registerTenant(h, 'Forgery Co');
    const [head, body] = owner.session.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const elevated = b64({ ...claims, role: 'owner', tid: 'another-tenant' });
    const tokens = [
      `${head}.${elevated}.${owner.session.accessToken.split('.')[2]}`, // payload swapped
      `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`, // alg=none
      `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJl`, // alg confusion
      'not-a-token',
    ];
    for (const t of tokens) expect(await call('GET', '/v1/me', t)).toBe(401);
    expect(await call('GET', '/v1/me', owner.session.accessToken)).toBe(200);
  });
});

describe('role checks', () => {
  it('members get 403 on every admin and operator route', async () => {
    const owner = await registerTenant(h, 'Roles Co');
    const member = await inviteAndLogin(h, owner.session, owner.slug, 'Mia Member');
    const allowed: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (!ADMIN_ONLY.some((re) => re.test(r.path) || re.test(key))) continue;
      const status = await call(r.method, r.path, member.accessToken);
      // 403 is the answer; 400 would mean the body was validated before the role check.
      if (status !== 403) allowed.push(`${status} ${key}`);
    }
    expect(allowed).toEqual([]);
  });
});

describe('request hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await fetch(h.url + '/health/live');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('refuses JSON bodies over 256 KB', async () => {
    const res = await fetch(h.url + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x'.repeat(300_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('treats query operators in a login body as invalid input, not a query', async () => {
    const owner = await registerTenant(h, 'Injection Co');
    const res = await fetch(h.url + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: owner.slug,
        email: { $ne: null },
        password: { $ne: null },
        device: device(),
      }),
    });
    expect(res.status).toBe(400);
  });

  it('does not allow cross-origin calls from unknown sites', async () => {
    const res = await fetch(h.url + '/v1/billing/plans', {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const owner = await registerTenant(h, 'Enumeration Co');
    const login = (email: string) =>
      fetch(h.url + '/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: owner.slug,
          email,
          password: 'wrong password 123',
          device: device(),
        }),
      }).then(async (r) => ({ status: r.status, body: await r.text() }));
    const known = await login(`priya@${owner.slug}.test`);
    const unknown = await login(`nobody@${owner.slug}.test`);
    expect(known.status).toBe(401);
    expect(unknown).toEqual(known);
  });
});

describe('rate limits', () => {
  it('locks out repeated wrong passwords', async () => {
    // Same database as the main harness, so the account is made without spending the IP's
    // registration allowance; only this second app instance enforces limits.
    const owner = await registerTenant(h, 'Brute Co');
    const limited = await startHarness({ RATE_LIMIT_DISABLED: 'false' }, { dbName: h.dbName });
    try {
      const slug = owner.slug;
      const email = `priya@${slug}.test`;
      const statuses: number[] = [];
      for (let i = 0; i < 25; i++) {
        const r = await fetch(limited.url + '/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenantSlug: slug,
            email,
            password: `guess number ${i}`,
            device: device(),
          }),
        });
        await r.arrayBuffer();
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
      expect(statuses.indexOf(429)).toBeLessThanOrEqual(20);
    } finally {
      await limited.close(false);
    }
  });
});

describe('metrics endpoint', () => {
  it('is off without METRICS_TOKEN and needs the token when on', async () => {
    expect((await fetch(h.url + '/health/metrics')).status).toBe(404);
    const token = 'metrics-token-for-tests-0123456789';
    const m = await startHarness({ METRICS_TOKEN: token }, { dbName: h.dbName });
    try {
      expect((await fetch(m.url + '/health/metrics')).status).toBe(401);
      await fetch(m.url + '/v1/billing/plans');
      const res = await fetch(m.url + '/health/metrics', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(
        'sc_http_requests_total{method="GET",route="/v1/billing/plans",status="2xx"} 1',
      );
      expect(text).toContain('sc_mongo_up 1');
      expect(text).toContain('sc_socket_connections 0');
    } finally {
      await m.close(false);
    }
  });
});
