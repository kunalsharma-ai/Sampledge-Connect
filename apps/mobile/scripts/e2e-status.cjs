const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Status and quiet hours end to end: Sam sets Busy with a preset that clears itself and turns on
// quiet hours; the server and his More tab show it. Priya's status reaches Sam live on her
// profile and in their DM header. Offline, a new status shows at once and syncs on reconnect.
// Usage: pnpm web:export, then node scripts/e2e-status.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs.
const out = process.argv[2];
const API = process.env.API ?? 'http://localhost:4000/api';
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
  const users = await api('GET', '/v1/users', undefined, sam);
  const uid = (e) => users.find((u) => u.email === e).userId;
  const priyaId = uid('priya@northwind.test');
  const cleared = { availability: 'auto', emoji: null, text: null, expiresAt: null };
  await api('PUT', '/v1/me/status', cleared, sam);
  await api('PUT', '/v1/me/status', cleared, priya);
  await api(
    'PUT',
    '/v1/me/dnd-schedule',
    { enabled: false, timeZone: 'UTC', days: [1, 2, 3, 4, 5], start: '19:00', end: '08:00' },
    sam,
  );
  const dm = await api('POST', '/v1/conversations', { kind: 'dm', memberIds: [priyaId] }, sam);

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
  await inputs.nth(0).fill(APP);
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
  const save = async () => {
    await p.getByRole('button', { name: 'Save' }).click();
    await p.waitForTimeout(2500);
  };

  // 1. Busy, "In a meeting" for an hour, and weekday quiet hours.
  await p.goto(`${APP}/settings/status`);
  await p.waitForTimeout(3000);
  await p.getByRole('radio', { name: 'Busy', exact: true }).click();
  await p.getByRole('button', { name: 'Use In a meeting' }).click();
  await p.getByRole('switch', { name: 'Quiet hours' }).click();
  await p.waitForTimeout(500);
  let t = await body();
  check('preview shows what others will see', /Busy · 📅 In a meeting · until/.test(t));
  await shot('01-status');
  await p.getByRole('button', { name: 'To later' }).click();
  await p.waitForTimeout(300);
  await shot('02-quiet-hours');
  await save();
  let s = await api('GET', '/v1/me/status', undefined, sam);
  check(
    'server has the status with an expiry',
    s.status.availability === 'busy' && s.status.text === 'In a meeting' && !!s.status.expiresAt,
  );
  check(
    'server has the quiet hours',
    s.dndSchedule.enabled && s.dndSchedule.start === '19:00' && s.dndSchedule.end === '08:30',
  );
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2500);
  check('More shows your status', /Busy · 📅 In a meeting/.test(await body()));
  await shot('03-more');

  // 2. Priya's status reaches Sam live.
  await p.goto(`${APP}/person/${priyaId}`);
  await p.waitForTimeout(2500);
  await api(
    'PUT',
    '/v1/me/status',
    { availability: 'dnd', emoji: '🎯', text: 'Writing the wave 3 report', expiresAt: null },
    priya,
  );
  await p.waitForTimeout(4000);
  t = await body();
  check(
    'teammate status shows live',
    /Do not disturb · 🎯 Writing the wave 3 report/.test(t) && /Notifications paused/.test(t),
  );
  await shot('04-teammate');
  await p.goto(`${APP}/conversation/${dm.conversationId}`);
  await p.waitForTimeout(3000);
  check('DM header shows her status', /Writing the wave 3 report/.test(await body()));
  await shot('05-dm-header');

  // 3. Offline change shows at once and reaches the server on reconnect.
  await p.goto(`${APP}/settings/status`);
  await p.waitForTimeout(2500);
  await ctx.setOffline(true);
  await p.waitForTimeout(1200);
  await p.getByRole('radio', { name: 'Away', exact: true }).click();
  await p.getByRole('button', { name: 'Use In the field' }).click();
  await save();
  await p.goto(`${APP}/more`).catch(() => undefined);
  await p.waitForTimeout(2000);
  check('offline status shows at once', /Away · 🧪 In the field/.test(await body()));
  await shot('06-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  s = await api('GET', '/v1/me/status', undefined, sam);
  check(
    'offline status reached the server',
    s.status.availability === 'away' && s.status.text === 'In the field',
  );

  // 4. Clear.
  await p.goto(`${APP}/settings/status`);
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Clear status' }).click();
  await p.waitForTimeout(3000);
  s = await api('GET', '/v1/me/status', undefined, sam);
  check('cleared on the server', s.status.availability === 'auto' && !s.status.text);

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
