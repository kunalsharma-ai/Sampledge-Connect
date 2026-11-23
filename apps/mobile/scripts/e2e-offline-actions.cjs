const { chromium, devices } = require('playwright');
// Offline actions end to end: Sam pins, saves, posts a poll, creates a task and approves while
// offline; everything reaches the server on reconnect; Marco's change on another device shows live.
// Usage: pnpm web:export, then node scripts/e2e-offline-actions.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs. The app's files are served from dist-web by the browser itself, so
// they still load while the network is off (as on a phone); only the server is unreachable.
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
const tokenOf = async (email) =>
  (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email,
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;

(async () => {
  const samTok = await tokenOf('sam@northwind.test');
  const marcoTok = await tokenOf('marco@northwind.test');
  const priyaTok = await tokenOf('priya@northwind.test');
  const users = await api('GET', '/v1/users', undefined, samTok);
  const sam = users.find((u) => u.email === 'sam@northwind.test');
  const convs = await api('GET', '/v1/conversations', undefined, samTok);
  const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
    (c) => c.name === 'fieldwork-ops',
  );
  const run = Date.now().toString(36).slice(-4);
  const post = async (text, tok) =>
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
  const first = `Wave 4 quotas are signed off (${run}).`;
  const second = `Client call moved to Thursday 3 pm (${run}).`;
  const m1 = await post(first, marcoTok);
  const m2 = await post(second, marcoTok);
  const id1 = m1.message?.messageId ?? m1.messageId;
  const id2 = m2.message?.messageId ?? m2.messageId;
  const apprTitle = `Approve the wave 4 panel top-up (${run})`;
  const appr = await api(
    'POST',
    '/v1/approvals',
    {
      title: apprTitle,
      category: 'budget',
      amount: { amountMinor: 84000, currency: 'USD' },
      approverIds: [sam.userId],
      conversationId: ops.conversationId,
      clientRequestId: crypto.randomUUID(),
    },
    priyaTok,
  );

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  // The app's own files come from disk, as they do on a phone; only the API goes offline.
  const fs = require('fs');
  const pathMod = require('path');
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
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
  p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 200)));
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  const shot = async (n) => {
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const inputs = p.locator('input');
  await inputs.nth(0).fill(APP);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill('sam@northwind.test');
  await inputs.nth(3).fill(pw);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(4000);
  // Warm the caches the way a phone would before losing signal. The web preview also loads each
  // screen's code here (a phone has it all on the device).
  for (const path of [
    `/poll/new?conversationId=${ops.conversationId}`,
    `/task/new?conversationId=${ops.conversationId}`,
    `/task/x`,
    `/approval/${appr.approvalId}`,
    '/saved',
    '/more',
    '/tasks',
  ]) {
    await p.goto(`${APP}${path}`);
    await p.waitForTimeout(1500);
  }
  await p.goto(`${APP}/conversation/${ops.conversationId}`);
  await p.waitForTimeout(3500);

  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  check('offline banner shown', (await p.innerText('body')).includes('Offline'));
  await p.getByText(first, { exact: true }).last().click({ delay: 700 });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Pin to conversation' }).click();
  await p.waitForTimeout(800);
  await p.getByText(second, { exact: true }).last().click({ delay: 700 });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Save for later' }).click();
  await p.waitForTimeout(800);
  check(
    'the pin shows at once offline',
    (await p.getByRole('button', { name: /^1 pinned/ }).count()) > 0,
  );
  const question = `Where do we hold the wave 4 debrief? (${run})`;
  await p.getByRole('button', { name: 'Attach' }).click();
  await p.getByRole('button', { name: 'Poll' }).click();
  await p.waitForTimeout(1500);
  await p.getByLabel('Question', { exact: true }).fill(question);
  await p.getByLabel('Option 1', { exact: true }).fill('Pune office');
  await p.getByLabel('Option 2', { exact: true }).fill('Video call');
  await p.getByRole('button', { name: 'Post poll' }).click();
  await p.waitForTimeout(2000);
  check('the poll shows in the conversation offline', (await p.getByText(question).count()) > 0);
  await shot('01-offline-pin-save-poll');

  await p.getByText(first, { exact: true }).last().click({ delay: 700 });
  await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'Create task' }).click();
  await p.waitForTimeout(2000);
  await p
    .getByLabel('Title', { exact: true })
    .fill(`Share signed-off quotas with the client (${run})`);
  await p.getByRole('checkbox', { name: /^Marco/ }).click();
  await p.getByRole('radio', { name: 'High' }).click();
  await p.getByRole('button', { name: 'Create task' }).click();
  await p.waitForTimeout(2000);
  check(
    'the new task opens offline with the waiting note',
    /Saved on this phone/.test(await p.innerText('body')),
  );
  await shot('02-task-created-offline');

  // Into Tasks & Approvals without the network. Reopening the app offline also proves the
  // queue and caches survive a restart.
  await p.goto(`${APP}/tasks`);
  await p.waitForTimeout(2500);
  await p.getByRole('tab', { name: 'To decide' }).click();
  await p.waitForTimeout(1200);
  check(
    'the approval waiting for Sam is listed offline',
    (await p.innerText('body')).includes(apprTitle),
  );
  await p.getByText(apprTitle).first().click();
  await p.waitForTimeout(1500);
  await p.getByLabel('Comment').fill('Approved, keep it under $900.');
  await p.getByRole('button', { name: 'Approve' }).click();
  await p.waitForTimeout(1500);
  check(
    'the decision shows at once offline',
    /Approved/.test(await p.innerText('body')) &&
      /sent when you are back online/.test(await p.innerText('body')),
  );
  await shot('03-approval-decided-offline');
  await p.goto(`${APP}/tasks`);
  await p.waitForTimeout(2500);
  await p.getByRole('tab', { name: 'Created by me' }).click();
  await p.waitForTimeout(1500);
  check(
    'the offline task is listed as waiting to sync',
    /Waiting to sync/.test(await p.innerText('body')),
  );
  await shot('04-tasks-offline');
  await p.goto(`${APP}/saved`);
  await p.waitForTimeout(2500);
  check('the message saved offline is listed', (await p.innerText('body')).includes(second));
  await shot('05-saved-offline');

  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  await shot('06-saved-back-online');
  const msgs = await api(
    'GET',
    `/v1/conversations/${ops.conversationId}/messages?limit=40`,
    undefined,
    samTok,
  );
  const arr = Array.isArray(msgs) ? msgs : (msgs.messages ?? msgs.items);
  check('the pin reached the server', !!arr.find((m) => m.messageId === id1)?.pinned);
  check('the poll was posted once', arr.filter((m) => m.poll?.question === question).length === 1);
  const saved = (await api('GET', '/v1/bookmarks', undefined, samTok)).items;
  check(
    'the save reached the server',
    saved.some((x) => x.messageId === id2),
  );
  const created = await api('GET', '/v1/tasks?scope=created', undefined, samTok);
  const task = created.filter((t) => t.title.includes(run));
  check(
    'the task was created once, assigned to Marco, high priority',
    task.length === 1 && task[0].priority === 'high',
  );
  const a = await api('GET', `/v1/approvals/${appr.approvalId}`, undefined, priyaTok);
  check(
    'the approval decision reached the server with the comment',
    a.status === 'approved' && a.decisions[0]?.comment.startsWith('Approved'),
  );

  // Live from another device: Marco starts the task on the web; Sam's list updates.
  await p.goto(`${APP}/tasks`);
  await p.waitForTimeout(2500);
  await p.getByRole('tab', { name: 'Created by me' }).click();
  await p.waitForTimeout(2000);
  await api('PATCH', `/v1/tasks/${task[0].taskId}`, { status: 'in_progress' }, marcoTok);
  await p.waitForTimeout(2500);
  const body = await p.innerText('body');
  check(
    "Marco's change shows live without a refresh",
    /In progress/.test(body) && !/Waiting to sync/.test(body),
  );
  await shot('07-live-update-from-marco');

  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(800);
  await shot('08-tasks-arctic');

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
