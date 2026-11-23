const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Minutes and chat export end to end: Sam makes minutes for an ended call, edits them (online and
// offline), follows Priya's edit live, shares them (the card shows in the conversation), downloads a
// PDF, exports the conversation, and deletes the minutes.
// Usage: pnpm web:export, then node scripts/e2e-minutes.cjs <screenshot-dir> with the API seeded by
// e2e-seed.mjs and Mongo on localhost (an ended call is written straight into the database).
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
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const list = Array.isArray(convs) ? convs : (convs.items ?? convs.conversations);
  const conv = list.find((c) => c.kind === 'channel') ?? list[0];
  const me = async (t) =>
    (await api('GET', '/v1/auth/me', undefined, t)).user ??
    (await api('GET', '/v1/auth/me', undefined, t));

  // An ended call with Sam and Priya in it, as the call server leaves it.
  const { MongoClient, ObjectId } = require(
    pathMod.join(__dirname, '../../api/node_modules/mongodb'),
  );
  const mongo = await MongoClient.connect('mongodb://localhost:27017');
  const mdb = mongo.db('sampledge_connect');
  const tenant = await mdb.collection('tenants').findOne({ slug: 'northwind' });
  const users = await mdb.collection('users').find({ tenantId: tenant._id }).toArray();
  const uid = (email) => users.find((u) => u.email === email)._id;
  const callId = new ObjectId().toHexString();
  const startedAt = new Date(Date.now() - 90 * 60_000);
  const endedAt = new Date(startedAt.getTime() + 35 * 60_000);
  await mdb.collection('calls').insertOne({
    _id: callId,
    tenantId: tenant._id,
    conversationId: conv.conversationId,
    media: 'video',
    status: 'ended',
    startedBy: uid('sam@northwind.test'),
    startedAt,
    endedAt,
    room: `room-${callId}`,
    participants: [
      {
        userId: uid('sam@northwind.test'),
        state: 'left',
        joinedAt: startedAt,
        leftAt: endedAt,
        ringUntil: null,
      },
      {
        userId: uid('priya@northwind.test'),
        state: 'left',
        joinedAt: new Date(startedAt.getTime() + 60_000),
        leftAt: endedAt,
        ringUntil: null,
      },
    ],
    messageId: null,
    lastActivityAt: endedAt,
    guests: [],
  });
  const server = async () =>
    (await api('GET', `/v1/calls/${callId}/minutes`, undefined, sam)).minutes;

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const signIn = async (scheme, email, path) => {
    const ctx = await b.newContext({
      ...devices['iPhone 13'],
      colorScheme: scheme,
      acceptDownloads: true,
    });
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
    await p.goto(`${APP}${path}`);
    await p.waitForTimeout(3500);
    return { ctx, p };
  };
  const { ctx, p } = await signIn('dark', 'sam@northwind.test', `/minutes/${callId}`);
  const shot = async (page, n, top) => {
    if (top)
      await page
        .getByRole('heading', { name: 'Attendees' })
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => undefined);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = () => p.innerText('body');

  check('offers to make minutes', /No minutes for this call yet/.test(await body()));
  await shot(p, '01-make');
  await p.getByRole('button', { name: 'Make minutes' }).click();
  await p.waitForTimeout(4000);
  let m = await server();
  check('draft made', m?.status === 'draft');
  check('attendees filled in', /Sam/.test(await body()) && /Priya/.test(await body()));

  // Edit the summary (saves when you leave the box).
  const summary = p.getByLabel('Summary', { exact: true });
  await summary.scrollIntoViewIfNeeded();
  await summary.fill('We agreed the Q1 field plan and the launch date.');
  await p.getByLabel('Agenda', { exact: true }).click();
  await p.getByLabel('Agenda', { exact: true }).fill('Q1 fieldwork, launch date');
  await summary.click();
  await p.waitForTimeout(5000);
  m = await server();
  check('summary saved', m.summary === 'We agreed the Q1 field plan and the launch date.');
  check('agenda saved', m.agenda === 'Q1 fieldwork, launch date');

  // Offline: add a decision and an action; they go up on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(800);
  const addDecision = p.getByRole('button', { name: 'Add decision' });
  await addDecision.scrollIntoViewIfNeeded();
  await addDecision.click();
  await p.getByLabel('Decision 1', { exact: true }).fill('Soft launch moves to Tuesday');
  const addAction = p.getByRole('button', { name: 'Add action' });
  await addAction.click();
  await p.getByLabel('Action', { exact: true }).last().fill('Send the revised sample plan');
  await p.getByLabel('Owner', { exact: true }).last().fill('Lena');
  await p.getByLabel('Due', { exact: true }).last().fill('Monday');
  await p.getByLabel('Decision 1', { exact: true }).click();
  await p.waitForTimeout(1200);
  check('not sent while offline', (await server()).decisions.length === 0);
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  m = await server();
  check('decision sent on reconnect', m.decisions[0] === 'Soft launch moves to Tuesday');
  check(
    'action sent on reconnect',
    m.actionItems[0]?.text === 'Send the revised sample plan' && m.actionItems[0]?.due === 'Monday',
  );

  // Priya edits the notes on her device: Sam sees it live.
  await api(
    'PATCH',
    `/v1/minutes/${m.minutesId}`,
    { baseRevision: m.revision, notes: 'Budget review next week.' },
    priya,
  );
  await p.waitForTimeout(3000);
  check(
    'follows Priya live',
    (await p.getByLabel('Notes', { exact: true }).inputValue()) === 'Budget review next week.',
  );
  await shot(p, '02-draft', true);
  await p.getByLabel('Notes', { exact: true }).scrollIntoViewIfNeeded();
  await shot(p, '03-actions');

  // Share, and the card shows in the conversation.
  const share = p.getByRole('button', { name: 'Share with the conversation' });
  await share.scrollIntoViewIfNeeded();
  await share.click();
  await p.waitForTimeout(3000);
  check('shared', (await server()).status === 'shared');

  // Download a PDF (the web build saves it through the browser).
  const dl = p.getByRole('button', { name: 'Download PDF' });
  await dl.scrollIntoViewIfNeeded();
  await p.getByRole('radio', { name: 'Executive template' }).click();
  await shot(p, '04-download');
  const [download] = await Promise.all([
    p.waitForEvent('download', { timeout: 20000 }),
    dl.click(),
  ]);
  const file = pathMod.join(out, 'minutes.pdf');
  await download.saveAs(file);
  check('PDF downloaded', fs.readFileSync(file).subarray(0, 4).toString() === '%PDF');

  await p.goto(`${APP}/conversation/${conv.conversationId}`);
  await p.waitForTimeout(4000);
  check('card in the conversation', /Minutes · 1 decision · 1 action/.test(await body()));
  await shot(p, '05-card');

  // Export the conversation as Word.
  await p.goto(
    `${APP}/export-chat?conversationId=${conv.conversationId}&title=${encodeURIComponent(conv.name ?? 'Chat')}`,
  );
  await p.waitForTimeout(3000);
  await p.getByRole('radio', { name: 'Word', exact: true }).click();
  await p.getByRole('radio', { name: 'Last 30 days', exact: true }).click();
  await shot(p, '06-export');
  const [exp] = await Promise.all([
    p.waitForEvent('download', { timeout: 30000 }),
    p.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const docx = pathMod.join(out, 'export.docx');
  await exp.saveAs(docx);
  check('Word export downloaded', fs.readFileSync(docx).subarray(0, 2).toString() === 'PK');

  // Light theme, list screen.
  const light = await signIn(
    'light',
    'sam@northwind.test',
    `/minutes?conversationId=${conv.conversationId}`,
  );
  check('listed', /Draft|decision/.test(await light.p.innerText('body')));
  await shot(light.p, '07-list-light');

  // Delete.
  await p.goto(`${APP}/minutes/${callId}`);
  await p.waitForTimeout(3500);
  const del = p.getByRole('button', { name: 'Delete', exact: true });
  await del.scrollIntoViewIfNeeded();
  await del.click();
  await p.waitForTimeout(3000);
  check('deleted', (await server()) === null);

  await mdb.collection('calls').deleteOne({ _id: callId });
  await mongo.close();
  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
