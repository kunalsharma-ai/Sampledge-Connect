const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Files library end to end: Sam sees every file shared in his conversations, filters by type,
// searches names, sees a new file from another device arrive live, opens a file at its message,
// and scopes the list to one conversation. Offline it lists the files saved on the phone, and a
// file sent while offline shows as waiting, then uploads on reconnect.
// Usage: pnpm web:export, then node scripts/e2e-files.cjs <screenshot-dir> with the API
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
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
    (c) => c.name === 'fieldwork-ops',
  );
  const run = Date.now().toString(36).slice(-4);
  const fx = (n) => pathMod.join(__dirname, 'e2e-fixtures', n);
  const share = async (file, fileName, mimeType, text, tok, extra = {}) => {
    const bytes = fs.readFileSync(fx(file));
    const ticket = await api(
      'POST',
      '/v1/uploads',
      { conversationId: ops.conversationId, fileName, mimeType, sizeBytes: bytes.length, ...extra },
      tok,
    );
    const put = await fetch(API + ticket.uploadUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    if (!put.ok) throw new Error(`upload PUT ${put.status}`);
    await api('POST', `/v1/uploads/${ticket.uploadId}/complete`, undefined, tok);
    return api(
      'POST',
      `/v1/conversations/${ops.conversationId}/messages`,
      {
        conversationId: ops.conversationId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text, mentions: [] },
        attachmentIds: [ticket.uploadId],
      },
      tok,
    );
  };
  const brief = `Wave-3-brief-${run}.pdf`;
  const chart = `quota-chart-${run}.png`;
  const briefMsg = await share(
    'boost-sample-brief.pdf',
    brief,
    'application/pdf',
    'Brief for wave 3.',
    priya,
  );
  await share('quota-by-market.png', chart, 'image/png', 'Quota by market.', priya, {
    width: 480,
    height: 300,
  });

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
  const box = () => p.getByLabel('Search file names');

  // Open the conversation once so its messages are saved on the phone.
  await p.goto(`${APP}/conversation/${ops.conversationId}`);
  await p.waitForTimeout(3500);

  // 1. Every file, newest first, with where it was shared and who shared it.
  await p.goto(`${APP}/files`);
  await p.waitForTimeout(3500);
  let t = await body();
  check('files from the server listed', t.includes(brief) && t.includes(chart));
  check('shows conversation and sharer', /# fieldwork-ops · Priya Shah/.test(t));
  check('newest first', t.indexOf(chart) < t.indexOf(brief));
  await shot('01-files');

  // 2. Filter by type.
  await p.getByRole('tab', { name: 'Images' }).click();
  await p.waitForTimeout(2000);
  t = await body();
  check('images filter', t.includes(chart) && !t.includes(brief));
  const thumb = await p.evaluate(() =>
    [...document.images].some((i) => i.src.includes('/v1/files/') && i.naturalWidth > 0),
  );
  check('image thumbnail loads through a signed link', thumb);
  await shot('02-images');
  await p.getByRole('tab', { name: 'All' }).click();

  // 3. Search names.
  await box().fill(`brief-${run}`);
  await p.waitForTimeout(2000);
  t = await body();
  check('name search', t.includes(brief) && !t.includes(chart));
  await box().fill('');
  await p.waitForTimeout(1500);

  // 4. A file shared from another device shows up live.
  const live = `fieldwork-notes-${run}.pdf`;
  await share('boost-sample-brief.pdf', live, 'application/pdf', 'Notes from today.', priya);
  await p.waitForTimeout(4500);
  t = await body();
  check('new file arrives live', t.includes(live) && t.indexOf(live) < t.indexOf(chart));
  await shot('03-live');

  // 5. Show in chat opens the conversation at the message.
  await p.getByRole('button', { name: `Show ${brief} in the conversation` }).click();
  await p.waitForTimeout(3000);
  check(
    'opens the conversation at the message',
    p.url().includes(`/conversation/${ops.conversationId}`) &&
      p.url().includes(briefMsg.message.messageId),
  );

  // 6. Files for one conversation from its info screen.
  await p.goto(`${APP}/conversation-info/${ops.conversationId}`);
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: 'Files in this conversation' }).click();
  await p.waitForTimeout(3000);
  t = await body();
  check(
    'scoped to the conversation',
    /Files · /.test(t) && t.includes(brief) && !/# fieldwork-ops ·/.test(t),
  );
  await shot('04-conversation-files');

  // 7. Offline: files saved on the phone, and a file sent offline waits to upload.
  await p.goto(`${APP}/conversation/${ops.conversationId}`);
  await p.waitForTimeout(3000);
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Attach' }).click();
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByRole('button', { name: 'Files' }).click(),
  ]);
  await chooser.setFiles(fx('boost-sample-brief.pdf'));
  await p.waitForTimeout(600);
  await p.locator('textarea').last().fill(`Offline copy ${run}`);
  await p.getByRole('button', { name: 'Send message' }).click();
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Conversation details' }).first().click();
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Files in this conversation' }).click();
  await p.waitForTimeout(2500);
  t = await body();
  check('offline note', /Showing the files saved on this phone/.test(t));
  check('phone files listed offline', t.includes(brief) && t.includes(live));
  check('unsent file waits to upload', /Waiting to upload/.test(t));
  await shot('05-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(8000);
  t = await body();
  check(
    'uploaded after reconnect',
    !/Waiting to upload/.test(t) && !/Showing the files saved/.test(t),
  );
  const server = await api(
    'GET',
    `/v1/files?in=${ops.conversationId}&q=boost-sample`,
    undefined,
    sam,
  );
  check(
    'the offline file reached the server',
    server.items.some((f) => f.fileName === 'boost-sample-brief.pdf'),
  );
  await shot('06-back-online');

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
