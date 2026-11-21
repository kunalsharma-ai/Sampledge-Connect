const { chromium, devices } = require('playwright');
// End-to-end check of the web preview against a running API seeded by e2e-seed.mjs.
// Usage: node scripts/e2e-real-server.cjs <screenshot-dir>  (API and APP env vars override the defaults)
const out = process.argv[2];
const API = process.env.API ?? 'http://localhost:4000';
const APP = process.env.APP ?? 'http://localhost:8099';
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const pw = 'correct-horse-battery-1';
async function api(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : undefined;
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 200)));
  const shot = async (n) => {
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const inputs = p.locator('input');
  await inputs.nth(0).fill(API);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill('sam@northwind.test');
  await inputs.nth(3).fill(pw);
  await shot('01-sign-in-real-server');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(4000);
  await shot('02-home-synced');
  check(
    'home lists synced conversations with directory names',
    /fieldwork-ops/.test(await p.innerText('body')) && /Priya Shah/.test(await p.innerText('body')),
  );
  await p.goto(`${APP}/messages`);
  await p.waitForTimeout(2000);
  await shot('03-messages-synced');
  await p.getByText('# fieldwork-ops').last().click();
  await p.waitForTimeout(2000);
  await shot('04-channel-from-server');
  await p.locator('textarea').last().fill('Sam here. Boost sample brief is in the shared folder.');
  await p.getByRole('button', { name: 'Send message' }).click();
  await shot('05-sent-online');
  // Realtime: another member posts via the API
  const marco = (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email: 'marco@northwind.test',
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;
  const convs = await api('GET', '/v1/conversations', undefined, marco);
  const list = Array.isArray(convs) ? convs : convs.conversations;
  const ch = list.find((c) => c.name === 'fieldwork-ops');
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: { text: 'Got it, thanks Sam. Launching at 2pm.', mentions: [] },
    },
    marco,
  );
  await shot('06-realtime-from-marco');
  // Offline: queue a message
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  check('offline banner shown', (await p.innerText('body')).includes('Offline'));
  await p
    .locator('textarea')
    .last()
    .fill('Written offline: please hold the DE invites until the boost is live.');
  await p.getByRole('button', { name: 'Send message' }).click();
  await shot('07-offline-queued');
  // Marco posts while we are offline (missed-event recovery)
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: { text: 'Posted while Sam was offline.', mentions: [] },
    },
    marco,
  );
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  await shot('08-back-online-delivered');
  const msgs = await api(
    'GET',
    `/v1/conversations/${ch.conversationId}/messages?limit=50`,
    undefined,
    marco,
  );
  const arr = Array.isArray(msgs) ? msgs : (msgs.messages ?? msgs.items);
  const texts = arr.map((m) => m.content.text);
  check(
    'message sent online reached the server',
    texts.includes('Sam here. Boost sample brief is in the shared folder.'),
  );
  check(
    'message queued offline was delivered once',
    texts.filter((t) => t.startsWith('Written offline')).length === 1,
  );
  check(
    'message missed while offline recovered by sync',
    (await p.innerText('body')).includes('Posted while Sam was offline.'),
  );
  await b.close();
  if (failures.length) process.exit(1);
})();
