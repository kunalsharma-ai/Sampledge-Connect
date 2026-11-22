const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// SampConnect Network communities on the phone: Sam finds Maria's public community, asks to
// join, and is let in live; he opens its General group; offline he creates his own community,
// which goes up on reconnect; he invites Maria, makes an invite link, makes her a moderator,
// edits the settings and leaves Maria's community.
// Usage: pnpm web:export, then node scripts/e2e-network-communities.cjs <screenshot-dir> with
// the API seeded by e2e-seed.mjs (run after e2e-network.cjs, which creates Maria's account).
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
  const run = Date.now() % 100000;
  const theirs = await api(
    'POST',
    '/v1/network/communities',
    {
      clientActionId: crypto.randomUUID(),
      name: `Panel Partners ${run}`,
      description: 'Panel owners and buyers swapping notes on quality and incidence.',
      visibility: 'public',
      joinPolicy: 'approval',
      rules: 'Be kind. No selling in General.',
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
  await inputs.nth(0).fill(API);
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

  // 1. Open the network, then Discover: Maria's community is listed.
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Open SampConnect Network' }).click();
  await p.waitForTimeout(5000);
  await p.goto(`${APP}/network/communities`);
  await p.waitForTimeout(3500);
  await p.getByRole('radio', { name: 'Discover' }).click();
  await p.getByLabel('Search public communities').fill(`Panel Partners ${run}`);
  await p.waitForTimeout(3000);
  let t = await body();
  check('discover finds Maria’s community', t.includes(`Panel Partners ${run}`));
  await shot('01-discover');

  // 2. Ask to join; Maria approves and the page opens up live.
  await p.getByRole('button', { name: new RegExp(`^Panel Partners ${run}`) }).click();
  await p.waitForTimeout(3000);
  await p.getByRole('button', { name: 'Ask to join' }).click();
  await p.waitForTimeout(2500);
  t = await body();
  check('asking shows at once', /Your request is with the admins/.test(t));
  const asked = await api(
    'GET',
    `/v1/network/communities/${theirs.communityId}/members`,
    undefined,
    mt,
  );
  check(
    'Maria sees Sam asking',
    asked.some((m) => m.person.userId === samMe.userId && m.status === 'pending'),
  );
  await api(
    'POST',
    `/v1/network/communities/${theirs.communityId}/members/${samMe.userId}/approve`,
    undefined,
    mt,
  );
  await p.waitForTimeout(4000);
  t = await body();
  check('approval arrives live: groups show', /Announcements/.test(t) && /General/.test(t));
  await shot('02-community');

  // 3. Open the General group: a chat on the phone.
  await p.getByRole('button', { name: 'Open General' }).click();
  await p.waitForTimeout(4000);
  check('General group opens as a chat', /\/conversation\//.test(p.url()));
  const hello = `Hi all, Sam here ${run}`;
  await p.getByLabel('Message', { exact: true }).fill(hello);
  await p.getByRole('button', { name: 'Send message' }).click();
  await p.waitForTimeout(3000);
  await shot('03-group-chat');
  const ms = await api('POST', '/v1/sync', {}, mt);
  check('Maria gets Sam’s message in General', JSON.stringify(ms).includes(hello));

  // 4. Offline: a new community shows at once, queued, and is created on reconnect.
  await p.goto(`${APP}/network/communities`);
  await p.waitForTimeout(3500);
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'New community' }).click();
  await p.waitForTimeout(1500);
  const mineName = `Lagos Fieldwork ${run}`;
  await p.getByLabel('Name', { exact: true }).fill(mineName);
  await p.getByLabel('What it’s about').fill('Field teams across West Africa.');
  await p
    .getByRole('switch', { name: 'Admins approve new members' })
    .click()
    .catch(async () => {
      await p.getByLabel('Admins approve new members').click();
    });
  await p.getByRole('button', { name: 'Create community' }).click();
  await p.waitForTimeout(2000);
  t = await body();
  check('offline community shows at once, queued', t.includes(mineName) && /Queued/.test(t));
  await shot('04-offline-create');
  await ctx.setOffline(false);
  await p.waitForTimeout(9000);
  const samList = await api('GET', '/v1/network/communities', undefined, samNet);
  const ours = samList.find((x) => x.name === mineName);
  check(
    'created on reconnect, as owner, with approval',
    ours?.myRole === 'owner' && ours?.joinPolicy === 'approval',
  );

  // 5. Invite Maria and make a link.
  await p.getByRole('button', { name: new RegExp(`^${mineName}`) }).click();
  await p.waitForTimeout(3500);
  await p.getByRole('radio', { name: 'Invite' }).click();
  await p.waitForTimeout(2000);
  await p.getByRole('checkbox', { name: 'Maria Lopez' }).click();
  await p.getByRole('button', { name: 'Invite 1' }).click();
  await p.getByRole('button', { name: 'New link' }).click();
  await p.waitForTimeout(4000);
  const asMaria =
    ours && (await api('GET', `/v1/network/communities/${ours.communityId}`, undefined, mt));
  check('Maria is invited', asMaria?.myStatus === 'invited');
  const links = ours
    ? await api('GET', `/v1/network/communities/${ours.communityId}/links`, undefined, samNet)
    : [];
  check('invite link made', links.length === 1);
  t = await body();
  check('link shows on the phone', links[0] ? t.includes(links[0].url.slice(0, 30)) : false);
  await shot('05-invite');

  // 6. Maria accepts; Sam makes her a moderator.
  if (ours) await api('POST', `/v1/network/communities/${ours.communityId}/join`, undefined, mt);
  await p.waitForTimeout(2500);
  await p.getByRole('radio', { name: 'Members' }).click();
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Manage Maria Lopez' }).click();
  await p.getByRole('radio', { name: 'Moderator' }).click();
  await p.waitForTimeout(3000);
  const mem = ours
    ? await api('GET', `/v1/network/communities/${ours.communityId}/members`, undefined, samNet)
    : [];
  check(
    'Maria is now a moderator',
    mem.some((m) => m.person.userId === mariaId && m.role === 'moderator'),
  );
  await shot('06-members');

  // 7. Settings, then leave Maria's community.
  await p.getByRole('radio', { name: 'Settings' }).click();
  await p.waitForTimeout(1000);
  await p.getByLabel('Rules', { exact: true }).fill('Share field tips. Be kind.');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.waitForTimeout(3000);
  const after =
    ours && (await api('GET', `/v1/network/communities/${ours.communityId}`, undefined, mt));
  check('settings saved', after?.rules === 'Share field tips. Be kind.');
  await p.goto(`${APP}/network/communities/${theirs.communityId}`);
  await p.waitForTimeout(3500);
  await p.getByRole('button', { name: 'Leave' }).click();
  await p.waitForTimeout(3000);
  const left = await api('GET', `/v1/network/communities/${theirs.communityId}`, undefined, samNet);
  check('left Maria’s community', left.myStatus === null);

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
