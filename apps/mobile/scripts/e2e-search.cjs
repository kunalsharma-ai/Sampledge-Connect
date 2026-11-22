const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Universal Search end to end: Sam searches everything from the phone (messages, meetings,
// people), narrows with from:/in: operators, opens a hit at the message, and his recent
// searches follow him across devices (live in, queued out). Offline it searches the phone.
// Usage: pnpm web:export, then node scripts/e2e-search.cjs <screenshot-dir> with the API
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
  const priya = await login('priya@northwind.test');
  const users = await api('GET', '/v1/users', undefined, sam);
  const uid = (e) => users.find((u) => u.email === e).userId;
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
    (c) => c.name === 'fieldwork-ops',
  );
  const run = Date.now().toString(36).slice(-4);
  const word = `zephyr${run}`;
  const post = (text, tok) =>
    api(
      'POST',
      `/v1/conversations/${ops.conversationId}/messages`,
      {
        conversationId: ops.conversationId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text, mentions: [] },
      },
      tok,
    );
  const hit = await post(
    `Heads up: the ${word} panel needs its quota checked before Friday's fieldwork launch.`,
    priya,
  );
  await post(`Thanks, I'll look at the ${word} numbers this afternoon.`, sam);
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setHours(11, 0, 0, 0);
  await api(
    'POST',
    '/v1/meetings',
    {
      title: `${word[0].toUpperCase()}${word.slice(1)} kickoff review`,
      agenda: '',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      media: 'video',
      remindMinutes: [10],
      attendeeIds: [uid('sam@northwind.test')],
    },
    priya,
  );
  await api('PUT', '/v1/search/recent', { recent: ['wave 3 incidence'] }, sam);

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
  const box = () => p.getByLabel('Search everything');

  // 1. Recent searches from the server show before typing.
  await p.goto(`${APP}/search`);
  await p.waitForTimeout(3000);
  check('recent searches from the server show', /wave 3 incidence/.test(await body()));
  await shot('01-search-start');

  // 2. One word finds the messages and the meeting.
  await box().fill(word);
  await p.waitForTimeout(2500);
  let t = await body();
  check('messages found', /MESSAGES/i.test(t) && /panel needs its quota/.test(t));
  check('meeting found', /MEETINGS/i.test(t) && /kickoff review/i.test(t));
  await shot('02-everything');

  // 3. Operators become filters: only Priya's message in #fieldwork-ops.
  await box().fill(`${word} from:@priya in:#fieldwork`);
  await p.waitForTimeout(2500);
  t = await body();
  check('filters shown as chips', /From Priya Shah/.test(t) && /In # fieldwork-ops/.test(t));
  check('only Priya’s message', /panel needs its quota/.test(t) && !/look at the/.test(t));
  await shot('03-filters');
  await p.getByRole('button', { name: 'Remove filter From Priya Shah' }).click();
  await p.waitForTimeout(2000);
  check('closing a chip widens the search', /look at the/.test(await body()));

  // 4. People tab.
  await box().fill('priya');
  await p.waitForTimeout(2000);
  await p.getByRole('tab', { name: /People/ }).click();
  await p.waitForTimeout(2000);
  check('people tab lists Priya', /Priya Shah/.test(await body()));
  await shot('04-people');
  await p.getByRole('tab', { name: 'All' }).click();

  // 5. Open the message: the chat opens at it, and the search is remembered on every device.
  await box().fill(word);
  await p.waitForTimeout(2500);
  await p
    .getByRole('button', { name: /^Message from Priya Shah in # fieldwork-ops/ })
    .first()
    .click();
  await p.waitForTimeout(3000);
  check('opens the conversation', p.url().includes(`/conversation/${ops.conversationId}`));
  check('at the message', p.url().includes(hit.messageId) || /focus=/.test(p.url()));
  await shot('05-opened');
  await p.waitForTimeout(1500);
  const recent = (await api('GET', '/v1/search/recent', undefined, sam)).recent;
  check('remembered for every device', recent[0] === word && recent.includes('wave 3 incidence'));

  // 6. Another device clears one; the phone follows live.
  await p.goto(`${APP}/search`);
  await p.waitForTimeout(2500);
  await api('PUT', '/v1/search/recent', { recent: [word, 'from another device'] }, sam);
  await p.waitForTimeout(2500);
  t = await body();
  check(
    'recent list follows the other device live',
    /from another device/.test(t) && !/wave 3 incidence/.test(t),
  );

  // 7. Offline: messages on this phone, including one not sent yet; forgetting a search queues.
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Remove from another device from recent searches' }).click();
  await p.waitForTimeout(500);
  await box().fill(`${word} quota`);
  await p.waitForTimeout(2500);
  t = await body();
  check('offline note shown', /only messages saved on this phone/.test(t));
  check('finds the message saved on the phone', /panel needs its quota/.test(t));
  await shot('06-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  const after = (await api('GET', '/v1/search/recent', undefined, sam)).recent;
  console.log('recent after', JSON.stringify(after));
  check('the offline change reached the server', !after.includes('from another device'));

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
