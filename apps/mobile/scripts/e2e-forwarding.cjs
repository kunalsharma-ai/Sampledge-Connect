const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Forwarding end to end: Sam forwards Priya's message to two conversations with a comment, it
// shows at once with the original quoted, and the server stores the snapshot. Offline, a
// forward is queued and sent on reconnect. In a group where forwarding is off, Sam can only
// re-share inside it. As a group owner, Sam turns forwarding off from the details screen.
// Usage: pnpm web:export, then node scripts/e2e-forwarding.cjs <screenshot-dir> with the API
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
  const priya = await login('priya@northwind.test');
  const users = await api('GET', '/v1/users', undefined, sam);
  const uid = (e) => users.find((u) => u.email === e).userId;
  const list = async (tok) => {
    const r = await api('GET', '/v1/conversations', undefined, tok);
    return Array.isArray(r) ? r : r.conversations;
  };
  const ops = (await list(sam)).find((c) => c.name === 'fieldwork-ops');
  const run = Date.now().toString(36).slice(-4);
  const post = (convId, text, tok) =>
    api(
      'POST',
      `/v1/conversations/${convId}/messages`,
      {
        conversationId: convId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text, mentions: [] },
      },
      tok,
    );
  // Two places to forward to, made fresh so they are easy to find.
  const dest1 = await api(
    'POST',
    '/v1/conversations',
    {
      kind: 'group',
      name: `Client prep ${run}`,
      memberIds: [uid('sam@northwind.test'), uid('marco@northwind.test')],
    },
    sam,
  );
  const dest2 = await api(
    'POST',
    '/v1/conversations',
    {
      kind: 'group',
      name: `Ops leads ${run}`,
      memberIds: [uid('sam@northwind.test'), uid('lena@northwind.test')],
    },
    sam,
  );
  // A private group Priya owns, with forwarding off.
  const board = await api(
    'POST',
    '/v1/conversations',
    {
      kind: 'group',
      name: `Board ${run}`,
      memberIds: [uid('priya@northwind.test'), uid('sam@northwind.test')],
    },
    priya,
  );
  await api(
    'PUT',
    `/v1/conversations/${board.conversationId}/forwarding`,
    { allowed: false },
    priya,
  );
  const original = `Quota for wave 3 is confirmed at 1,200 completes ${run}`;
  const src = await post(ops.conversationId, original, priya);
  const secret = `Board only: budget is 40k ${run}`;
  await post(board.conversationId, secret, priya);

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
  await inputs.nth(0).fill(APP);
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
  const msgs = async (convId) => {
    const r = await api('GET', `/v1/conversations/${convId}/messages?limit=50`, undefined, sam);
    return Array.isArray(r) ? r : (r.messages ?? r.items);
  };
  const openActions = async (text) => {
    await p.getByText(text, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(800);
  };
  const pickAndSend = async (names, comment) => {
    for (const n of names) await p.getByRole('checkbox', { name: n }).click();
    if (comment) await p.getByLabel('Comment').fill(comment);
    await p.waitForTimeout(400);
  };

  // 1. Forward to two conversations with a comment.
  await p.goto(`${APP}/conversation/${ops.conversationId}`);
  await p.waitForTimeout(3500);
  await openActions(original);
  await shot('01-actions');
  await p.getByRole('button', { name: 'Forward' }).click();
  await p.waitForTimeout(1500);
  await pickAndSend([`Client prep ${run}`, `Ops leads ${run}`], 'For the client call');
  let t = await body();
  check(
    'picker shows the original and the count',
    t.includes(original) && /2 of 10 picked/.test(t),
  );
  await shot('02-picker');
  await p.getByRole('button', { name: 'Forward to 2' }).click();
  await p.waitForTimeout(4000);
  const m1 = (await msgs(dest1.conversationId)).find((m) => m.metadata?.forwarded);
  const m2 = (await msgs(dest2.conversationId)).find((m) => m.metadata?.forwarded);
  check(
    'server stored both forwards with the snapshot and comment',
    !!m1 &&
      !!m2 &&
      m1.metadata.forwarded.messageId === src.message.messageId &&
      m1.metadata.forwarded.text === original &&
      m1.content.text === 'For the client call',
  );
  check('forward records where it came from', m1?.metadata.forwarded.from === '#fieldwork-ops');
  await p.goto(`${APP}/conversation/${dest1.conversationId}`);
  await p.waitForTimeout(3000);
  t = await body();
  check(
    'bubble shows the forwarded card',
    /Forwarded from #fieldwork-ops/.test(t) && t.includes(original),
  );
  await shot('03-forwarded');

  // 2. Tapping the card opens the original at its message.
  await p
    .getByRole('button', { name: /^Forwarded message from Priya Shah/ })
    .first()
    .click();
  await p.waitForTimeout(3000);
  check(
    'opens the original',
    p.url().includes(ops.conversationId) && p.url().includes(src.message.messageId),
  );

  // 3. Offline: the forward shows at once and goes out on reconnect.
  await p.goto(`${APP}/conversation/${ops.conversationId}`);
  await p.waitForTimeout(3000);
  await ctx.setOffline(true);
  await p.waitForTimeout(1200);
  await openActions(original);
  await p.getByRole('button', { name: 'Forward' }).click();
  await p.waitForTimeout(1200);
  await pickAndSend([`Ops leads ${run}`], `Offline note ${run}`);
  await p.getByRole('button', { name: 'Forward', exact: true }).click();
  await p.waitForTimeout(1200);
  await p.goBack();
  await p.waitForTimeout(400);
  await p.goto(`${APP}/conversation/${dest2.conversationId}`).catch(() => undefined);
  await p.waitForTimeout(2500);
  t = await body();
  check(
    'queued forward shows offline',
    t.includes(`Offline note ${run}`) && /Forwarded from/.test(t),
  );
  await shot('04-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  const after = (await msgs(dest2.conversationId)).filter((m) => m.metadata?.forwarded);
  check(
    'the offline forward reached the server',
    after.some((m) => m.content.text === `Offline note ${run}`),
  );

  // 4. Forwarding off in Priya's group: only re-share inside it.
  await p.goto(`${APP}/conversation/${board.conversationId}`);
  await p.waitForTimeout(3500);
  await openActions(secret);
  await p.getByRole('button', { name: 'Forward' }).click();
  await p.waitForTimeout(1500);
  t = await body();
  check('note says forwarding is off', /Forwarding is turned off in Board/.test(t));
  check(
    'only the same conversation is offered',
    (await p.getByRole('checkbox').count()) === 1 && t.includes(`Board ${run}`),
  );
  await shot('05-forwarding-off');

  // 5. Sam owns Client prep: he turns forwarding off there, and every device sees it.
  await p.goto(`${APP}/conversation-info/${dest1.conversationId}`);
  await p.waitForTimeout(3000);
  await p.getByRole('switch', { name: 'Allow forwarding' }).click();
  await p.waitForTimeout(2500);
  const conv = (await list(sam)).find((c) => c.conversationId === dest1.conversationId);
  check('forwarding turned off on the server', conv.allowForwarding === false);
  await shot('06-allow-forwarding');

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
