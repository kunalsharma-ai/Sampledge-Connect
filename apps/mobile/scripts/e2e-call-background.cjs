const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Call background end to end: Sam picks a prebuilt scene, uploads an own image, follows a change
// made on another device live, picks offline (sent on reconnect), sees the company background
// locked in when an admin requires it, and removes the image. Priya manages the rules.
// Usage: pnpm web:export, then node scripts/e2e-call-background.cjs <screenshot-dir> with the API
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

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const route = (ctx) =>
    ctx.route('http://localhost:8099/**', (route) => {
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

  const priya = await login('priya@northwind.test');
  const reset = async () => {
    await api(
      'PUT',
      '/v1/admin/call-backgrounds',
      { defaultChoice: { kind: 'none' }, enforceLogo: false },
      priya,
    );
    await api('DELETE', '/v1/me/call-background/image', undefined, sam);
    await api('PUT', '/v1/me/call-background', { kind: 'none' }, sam);
  };
  await reset();
  const server = () => api('GET', '/v1/me/call-background', undefined, sam);

  const signIn = async (scheme, email) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
    await route(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
    await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const inputs = p.locator('input');
    await inputs.nth(0).fill(API);
    await inputs.nth(1).fill('northwind');
    await inputs.nth(2).fill(email);
    await inputs.nth(3).fill(pw);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.waitForTimeout(5000);
    await p.goto(`${APP}/settings/call-background`);
    await p.waitForTimeout(3500);
    return { ctx, p };
  };
  const { ctx, p } = await signIn('dark', 'sam@northwind.test');
  const shot = async (page, n) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = () => p.innerText('body');
  const tile = (name) => p.getByRole('radio', { name, exact: true }).first();
  const pick = async (name) => {
    await tile(name).scrollIntoViewIfNeeded();
    await tile(name).click();
    await p.waitForTimeout(1500);
  };

  check('opens on no background', /No background\n/.test(await body()));
  await shot(p, '01-picker');

  // 1. A prebuilt scene, saved to the account.
  await pick('Library');
  check('preset saved to the account', (await server()).choice?.presetId === 'library');
  await p.getByTestId('call-background-preview').scrollIntoViewIfNeeded();
  await shot(p, '02-library');

  // 2. Your own image.
  const photo = pathMod.join(out, 'test-photo.jpg');
  {
    const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
    await pg.setContent(`<body style="margin:0;width:1600px;height:900px;background:
      linear-gradient(120deg,#0f4c5c 0%,#3a7d8c 50%,#e9c46a 100%)">
      <div style="position:absolute;left:0;right:0;bottom:0;height:300px;background:#264653"></div>
      <div style="position:absolute;left:1100px;top:120px;width:220px;height:220px;border-radius:50%;background:#f4a261"></div>
    </body>`);
    await pg.screenshot({ path: photo, type: 'jpeg', quality: 85 });
    await pg.close();
  }
  const add = p.getByRole('radio', { name: 'Add your image', exact: true });
  await add.scrollIntoViewIfNeeded();
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), add.click()]);
  await chooser.setFiles(photo);
  await p.waitForTimeout(4000);
  let s = await server();
  check('own image uploaded and selected', s.choice?.kind === 'custom' && !!s.customImageUrl);
  await p.getByTestId('call-background-preview').scrollIntoViewIfNeeded();
  await shot(p, '03-own-image');

  // 3. Another device picks Boardroom: this phone follows live.
  await api('PUT', '/v1/me/call-background', { kind: 'preset', presetId: 'boardroom' }, sam);
  await p.waitForTimeout(2500);
  check(
    'follows another device live',
    /Boardroom\n/.test(await body()) &&
      (await tile('Boardroom').getAttribute('aria-checked')) === 'true',
  );

  // 4. Offline pick, sent on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await pick('Mountain view');
  check(
    'offline pick shows at once',
    (await tile('Mountain view').getAttribute('aria-checked')) === 'true',
  );
  check('not sent while offline', (await server()).choice?.presetId === 'boardroom');
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  check('sent on reconnect', (await server()).choice?.presetId === 'mountain-view');

  // 5. Priya requires the company background: Sam's picker locks live.
  const admin = await signIn('dark', 'priya@northwind.test');
  await admin.p.getByRole('button', { name: 'Manage', exact: true }).click();
  await admin.p.waitForTimeout(800);
  await admin.p.getByRole('radio', { name: 'Blur', exact: true }).first().click();
  await admin.p.getByRole('switch', { name: 'Require the company background' }).click();
  await admin.p.waitForTimeout(500);
  await shot(admin.p, '04-admin-rules');
  await admin.p.getByRole('button', { name: 'Save rules' }).click();
  await admin.p.waitForTimeout(3000);
  const pol = (await server()).policy;
  check('admin saved the rules', pol.enforceLogo === true && pol.defaultChoice.kind === 'blur');
  await p.waitForTimeout(2000);
  check(
    'company background locked in live',
    /uses the company background for everyone/.test(await body()),
  );
  await p.getByTestId('call-background-preview').scrollIntoViewIfNeeded();
  await shot(p, '05-company-locked');
  await admin.p.getByRole('button', { name: 'Manage', exact: true }).click();
  await admin.p.getByRole('switch', { name: 'Require the company background' }).click();
  await admin.p.getByRole('button', { name: 'Save rules' }).click();
  await admin.p.waitForTimeout(2500);

  // 6. Remove the image.
  await p.waitForTimeout(1500);
  await pick('Your image');
  const rm = p.getByRole('button', { name: 'Remove image' });
  await rm.scrollIntoViewIfNeeded();
  await rm.click();
  await p.waitForTimeout(800);
  const confirm = p.getByRole('button', { name: 'Remove', exact: true });
  if (await confirm.count()) await confirm.last().click();
  await p.waitForTimeout(3000);
  s = await server();
  check('image removed, back to the default', !s.customImageUrl && s.effective.kind === 'blur');

  // Light theme.
  const light = await signIn('light', 'sam@northwind.test');
  await light.p.getByRole('radio', { name: 'Seaside view', exact: true }).first().click();
  await light.p.waitForTimeout(1500);
  await light.p.getByTestId('call-background-preview').scrollIntoViewIfNeeded();
  await shot(light.p, '06-light');

  await reset();
  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
