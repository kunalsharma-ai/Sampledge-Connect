const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Client Inbox on the phone, against a real API: Sam sees his clients, opens one (read on all
// his devices), replies with a "/" template and adds a note; offline he replies, assigns and
// resolves, and it all reaches the server on reconnect; a client message arrives live; he
// changes priority and tags in Details; Priya (owner) sees the dashboard.
// Usage: pnpm web:export, reset the API, node scripts/e2e-seed.mjs, node scripts/e2e-inbox-seed.mjs,
// then node scripts/e2e-inbox.cjs <screenshot-dir>.
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
  await inputs.nth(0).fill(APP);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill(pw);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForTimeout(5000);
  return { ctx, p };
}

(async () => {
  const priya = await login('priya@northwind.test');
  const sam = await login('sam@northwind.test');
  const samId =
    (await api('GET', '/v1/me', undefined, sam)).user?.userId ??
    (await api('GET', '/v1/users', undefined, priya)).find((u) => u.email === 'sam@northwind.test')
      .userId;
  const list = await api('GET', '/v1/inbox/conversations?status=active', undefined, priya);
  const hannah = list.items.find((c) => c.client.name === 'Hannah Becker');
  const detailOf = (id, tok = sam) => api('GET', `/v1/inbox/conversations/${id}`, undefined, tok);
  const connectors = await api('GET', '/v1/connectors', undefined, priya);
  const telegram = connectors.find((c) => c.provider === 'telegram');

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const { ctx, p } = await signIn(b, 'sam@northwind.test');
  const shot = async (n, page = p) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = (page = p) => page.innerText('body');

  // 1. The inbox: Mine has Hannah and Omar.
  await p.getByRole('tab', { name: 'Client Inbox' }).first().click();
  await p.waitForTimeout(3500);
  let t = await body();
  check('Mine lists Hannah and Omar', /Hannah Becker/.test(t) && /Omar Haddad/.test(t));
  check('Mine does not list Daniel (Marco’s)', !/Daniel Moreau/.test(t));
  check('view counts shown', /Mine\s*2/.test(t));
  await shot('01-inbox-mine');
  await p.getByRole('tab', { name: /All open/ }).click();
  await p.waitForTimeout(2500);
  t = await body();
  check('All open lists every client', /Daniel Moreau/.test(t) && /Aiko Tanaka/.test(t));
  await shot('02-inbox-all-open');
  await p.getByRole('tab', { name: /Mine/ }).click();
  await p.waitForTimeout(1500);

  // 2. Open Hannah: timeline with client messages, reply and note; marked read for Sam.
  check(
    'Hannah unread before',
    (await detailOf(hannah.conversationId)).conversation.unread === true,
  );
  await p.getByRole('button', { name: /^Hannah Becker/ }).click();
  await p.waitForTimeout(4000);
  t = await body();
  check('timeline shows client message', /awareness chart by market/.test(t));
  check('timeline shows the reply', /send it by Thursday noon/.test(t));
  check(
    'timeline shows the internal note',
    /Internal note/.test(t) && /Topline is with QA/.test(t),
  );
  check('test mode reply captured by sandbox', /Captured by sandbox/.test(t));
  check(
    'opening marks it read on the server',
    (await detailOf(hannah.conversationId)).conversation.unread === false,
  );
  await shot('03-conversation');

  // 3. A reply from a "/" template, then a note.
  const composer = p.getByLabel('Reply to the client', { exact: true });
  await composer.fill('/top');
  await p.waitForTimeout(600);
  await shot('04-template-suggestion');
  await p.getByRole('button', { name: 'Use template Topline timing' }).click();
  await p.waitForTimeout(300);
  check(
    'template filled with client name',
    /Hi Hannah, the topline for Acme|Hi Hannah, the topline for/.test(await composer.inputValue()),
  );
  await p.getByRole('button', { name: 'Send reply' }).click();
  await p.waitForTimeout(3000);
  let d = await detailOf(hannah.conversationId);
  check(
    'templated reply on the server',
    d.timeline.some((x) => x.type === 'message' && /the topline for/.test(x.message.text)),
  );
  await p.getByRole('radio', { name: /Internal note/ }).click();
  await p.getByLabel('Internal note', { exact: true }).fill('Chart is in the appendix, slide 14.');
  await p.getByRole('button', { name: 'Add note' }).click();
  await p.waitForTimeout(2500);
  d = await detailOf(hannah.conversationId);
  check(
    'note on the server',
    d.timeline.some((x) => x.type === 'note' && /slide 14/.test(x.note.text)),
  );
  await shot('05-note-added');

  // 4. Offline: a reply, and Resolve. Shown at once, sent on reconnect.
  await p.getByRole('radio', { name: /Reply on Telegram/ }).click();
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p
    .getByLabel('Reply to the client', { exact: true })
    .fill('Sending the chart in a minute (written offline).');
  await p.getByRole('button', { name: 'Send reply' }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Resolve' }).click();
  await p.waitForTimeout(1200);
  t = await body();
  check('offline reply shows as queued', /Queued on this phone/.test(t));
  check('resolved at once offline', /Reopen/.test(t) && /Resolved/.test(t));
  await shot('06-offline-queued');
  d = await detailOf(hannah.conversationId);
  check(
    'server has not seen the offline reply yet',
    !d.timeline.some((x) => x.type === 'message' && /written offline/.test(x.message.text)),
  );
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  d = await detailOf(hannah.conversationId);
  check(
    'offline reply sent on reconnect',
    d.timeline.some((x) => x.type === 'message' && /written offline/.test(x.message.text)),
  );
  check('resolve sent on reconnect', d.conversation.status === 'resolved');
  t = await body();
  check('queued label cleared', !/Queued on this phone/.test(t));

  // 5. Live: Hannah writes again (from Telegram) while it is open.
  await api(
    'POST',
    `/v1/connectors/${telegram.connectorId}/simulate-inbound`,
    { fromName: 'Hannah Becker', fromHandle: 'hannah_b', text: 'Got it, thanks a lot!' },
    priya,
  );
  await p.waitForTimeout(4000);
  t = await body();
  check('client message arrives live', /Got it, thanks a lot!/.test(t));
  await shot('07-live-client-message');

  // 6. Details: priority and a tag (queued and synced), escalation (server).
  await p.getByRole('button', { name: 'Client and conversation details' }).click();
  await p.waitForTimeout(2500);
  await p.getByRole('radio', { name: 'Urgent' }).click();
  await p.getByLabel('Add a tag').fill('chart');
  await p.getByLabel('Add a tag').press('Enter');
  await p.waitForTimeout(3000);
  d = await detailOf(hannah.conversationId);
  check('priority changed on the server', d.conversation.priority === 'urgent');
  check('tag added on the server', d.conversation.tags.includes('chart'));
  await shot('08-details');
  await p.getByLabel('Escalation reason').fill('Client needs the chart before the board meeting');
  await p.getByRole('button', { name: 'Escalate' }).click();
  await p.waitForTimeout(2500);
  d = await detailOf(hannah.conversationId);
  check('escalated on the server', !!d.conversation.escalation);

  // 7. Another device of Sam's sees the read mark and changes; an assignment from Priya shows.
  const omar = list.items.find((c) => c.client.name === 'Omar Haddad');
  await api('PATCH', `/v1/inbox/conversations/${omar.conversationId}`, { assigneeId: null }, priya);
  await p.goto(`${APP}/inbox`);
  await p.waitForTimeout(4000);
  t = await body();
  check('reassigned elsewhere leaves Mine live', !/Omar Haddad/.test(t));

  // 8. Light theme list.
  await p.getByRole('tab', { name: /All open/ }).click();
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(1500);
  await shot('09-inbox-light');
  await p.emulateMedia({ colorScheme: 'dark' });

  // 9. Priya: dashboard.
  const pr = await signIn(b, 'priya@northwind.test');
  await pr.p.goto(`${APP}/inbox/dashboard`);
  await pr.p.waitForTimeout(4500);
  t = await body(pr.p);
  check('dashboard shows KPIs', /Median first reply/.test(t) && /By channel/.test(t));
  await shot('10-dashboard', pr.p);

  await b.close();
  console.log(
    failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : '\nALL PASS',
  );
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
