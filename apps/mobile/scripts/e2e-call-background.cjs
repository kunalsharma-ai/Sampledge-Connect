const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Call background end to end: Sam picks a prebuilt scene, uploads an own image, follows a change
// made on another device live, picks offline (sent on reconnect), sees the company background
// locked in when an admin requires it, and removes the image. Priya manages the rules.
// Usage: pnpm web:export, then node scripts/e2e-call-background.cjs <screenshot-dir> with the API
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
    const st = await api('GET', '/v1/me/call-background', undefined, sam);
    for (const u of st.uploads ?? [])
      await api(
        'DELETE',
        u.owner === 'mine'
          ? `/v1/me/call-backgrounds/${u.imageId}`
          : `/v1/admin/call-backgrounds/images/${u.imageId}`,
        undefined,
        u.owner === 'mine' ? sam : priya,
      );
    await api('PUT', '/v1/me/call-background', { kind: 'none' }, sam);
    await api('PUT', '/v1/me/call-appearance', {}, sam);
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
    await inputs.nth(0).fill(APP);
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
  await pick('Library study');
  check('preset saved to the account', (await server()).choice?.presetId === 'library-study');
  await p.getByTestId('call-background-preview').scrollIntoViewIfNeeded();
  await shot(p, '02-library');

  // 2. Your own images.
  const makePhoto = async (file, a, c2) => {
    const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
    await pg.setContent(`<body style="margin:0;width:1600px;height:900px;background:
      linear-gradient(120deg,${a} 0%,#3a7d8c 50%,${c2} 100%)">
      <div style="position:absolute;left:0;right:0;bottom:0;height:300px;background:#264653"></div>
      <div style="position:absolute;left:1100px;top:120px;width:220px;height:220px;border-radius:50%;background:#f4a261"></div>
    </body>`);
    await pg.screenshot({ path: file, type: 'jpeg', quality: 85 });
    await pg.close();
  };
  const photo = pathMod.join(out, 'test-photo.jpg');
  const photo2 = pathMod.join(out, 'test-photo-2.jpg');
  await makePhoto(photo, '#0f4c5c', '#e9c46a');
  await makePhoto(photo2, '#5c0f3a', '#6ae9c4');
  const addImage = async (page, name, file) => {
    const add = page.getByRole('radio', { name, exact: true });
    await add.scrollIntoViewIfNeeded();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
    await chooser.setFiles(file);
    await page.waitForTimeout(4000);
  };
  await addImage(p, 'Add your image', photo);
  let s = await server();
  const mine = (x) => x.uploads.filter((u) => u.owner === 'mine');
  check(
    'own image uploaded and selected',
    mine(s).length === 1 && s.choice?.kind === 'upload' && s.choice.imageId === mine(s)[0].imageId,
  );
  const firstId = mine(s)[0].imageId;
  check('named after the photo', /test-photo\n/.test(await body()));

  // A second one, offline: it shows at once and uploads on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await addImage(p, 'Add your image', photo2);
  check('offline image shows at once', /test-photo-2 · uploading/.test(await body()));
  check('not uploaded while offline', mine(await server()).length === 1);
  await p.getByText('Your backgrounds').scrollIntoViewIfNeeded();
  await shot(p, '03-own-images-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  s = await server();
  check(
    'uploaded on reconnect and selected',
    mine(s).length === 2 && s.choice?.kind === 'upload' && s.choice.imageId !== firstId,
  );

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
  await pick('Penthouse view');
  check(
    'offline pick shows at once',
    (await tile('Penthouse view').getAttribute('aria-checked')) === 'true',
  );
  check('not sent while offline', (await server()).choice?.presetId === 'boardroom');
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  check('sent on reconnect', (await server()).choice?.presetId === 'penthouse-view');

  // 5. Remove the first image.
  const rm = p.getByRole('button', { name: 'Remove test-photo', exact: true });
  await rm.scrollIntoViewIfNeeded();
  await rm.click();
  await p.waitForTimeout(800);
  const confirm = p.getByRole('button', { name: 'Remove', exact: true });
  if (await confirm.count()) await confirm.last().click();
  await p.waitForTimeout(3000);
  s = await server();
  check(
    'image removed everywhere',
    mine(s).length === 1 && !mine(s).some((u) => u.imageId === firstId),
  );

  // 6. How you look: a look and Enhance, saved to the account.
  const look = p.getByRole('button', { name: 'How you look on camera' });
  await look.scrollIntoViewIfNeeded();
  await look.click();
  await p.waitForTimeout(2500);
  await p.getByRole('radio', { name: 'Warm', exact: true }).click();
  await p.getByRole('button', { name: 'Enhance', exact: true }).click();
  await p.waitForTimeout(2500);
  s = await server();
  check(
    'appearance saved to the account',
    s.appearance.filter === 'warm' && s.appearance.smoothing === 45,
  );
  await shot(p, '04-appearance');
  // Changed on another device: this phone follows.
  await api('PUT', '/v1/me/call-appearance', { ...s.appearance, filter: 'mono' }, sam);
  await p.waitForTimeout(2500);
  check(
    'appearance follows another device',
    (await p
      .getByRole('radio', { name: 'Black and white', exact: true })
      .getAttribute('aria-checked')) === 'true',
  );
  await p.goBack();
  await p.waitForTimeout(1500);

  // 7. Priya adds a background for everyone and requires the company background.
  const admin = await signIn('dark', 'priya@northwind.test');
  await admin.p.getByRole('button', { name: 'Manage', exact: true }).click();
  await admin.p.waitForTimeout(800);
  await addImage(admin.p, 'Add for everyone', photo);
  check(
    'organization background added',
    (await server()).uploads.filter((u) => u.owner === 'organization').length === 1,
  );
  await p.waitForTimeout(1500);
  check('Sam sees it live', /From your organization/.test(await body()));
  await admin.p.getByRole('radio', { name: 'Blur', exact: true }).first().click();
  await admin.p.getByRole('switch', { name: 'Require the company background' }).click();
  await admin.p.waitForTimeout(500);
  await shot(admin.p, '05-admin-rules');
  await admin.p.getByRole('button', { name: 'Save rules' }).click();
  await admin.p.waitForTimeout(3000);
  const pol = (await server()).policy;
  check('admin saved the rules', pol.enforceLogo === true && pol.defaultChoice.kind === 'blur');
  await p.waitForTimeout(2000);
  check(
    'company background locked in live',
    /uses the company background for everyone/.test(await body()),
  );
  await admin.p.getByRole('button', { name: 'Manage', exact: true }).click();
  await admin.p.getByRole('switch', { name: 'Require the company background' }).click();
  await admin.p.getByRole('button', { name: 'Save rules' }).click();
  await admin.p.waitForTimeout(2500);

  // Light theme.
  const light = await signIn('light', 'sam@northwind.test');
  await light.p.getByRole('radio', { name: 'Villa terrace', exact: true }).first().click();
  await light.p.waitForTimeout(1500);
  await light.p.getByText('Your backgrounds').scrollIntoViewIfNeeded();
  await shot(light.p, '06-light');

  await reset();
  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
