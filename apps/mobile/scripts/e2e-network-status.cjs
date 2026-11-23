const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// SampConnect Network status updates on the phone: Maria's status shows in Sam's strip; he
// views it (recorded on the server) and replies (lands in their chat); he posts a text status
// and, offline, a photo status that uploads on reconnect; he sees who viewed it and deletes it;
// a new status from Maria arrives live.
// Usage: pnpm web:export, then node scripts/e2e-network-status.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs (run after e2e-network.cjs, which creates Maria's personal account).
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

const dev = () => ({ deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' });
const MARIA = { email: 'maria.e2e@example.com', password: 'maria-password-123' };

(async () => {
  const sam = await login('sam@northwind.test');
  const samNet = (await api('POST', '/v1/network/link', { device: dev() }, sam)).accessToken;
  const samMe = await api('GET', '/v1/network/me', undefined, samNet);
  await api('PATCH', '/v1/network/me', { headline: '' }, samNet);
  let maria;
  try {
    maria = await api('POST', '/v1/network/public/signup', {
      displayName: 'Maria Lopez',
      handle: 'maria.lopez',
      ...MARIA,
      device: dev(),
    });
  } catch {
    maria = await api('POST', '/v1/auth/login', {
      tenantSlug: 'sampledge-network',
      ...MARIA,
      device: dev(),
    });
  }
  const mt = maria.accessToken;
  const mariaId = maria.user.userId;
  // A clean slate between runs.
  for (const [tok, other] of [
    [mt, samMe.userId],
    [samNet, mariaId],
  ]) {
    await api('DELETE', `/v1/network/connections/${other}`, undefined, tok).catch(() => undefined);
    await api('DELETE', `/v1/network/blocks/${other}`, undefined, tok).catch(() => undefined);
    await api('DELETE', `/v1/network/follows/user/${other}`, undefined, tok).catch(() => undefined);
    const r = await api('GET', '/v1/network/requests', undefined, tok);
    for (const x of r.outgoing)
      await api('DELETE', `/v1/network/requests/${x.requestId}`, undefined, tok).catch(
        () => undefined,
      );
  }
  // Connected, with no statuses left from earlier runs.
  const req = await api(
    'POST',
    '/v1/network/requests',
    { clientActionId: crypto.randomUUID(), toUserId: samMe.userId, circle: 'friends' },
    mt,
  );
  await api(
    'POST',
    `/v1/network/requests/${req.requestId}/respond`,
    { clientActionId: crypto.randomUUID(), accept: true, circle: 'friends' },
    samNet,
  );
  for (const tok of [mt, samNet]) {
    const f = await api('GET', '/v1/network/statuses', undefined, tok);
    for (const s of f.mine)
      await api('DELETE', `/v1/network/statuses/${s.statusId}`, undefined, tok);
  }
  const mariaStatus = await api(
    'POST',
    '/v1/network/statuses',
    {
      clientStatusId: crypto.randomUUID(),
      kind: 'text',
      text: 'Launching our new survey panel today!',
      background: 'sunset',
      audience: 'connections',
    },
    mt,
  );
  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  const serve = (route) => {
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
  };
  await ctx.route('http://localhost:8099/**', serve);
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
  const shot = async (n, page = p) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = (page = p) => page.innerText('body');
  const tab = (name) => p.getByRole('tab', { name }).or(p.getByRole('link', { name })).first();

  // 1. Open the network; Maria's status is in the strip.
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Open SampConnect Network' }).click();
  await p.waitForTimeout(5000);
  await p.goto(`${APP}/`);
  await p.waitForTimeout(6000);
  const mariaBubble = () => p.getByRole('button', { name: /Maria Lopez’s status/ });
  check(
    'status strip shows Maria with a new status',
    /1 new/.test((await mariaBubble().getAttribute('aria-label')) ?? ''),
  );
  await shot('01-status-strip');

  // 2. View it (recorded) and reply (goes to their chat).
  await mariaBubble().click();
  await p.waitForTimeout(3000);
  let t = await body();
  check('viewer shows the status', /Launching our new survey panel today!/.test(t));
  await shot('02-viewer');
  const reply = `Congrats! ${Date.now() % 10000}`;
  await p.getByLabel('Reply', { exact: true }).fill(reply);
  await p.getByRole('button', { name: 'Send reply' }).click();
  await p.waitForTimeout(3500);
  const viewers = await api(
    'GET',
    `/v1/network/statuses/${mariaStatus.statusId}/viewers`,
    undefined,
    mt,
  );
  check(
    'Sam’s view recorded',
    viewers.some((v) => v.person.userId === samMe.userId),
  );
  const sync = await api('POST', '/v1/sync', {}, mt);
  check('reply landed in Maria’s chat', JSON.stringify(sync).includes(reply));

  // 3. A text status from the composer.
  await p.goto(`${APP}/network/status/new`);
  await p.waitForTimeout(3000);
  await p.getByLabel('Status text', { exact: true }).fill('Hiring two analysts in Lagos 🎉');
  await p.getByRole('radio', { name: 'violet' }).click();
  await p.getByRole('radio', { name: 'Connections and followers' }).click();
  await shot('03-compose');
  await p.getByRole('button', { name: 'Post status' }).click();
  await p.waitForTimeout(3500);
  let mf = await api('GET', '/v1/network/statuses', undefined, mt);
  const samGroup = () => mf.people.find((g) => g.person.userId === samMe.userId);
  check(
    'Maria sees Sam’s text status',
    !!samGroup()?.statuses.some(
      (s) =>
        s.text.startsWith('Hiring two analysts') &&
        s.background === 'violet' &&
        s.audience === 'followers',
    ),
  );

  // 4. Offline: a photo status waits on the phone, then uploads and posts.
  await p.goto(`${APP}/`);
  await p.waitForTimeout(4000);
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'New status' }).click();
  await p.waitForTimeout(1500);
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByRole('radio', { name: 'Photo' }).click(),
  ]);
  await chooser.setFiles(pathMod.join(__dirname, 'e2e-fixtures', 'quota-by-market.png'));
  await p.waitForTimeout(1500);
  await p.getByLabel('Caption', { exact: true }).fill('Quota by market, week 47');
  await p.getByRole('button', { name: 'Post status' }).click();
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: /^Your status/ }).click();
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Next status' }).click();
  await p.waitForTimeout(800);
  t = await body();
  check(
    'offline photo status shows at once, queued',
    /Queued/.test(t) && /Quota by market/.test(t),
  );
  await shot('04-offline-photo');
  await ctx.setOffline(false);
  await p.waitForTimeout(9000);
  mf = await api('GET', '/v1/network/statuses', undefined, mt);
  const photo = samGroup()?.statuses.find((s) => s.kind === 'image');
  check(
    'photo uploaded and posted on reconnect',
    !!photo?.media?.url && photo?.text === 'Quota by market, week 47',
  );

  // 5. Who viewed it, then delete.
  if (photo) await api('PUT', `/v1/network/statuses/${photo.statusId}/view`, undefined, mt);
  await p.goto(`${APP}/network/status/me`);
  await p.waitForTimeout(4000);
  await p.getByRole('button', { name: 'Next status' }).click();
  await p.waitForTimeout(800);
  t = await body();
  check('own photo status shows its views', /Seen by 1/.test(t));
  await p.getByText('Seen by 1').click();
  await p.waitForTimeout(2500);
  t = await body();
  check('viewers list names Maria', /Viewed by 1/.test(t) && /Maria Lopez/.test(t));
  await shot('05-viewers');
  await p.getByRole('button', { name: 'Close viewers' }).click();
  await p.getByRole('button', { name: 'Delete status' }).click();
  await p.waitForTimeout(3500);
  mf = await api('GET', '/v1/network/statuses', undefined, mt);
  check('deleted for everyone', !samGroup()?.statuses.some((s) => s.kind === 'image'));

  // 6. Live: a new status from Maria lights up the strip without a refresh.
  await p.goto(`${APP}/`);
  await p.waitForTimeout(4500);
  await api(
    'POST',
    '/v1/network/statuses',
    {
      clientStatusId: crypto.randomUUID(),
      kind: 'text',
      text: 'Second update',
      background: 'emerald',
    },
    mt,
  );
  await p.waitForTimeout(3500);
  check(
    'Maria’s new status arrives live',
    /1 new/.test((await mariaBubble().getAttribute('aria-label')) ?? ''),
  );
  await shot('06-live');

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
