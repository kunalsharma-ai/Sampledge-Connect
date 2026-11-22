const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Channel setup and inbox settings on the phone, against a real API. Priya (owner) opens the
// inbox settings, adds a LINE channel in test mode, simulates a client message, pauses it and
// goes live; her second device sees each change live. Offline she changes the inbox settings,
// which reach the server on reconnect, and she adds a reply template.
// Usage: pnpm web:export, reset the API, node scripts/e2e-seed.mjs, node scripts/e2e-inbox-seed.mjs,
// then node scripts/e2e-inbox-admin.cjs <screenshot-dir>.
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

const DIST = pathMod.join(__dirname, '..', 'dist-web');
const types = {
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};
const serve = (route) => {
  const u = new URL(route.request().url());
  let f = pathMod.join(DIST, decodeURIComponent(u.pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    const html = f.replace(/\/$/, '') + '.html';
    f = fs.existsSync(html) ? html : pathMod.join(DIST, 'index.html');
  }
  return route.fulfill({
    path: f,
    headers: {
      'content-type': types[pathMod.extname(f)] ?? 'application/octet-stream',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  });
};

async function signIn(b, email, scheme = 'dark') {
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
  await ctx.route('http://localhost:8099/**', serve);
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
  return { ctx, p };
}

(async () => {
  const priya = await login('priya@northwind.test');
  const channels = () => api('GET', '/v1/connectors', undefined, priya);
  const settings = () => api('GET', '/v1/inbox/settings', undefined, priya);
  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const { ctx, p } = await signIn(b, 'priya@northwind.test');
  const two = await signIn(b, 'priya@northwind.test', 'light');
  const shot = async (n, page = p) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = (page = p) => page.innerText('body');
  const openSettings = async (page) => {
    await page.getByRole('tab', { name: 'Client Inbox' }).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Inbox settings' }).click();
    await page.waitForTimeout(2500);
  };

  // 1. Inbox settings from the gear in the inbox.
  await openSettings(p);
  let t = await body();
  check('settings show reply times', /How long a client may wait/i.test(t));
  check('settings show templates', /Reply templates/i.test(t) && /Topline timing/.test(t));
  await shot('01-inbox-settings');

  // 2. Channels list, on both devices.
  await p.getByRole('button', { name: 'Channels' }).click();
  await p.waitForTimeout(2500);
  t = await body();
  check(
    'channels listed',
    /Client support \(Telegram\)/.test(t) && /Partner desk \(Teams\)/.test(t),
  );
  check('test mode shown', /Test mode/.test(t));
  await shot('02-channels');
  await openSettings(two.p);
  await two.p.getByRole('button', { name: 'Channels' }).click();
  await two.p.waitForTimeout(2500);

  // 3. Add LINE in test mode.
  await p.getByRole('button', { name: 'Add channel' }).click();
  await p.waitForTimeout(1500);
  await shot('03-catalog');
  await p.getByRole('button', { name: 'Connect LINE' }).click();
  await p.waitForTimeout(1000);
  await p.getByLabel('Name', { exact: true }).fill('LINE clients Japan');
  await shot('04-connect-line');
  await p.getByRole('button', { name: 'Connect', exact: true }).click();
  await p.waitForTimeout(3500);
  let line = (await channels()).find((c) => c.name === 'LINE clients Japan');
  check('LINE channel on the server', !!line && line.environment === 'test');
  t = await body();
  check('channel page shows webhook URL', /Webhook URL/.test(t) && /localhost:4000/.test(t));
  await shot('05-channel-detail');
  await two.p.waitForTimeout(2000);
  check('second device sees the new channel live', /LINE clients Japan/.test(await body(two.p)));

  // 4. Test connection and simulate a client message.
  await p.getByRole('button', { name: 'Test connection' }).click();
  await p.waitForTimeout(2500);
  check('test connection result shown', /Connection works|Connection failed/.test(await body()));
  await p.getByRole('button', { name: 'Simulate client message' }).click();
  await p.waitForTimeout(800);
  await p
    .getByLabel('Message', { exact: true })
    .fill('Konnichiwa! Is the Japan wave in field yet?');
  await shot('06-simulate');
  await p.getByRole('button', { name: 'Send test message' }).click();
  await p.waitForTimeout(4500);
  t = await body();
  check('simulated message opens the conversation', /Japan wave in field/.test(t));
  const list = await api('GET', '/v1/inbox/conversations?status=active', undefined, priya);
  check(
    'simulated conversation on the server',
    list.items.some((c) => c.connectorId === line.connectorId),
  );
  await shot('07-simulated-conversation');
  await p.goBack();
  await p.waitForTimeout(2000);

  // 5. Pause, then go live: the credentials form opens.
  await p.getByRole('button', { name: 'Pause' }).click();
  await p.waitForTimeout(2500);
  line = (await channels()).find((c) => c.connectorId === line.connectorId);
  check('paused on the server', line.status === 'paused');
  await two.p.waitForTimeout(1500);
  check('second device sees it paused', /Paused/.test(await body(two.p)));
  await two.p.getByText('LINE clients Japan').scrollIntoViewIfNeeded();
  await shot('08-second-device-paused', two.p);
  await p.getByRole('button', { name: 'Resume' }).click();
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Go live' }).click();
  await p.waitForTimeout(2500);
  line = (await channels()).find((c) => c.connectorId === line.connectorId);
  check('live on the server', line.environment === 'live');
  t = await body();
  check(
    'credentials form shown after going live',
    /LINE credentials/.test(t) && /Missing:/.test(t),
  );
  await shot('09-go-live-credentials');
  await p.getByRole('button', { name: 'Back to test mode' }).click();
  await p.waitForTimeout(2000);
  line = (await channels()).find((c) => c.connectorId === line.connectorId);
  check('back in test mode', line.environment === 'test');

  // 6. Inbox settings offline, sent on reconnect; the other device follows.
  await p.goBack();
  await p.waitForTimeout(1000);
  await p.goBack();
  await p.waitForTimeout(2000);
  await two.p.goBack();
  await two.p.waitForTimeout(1500);
  const before = await settings();
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.getByLabel('Urgent reply time in minutes').fill('20');
  await p.getByRole('switch', { name: 'Auto-assign new conversations' }).click();
  await p.getByRole('button', { name: 'Save settings' }).click();
  await p.waitForTimeout(1200);
  check('saved on the phone offline', /sent when you reconnect/.test(await body()));
  await shot('10-settings-offline');
  check('server unchanged while offline', (await settings()).autoAssign === before.autoAssign);
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  const after = await settings();
  check(
    'settings reached the server',
    after.autoAssign === !before.autoAssign && after.sla.urgent === 20,
  );
  await two.p.waitForTimeout(1500);
  const urgent2 = await two.p.getByLabel('Urgent reply time in minutes').inputValue();
  check('second device shows the new settings', urgent2 === '20');
  await shot('11-second-device-settings', two.p);

  // 7. A new reply template.
  await p.getByRole('button', { name: 'New template' }).click();
  await p.getByLabel('Template name').fill('Wave in field');
  await p.getByLabel('Template shortcut').fill('infield');
  await p
    .getByLabel('Template text')
    .fill('Hi {{client.firstName}}, the wave is in field and on track.');
  await p.getByRole('button', { name: 'Save template' }).click();
  await p.waitForTimeout(2500);
  const tpls = await api('GET', '/v1/inbox/templates', undefined, priya);
  check(
    'template on the server',
    (tpls.items ?? tpls).some((x) => x.shortcut === 'infield'),
  );
  await two.p.waitForTimeout(1500);
  check('second device sees the template', /Wave in field/.test(await body(two.p)));
  await p.getByText('Wave in field').scrollIntoViewIfNeeded();
  await shot('12-template-added');

  // 8. Remove the LINE channel.
  await p.getByRole('button', { name: 'Channels' }).click();
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: /^LINE clients Japan/ }).click();
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Remove channel' }).click();
  await p.waitForTimeout(2500);
  check(
    'removed on the server',
    !(await channels()).some((c) => c.connectorId === line.connectorId),
  );
  await shot('13-channels-after-remove');

  await b.close();
  console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'ALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
