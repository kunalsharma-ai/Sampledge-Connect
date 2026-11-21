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
      ...(body ? { 'content-type': 'application/json' } : {}),
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

  // ---- Phase 1 chat: reply with an @mention, edit, delete, mentions in Activity
  const users = await api('GET', '/v1/users', undefined, marco);
  const idOf = (name) => users.find((u) => u.displayName === name).userId;
  const serverMsgs = async () => {
    const r = await api(
      'GET',
      `/v1/conversations/${ch.conversationId}/messages?limit=100`,
      undefined,
      marco,
    );
    return Array.isArray(r) ? r : (r.messages ?? r.items);
  };
  const longPress = async (text) => {
    await p.getByText(text, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(500);
  };
  await longPress('Got it, thanks Sam. Launching at 2pm.');
  await shot('09-message-actions');
  await p.getByRole('button', { name: 'Reply' }).click();
  await p.locator('textarea').last().fill('Sounds good. @Pri');
  await p.waitForTimeout(400);
  await shot('10-reply-with-mention-picker');
  await p.getByRole('button', { name: 'Mention Priya Shah' }).click();
  await p.locator('textarea').last().pressSequentially('can you confirm the quota?');
  await p.getByRole('button', { name: 'Send message' }).click();
  await p.waitForTimeout(2500);
  await shot('11-reply-sent');
  let all = await serverMsgs();
  const marcoMsg = all.find((m) => m.content.text === 'Got it, thanks Sam. Launching at 2pm.');
  const reply = all.find((m) => m.content.text.startsWith('Sounds good.'));
  check(
    'reply reached the server with its parent',
    reply?.replyToMessageId === marcoMsg?.messageId,
  );
  check('mention carried the user id', reply?.content.mentions.includes(idOf('Priya Shah')));
  check(
    'mention text is readable',
    reply?.content.text === 'Sounds good. @Priya Shah can you confirm the quota?',
  );

  await longPress('Sam here. Boost sample brief is in the shared folder.');
  await p.getByRole('button', { name: 'Edit' }).click();
  await p
    .locator('textarea')
    .last()
    .fill('Sam here. Boost sample brief (v2) is in the shared folder.');
  await shot('12-editing');
  await p.getByRole('button', { name: 'Save edit' }).click();
  await p.waitForTimeout(2500);
  all = await serverMsgs();
  const edited = all.find((m) => m.content.text.includes('(v2)'));
  check('edit saved on the server', !!edited?.editedAt);

  await longPress('Written offline: please hold the DE invites until the boost is live.');
  await p.getByRole('button', { name: 'Delete for everyone' }).click();
  await p.waitForTimeout(2500);
  await shot('13-edited-and-deleted');
  all = await serverMsgs();
  const gone = all.find((m) => m.clientMessageId && m.deletedAt);
  check('delete saved on the server', !!gone);

  // ---- Reactions: add from the sheet, live reaction from Marco, toggle off from the chip, offline add
  const reactionsOn = async (text) =>
    (await serverMsgs()).find((m) => m.content.text === text)?.reactions ?? [];
  const marcoText = 'Got it, thanks Sam. Launching at 2pm.';
  await longPress(marcoText);
  await p.getByRole('button', { name: 'React with 👍' }).click();
  await p.waitForTimeout(2000);
  check(
    'reaction saved on the server',
    (await reactionsOn(marcoText)).some(
      (r) => r.emoji === '👍' && r.userIds.includes(idOf('Sam Okafor')),
    ),
  );
  await api(
    'PUT',
    `/v1/messages/${marcoMsg.messageId}/reactions/${encodeURIComponent('👍')}`,
    undefined,
    marco,
  );
  await api(
    'PUT',
    `/v1/messages/${marcoMsg.messageId}/reactions/${encodeURIComponent('🎉')}`,
    undefined,
    marco,
  );
  await p.waitForTimeout(2000);
  await shot('16-reactions-live');
  check('live reactions shown with counts', (await p.innerText('body')).includes('🎉'));
  await p.locator('[aria-label^="👍 2"]').first().click();
  await p.waitForTimeout(2000);
  check(
    'tapping your chip removes your reaction',
    !(await reactionsOn(marcoText))
      .find((r) => r.emoji === '👍')
      ?.userIds.includes(idOf('Sam Okafor')),
  );
  await ctx.setOffline(true);
  await p.waitForTimeout(800);
  await longPress(marcoText);
  await p.getByRole('button', { name: 'React with ❤️' }).click();
  await p.waitForTimeout(800);
  await shot('17-reaction-queued-offline');
  check(
    'offline reaction not on the server yet',
    !(await reactionsOn(marcoText)).some((r) => r.emoji === '❤️'),
  );
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  check(
    'offline reaction delivered after reconnect',
    (await reactionsOn(marcoText)).some((r) => r.emoji === '❤️'),
  );
  await shot('18-reactions-synced');

  const priya = (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email: 'priya@northwind.test',
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: {
        text: 'Quota confirmed. @Sam Okafor please share the boost brief with the client.',
        mentions: [idOf('Sam Okafor')],
      },
    },
    priya,
  );
  await p.waitForTimeout(2000);
  await shot('14-mentioned-by-priya');
  await p.goto(`${APP}/activity`);
  await p.waitForTimeout(2500);
  await shot('15-activity-mentions');
  check(
    'mention of you listed in Activity',
    (await p.innerText('body')).includes('please share the boost brief'),
  );
  await b.close();
  if (failures.length) process.exit(1);
})();
