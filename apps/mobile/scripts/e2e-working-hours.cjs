const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Working hours end to end: Sam saves new hours on the phone and the server has them; a change
// made on another device (the web) shows on the open screen live; offline, a change is kept on
// the phone, shows again after reopening, and reaches the server on reconnect.
// Usage: pnpm web:export, then node scripts/e2e-working-hours.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs.
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
  const weekdays = (start, end) => [1, 2, 3, 4, 5].map((day) => ({ day, start, end }));
  await api(
    'PUT',
    '/v1/me/working-hours',
    { timeZone: 'UTC', days: weekdays('09:00', '17:30') },
    sam,
  );
  const hours = () => api('GET', '/v1/me/working-hours', undefined, sam);

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
  const save = async () => {
    await p.getByRole('button', { name: 'Save working hours' }).click();
    await p.waitForTimeout(2500);
  };
  const open = async () => {
    await p.goto(`${APP}/settings/working-hours`);
    await p.waitForTimeout(3000);
  };

  // 1. Save on the phone: Monday starts at 08:00, Friday off.
  await open();
  check('loads the server hours', /09:00/.test(await body()) && /17:30/.test(await body()));
  await p.getByRole('button', { name: 'Monday start earlier' }).click();
  await p.getByRole('button', { name: 'Monday start earlier' }).click();
  await p.getByRole('switch', { name: 'Working on Friday' }).click();
  await shot('01-editing');
  await save();
  let h = await hours();
  check(
    'server has the new hours',
    h.days.find((d) => d.day === 1)?.start === '08:00' && !h.days.some((d) => d.day === 5),
  );
  check('saved note', /Suggested meeting times now follow these hours/.test(await body()));
  await shot('02-saved');

  // 2. Changed on the web: the open screen follows.
  await api(
    'PUT',
    '/v1/me/working-hours',
    { timeZone: 'Asia/Kolkata', days: weekdays('10:00', '18:30') },
    sam,
  );
  await p.waitForTimeout(4000);
  let t = await body();
  check('another device change shows live', /Asia\/Kolkata/.test(t) && /18:30/.test(t));
  await shot('03-live-from-web');

  // 3. Offline: kept on the phone, shown again on reopening, sent on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Tuesday end later' }).click();
  await save();
  check('offline note', /Saved on this phone/.test(await body()));
  await shot('04-offline-saved');
  await p.goto(`${APP}/settings/working-hours`).catch(() => undefined);
  await p.waitForTimeout(3000);
  check('offline change still shows', /19:00/.test(await body()));
  await shot('05-offline-reopened');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  h = await hours();
  check(
    'offline change reached the server',
    h.days.find((d) => d.day === 2)?.end === '19:00' && h.timeZone === 'Asia/Kolkata',
  );

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
