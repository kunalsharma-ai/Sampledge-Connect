const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// SampConnect Network on the phone, end to end: Sam (northwind) opens the network from More,
// accepts Maria's request into Friends, finds her, messages her, follows her and moves her to
// Business offline (sent on reconnect), sees her follow arrive live, invites someone, edits his
// network profile and switches back to work. Maria then signs in on another phone with a
// personal account.
// Usage: pnpm web:export, then node scripts/e2e-network.cjs <screenshot-dir> with the API
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
  await api(
    'POST',
    '/v1/network/requests',
    {
      clientActionId: crypto.randomUUID(),
      toUserId: samMe.userId,
      circle: 'friends',
      message: 'Great meeting you at the expo!',
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

  // 1. Open the network from More.
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2500);
  check('More offers the network', /SampConnect Network/.test(await body()));
  await p.getByRole('button', { name: 'Open SampConnect Network' }).click();
  await p.waitForTimeout(5000);
  await p.goto(`${APP}/`);
  await p.waitForTimeout(6000);
  let t = await body();
  check('home is the network space', /SampConnect Network/i.test(t) && /@sam\.okafor/.test(t));
  check(
    'request from Maria waiting',
    /Requests waiting for you \(1\)/i.test(t) && /Maria Lopez/.test(t),
  );
  check('switch back to work offered', /Work: Northwind/.test(t));
  check('People tab replaces the Client Inbox', /People/.test(t) && !/Client Inbox/.test(t));
  await shot('01-network-home');

  // 2. Accept into Friends.
  await p.goto(`${APP}/people?tab=requests`);
  await p.waitForTimeout(3000);
  t = await body();
  check('request shows the note', /Great meeting you at the expo/.test(t));
  await p.getByRole('radio', { name: 'Friends' }).first().click();
  await shot('02-request');
  await p.getByRole('button', { name: 'Accept Maria Lopez' }).click();
  await p.waitForTimeout(3000);
  let conns = await api('GET', '/v1/network/connections', undefined, samNet);
  check(
    'accepted into Friends on the server',
    conns.some((c) => c.person.userId === mariaId && c.circle === 'friends'),
  );
  const mariaConns = await api('GET', '/v1/network/connections', undefined, mt);
  check(
    'Maria is connected too',
    mariaConns.some((c) => c.person.userId === samMe.userId),
  );

  // 3. Find her by Connect ID.
  await p.getByRole('radio', { name: 'Find' }).click();
  await p.getByLabel('Search people').fill('maria.lopez');
  await p.waitForTimeout(2500);
  t = await body();
  check('search finds Maria as a Friend', /1 person/i.test(t) && /Friends/.test(t));
  await shot('03-find');

  // 4. Her profile, then a message.
  await p.getByRole('button', { name: 'Maria Lopez, @maria.lopez' }).click();
  await p.waitForTimeout(3000);
  t = await body();
  check('profile shows the connection', /Connected · Friends/.test(t) && /Message/.test(t));
  await p.getByRole('button', { name: 'Message', exact: true }).click();
  await p.waitForTimeout(3500);
  const text = `Hello from the phone ${Date.now() % 10000}`;
  await p.getByRole('textbox').last().fill(text);
  await p.getByRole('button', { name: 'Send message' }).click();
  await p.waitForTimeout(3000);
  const mConvs = await api('POST', '/v1/sync', {}, mt).catch(() => null);
  const got = JSON.stringify(mConvs ?? {}).includes(text);
  check('Maria received the message', got);
  await shot('04-chat');

  // 5. Live: Maria follows Sam; his Followers list shows it without a refresh.
  await p.goto(`${APP}/people?tab=followers`);
  await p.waitForTimeout(3000);
  await api('PUT', `/v1/network/follows/user/${samMe.userId}`, undefined, mt);
  await p.waitForTimeout(3000);
  check('Maria’s follow arrives live', /Followers \(1\)/i.test(await body()));

  // 6. Offline: follow Maria and move her to Business; both are queued and sent on reconnect.
  await p.goto(`${APP}/network/person/${mariaId}`);
  await p.waitForTimeout(3000);
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'Follow', exact: true }).click();
  await p.getByRole('button', { name: 'Move to Business' }).click();
  await p.waitForTimeout(1200);
  t = await body();
  check(
    'offline: shows at once with Queued',
    /Queued/.test(t) && /Unfollow/.test(t) && /Connected · Business/.test(t),
  );
  await shot('05-offline-queued');
  await ctx.setOffline(false);
  await p.waitForTimeout(8000);
  conns = await api('GET', '/v1/network/connections', undefined, samNet);
  const follows = await api('GET', '/v1/network/follows', undefined, samNet);
  check(
    'offline changes reached the server',
    conns.some((c) => c.person.userId === mariaId && c.circle === 'business') &&
      follows.following.some((f) => f.person.userId === mariaId),
  );
  check('Queued badge cleared', !/Queued/.test(await body()));

  // 7. Invite by link.
  await p.goto(`${APP}/network/invite`);
  await p.waitForTimeout(2500);
  await p.getByLabel('Their name (optional)').fill('Jo Kim');
  await p.getByRole('button', { name: 'Create invite link' }).click();
  await p.waitForTimeout(3500);
  t = await body();
  check('invite link listed', /Jo Kim/.test(t) && /\/join\/n\//.test(t));
  await shot('06-invite');

  // 8. Network profile.
  await p.goto(`${APP}/network/profile`);
  await p.waitForTimeout(3000);
  await p.getByLabel('Headline').fill('Analyst at Northwind');
  await p.getByRole('button', { name: 'Save profile' }).click();
  await p.waitForTimeout(3000);
  const me2 = await api('GET', '/v1/network/me', undefined, samNet);
  check('profile saved on the server', me2.headline === 'Analyst at Northwind');
  check('linked account shown', /Linked to your Northwind/.test(await body()));
  await shot('07-profile');

  // 9. Back to work: the organization's own space.
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: /Switch to Work/ }).click();
  await p.waitForTimeout(4000);
  await p.goto(`${APP}/`);
  await p.waitForTimeout(3500);
  t = await body();
  check('work space is back', /Client Inbox/.test(t) && !/Requests waiting for you/i.test(t));

  // 10. Maria signs in on her phone with a personal account.
  const ctx2 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'light' });
  await ctx2.route('http://localhost:8099/**', serve);
  const q = await ctx2.newPage();
  await q.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await q.waitForTimeout(1500);
  await q.getByRole('radio', { name: 'Personal account' }).click();
  await q.waitForTimeout(300);
  const qi = q.locator('input');
  await qi.nth(0).fill(APP);
  await qi.nth(1).fill(MARIA.email);
  await qi.nth(2).fill(MARIA.password);
  await shot('08-personal-sign-in', q);
  await q.getByRole('button', { name: 'Sign in', exact: true }).click();
  await q.waitForTimeout(6000);
  t = await body(q);
  check('personal account opens the network', /@maria\.lopez/.test(t) && !/Work:/.test(t));
  check('her chat with Sam is there', new RegExp(text).test(t) || /Sam Okafor/.test(t));
  await shot('09-maria-home', q);

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
