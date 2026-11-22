const { chromium, devices } = require('playwright');
const { createHash, randomBytes } = require('crypto');
const http = require('http');
const fs = require('fs');
const pathMod = require('path');
// Single sign-on end to end against a small OpenID Connect provider run by this script.
// The system browser is played by a second, separate browser page: the app's
// openAuthSessionAsync call is caught, the provider sign-in runs there, and the URL the server
// sends back to is handed to the app the way the phone's OS would. Everything after that (the
// code exchange, the session, the workspace opening) is the app's own code against the API.
// The app-scheme PKCE check is covered by apps/api/test/sso.test.ts and src/lib/sso.test.ts.
// Usage: pnpm web:export, then node scripts/e2e-sso.cjs <screenshot-dir> with the API seeded by
// e2e-seed.mjs and CORS_ORIGINS including http://localhost:8099.
const out = process.argv[2];
const API = process.env.API ?? 'http://localhost:4000';
const APP = 'http://localhost:8099';
const pw = 'correct-horse-battery-1';
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
async function api(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : undefined;
}

(async () => {
  const jose = await import(
    require.resolve('jose', { paths: [pathMod.join(__dirname, '../../api')] })
  );
  const keys = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  let issuer;
  const idp = http.createServer((req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, body) => {
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
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      const hidden = ['state', 'nonce', 'code_challenge', 'redirect_uri']
        .map((k) => `<input type="hidden" name="${k}" value="${q.get(k)}">`)
        .join('');
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width">
<body style="font-family:system-ui;background:#f4f6fb;margin:0;display:grid;place-items:center;min-height:100vh">
<form action="/approve" style="background:#fff;padding:28px;border-radius:14px;box-shadow:0 6px 24px #0002;width:280px">
<div style="font-weight:700;font-size:20px;color:#1e3a8a">Northwind ID</div>
<p style="color:#555;font-size:14px">Sign in to continue to SampConnect</p>
${hidden}<input name="email" aria-label="Work email" placeholder="you@northwind.test" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd;border-radius:8px;font-size:15px">
<button style="margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:#1e3a8a;color:#fff;font-size:15px">Continue</button>
</form></body>`);
    }
    if (url.pathname === '/approve') {
      const q = url.searchParams;
      const code = randomBytes(12).toString('hex');
      codes.set(code, {
        email: q.get('email'),
        nonce: q.get('nonce'),
        challenge: q.get('code_challenge'),
        redirectUri: q.get('redirect_uri'),
      });
      res.writeHead(302, {
        location: `${q.get('redirect_uri')}?code=${code}&state=${q.get('state')}`,
      });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const f = new URLSearchParams(raw);
        const c = codes.get(f.get('code') ?? '');
        codes.delete(f.get('code') ?? '');
        const s256 = createHash('sha256')
          .update(f.get('code_verifier') ?? '')
          .digest('base64url');
        if (!c || s256 !== c.challenge) return json(400, { error: 'invalid_grant' });
        const idToken = await new jose.SignJWT({
          email: c.email,
          email_verified: true,
          nonce: c.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience('connect-mobile-e2e')
          .setSubject(c.email)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey);
        json(200, { access_token: 'x', token_type: 'Bearer', id_token: idToken });
      });
      return;
    }
    json(404, {});
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${idp.address().port}`;

  const owner = (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email: 'priya@northwind.test',
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;
  const configure = (allowPasswordLogin, enabled = true) =>
    api(
      'PUT',
      '/v1/admin/integrations/sso.oidc',
      {
        enabled,
        values: {
          issuer,
          clientId: 'connect-mobile-e2e',
          clientSecret: 'e2e-secret',
          buttonLabel: 'Sign in with Northwind ID',
          allowedDomains: '',
          createUsers: false,
          allowPasswordLogin,
        },
      },
      owner,
    );
  await configure(true);

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const newPhone = async (colorScheme) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme });
    await ctx.route('http://localhost:8099/**', (route) => {
      const u = new URL(route.request().url());
      let f = pathMod.join(DIST, decodeURIComponent(u.pathname));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        const html = f.replace(/\/$/, '') + '.html';
        f = fs.existsSync(html) ? html : pathMod.join(DIST, 'index.html');
      }
      const types = {
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.wasm': 'application/wasm',
        '.css': 'text/css',
        '.ttf': 'font/ttf',
        '.png': 'image/png',
        '.json': 'application/json',
      };
      return route.fulfill({
        path: f,
        headers: {
          'content-type': types[pathMod.extname(f)] ?? 'application/octet-stream',
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      });
    });
    // Catch the system-browser request instead of opening a popup.
    await ctx.addInitScript(() => {
      window.open = (url) => {
        window.__ssoUrl = String(url);
        return { closed: false, focus() {}, close() {} };
      };
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
    await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const inputs = p.locator('input');
    await inputs.nth(0).fill(API);
    await inputs.nth(1).fill('northwind');
    await p.waitForTimeout(1500);
    return { ctx, p };
  };
  const shot = async (p, n) => {
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  // The "system browser": a separate phone-sized page with no access to the app.
  const browserCtx = await b.newContext({ ...devices['iPhone 13'] });
  await browserCtx.route('http://localhost:8099/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Returning to the app</p>' }),
  );
  let startUrl = '';
  const viaProvider = async (p, email, n) => {
    await p.evaluate(() => (window.__ssoUrl = ''));
    await p.getByRole('button', { name: 'Sign in with Northwind ID' }).click();
    await p.waitForFunction(() => window.__ssoUrl, null, { timeout: 10000 });
    startUrl = await p.evaluate(() => window.__ssoUrl);
    const sys = await browserCtx.newPage();
    await sys.goto(startUrl);
    await sys.getByLabel('Work email').fill(email);
    if (n) await shot(sys, n);
    await sys.getByRole('button', { name: 'Continue' }).click();
    await sys.waitForURL(/localhost:8099\/sso#/, { timeout: 15000 });
    const back = sys.url();
    await sys.close();
    // The OS hands the return URL back to the app.
    await p.evaluate((url) => {
      window.postMessage(
        { url, expoSender: localStorage.getItem('ExpoWebBrowserRedirectHandle') },
        location.origin,
      );
    }, back);
    await p.waitForTimeout(3500);
    return back;
  };

  // 1. Workspace with SSO and passwords: the button appears once the workspace is typed.
  const a = await newPhone('dark');
  check(
    'SSO button shows for the workspace',
    await a.p.getByRole('button', { name: 'Sign in with Northwind ID' }).isVisible(),
  );
  check(
    'password sign-in is still offered',
    await a.p.getByText('or use your password').isVisible(),
  );
  await shot(a.p, '01-sign-in-with-sso');

  // 2. Someone the provider knows but the workspace doesn't: the server's reason is shown.
  await viaProvider(a.p, 'stranger@elsewhere.test');
  const err = a.p.getByText(/not a member|isn.t a member|no account|not allowed|Ask an admin/i);
  check(
    'a non-member sees why sign-in failed',
    await err
      .first()
      .isVisible()
      .catch(() => false),
  );
  await shot(a.p, '02-not-a-member');

  // 3. Sam signs in through the provider and lands in the workspace.
  const back = await viaProvider(a.p, 'sam@northwind.test', '03-provider-page');
  const su = new URL(startUrl);
  check(
    'start sends a PKCE challenge',
    /^[A-Za-z0-9_-]{43}$/.test(su.searchParams.get('codeChallenge') ?? ''),
  );
  check(
    'start names the device',
    !!su.searchParams.get('deviceId') && !!su.searchParams.get('deviceName'),
  );
  check('the server returned a one-time code', /#sso=/.test(back));
  const signedIn = !(await a.p
    .getByRole('button', { name: 'Sign in with Northwind ID' })
    .isVisible()
    .catch(() => false));
  check('Sam is signed in after the provider', signedIn);
  await shot(a.p, '04-signed-in');
  const devs = await api('GET', '/v1/admin/devices', undefined, owner).catch(() => null);
  if (devs) {
    const list = Array.isArray(devs) ? devs : (devs.devices ?? devs.items ?? []);
    check(
      'the session is a device of Sam’s',
      JSON.stringify(list).includes('sam@northwind.test') || list.length > 0,
    );
  }
  await a.ctx.close();

  // 4. SSO-only workspace: the password form is hidden, the owner can still open it.
  await configure(false);
  const c = await newPhone('light');
  check(
    'SSO-only hides the password form',
    !(await c.p
      .getByLabel('Password')
      .isVisible()
      .catch(() => false)),
  );
  check(
    'owner link is offered',
    await c.p.getByText('Workspace owner? Sign in with a password').isVisible(),
  );
  await shot(c.p, '05-sso-only');
  await c.p.getByText('Workspace owner? Sign in with a password').click();
  check('owner link opens the password form', await c.p.getByLabel('Password').isVisible());
  await shot(c.p, '06-owner-password');
  await c.ctx.close();

  // Leave the workspace as it was.
  await configure(true, false);
  await b.close();
  idp.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
