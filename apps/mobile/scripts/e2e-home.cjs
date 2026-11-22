const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Home end to end: Sam's start screen sums up what needs him (unread, mentions, meetings, tasks,
// approvals), each section opens the right place, a new message arrives live, and he marks a
// task done and approves straight from Home, offline too (sent on reconnect).
// Usage: pnpm web:export, then node scripts/e2e-home.cjs <screenshot-dir> with the API
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
  const samId = users.find((u) => u.email === 'sam@northwind.test').userId;
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
    (c) => c.name === 'fieldwork-ops',
  );
  const run = Date.now().toString(36).slice(-4);
  const post = (text, mentions = []) =>
    api(
      'POST',
      `/v1/conversations/${ops.conversationId}/messages`,
      {
        conversationId: ops.conversationId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text, mentions },
      },
      priya,
    );
  // Start clean so the counts are this run's.
  await api('POST', '/v1/notifications/read', { all: true }, sam).catch(() => undefined);
  const mention = `@Sam Okafor can you check the DE quota before 4? ${run}`;
  const mentionMsg = await post(mention, [samId]);
  const start = new Date(Date.now() + 2 * 3_600_000);
  await api(
    'POST',
    '/v1/meetings',
    {
      title: `Wave 3 client sync ${run}`,
      agenda: '',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      media: 'video',
      remindMinutes: [10],
      attendeeIds: [samId],
    },
    priya,
  );
  const taskTitle = `Send the wave 3 brief ${run}`;
  const task = await api(
    'POST',
    '/v1/tasks',
    {
      title: taskTitle,
      assigneeIds: [samId],
      dueAt: '2026-01-05T09:00:00.000Z',
      priority: 'high',
      conversationId: ops.conversationId,
      clientRequestId: crypto.randomUUID(),
    },
    priya,
  );
  const apprTitle = `Approve the DE panel top-up ${run}`;
  const appr = await api(
    'POST',
    '/v1/approvals',
    {
      title: apprTitle,
      category: 'budget',
      amount: { amountMinor: 84000, currency: 'USD' },
      approverIds: [samId],
      conversationId: ops.conversationId,
      clientRequestId: crypto.randomUUID(),
    },
    priya,
  );
  const appr2Title = `Approve the UK incentive change ${run}`;
  const appr2 = await api(
    'POST',
    '/v1/approvals',
    {
      title: appr2Title,
      approverIds: [samId],
      conversationId: ops.conversationId,
      clientRequestId: crypto.randomUUID(),
    },
    priya,
  );

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

  // 1. Home sums up what needs Sam.
  await p.goto(`${APP}/`);
  await p.waitForTimeout(5000);
  let t = await body();
  check(
    'summary line',
    /You have .*new for you.*meeting.*today/.test(t) || /You have .*new for you/.test(t),
  );
  check(
    'for you lists the mention',
    t.includes('mentioned you') && t.includes(`check the DE quota before 4? ${run}`),
  );
  check('coming up lists the meeting', t.includes(`Wave 3 client sync ${run}`));
  check('my tasks lists the overdue task', t.includes(taskTitle) && /overdue/.test(t));
  check('waiting on you lists the approval', t.includes(apprTitle) && t.includes('$840.00'));
  await shot('01-home');
  await p.mouse.wheel(0, 900);
  await shot('02-home-sections');
  await p.mouse.wheel(0, 1200);
  await shot('03-home-work');

  // 2. A new message arrives live and the unread count moves.
  await p.mouse.wheel(0, -4000);
  await p.waitForTimeout(500);
  const before = await p.getByRole('button', { name: /^Unread: \d+/ }).getAttribute('aria-label');
  await post(`Live update for Home ${run}`);
  await p.waitForTimeout(4000);
  const after = await p.getByRole('button', { name: /^Unread: \d+/ }).getAttribute('aria-label');
  check(
    'unread count updates live',
    parseInt(after.match(/\d+/)[0]) > parseInt(before.match(/\d+/)[0]),
  );

  // 3. Approve and mark done straight from Home.
  await p.getByRole('button', { name: `Approve ${apprTitle}` }).click();
  await p.waitForTimeout(3000);
  const a1 = await api('GET', `/v1/approvals/${appr.approvalId}`, undefined, sam);
  check(
    'approved on the server',
    a1.status === 'approved' || a1.decisions?.some((d) => d.decision === 'approve'),
  );
  check(
    'approval leaves the list',
    (await p.getByRole('button', { name: `Approve ${apprTitle}` }).count()) === 0,
  );

  // 4. Offline: decide and mark done; both go out on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: `Reject ${appr2Title}` }).click();
  await p.waitForTimeout(800);
  await p.getByRole('checkbox', { name: `Mark ${taskTitle} done` }).click();
  await p.waitForTimeout(1500);
  t = await body();
  check('offline note on Home', /Offline: showing what is saved on this phone/.test(t));
  check(
    'offline decision leaves the list at once',
    (await p.getByRole('button', { name: `Reject ${appr2Title}` }).count()) === 0,
  );
  await shot('04-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(8000);
  const a2 = await api('GET', `/v1/approvals/${appr2.approvalId}`, undefined, sam);
  check('offline decision reached the server', a2.status === 'rejected');
  const t2 = await api('GET', `/v1/tasks/${task.taskId}`, undefined, sam);
  check('task marked done from Home', t2.status === 'done');

  // 5. Tapping a mention opens the conversation at the message.
  await p.goto(`${APP}/`);
  await p.waitForTimeout(3500);
  const forYou = p.getByRole('button', {
    name: new RegExp(`check the DE quota before 4\\? ${run}`),
  });
  if (await forYou.count()) {
    await forYou.first().click();
    await p.waitForTimeout(3000);
    check('mention opens at the message', p.url().includes(mentionMsg.message.messageId));
  } else check('mention opens at the message', false);

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
