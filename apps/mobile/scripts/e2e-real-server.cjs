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

  // ---- Attachments: a PDF and a photo from Sam, a photo from Marco, signed download
  const path = require('node:path');
  const fx = (n) => path.join(__dirname, 'e2e-fixtures', n);
  const pick = async (menuItem, file) => {
    await p.getByRole('button', { name: 'Attach' }).click();
    const [chooser] = await Promise.all([
      p.waitForEvent('filechooser'),
      p.getByRole('button', { name: menuItem }).click(),
    ]);
    await chooser.setFiles(file);
    await p.waitForTimeout(500);
  };
  await pick('Files', fx('boost-sample-brief.pdf'));
  await pick('Photos', fx('quota-by-market.png'));
  await p.locator('textarea').last().fill('Brief and the quota chart for the client call.');
  await shot('19-files-attached');
  await p.getByRole('button', { name: 'Send message' }).click();
  await p.waitForTimeout(3500);
  await shot('20-files-sent');
  all = await serverMsgs();
  const withFiles = all.find(
    (m) => m.content.text === 'Brief and the quota chart for the client call.',
  );
  check('message sent with 2 attachments', withFiles?.attachments?.length === 2);
  check(
    'attachments keep names and types',
    JSON.stringify(withFiles?.attachments?.map((a) => [a.fileName, a.mimeType])) ===
      JSON.stringify([
        ['boost-sample-brief.pdf', 'application/pdf'],
        ['quota-by-market.png', 'image/png'],
      ]),
  );
  const signed = await api(
    'GET',
    `/v1/attachments/${withFiles.attachments[0].attachmentId}/url`,
    undefined,
    marco,
  );
  const pdfBytes = await (await fetch(API + signed.url)).arrayBuffer();
  check(
    'uploaded bytes download intact',
    Buffer.from(pdfBytes).equals(require('node:fs').readFileSync(fx('boost-sample-brief.pdf'))),
  );

  // Marco shares a photo: Sam sees it through a signed link.
  const png = require('node:fs').readFileSync(fx('quota-by-market.png'));
  const ticket = await api(
    'POST',
    '/v1/uploads',
    {
      conversationId: ch.conversationId,
      fileName: 'de-boost-progress.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
      width: 480,
      height: 300,
    },
    marco,
  );
  const put = await fetch(API + ticket.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${marco}`, 'content-type': 'application/octet-stream' },
    body: png,
  });
  if (!put.ok) throw new Error(`upload PUT ${put.status} ${await put.text()}`);
  await api('POST', `/v1/uploads/${ticket.uploadId}/complete`, undefined, marco);
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: { text: 'DE boost is filling fast.', mentions: [] },
      attachmentIds: [ticket.uploadId],
    },
    marco,
  );
  await p.waitForTimeout(3500);
  await shot('21-photo-from-marco');
  const imgOk = await p.evaluate(() =>
    [...document.images].some(
      (i) => i.src.includes('/v1/files/') && i.complete && i.naturalWidth > 0,
    ),
  );
  check('photo from another member loads through a signed link', imgOk);

  // Offline: the file waits on the device and uploads after reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(800);
  await pick('Files', fx('boost-sample-brief.pdf'));
  await p.getByRole('button', { name: 'Send message' }).click();
  await p.waitForTimeout(1200);
  await shot('22-file-queued-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  all = await serverMsgs();
  check(
    'file queued offline uploaded and sent after reconnect',
    all.filter((m) => m.attachments?.some((a) => a.fileName === 'boost-sample-brief.pdf'))
      .length === 2,
  );

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

  // ---- Notifications: server feed, live in-app banner, tab badge, read state across devices
  const samApi = (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email: 'sam@northwind.test',
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e second device', platform: 'web' },
    })
  ).accessToken;
  const feed = () => api('GET', '/v1/notifications?limit=50', undefined, samApi);
  check(
    'mention was read when the conversation was open',
    (await feed()).items.some((n) => n.kind === 'mention' && n.readAt),
  );
  await p.goto(`${APP}/messages`);
  await p.waitForTimeout(2500);
  const samMsg = (await serverMsgs()).find(
    (m) => m.senderId === idOf('Sam Okafor') && !m.deletedAt && m.content.text.includes('Sam here'),
  );
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: { text: 'Got the brief, thanks. Forwarding it to the client now.', mentions: [] },
      replyToMessageId: samMsg.messageId,
    },
    priya,
  );
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/23-in-app-banner.png` });
  console.log('shot 23-in-app-banner');
  const bannerText = await p.innerText('body');
  check(
    'in-app banner shows the live reply',
    bannerText.includes('replied to you') && bannerText.includes('Forwarding it to the client'),
  );
  check('server counts the reply unread', (await feed()).unreadCount === 1);
  await p.goto(`${APP}/activity`);
  await p.waitForTimeout(2500);
  await shot('24-activity-unread');
  check(
    'Activity shows the unread reply and mark-all',
    /1 unread/.test(await p.innerText('body')) &&
      (await p.innerText('body')).includes('Mark all read'),
  );
  // Read on another device: this phone follows.
  await api('POST', '/v1/notifications/read', { all: true }, samApi);
  await p.waitForTimeout(2500);
  await shot('25-read-on-other-device');
  check(
    'read on another device clears the badge here',
    !/1 unread/.test(await p.innerText('body')),
  );
  // Offline mark-read reaches the server after reconnecting.
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: {
        text: '@Sam Okafor client approved the boost. Thanks!',
        mentions: [idOf('Sam Okafor')],
      },
    },
    priya,
  );
  await p.waitForTimeout(2500);
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Mark all read' }).click();
  await shot('26-marked-read-offline');
  check('offline mark stays local until reconnect', (await feed()).unreadCount === 1);
  await ctx.setOffline(false);
  await p.waitForTimeout(5000);
  check('offline mark reached the server', (await feed()).unreadCount === 0);
  await p.goto(`${APP}/settings/notifications`);
  await p.waitForTimeout(2000);
  await shot('27-notification-settings');
  check('push shown as needing setup', (await p.innerText('body')).includes('Needs setup'));
  check(
    'server push status read live',
    (await p.innerText('body')).includes('no push provider configured'),
  );

  // ---- Per-conversation notification level (mute), synced across devices and offline-safe
  const levelOnServer = async () => {
    const r = await api('GET', '/v1/conversations', undefined, samApi);
    return (Array.isArray(r) ? r : r.conversations).find(
      (c) => c.conversationId === ch.conversationId,
    ).myNotifyLevel;
  };
  await p.goto(`${APP}/conversation/${ch.conversationId}`);
  await p.waitForTimeout(2500);
  await p.getByRole('button', { name: /^Notifications:/ }).click();
  await shot('28-notify-level-sheet');
  await p.getByRole('radio', { name: 'Nothing' }).click();
  await p.waitForTimeout(1500);
  check('mute saved on the server', (await levelOnServer()) === 'none');
  const before = (await feed()).unreadCount;
  await p.goto(`${APP}/messages`);
  await p.waitForTimeout(1500);
  await api(
    'POST',
    `/v1/conversations/${ch.conversationId}/messages`,
    {
      conversationId: ch.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: { text: '@Sam Okafor are you around?', mentions: [idOf('Sam Okafor')] },
    },
    priya,
  );
  await p.waitForTimeout(2000);
  await shot('29-muted-conversation');
  check('muted conversation sends no notification', (await feed()).unreadCount === before);
  check(
    'muted conversation shows no banner',
    !(await p.innerText('body')).includes('mentioned you'),
  );
  // Change it offline: kept on the phone, sent after reconnecting.
  await p.goto(`${APP}/conversation/${ch.conversationId}`);
  await p.waitForTimeout(2000);
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: /^Notifications:/ }).click();
  await p.getByRole('radio', { name: '@Mentions only' }).click();
  await p.getByRole('button', { name: /^Notifications:/ }).click();
  await shot('30-level-changed-offline');
  check('offline level change not on the server yet', (await levelOnServer()) === 'none');
  await p.getByRole('button', { name: 'Done' }).click();
  await ctx.setOffline(false);
  await p.waitForTimeout(5000);
  check('offline level change reached the server', (await levelOnServer()) === 'mentions');
  // Changed on another device: this phone follows.
  await api('PUT', `/v1/conversations/${ch.conversationId}/notify-level`, { level: 'all' }, samApi);
  await p.waitForTimeout(2500);
  check(
    'level changed on another device shows here',
    (await p.getByRole('button', { name: /^Notifications:/ }).getAttribute('aria-label')) ===
      'Notifications: all activity',
  );
  await b.close();
  if (failures.length) process.exit(1);
})();
