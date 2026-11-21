const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Chat themes end to end: Sam picks a theme on the phone and the server has it; conversations
// take its background and bubble colors; a pick made on another device shows live; offline picks
// sync on reconnect; organization rules from an admin narrow the picker live.
// Usage: pnpm web:export, then node scripts/e2e-chat-themes.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs (and built with chat themes).
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
const login = async (email) =>
  (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email,
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;

(async () => {
  const sam = await login('sam@northwind.test');
  const priya = await login('priya@northwind.test');
  const policy = (p) => api('PUT', '/v1/admin/chat-themes', p, priya);
  await policy({ defaultThemeId: 'default', allowed: null });
  await api('PUT', '/v1/me/chat-theme', { themeId: null }, sam);
  const theme = () => api('GET', '/v1/me/chat-theme', undefined, sam);
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const list = Array.isArray(convs) ? convs : (convs.items ?? convs.conversations);
  const conv = list.find((c) => c.kind === 'channel') ?? list[0];

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
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
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const inputs = p.locator('input');
  await inputs.nth(0).fill(API);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill('sam@northwind.test');
  await inputs.nth(3).fill(pw);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForTimeout(5000);
  const shot = async (n) => {
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = () => p.innerText('body');
  const open = async () => {
    await p.goto(`${APP}/settings/chat-theme`);
    await p.waitForTimeout(3000);
  };

  const backdrop = (id) => p.locator(`[data-testid="chat-backdrop-${id}"]`).count();
  const toConv = async () => {
    await p.goto(`${APP}/conversation/${conv.conversationId}`);
    await p.waitForTimeout(3500);
  };

  // 1. Pick on the phone.
  await open();
  await shot('01-picker');
  await p.getByRole('radio', { name: 'Skyline Office' }).click();
  await p.waitForTimeout(2500);
  let s = await theme();
  check('server has the pick', s.themeId === 'skyline-office');
  await p.mouse.wheel(0, 500);
  await shot('02-picked');
  await toConv();
  check('conversation shows the skyline', (await backdrop('skyline-office')) === 1);
  await shot('03-conversation-skyline');

  // 2. Picked on another device: the open conversation follows.
  await api('PUT', '/v1/me/chat-theme', { themeId: 'blueprint' }, sam);
  await p.waitForTimeout(4000);
  check('another device pick shows live', (await backdrop('blueprint')) === 1);
  await shot('04-live-blueprint');

  // 3. Offline pick, sent on reconnect.
  await open();
  await ctx.setOffline(true);
  await p.waitForTimeout(1200);
  await p.getByRole('radio', { name: 'Evergreen' }).click();
  await p.waitForTimeout(800);
  await toConv().catch(() => undefined);
  check('offline pick shows at once', (await backdrop('evergreen')) === 1);
  await shot('05-offline-evergreen');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  s = await theme();
  check('offline pick reached the server', s.themeId === 'evergreen');

  // 4. Organization rules narrow the picker live; the removed theme falls back to the default.
  await open();
  await policy({ defaultThemeId: 'graphite', allowed: ['graphite', 'linen'] });
  await p.waitForTimeout(4000);
  let t = await body();
  check('rules reach the phone live', /offers 2 of 20 themes/.test(t));
  check('only allowed themes offered', !/Skyline Office/.test(t) && /Linen/.test(t));
  await shot('06-org-rules');
  await toConv();
  check(
    'removed theme falls back to the default',
    (await backdrop('evergreen')) === 0 && (await theme()).effective === 'graphite',
  );

  await shot('07-conversation-default');
  await policy({ defaultThemeId: 'default', allowed: null });
  await api('PUT', '/v1/me/chat-theme', { themeId: null }, sam);

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
