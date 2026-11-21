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

// RFC 6238 code for a base32 secret, `offset` 30-second steps from now.
function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = require('crypto').createHmac('sha1', key).update(step).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
(async () => {
  // Fake camera and microphone so calls connect real media through the local SFU.
  const b = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await b.newContext({
    ...devices['iPhone 13'],
    colorScheme: 'dark',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
  });
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

  // ---- Calls through the self-hosted SFU (skipped when the API has no LiveKit configured)
  const callsConfig = await api('GET', '/v1/calls/config', undefined, samApi);
  if (!callsConfig.enabled) {
    console.log('SKIP calls: the API has no media server configured');
  } else {
    // Priya's phone, signed in through the same web preview.
    const ctx2 = await b.newContext({
      ...devices['iPhone 13'],
      colorScheme: 'dark',
      permissions: ['camera', 'microphone'],
    });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => console.log('pageerror (priya):', e.message.slice(0, 300)));
    await p2.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(1500);
    const in2 = p2.locator('input');
    await in2.nth(0).fill(API);
    await in2.nth(1).fill('northwind');
    await in2.nth(2).fill('priya@northwind.test');
    await in2.nth(3).fill(pw);
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await p2.waitForTimeout(4000);

    await p.goto(`${APP}/conversation/${ch.conversationId}`);
    await p.waitForTimeout(2500);
    check(
      'call buttons shown when the server has a media server',
      (await p.getByRole('button', { name: 'Start video call' }).count()) === 1,
    );
    await p.getByRole('button', { name: 'Start video call' }).click();
    await p.waitForTimeout(5000);
    await shot('33-call-started');
    check(
      'caller connected to the SFU',
      !/Could not connect|Connecting/.test(await p.innerText('body')),
    );
    await p2.waitForTimeout(1000);
    await p2.screenshot({ path: `${out}/34-incoming-call.png` });
    console.log('shot 34-incoming-call');
    check(
      'incoming call rings on the other phone',
      /Incoming video call/.test(await p2.innerText('body')),
    );
    await p2.getByRole('button', { name: 'Accept' }).click();
    await p2.waitForTimeout(6000);
    await shot('35-call-two-people');
    const active = await api('GET', '/v1/calls/active', undefined, samApi);
    const live = (Array.isArray(active) ? active : active.calls)[0];
    check(
      'both people joined on the server',
      live?.participants.filter((x) => x.state === 'joined').length === 2,
    );
    check('other person shown in the call with video', (await p.locator('video').count()) >= 2);
    await p2.getByRole('button', { name: 'Raise hand' }).click();
    await p.waitForTimeout(2500);
    check(
      'raised hand shown to the others',
      (await p.locator('[aria-label*="hand raised"]').count()) === 1,
    );
    await shot('36-hand-raised');
    // Priya leaves; Sam returns to the chat and comes back through the banner, then ends it.
    await p2.getByRole('button', { name: 'Leave' }).click();
    await p2.waitForTimeout(2000);
    await p.getByRole('button', { name: 'End for all' }).click();
    await p.waitForTimeout(4000);
    await shot('37-call-ended-card');
    check('ended call card in the timeline', /Video call ended/.test(await p.innerText('body')));
    const after = await api('GET', '/v1/calls/active', undefined, samApi);
    check(
      'no live call left on the server',
      (Array.isArray(after) ? after : after.calls).length === 0,
    );

    // Priya calls from her phone; Sam sees the join banner, joins late, then declines the next one.
    await p.goto(`${APP}/messages`);
    await p.waitForTimeout(1500);
    await p2.goto(`${APP}/conversation/${ch.conversationId}`);
    await p2.waitForTimeout(2500);
    await p2.getByRole('button', { name: 'Start voice call' }).click();
    await p.waitForTimeout(3000);
    await p.getByRole('button', { name: 'Decline' }).click();
    await p.waitForTimeout(1500);
    await p.goto(`${APP}/conversation/${ch.conversationId}`);
    await p.waitForTimeout(2500);
    await shot('38-join-banner');
    check('join banner for a live call', /Voice call in progress/.test(await p.innerText('body')));
    await p.getByRole('button', { name: 'Join voice call' }).click();
    await p.waitForTimeout(5000);
    check(
      'joined late from the banner',
      !/Could not connect|Connecting/.test(await p.innerText('body')),
    );
    await p.getByRole('button', { name: 'Leave' }).click();
    await p2.getByRole('button', { name: 'Leave' }).click();
    await p2.waitForTimeout(3000);
    await ctx2.close();
  }

  // ---- Start conversations, browse and join channels, members, devices
  {
    const users = await api('GET', '/v1/users', undefined, samApi);
    const uid = (email) => users.find((u) => u.email === email).userId;
    const lenaApi = (
      await api('POST', '/v1/auth/login', {
        tenantSlug: 'northwind',
        email: 'lena@northwind.test',
        password: pw,
        device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
      })
    ).accessToken;
    // A public channel Sam is not in yet.
    const qa = await api(
      'POST',
      '/v1/conversations',
      {
        kind: 'channel_public',
        name: 'brand-tracker-qa',
        topic: 'Questionnaire QA for the Q1 brand tracker',
        memberIds: [uid('marco@northwind.test')],
      },
      lenaApi,
    );
    await p.goto(`${APP}/messages`);
    await p.waitForTimeout(3500);
    check(
      'unjoined public channel kept out of the Messages list',
      !(await p.innerText('body')).includes('# brand-tracker-qa'),
    );
    await p.getByRole('button', { name: 'Browse channels' }).click();
    await p.waitForTimeout(1500);
    await shot('40-browse-channels');
    check(
      'browse lists the public channel with Join',
      (await p.getByRole('button', { name: 'Join brand-tracker-qa' }).count()) === 1,
    );
    await p.getByText('# brand-tracker-qa').first().click();
    await p.waitForTimeout(2000);
    await shot('41-unjoined-channel-read-only');
    check(
      'unjoined channel offers Join instead of the composer',
      (await p.getByRole('button', { name: 'Join channel' }).count()) === 1 &&
        (await p.locator('textarea').count()) === 0,
    );
    await p.getByRole('button', { name: 'Join channel' }).click();
    await p.waitForTimeout(2500);
    const qaAfter = await api('GET', `/v1/conversations/${qa.conversationId}`, undefined, samApi);
    check('join reached the server', qaAfter.myRole === 'member');
    check('composer shown after joining', (await p.locator('textarea').count()) > 0);

    // New group with Priya and Lena.
    await p.goto(`${APP}/messages`);
    await p.waitForTimeout(2000);
    await p.getByRole('button', { name: 'New conversation' }).click();
    await p.waitForTimeout(1200);
    await p.getByRole('tab', { name: 'Group' }).click();
    await p.getByLabel('Group name').fill('Wave 3 kickoff');
    await p.getByRole('checkbox', { name: 'Priya Shah' }).click();
    await p.getByRole('checkbox', { name: 'Lena Fischer' }).click();
    await shot('42-new-group');
    await p.getByRole('button', { name: 'Create group' }).click();
    await p.waitForTimeout(2500);
    const all = await api('GET', '/v1/conversations', undefined, samApi);
    const group = (Array.isArray(all) ? all : all.conversations).find(
      (c) => c.name === 'Wave 3 kickoff',
    );
    check(
      'group created on the server with the picked people',
      !!group &&
        group.kind === 'group' &&
        [uid('priya@northwind.test'), uid('lena@northwind.test')].every((u) =>
          group.memberIds.includes(u),
        ),
    );
    check('new group opens straight away', /Wave 3 kickoff/.test(await p.innerText('body')));
    await p.locator('textarea').last().fill('Kickoff notes go here.');
    await p.getByRole('button', { name: 'Send message' }).click();
    await p.waitForTimeout(1500);

    // Details: add Marco, remove Lena.
    await p.getByRole('button', { name: 'Conversation details' }).click();
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: 'Add people' }).click();
    await p.waitForTimeout(1200);
    await p.getByRole('checkbox', { name: 'Marco Silva' }).click();
    await shot('43-add-people');
    await p.getByRole('button', { name: 'Add 1' }).click();
    await p.waitForTimeout(2000);
    await p.getByRole('button', { name: 'Remove Lena Fischer' }).click();
    await p.waitForTimeout(2000);
    await shot('44-group-details');
    const g2 = await api('GET', `/v1/conversations/${group.conversationId}`, undefined, samApi);
    check(
      'Marco added and Lena removed on the server',
      g2.memberIds.includes(uid('marco@northwind.test')) &&
        !g2.memberIds.includes(uid('lena@northwind.test')),
    );
    check(
      'details list shows the new members',
      /Marco Silva/.test(await p.innerText('body')) &&
        !/Lena Fischer/.test(await p.innerText('body')),
    );

    // New private channel.
    await p.goto(`${APP}/new-conversation`);
    await p.waitForTimeout(1500);
    await p.getByRole('tab', { name: 'Channel' }).click();
    await p.getByLabel('Channel name').fill('-bad');
    await p.getByRole('button', { name: 'Create channel' }).click();
    await p.waitForTimeout(500);
    check(
      'invalid channel name explained',
      /starting with a letter/.test(await p.innerText('body')),
    );
    await p.getByLabel('Channel name').fill('client-escalations');
    await p.getByLabel('Channel topic').fill('Anything a client has flagged as urgent');
    await p.getByLabel('Private channel').click();
    await p.getByRole('checkbox', { name: 'Priya Shah' }).click();
    await shot('45-new-private-channel');
    await p.getByRole('button', { name: 'Create channel' }).click();
    await p.waitForTimeout(2500);
    const all2 = await api('GET', '/v1/conversations', undefined, samApi);
    const priv = (Array.isArray(all2) ? all2 : all2.conversations).find(
      (c) => c.name === 'client-escalations',
    );
    check('private channel created', priv?.kind === 'channel_private');

    // Offline: membership changes say they need a connection.
    await p.goto(`${APP}/conversation-info/${group.conversationId}`);
    await p.waitForTimeout(2500);
    await ctx.setOffline(true);
    await p.waitForTimeout(2000);
    await shot('45b-details-offline');
    check(
      'offline details explain changes need a connection',
      /You are offline/.test(await p.innerText('body')),
    );
    await ctx.setOffline(false);
    await p.waitForTimeout(3000);

    // Leave the group.
    await p.goto(`${APP}/conversation-info/${group.conversationId}`);
    await p.waitForTimeout(2500);
    await p.getByRole('button', { name: 'Leave group' }).click();
    await p.waitForTimeout(2500);
    const g3 = await api(
      'GET',
      `/v1/conversations/${group.conversationId}`,
      undefined,
      lenaApi,
    ).catch(() => null);
    const priyaApi = (
      await api('POST', '/v1/auth/login', {
        tenantSlug: 'northwind',
        email: 'priya@northwind.test',
        password: pw,
        device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
      })
    ).accessToken;
    const g4 = await api('GET', `/v1/conversations/${group.conversationId}`, undefined, priyaApi);
    check('left the group on the server', !g4.memberIds.includes(uid('sam@northwind.test')));
    void g3;
    check(
      'group removed from this phone after leaving',
      !(await p.innerText('body')).includes('Wave 3 kickoff'),
    );

    // Devices: Sam's iPad signs in, Sam signs it out from the phone.
    const ipad = await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email: 'sam@northwind.test',
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: "Sam's iPad", platform: 'ios' },
    });
    await p.goto(`${APP}/settings/devices`);
    await p.waitForTimeout(2500);
    await shot('46-devices');
    check('devices list shows the iPad', /Sam's iPad/.test(await p.innerText('body')));
    await p.getByRole('button', { name: "Sign out Sam's iPad" }).first().click();
    await p.waitForTimeout(2500);
    const refreshed = await fetch(`${API}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: ipad.refreshToken }),
    });
    check('signed-out iPad can no longer refresh', refreshed.status === 401);
    check('iPad gone from the list', !/Sam's iPad/.test(await p.innerText('body')));
    await shot('47-devices-after-sign-out');
  }

  // ---- Meetings: schedule with suggested times, RSVP (live and offline), card in chat,
  // working hours, reminder banner, join, cancel
  {
    const users = await api('GET', '/v1/users', undefined, samApi);
    const uid = (email) => users.find((u) => u.email === email).userId;
    const loginAs = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const priyaApi = await loginAs('priya@northwind.test');
    const lenaApi = await loginAs('lena@northwind.test');

    // Sam schedules from the phone.
    await p.goto(`${APP}/meetings`);
    await p.waitForTimeout(2500);
    await p.getByRole('button', { name: 'Schedule a meeting' }).click();
    await p.waitForTimeout(1500);
    await p.getByLabel('Meeting title').fill('Wave 3 fieldwork kickoff');
    await p.getByRole('button', { name: 'Add people' }).click();
    await p.waitForTimeout(800);
    await p.getByRole('checkbox', { name: 'Priya Shah' }).click();
    await p.getByRole('checkbox', { name: 'Lena Fischer' }).click();
    await p.getByRole('button', { name: 'Done' }).click();
    await p.waitForTimeout(2500);
    const suggested = p.getByRole('radio', { name: /^Suggested / });
    check('suggested free times shown', (await suggested.count()) > 0);
    await suggested.first().click();
    await p.getByLabel('Agenda').fill('Quotas by region, launch checklist, who owns DE.');
    await p.getByRole('checkbox', { name: 'Remind 30 minutes before' }).click();
    await shot('50-schedule-meeting');
    await p.getByRole('button', { name: 'Send invites' }).click();
    await p.waitForTimeout(3000);
    const now = Date.now();
    const range = `from=${new Date(now - 86_400_000).toISOString()}&to=${new Date(now + 20 * 86_400_000).toISOString()}`;
    const mine = await api('GET', `/v1/meetings?${range}`, undefined, samApi);
    const kickoff = mine.find((m) => m.title === 'Wave 3 fieldwork kickoff');
    check(
      'meeting created on the server with everyone invited',
      !!kickoff &&
        kickoff.organizerId === uid('sam@northwind.test') &&
        ['priya', 'lena'].every((n) =>
          kickoff.attendees.some((a) => a.userId === uid(`${n}@northwind.test`)),
        ) &&
        kickoff.remindMinutes.includes(30),
    );
    check('opens the new meeting', /Wave 3 fieldwork kickoff/.test(await p.innerText('body')));

    // Priya and Lena answer; Sam sees it live.
    await api('POST', `/v1/meetings/${kickoff.meetingId}/rsvp`, { response: 'accepted' }, priyaApi);
    await api('POST', `/v1/meetings/${kickoff.meetingId}/rsvp`, { response: 'tentative' }, lenaApi);
    await p.waitForTimeout(2500);
    await shot('51-meeting-detail');
    const detail = await p.innerText('body');
    check('answers from others arrive live', /2 going/i.test(detail) && /1 maybe/i.test(detail));

    // The card in the meeting chat opens the meeting.
    await p.getByRole('button', { name: 'Open meeting chat' }).click();
    await p.waitForTimeout(2500);
    await shot('52-meeting-card-in-chat');
    check(
      'meeting card in the chat',
      /“Wave 3 fieldwork kickoff” scheduled/.test(await p.innerText('body')),
    );

    // Priya invites Sam to a meeting that starts in ~10 minutes (reminder at 10).
    const soon = await api(
      'POST',
      '/v1/meetings',
      {
        title: 'Client debrief: brand tracker',
        agenda: 'Topline readout before the client call.',
        startsAt: new Date(Date.now() + 10 * 60_000 + 20_000).toISOString(),
        endsAt: new Date(Date.now() + 40 * 60_000).toISOString(),
        timeZone: 'Europe/London',
        media: 'video',
        remindMinutes: [10],
        attendeeIds: [uid('sam@northwind.test')],
      },
      priyaApi,
    );
    await p.goto(`${APP}/meetings`);
    await p.waitForTimeout(2500);
    check(
      'invitation shows up in the list',
      /Client debrief: brand tracker/.test(await p.innerText('body')),
    );
    await shot('53-meetings-list');

    // Answer offline, then come back online.
    await p.getByRole('button', { name: /^Client debrief: brand tracker/ }).click();
    await p.waitForTimeout(1500);
    await ctx.setOffline(true);
    await p.waitForTimeout(1000);
    await p.getByRole('radio', { name: 'Going', exact: true }).click();
    await p.waitForTimeout(800);
    check(
      'offline answer kept on the phone',
      /Sent to the organizer when you are online/.test(await p.innerText('body')),
    );
    await shot('54-rsvp-offline');
    const before = await api('GET', `/v1/meetings/${soon.meetingId}`, undefined, priyaApi);
    check(
      'offline answer not on the server yet',
      before.attendees.find((a) => a.userId === uid('sam@northwind.test')).response === 'pending',
    );
    await ctx.setOffline(false);
    await p.waitForTimeout(6000);
    const after = await api('GET', `/v1/meetings/${soon.meetingId}`, undefined, priyaApi);
    check(
      'offline answer reached the organizer',
      after.attendees.find((a) => a.userId === uid('sam@northwind.test')).response === 'accepted',
    );

    // The reminder sweeper runs every 30 s; the banner comes from meeting:reminder.
    let reminded = false;
    for (let i = 0; i < 20 && !reminded; i++) {
      await p.waitForTimeout(3000);
      reminded = /Starts in 10 min/.test(await p.innerText('body'));
    }
    check('reminder banner before the meeting', reminded);
    if (reminded) await shot('55-reminder-banner');

    // Join from the meeting (the meeting chat's call).
    if (callsConfig.enabled) {
      await p.goto(`${APP}/meeting/${soon.meetingId}`);
      await p.waitForTimeout(2500);
      await p.getByRole('button', { name: 'Join video meeting' }).click();
      await p.waitForTimeout(5000);
      const live = await api('GET', '/v1/calls/active', undefined, priyaApi);
      const calls = Array.isArray(live) ? live : live.calls;
      check(
        'joining the meeting starts the call in its chat',
        calls.some((c) => c.conversationId === soon.conversationId),
      );
      await p.getByRole('button', { name: 'Leave' }).click();
      await p.waitForTimeout(2000);
    }

    // Working hours.
    await p.goto(`${APP}/settings/working-hours`);
    await p.waitForTimeout(2500);
    await p.getByLabel('Working on Saturday').click();
    await p.getByRole('button', { name: 'Monday start earlier' }).click();
    await shot('56-working-hours');
    await p.getByRole('button', { name: 'Save working hours' }).click();
    await p.waitForTimeout(1500);
    const hours = await api('GET', '/v1/me/working-hours', undefined, samApi);
    check(
      'working hours saved',
      hours.days.some((d) => d.day === 6) && hours.days.find((d) => d.day === 1)?.start === '08:30',
    );

    // Sam cancels his meeting.
    await p.goto(`${APP}/meeting/${kickoff.meetingId}`);
    await p.waitForTimeout(2500);
    await p.getByRole('button', { name: 'Cancel meeting' }).click();
    await p.waitForTimeout(2500);
    const cancelled = await api('GET', `/v1/meetings/${kickoff.meetingId}`, undefined, priyaApi);
    check('meeting cancelled on the server', cancelled.status === 'cancelled');
    check('cancelled shown on the phone', /Cancelled/.test(await p.innerText('body')));
  }
  // ---- Recordings: voice messages with the fake microphone (online and queued offline),
  // playback, the Recordings library with filters, delete for everyone, and call recording
  // (when the API has egress set up; otherwise the Record button stays hidden).
  {
    const voiceOnServer = async () =>
      (await serverMsgs()).filter((m) => m.attachments?.[0]?.recording === 'voice');
    const recordVoice = async (ms) => {
      await p.getByRole('button', { name: 'Record voice message', exact: true }).click();
      await p.waitForTimeout(ms);
    };
    await p.goto(`${APP}/conversation/${ch.conversationId}`);
    await p.waitForTimeout(3000);
    await recordVoice(2600);
    await p.waitForTimeout(200);
    check('recording bar counts up', /0:0[2-4]/.test(await p.innerText('body')));
    await p.screenshot({ path: `${out}/60-recording-voice.png` });
    console.log('shot', '60-recording-voice');
    await p.getByRole('button', { name: 'Send voice message' }).click();
    await p.waitForTimeout(4000);
    await shot('61-voice-sent');
    let voices = await voiceOnServer();
    const first = voices[0]?.attachments[0];
    check(
      'voice message reached the server as a voice recording',
      voices.length === 1 && first.mimeType === 'audio/webm' && first.durationMs >= 1500,
    );
    const audioBytes = await (
      await fetch(
        API + (await api('GET', `/v1/attachments/${first.attachmentId}/url`, undefined, marco)).url,
      )
    ).arrayBuffer();
    check('voice clip bytes are stored', audioBytes.byteLength > 1000);
    await p
      .getByRole('button', { name: /^Play Voice message/ })
      .last()
      .click();
    await p.waitForTimeout(1500);
    check(
      'voice message plays',
      (await p.getByRole('button', { name: /^Pause Voice message/ }).count()) > 0,
    );
    await shot('62-voice-playing');
    await p.waitForTimeout(2500);

    // Recorded offline: queued with the clip, sent once on reconnect.
    await ctx.setOffline(true);
    await p.waitForTimeout(1500);
    await recordVoice(2200);
    await p.getByRole('button', { name: 'Send voice message' }).click();
    await shot('63-voice-queued-offline');
    check('offline voice message waits on the phone', (await voiceOnServer()).length === 1);
    await ctx.setOffline(false);
    await p.waitForTimeout(7000);
    voices = await voiceOnServer();
    check('offline voice message delivered once on reconnect', voices.length === 2);

    // Library.
    await p.goto(`${APP}/recordings`);
    await p.waitForTimeout(3000);
    await shot('64-recordings-library');
    const libText = await p.innerText('body');
    check(
      'library lists both voice messages with their conversation',
      (libText.match(/Voice message · fieldwork-ops/g) ?? []).length === 2,
    );
    await p.getByRole('tab', { name: 'Calls', exact: true }).click();
    await p.waitForTimeout(1500);
    check(
      'kind filter narrows the list',
      /No calls recordings|No call/.test(await p.innerText('body')),
    );
    await p.getByRole('tab', { name: 'All', exact: true }).click();
    await p.waitForTimeout(1500);
    await p
      .getByRole('button', { name: /^Delete Voice message/ })
      .first()
      .click();
    await p.waitForTimeout(2500);
    const left = await api(
      'GET',
      `/v1/recordings?conversationId=${ch.conversationId}`,
      undefined,
      marco,
    );
    check('deleted recording is gone from the server library', left.items.length === 1);
    await p.goto(`${APP}/conversation/${ch.conversationId}`);
    await p.waitForTimeout(3000);
    check(
      'chat shows the deleted voice message',
      /Voice message deleted/.test(await p.innerText('body')),
    );
    await shot('65-voice-deleted-in-chat');

    // Call recording.
    const cfg = await api('GET', '/v1/calls/config', undefined, marco);
    if (cfg.enabled) {
      await p.getByRole('button', { name: 'Start video call' }).click();
      await p.waitForTimeout(5000);
      const recordBtn = p.getByRole('button', { name: 'Record', exact: true });
      if (cfg.recordingEnabled) {
        await recordBtn.click();
        let on = false;
        for (let i = 0; i < 10 && !on; i++) {
          await p.waitForTimeout(1500);
          on = /Recording · /.test(await p.innerText('body'));
        }
        check('recording indicator shown in the call', on);
        await shot('66-call-recording');
        await p.waitForTimeout(6000);
        await p.getByRole('button', { name: 'Stop rec', exact: true }).click();
        await p.waitForTimeout(2000);
        await p.getByRole('button', { name: 'End for all' }).click();
        let card = false;
        for (let i = 0; i < 20 && !card; i++) {
          await p.waitForTimeout(3000);
          card = /Call recording · \d/.test(await p.innerText('body'));
        }
        check('call recording arrives in the chat', card);
        await shot('67-call-recording-in-chat');
        const calls = await api('GET', '/v1/recordings?kind=call', undefined, marco);
        check(
          'call recording is in the library with its length',
          calls.items.length === 1 && calls.items[0].durationMs > 3000,
        );
        await p
          .getByRole('button', { name: /^Play Call recording/ })
          .last()
          .click();
        let playing = false;
        for (let i = 0; i < 10 && !playing; i++) {
          await p.waitForTimeout(1000);
          playing = await p.evaluate(() => {
            const v = document.querySelector('video');
            return !!v && v.readyState >= 2 && v.currentTime > 0;
          });
        }
        check('call recording plays in the player', playing);
        await shot('68-call-recording-player');
        await p.getByRole('button', { name: 'Close player' }).click();
      } else {
        check(
          'Record is hidden when the server cannot record calls',
          (await recordBtn.count()) === 0,
        );
        await p.getByRole('button', { name: 'End for all' }).click();
        await p.waitForTimeout(2000);
      }
    }
  }
  // ---- External guests: invite by email from the form, guest list with invite status and
  // a shareable link, then the lobby in a live meeting call (admit one guest, deny another).
  {
    const loginAs = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const samApi2 = await loginAs('sam@northwind.test');
    const users = await api('GET', '/v1/users', undefined, samApi2);
    const uidOf = (email) => users.find((u) => u.email === email).userId;

    await p.goto(`${APP}/meetings`);
    await p.waitForTimeout(2500);
    await p.getByRole('button', { name: 'Schedule a meeting' }).click();
    await p.waitForTimeout(1500);
    await p.getByLabel('Meeting title').fill('Acme readout');
    await p.getByRole('button', { name: 'Add people' }).click();
    await p.waitForTimeout(800);
    await p.getByRole('checkbox', { name: 'Priya Shah' }).click();
    await p.getByRole('button', { name: 'Done' }).click();
    await p.waitForTimeout(1500);
    await p.getByLabel('Guest email').fill('priya@northwind.test');
    await p.getByRole('button', { name: 'Add guest' }).click();
    check(
      'members are refused as guests',
      /Priya Shah is in your organization/.test(await p.innerText('body')),
    );
    await p.getByLabel('Guest email').fill('Ana.Ruiz@acme.test');
    await p.getByRole('button', { name: 'Add guest' }).click();
    await p.waitForTimeout(1500);
    await p
      .getByRole('radio', { name: /^Suggested / })
      .first()
      .click();
    await p.getByText('Guests from outside', { exact: true }).evaluate((e) => e.scrollIntoView());
    await shot('70-schedule-with-guest');
    await p.getByRole('button', { name: 'Send invites' }).click();
    await p.waitForTimeout(3000);
    const range = `from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 20 * 86_400_000).toISOString()}`;
    const readout = (await api('GET', `/v1/meetings?${range}`, undefined, samApi2)).find(
      (m) => m.title === 'Acme readout',
    );
    check(
      'meeting created with the external guest',
      readout?.guests?.length === 1 && readout.guests[0].email === 'ana.ruiz@acme.test',
    );
    await p.getByText('Guests from outside · 1').scrollIntoViewIfNeeded();
    check(
      'guest shows its invite status',
      /Not emailed \(email isn't set up\)|Invite emailed|Sending invite/.test(
        await p.innerText('body'),
      ),
    );
    await p.getByRole('button', { name: /^Share .* join link$/ }).click();
    await p.waitForTimeout(1500);
    const copied = await p.evaluate(() => navigator.clipboard.readText());
    check('join link copied for the guest', /\/join\/[\w.-]+$/.test(copied));
    await shot('71-meeting-guests');

    // A meeting starting now, with two guests waiting in its call's lobby.
    const soon = await api(
      'POST',
      '/v1/meetings',
      {
        title: 'Acme quick sync',
        agenda: '',
        startsAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 32 * 60_000).toISOString(),
        timeZone: 'UTC',
        media: 'video',
        remindMinutes: [],
        attendeeIds: [uidOf('priya@northwind.test')],
        guests: [
          { email: 'bo@acme.test', name: 'Bo Lind' },
          { email: 'cy@acme.test', name: 'Cy Moreau' },
        ],
      },
      samApi2,
    );
    const tokenFor = async (g) =>
      (
        await api(
          'GET',
          `/v1/meetings/${soon.meetingId}/guests/${g.guestId}/link`,
          undefined,
          samApi2,
        )
      ).url
        .split('/join/')
        .pop();
    const [bo, cy] = await Promise.all(soon.guests.map(tokenFor));
    await p.goto(`${APP}/meeting/${soon.meetingId}`);
    await p.waitForTimeout(3000);
    await p.getByRole('button', { name: 'Join video meeting' }).click();
    await p.waitForTimeout(5000);
    await api('POST', `/v1/guest/${bo}/lobby`, { name: 'Bo Lind' });
    await api('POST', `/v1/guest/${cy}/lobby`, { name: 'Cy Moreau' });
    let waiting = false;
    for (let i = 0; i < 10 && !waiting; i++) {
      await p.waitForTimeout(1000);
      waiting = /Waiting in the lobby · 2/.test(await p.innerText('body'));
    }
    check('lobby shows both guests in the call', waiting);
    await shot('72-call-lobby');
    await p.getByRole('button', { name: 'Admit Bo Lind' }).click();
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: 'Deny Cy Moreau' }).click();
    await p.waitForTimeout(2000);
    const boState = await api('GET', `/v1/guest/${bo}/lobby`);
    const cyState = await api('GET', `/v1/guest/${cy}/lobby`);
    check(
      'admitted guest gets a call token',
      boState.state === 'admitted' && !!boState.join?.token,
    );
    check('denied guest is turned away', cyState.state === 'denied');
    check('lobby clears after answering', !/Waiting in the lobby/.test(await p.innerText('body')));
    await shot('73-lobby-answered');
    await p.getByRole('button', { name: 'End for all' }).click();
    await p.waitForTimeout(2000);
  }
  // ---- Chat during a call: open the conversation from the call, post, get back to the call,
  // the unread count on the Chat button, and the call surviving all of it.
  {
    const cfg = await api('GET', '/v1/calls/config', undefined, marco);
    if (cfg.enabled) {
      await p.goto(`${APP}/conversation/${ch.conversationId}`);
      await p.waitForTimeout(3000);
      await p.getByRole('button', { name: 'Start voice call' }).click();
      await p.waitForTimeout(4000);
      await p.getByRole('button', { name: /^Chat/ }).click();
      await p.waitForTimeout(2500);
      check(
        'chat opens over the call with a way back',
        /You are in this call\. Tap to return\./.test(await p.innerText('body')),
      );
      await p.locator('textarea').last().fill('Sharing the deck link in here while we talk.');
      await p.getByRole('button', { name: 'Send message' }).click();
      await p.waitForTimeout(2000);
      await shot('74-chat-during-call');
      await p.getByText('You are in this call. Tap to return.').last().click();
      await p.waitForTimeout(2000);
      const back = await p.innerText('body');
      check('returns to the same call', /Voice call ·/.test(back) && /Leave/.test(back));
      const live = await api('GET', '/v1/calls/active', undefined, marco);
      check(
        'call kept running while in the chat',
        (Array.isArray(live) ? live : live.calls).some(
          (c) => c.conversationId === ch.conversationId,
        ),
      );
      await api(
        'POST',
        `/v1/conversations/${ch.conversationId}/messages`,
        {
          conversationId: ch.conversationId,
          clientMessageId: crypto.randomUUID(),
          messageType: 'text',
          content: { text: 'Got it, opening it now.', mentions: [] },
        },
        marco,
      );
      await p.waitForTimeout(2500);
      check(
        'Chat button counts new messages',
        (await p.getByRole('button', { name: /^Chat · \d/ }).count()) > 0,
      );
      await shot('75-call-chat-badge');
      await p.getByRole('button', { name: 'End for all' }).click();
      await p.waitForTimeout(2000);
    }
  }

  // ---- Integrations: settings live in the server database, edited from the phone.
  // A member sees why they cannot change them; the owner saves SMTP with a write-only
  // password, tests it, and the settings reach the API.
  {
    await p.goto(`${APP}/more`);
    await p.waitForTimeout(2500);
    await p.getByText('Integrations', { exact: true }).first().click();
    await p.waitForTimeout(2500);
    check(
      'members are told only admins change integrations',
      /Only owners and admins can change integrations\./.test(await p.innerText('body')),
    );
    await shot('76-integrations-member');

    const ctx3 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const p3 = await ctx3.newPage();
    const shot3 = async (n) => {
      await p3.waitForTimeout(1200);
      await p3.screenshot({ path: `${out}/${n}.png` });
      console.log('shot', n);
    };
    await p3.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p3.waitForTimeout(1500);
    const f = p3.locator('input');
    await f.nth(0).fill(API);
    await f.nth(1).fill('northwind');
    await f.nth(2).fill('priya@northwind.test');
    await f.nth(3).fill(pw);
    await p3.getByRole('button', { name: 'Sign in' }).click();
    await p3.waitForTimeout(4000);
    await p3.goto(`${APP}/admin/integrations`);
    await p3.waitForTimeout(3000);
    const list = await p3.innerText('body');
    check(
      'owner sees the built-in providers by category',
      /Email \(SMTP\)|SMTP/.test(list) && /LiveKit|Call server/i.test(list) && /Push/.test(list),
    );
    await shot3('77-integrations-list');

    await p3
      .getByRole('button', { name: /SMTP.*Configure/ })
      .first()
      .click();
    await p3.waitForTimeout(1000);
    await p3.getByRole('switch', { name: /^Use / }).first().click();
    await p3
      .getByRole('button', { name: /^Save / })
      .first()
      .click();
    await p3.waitForTimeout(800);
    check(
      'required fields are checked before saving',
      /Host is required\./.test(await p3.innerText('body')),
    );
    await p3.getByLabel('Host', { exact: true }).fill('127.0.0.1');
    await p3.getByLabel('Port', { exact: true }).fill('2525');
    const user = p3.getByLabel('Username', { exact: true });
    if (await user.count()) await user.fill('mailer');
    await p3.getByLabel('Password', { exact: true }).fill('s3cret-from-phone');
    const from = p3.getByLabel(/^From/).first();
    if (await from.count()) await from.fill('meetings@northwind.test');
    check(
      'errors clear as fields are filled',
      !/Host is required\.|From address is required\./.test(await p3.innerText('body')),
    );
    await shot3('78-integrations-smtp-form');
    await p3
      .getByRole('button', { name: /^Save / })
      .first()
      .click();
    await p3.waitForTimeout(2500);
    const saved = await p3.innerText('body');
    check('save confirms it applies at once', /Saved\. It applies straight away\./.test(saved));
    check('the password is not shown again', /Stored securely/.test(saved));
    const priyaTok = (
      await api('POST', '/v1/auth/login', {
        tenantSlug: 'northwind',
        email: 'priya@northwind.test',
        password: pw,
        device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
      })
    ).accessToken;
    const views = await api('GET', '/v1/admin/integrations', undefined, priyaTok);
    const smtp = views.find((v) => v.provider.id === 'smtp');
    check(
      'SMTP settings are stored on the server with the secret kept write-only',
      smtp.enabled &&
        smtp.source === 'tenant' &&
        (smtp.saved?.secretsSet ?? []).includes('password') &&
        !JSON.stringify(smtp).includes('s3cret-from-phone'),
    );
    await p3.getByRole('button', { name: 'Test connection' }).first().click();
    await p3.waitForTimeout(6000);
    check(
      'test connection reports the result from the server',
      /Last test (passed|failed)|refused|connect|ECONN|timed out|Reached/i.test(
        await p3.innerText('body'),
      ),
    );
    await shot3('79-integrations-tested');
    await ctx3.close();
  }

  // ---- Two-step verification: Lena turns it on; the phone asks for her code after the
  // password, refuses a wrong one, and accepts a code from her authenticator. A recovery code
  // turns it off again at the end so later runs can sign her in with a password.
  {
    const lenaTok = (
      await api('POST', '/v1/auth/login', {
        tenantSlug: 'northwind',
        email: 'lena@northwind.test',
        password: pw,
        device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
      })
    ).accessToken;
    const setup = await api('POST', '/v1/auth/mfa/totp/setup', {}, lenaTok);
    const { recoveryCodes } = await api(
      'POST',
      '/v1/auth/mfa/totp/enable',
      { code: totp(setup.secret) },
      lenaTok,
    );
    const ctx4 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const p4 = await ctx4.newPage();
    const shot4 = async (n) => {
      await p4.waitForTimeout(1200);
      await p4.screenshot({ path: `${out}/${n}.png` });
      console.log('shot', n);
    };
    await p4.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p4.waitForTimeout(1500);
    const f4 = p4.locator('input');
    await f4.nth(0).fill(API);
    await f4.nth(1).fill('northwind');
    await f4.nth(2).fill('lena@northwind.test');
    await f4.nth(3).fill(pw);
    await p4.getByRole('button', { name: 'Sign in' }).click();
    await p4.waitForTimeout(2500);
    check(
      'password sign-in asks for the two-step code',
      /Two-step verification/.test(await p4.innerText('body')),
    );
    await shot4('80-two-step-code');
    await p4.getByLabel('Code', { exact: true }).fill('000000');
    await p4.getByRole('button', { name: 'Verify and sign in' }).click();
    await p4.waitForTimeout(2000);
    const wrong = await p4.innerText('body');
    check(
      'a wrong code is refused and the code step stays',
      /didn.t work/.test(wrong) && /Two-step verification/.test(wrong),
    );
    await shot4('81-two-step-wrong-code');
    await p4.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    check(
      'recovery codes can be used instead',
      (await p4.getByLabel('Recovery code', { exact: true }).count()) > 0,
    );
    await p4.getByRole('button', { name: 'Use my authenticator app instead' }).click();
    await p4.getByLabel('Code', { exact: true }).fill(totp(setup.secret, 1));
    await p4.getByRole('button', { name: 'Verify and sign in' }).click();
    await p4.waitForTimeout(4500);
    const home = await p4.innerText('body');
    check(
      'the authenticator code finishes sign-in',
      !/Two-step verification/.test(home) && /fieldwork-ops/.test(home),
    );
    await shot4('82-two-step-signed-in');
    await ctx4.close();
    await api('POST', '/v1/auth/mfa/disable', { password: pw, code: recoveryCodes[0] }, lenaTok);
  }

  // ---- Pins and saved messages: Sam pins a message (everyone sees the bar), Marco's pin
  // arrives live, the pinned list opens the message in place, Unpin from the list, and
  // Save for later shows up under Saved messages and on the server.
  {
    const tokenOf = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const samTok = await tokenOf('sam@northwind.test');
    const marcoTok = await tokenOf('marco@northwind.test');
    const convs = await api('GET', '/v1/conversations', undefined, samTok);
    const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
      (c) => c.name === 'fieldwork-ops',
    );
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
    // Start from no pins (an earlier interrupted run may have left some).
    const before = await api(
      'GET',
      `/v1/conversations/${ops.conversationId}/messages?limit=100`,
      undefined,
      samTok,
    );
    for (const m of Array.isArray(before) ? before : (before.messages ?? before.items))
      if (m.pinned) await api('DELETE', `/v1/messages/${m.messageId}/pin`, undefined, samTok);
    const run = Date.now().toString(36).slice(-4);
    const first = `Wave 3 quotas are final (${run}).`;
    const second = `Fieldwork closes Friday at 6 pm (${run}).`;
    const m1 = await post(first, marcoTok);
    const m2 = await post(second, marcoTok);
    const id1 = m1.message?.messageId ?? m1.messageId;
    const id2 = m2.message?.messageId ?? m2.messageId;
    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3500);
    await p.getByText(first, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Pin to conversation' }).click();
    await p.waitForTimeout(2000);
    check(
      'pinning shows the pinned bar',
      (await p.getByRole('button', { name: /^1 pinned\. Latest from Marco Silva/ }).count()) > 0,
    );
    const msgs = await api(
      'GET',
      `/v1/conversations/${ops.conversationId}/messages?limit=20`,
      undefined,
      marcoTok,
    );
    const list = Array.isArray(msgs) ? msgs : (msgs.messages ?? msgs.items);
    check(
      'the pin is saved on the server for everyone',
      !!list.find((m) => m.messageId === id1)?.pinned,
    );
    await api('PUT', `/v1/messages/${id2}/pin`, undefined, marcoTok);
    await p.waitForTimeout(2500);
    check(
      "another member's pin arrives live",
      (await p.getByRole('button', { name: /^2 pinned\. Latest from Marco Silva/ }).count()) > 0,
    );
    await shot('83-pinned-bar');
    await p
      .getByRole('button', { name: /^2 pinned/ })
      .first()
      .click();
    await p.waitForTimeout(2000);
    const pinnedList = await p.innerText('body');
    check(
      'the pinned list shows both, newest pin first',
      pinnedList.indexOf(second) > -1 &&
        pinnedList.indexOf(first) > pinnedList.indexOf(second) &&
        /Pinned by Marco Silva/.test(pinnedList) &&
        /Pinned by you/.test(pinnedList),
    );
    await shot('84-pinned-list');
    await p.getByRole('button', { name: 'Unpin' }).first().click();
    await p.waitForTimeout(2000);
    check(
      'Unpin from the list removes it',
      !(await p.innerText('body')).includes(second) && (await p.innerText('body')).includes(first),
    );
    await p
      .getByRole('button', { name: /Open in conversation/ })
      .first()
      .click();
    await p.waitForTimeout(2500);
    check(
      'opening a pin returns to the conversation',
      (await p.getByRole('button', { name: /^1 pinned/ }).count()) > 0,
    );

    await p.getByText(second, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Save for later' }).click();
    await p.waitForTimeout(1500);
    const bms = (await api('GET', '/v1/bookmarks', undefined, samTok)).items;
    check(
      'Save for later is stored on the server',
      bms.some((b) => b.messageId === id2),
    );
    await p.goto(`${APP}/more`);
    await p.waitForTimeout(2000);
    await p.getByText('Saved messages', { exact: true }).first().click();
    await p.waitForTimeout(2500);
    const saved = await p.innerText('body');
    check(
      'Saved messages lists it with its conversation',
      saved.includes(second) && /fieldwork-ops · saved/.test(saved),
    );
    await shot('85-saved-messages');
    await p.getByRole('button', { name: 'Remove from saved' }).first().click();
    await p.waitForTimeout(1500);
    check(
      'removing it takes it off the list and the server',
      !(await p.innerText('body')).includes(second) &&
        !(await api('GET', '/v1/bookmarks', undefined, samTok)).items.some(
          (b) => b.messageId === id2,
        ),
    );
    await api('DELETE', `/v1/messages/${id1}/pin`, undefined, samTok);
  }

  // ---- Polls: Sam posts a poll from the composer, votes, sees Marco's vote arrive live,
  // changes the vote, and closes the poll from the message sheet.
  {
    const tokenOf = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const samTok = await tokenOf('sam@northwind.test');
    const marcoTok = await tokenOf('marco@northwind.test');
    const convs = await api('GET', '/v1/conversations', undefined, samTok);
    const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
      (c) => c.name === 'fieldwork-ops',
    );
    const run = Date.now().toString(36).slice(-4);
    const question = `Which day for the wave 4 kickoff? (${run})`;
    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3000);
    await p.getByRole('button', { name: 'Attach' }).click();
    await p.getByRole('button', { name: 'Poll' }).click();
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: 'Post poll' }).click();
    await p.waitForTimeout(400);
    check('an empty poll is not posted', /Write a question\./.test(await p.innerText('body')));
    await p.getByLabel('Question', { exact: true }).fill(question);
    await p.getByLabel('Option 1', { exact: true }).fill('Monday');
    await p.getByLabel('Option 2', { exact: true }).fill('Tuesday');
    await p.getByRole('button', { name: 'Add option' }).click();
    await p.getByLabel('Option 3', { exact: true }).fill('Wednesday');
    await p.getByRole('radio', { name: '1 day' }).click();
    await shot('86-new-poll');
    await p.getByRole('button', { name: 'Post poll' }).click();
    await p.waitForTimeout(3000);
    check('the poll shows in the conversation', (await p.getByText(question).count()) > 0);
    const findPoll = async () => {
      const r = await api(
        'GET',
        `/v1/conversations/${ops.conversationId}/messages?limit=30`,
        undefined,
        samTok,
      );
      return (Array.isArray(r) ? r : (r.messages ?? r.items)).find(
        (m) => m.poll?.question === question,
      );
    };
    const created = await findPoll();
    check(
      'the poll is on the server with three options and a closing time',
      created?.poll.options.length === 3 && !!created.poll.closesAt,
    );
    await p
      .getByRole('radio', { name: /^Tuesday/ })
      .last()
      .click();
    await p.waitForTimeout(2000);
    check(
      'voting shows results',
      (await p.getByRole('radio', { name: /^Tuesday, 1 vote: you/i }).count()) > 0 ||
        (await p.getByRole('radio', { name: /^Tuesday, 1 vote/ }).count()) > 0,
    );
    await api(
      'PUT',
      `/v1/messages/${created.messageId}/poll/vote`,
      { optionIds: ['o1'] },
      marcoTok,
    );
    await p.waitForTimeout(2500);
    check(
      "Marco's vote arrives live",
      (await p.getByRole('radio', { name: /^Monday, 1 vote: Marco Silva/ }).count()) > 0 &&
        /2 voters/.test(await p.innerText('body')),
    );
    await shot('87-poll-results');
    await p
      .getByRole('radio', { name: /^Monday/ })
      .last()
      .click();
    await p.waitForTimeout(2000);
    const after = await findPoll();
    check(
      'changing a single-choice vote moves it',
      after.poll.options.find((o) => o.optionId === 'o1').count === 2 &&
        after.poll.options.find((o) => o.optionId === 'o2').count === 0,
    );
    await p.getByText(question).last().click({ delay: 700 });
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Close poll' }).click();
    await p.waitForTimeout(2000);
    check(
      'closing the poll stops voting',
      (await p.getByText('Poll · closed').count()) > 0 && !!(await findPoll()).poll.closedAt,
    );
    await shot('88-poll-closed');
  }

  // ---- Scheduled messages and announcement channels: Sam schedules a message from the
  // composer, sees it in the conversation's scheduled list, changes the time, sends one now
  // and deletes another; then Priya makes the channel announcement-only and Sam's composer
  // turns read-only (and back).
  {
    const tokenOf = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const samTok = await tokenOf('sam@northwind.test');
    const priyaTok = await tokenOf('priya@northwind.test');
    const convs = await api('GET', '/v1/conversations', undefined, samTok);
    const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
      (c) => c.name === 'fieldwork-ops',
    );
    const mine = async () => {
      const r = await api(
        'GET',
        `/v1/scheduled-messages?conversationId=${ops.conversationId}`,
        undefined,
        samTok,
      );
      return Array.isArray(r) ? r : r.items;
    };
    for (const m of await mine())
      await api('DELETE', `/v1/scheduled-messages/${m.scheduledId}`, undefined, samTok);
    const run = Date.now().toString(36).slice(-4);
    const later = `Reminder: upload the wave 3 data files (${run}).`;
    const other = `Draft I will not send (${run}).`;

    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3000);
    const schedule = async (text, preset) => {
      await p.locator('textarea').last().fill(text);
      await p.getByRole('button', { name: 'Attach' }).click();
      await p.getByRole('button', { name: 'Send later' }).click();
      await p.waitForTimeout(600);
      await p.getByRole('button', { name: preset }).click();
      await p.waitForTimeout(2000);
    };
    await p.locator('textarea').last().fill(later);
    await p.getByRole('button', { name: 'Attach' }).click();
    await p.getByRole('button', { name: 'Send later' }).click();
    await p.waitForTimeout(800);
    await shot('89-send-later');
    await p.getByRole('button', { name: /^In 1 hour/ }).click();
    await p.waitForTimeout(2000);
    check(
      'scheduling confirms the time and clears the composer',
      /Scheduled for /.test(await p.innerText('body')) &&
        (await p.locator('textarea').last().inputValue()) === '',
    );
    const s1 = (await mine()).find((m) => m.content.text === later);
    check('the server holds the scheduled message', s1?.status === 'scheduled');
    await schedule(other, /^Tomorrow, 9 AM/);
    check(
      'the conversation shows what is scheduled',
      (await p.getByRole('button', { name: /^2 scheduled messages/ }).count()) > 0,
    );
    await p.getByRole('button', { name: /^2 scheduled messages/ }).click();
    await p.waitForTimeout(2000);
    await p.getByRole('button', { name: 'Change time' }).first().click();
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: /^Tomorrow, 9 AM/ }).click();
    await p.waitForTimeout(2000);
    const moved = (await mine()).find((m) => m.scheduledId === s1.scheduledId);
    check(
      'changing the time reaches the server',
      Date.parse(moved.sendAt) > Date.parse(s1.sendAt) + 3_600_000,
    );
    await shot('90-scheduled-list');
    const cards = async () => p.innerText('body');
    // Delete the draft, send the reminder now.
    const draftIdx = (await mine()).findIndex((m) => m.content.text === other);
    await p.getByRole('button', { name: 'Delete' }).nth(draftIdx).click();
    await p.waitForTimeout(2000);
    check(
      'deleting removes it',
      !(await cards()).includes(other) &&
        !(await mine()).some((m) => m.content.text === other && m.status === 'scheduled'),
    );
    await p.getByRole('button', { name: 'Send now' }).first().click();
    await p.waitForTimeout(3000);
    const sent = await api(
      'GET',
      `/v1/conversations/${ops.conversationId}/messages?limit=10`,
      undefined,
      samTok,
    );
    check(
      'Send now posts it as Sam',
      (Array.isArray(sent) ? sent : (sent.messages ?? sent.items)).some((m) =>
        m.content.text === later && m.senderId === s1.senderId ? true : m.content.text === later,
      ) && /Nothing scheduled/.test(await cards()),
    );

    await api(
      'PUT',
      `/v1/conversations/${ops.conversationId}/posting-policy`,
      { policy: 'moderators' },
      priyaTok,
    );
    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3500);
    check(
      'members see a read-only bar in an announcement channel',
      /Announcement channel\. Only owners and moderators post here\./.test(
        await p.innerText('body'),
      ) && (await p.locator('textarea').count()) === 0,
    );
    await shot('91-announcement-channel');
    await api(
      'PUT',
      `/v1/conversations/${ops.conversationId}/posting-policy`,
      { policy: 'everyone' },
      priyaTok,
    );
    await p.waitForTimeout(3000);
    check('turning it off gives the composer back', (await p.locator('textarea').count()) > 0);

    // Priya turns it on from the details screen on her phone.
    const ctx5 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const p5 = await ctx5.newPage();
    await p5.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p5.waitForTimeout(1500);
    const f5 = p5.locator('input');
    await f5.nth(0).fill(API);
    await f5.nth(1).fill('northwind');
    await f5.nth(2).fill('priya@northwind.test');
    await f5.nth(3).fill(pw);
    await p5.getByRole('button', { name: 'Sign in' }).click();
    await p5.waitForTimeout(4000);
    await p5.goto(`${APP}/conversation-info/${ops.conversationId}`);
    await p5.waitForTimeout(2500);
    await p5.getByRole('switch', { name: 'Announcement channel' }).click();
    await p5.waitForTimeout(2000);
    const list = await api('GET', '/v1/conversations', undefined, priyaTok);
    check(
      'the owner turns on announcement-only from details',
      (Array.isArray(list) ? list : list.conversations).find(
        (c) => c.conversationId === ops.conversationId,
      ).postingPolicy === 'moderators',
    );
    await p5.waitForTimeout(800);
    await p5.screenshot({ path: `${out}/92-announcement-switch.png` });
    console.log('shot 92-announcement-switch');
    await p5.getByRole('switch', { name: 'Announcement channel' }).click();
    await p5.waitForTimeout(1500);
    await ctx5.close();
  }
  // ---- Tasks and approvals: Sam turns a message into a task for Marco and an approval
  // request for Priya; both cards land in the conversation; Priya approves from her phone;
  // Sam ticks the task done from the list.
  {
    const tokenOf = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const samTok = await tokenOf('sam@northwind.test');
    const convs = await api('GET', '/v1/conversations', undefined, samTok);
    const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
      (c) => c.name === 'fieldwork-ops',
    );
    const run = Date.now().toString(36).slice(-4);
    const ask = `Can someone recheck the wave 3 quota sheet before launch? (${run})`;
    const posted = await api(
      'POST',
      `/v1/conversations/${ops.conversationId}/messages`,
      {
        conversationId: ops.conversationId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text: ask, mentions: [] },
      },
      samTok,
    );
    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3500);
    await p.getByText(ask, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: 'Create task' }).click();
    await p.waitForTimeout(2500);
    check(
      'a task from a message starts with its text as the title',
      (await p.getByLabel('Title', { exact: true }).inputValue()) === ask,
    );
    await p.getByRole('checkbox', { name: /^Marco/ }).click();
    await p.getByRole('radio', { name: 'Tomorrow' }).click();
    await p.getByRole('radio', { name: 'High' }).click();
    await shot('93-new-task');
    await p.getByRole('button', { name: 'Create task' }).click();
    await p.waitForTimeout(3000);
    const created = await api('GET', '/v1/tasks?scope=created', undefined, samTok);
    const task = created.find((t) => t.title === ask);
    check(
      'the task reaches the server with its source message, assignee and due date',
      !!task &&
        task.sourceMessageId === (posted.messageId ?? posted.message?.messageId) &&
        task.assigneeIds.length === 1 &&
        task.priority === 'high' &&
        !!task.dueAt,
    );
    check(
      'the task opens after it is created',
      /Assigned to/.test(await p.innerText('body')) &&
        /High priority/.test(await p.innerText('body')),
    );
    await shot('94-task-detail');

    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3500);
    await p.getByText(ask, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: 'Request approval' }).click();
    await p.waitForTimeout(2500);
    const what = `Approve the wave 3 boost incentive (${run})`;
    await p.getByLabel('What needs approving').fill(what);
    await p.getByRole('radio', { name: 'Budget' }).click();
    await p.getByLabel('Amount').fill('1,250');
    await p.getByRole('checkbox', { name: /^Priya/ }).click();
    await shot('95-request-approval');
    await p.getByRole('button', { name: 'Send request' }).click();
    await p.waitForTimeout(3000);
    const requested = await api('GET', '/v1/approvals?scope=requested', undefined, samTok);
    const appr = requested.find((a) => a.title === what);
    check(
      'the approval reaches the server with its amount and approver',
      !!appr && appr.amount?.amountMinor === 125_000 && appr.status === 'pending',
    );
    await p.goto(`${APP}/conversation/${ops.conversationId}`);
    await p.waitForTimeout(3500);
    check(
      'task and approval cards appear in the conversation',
      (await p.getByRole('button', { name: new RegExp(`^Task: .*${run}`) }).count()) > 0 &&
        (await p.getByRole('button', { name: new RegExp(`^Approval: .*${run}`) }).count()) > 0,
    );
    await shot('96-work-cards');

    // Priya decides on her phone.
    const ctx6 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const p6 = await ctx6.newPage();
    await p6.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p6.waitForTimeout(1500);
    const f6 = p6.locator('input');
    await f6.nth(0).fill(API);
    await f6.nth(1).fill('northwind');
    await f6.nth(2).fill('priya@northwind.test');
    await f6.nth(3).fill(pw);
    await p6.getByRole('button', { name: 'Sign in' }).click();
    await p6.waitForTimeout(4000);
    await p6.goto(`${APP}/tasks`);
    await p6.waitForTimeout(2500);
    await p6.getByRole('tab', { name: 'To decide' }).click();
    await p6.waitForTimeout(2500);
    check(
      'the approver sees it under To decide',
      /Your decision/.test(await p6.innerText('body')) &&
        (await p6.innerText('body')).includes(what),
    );
    await p6.screenshot({ path: `${out}/97-to-decide.png` });
    console.log('shot 97-to-decide');
    await p6.getByText(what).first().click();
    await p6.waitForTimeout(2500);
    await p6.getByLabel('Comment').fill('Fine for this wave. Keep it under $1,500.');
    await p6.getByRole('button', { name: 'Approve' }).click();
    await p6.waitForTimeout(3000);
    const after = await api('GET', `/v1/approvals/${appr.approvalId}`, undefined, samTok);
    check(
      'approving reaches the server with the comment',
      after.status === 'approved' && after.decisions[0]?.comment.startsWith('Fine for this wave'),
    );
    await p6.waitForTimeout(800);
    await p6.screenshot({ path: `${out}/98-approved.png` });
    console.log('shot 98-approved');
    await ctx6.close();

    // Sam ticks the task done from the list.
    await p.goto(`${APP}/tasks`);
    await p.waitForTimeout(2500);
    await p.getByRole('tab', { name: 'Created by me' }).click();
    await p.waitForTimeout(2500);
    await p.getByRole('checkbox', { name: `Mark ${ask} done` }).click();
    await p.waitForTimeout(2500);
    const done = await api('GET', `/v1/tasks/${task.taskId}`, undefined, samTok);
    check('ticking a task marks it done on the server', done.status === 'done');
    await p.getByLabel('Show finished tasks').click();
    await p.waitForTimeout(2000);
    await shot('99-created-by-me');
  }
  // ---- AI assistant: Sam asks a question with sources, searches, reads the digest, summarizes
  // the channel and shares the summary (with confirmation), uses a suggested reply and
  // translates a message; Priya (owner) sees the organization switch.
  {
    const tokenOf = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const samTok = await tokenOf('sam@northwind.test');
    const convs = await api('GET', '/v1/conversations', undefined, samTok);
    const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
      (c) => c.name === 'fieldwork-ops',
    );
    const run = Date.now().toString(36).slice(-4);
    const marcoTok = await tokenOf('marco@northwind.test');
    const marcoSays = `Should we extend the Germany fieldwork to Friday? (${run})`;
    await api(
      'POST',
      `/v1/conversations/${ops.conversationId}/messages`,
      {
        conversationId: ops.conversationId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text: marcoSays, mentions: [] },
      },
      marcoTok,
    );

    await p.goto(`${APP}/assistant`);
    await p.waitForTimeout(3000);
    await p.getByLabel('Ask a question').fill('What did we say about the wave 3 quotas?');
    await p.getByRole('button', { name: 'Ask', exact: true }).click();
    await p.waitForTimeout(3500);
    const askBody = await p.innerText('body');
    check(
      'Ask answers with numbered sources',
      /Sources/.test(askBody) && /\[1\]/.test(askBody) && /Built-in assistant/.test(askBody),
    );
    await shot('100-ai-ask');
    await p.getByRole('radio', { name: 'Status digest' }).click();
    await p.waitForTimeout(3500);
    check(
      'the status digest lists conversations with a status',
      /On track|Needs attention|Quiet/.test(await p.innerText('body')),
    );
    await shot('101-ai-digest');
    await p.getByRole('radio', { name: 'Search', exact: true }).click();
    await p.waitForTimeout(800);
    await p.getByLabel('Search by meaning').fill('Germany fieldwork extension');
    await p.getByLabel('Search by meaning').press('Enter');
    await p.waitForTimeout(3000);
    check('search by meaning finds the message', (await p.innerText('body')).includes(marcoSays));
    await p.getByText(marcoSays).first().click();
    await p.waitForTimeout(3000);
    check(
      'a search hit opens its conversation',
      p.url().includes(`/conversation/${ops.conversationId}`),
    );

    // Suggested replies to Marco's question.
    await p.getByRole('button', { name: 'Attach' }).click();
    await p.getByRole('button', { name: 'Suggest replies' }).click();
    await p.waitForTimeout(3000);
    const chips = p.getByRole('button', { name: /^Use reply: / });
    check('suggested replies appear above the composer', (await chips.count()) > 0);
    await shot('102-ai-suggested-replies');
    const first = (await chips.first().getAttribute('aria-label')).replace(/^Use reply: /, '');
    await chips.first().click();
    await p.waitForTimeout(500);
    check(
      'tapping a suggestion puts it in the composer (not sent)',
      (await p.locator('textarea').last().inputValue()) === first,
    );
    await p.locator('textarea').last().fill('');

    // Translate (needs a model server: the built-in engine says so).
    await p.getByText(marcoSays, { exact: true }).last().click({ delay: 700 });
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: 'Translate' }).click();
    await p.waitForTimeout(2500);
    check(
      'translate explains that it needs a model server',
      /Translation needs a model server/.test(await p.innerText('body')),
    );
    await shot('103-ai-translate');
    await p.getByRole('button', { name: 'Close translation' }).click();

    // Summary, then share it.
    await p.getByRole('button', { name: 'Attach' }).click();
    await p.getByRole('button', { name: 'Summarize conversation' }).click();
    await p.waitForTimeout(3500);
    check(
      'the summary screen summarizes the channel',
      /\d+ messages?/.test(await p.innerText('body')),
    );
    await shot('104-ai-summary');
    await p.getByRole('button', { name: 'Share in the conversation' }).click();
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: 'Send', exact: true }).click();
    await p.waitForTimeout(2500);
    if (await p.getByRole('switch', { name: 'I checked it, send it' }).count()) {
      await shot('105-ai-share-sensitive');
      await p.getByRole('switch', { name: 'I checked it, send it' }).click();
      await p.getByRole('button', { name: 'Send', exact: true }).click();
      await p.waitForTimeout(2500);
    }
    const latest = await api(
      'GET',
      `/v1/conversations/${ops.conversationId}/messages?limit=5`,
      undefined,
      samTok,
    );
    check(
      'sharing posts the summary as Sam only after Send',
      (Array.isArray(latest) ? latest : (latest.messages ?? latest.items)).some((m) =>
        m.content.text?.startsWith('Summary:'),
      ) && /Shared in the conversation/.test(await p.innerText('body')),
    );

    // Priya manages the assistant for the organization.
    const ctx7 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
    const p7 = await ctx7.newPage();
    await p7.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p7.waitForTimeout(1500);
    const f7 = p7.locator('input');
    await f7.nth(0).fill(API);
    await f7.nth(1).fill('northwind');
    await f7.nth(2).fill('priya@northwind.test');
    await f7.nth(3).fill(pw);
    await p7.getByRole('button', { name: 'Sign in' }).click();
    await p7.waitForTimeout(4000);
    await p7.goto(`${APP}/assistant`);
    await p7.waitForTimeout(3000);
    const sw = p7.getByRole('switch', { name: 'Assistant on for everyone' });
    check('owners get the organization switch', (await sw.count()) === 1);
    await p7.screenshot({ path: `${out}/106-ai-admin.png` });
    console.log('shot 106-ai-admin');
    await sw.click();
    await p7.waitForTimeout(2000);
    const off = await api('GET', '/v1/ai/status', undefined, samTok);
    check(
      'turning it off reaches the server',
      off.enabled === false && /assistant is off/.test(await p7.innerText('body')),
    );
    await p7.getByRole('switch', { name: 'Assistant on for everyone' }).click();
    await p7.waitForTimeout(2000);
    check('and back on', (await api('GET', '/v1/ai/status', undefined, samTok)).enabled === true);
    await ctx7.close();
  }
  // ---- White-label branding: Priya (owner) sets the name, logo, colors and sign-in message on
  // her phone; Sam's app picks up the organization theme and logo; the sign-in screen shows
  // the branding once the workspace is typed; enforcing the theme locks Appearance.
  {
    const tokenOf = async (email) =>
      (
        await api('POST', '/v1/auth/login', {
          tenantSlug: 'northwind',
          email,
          password: pw,
          device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
        })
      ).accessToken;
    const priyaTok = await tokenOf('priya@northwind.test');
    const before = await api('GET', '/v1/branding', undefined, priyaTok);
    const restore = {
      appName: before.appName,
      logo: before.logo,
      primary: before.primary,
      secondary: before.secondary,
      mode: before.mode,
      useBrandTheme: before.useBrandTheme,
      enforceTheme: before.enforceTheme,
      loginMessage: before.loginMessage,
      supportEmail: before.supportEmail,
      supportUrl: before.supportUrl,
      hidePoweredBy: before.hidePoweredBy,
    };
    try {
      const ctx8 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
      const p8 = await ctx8.newPage();
      await p8.goto(`${APP}/`, { waitUntil: 'networkidle' });
      await p8.waitForTimeout(1500);
      const f8 = p8.locator('input');
      await f8.nth(0).fill(API);
      await f8.nth(1).fill('northwind');
      await f8.nth(2).fill('priya@northwind.test');
      await f8.nth(3).fill(pw);
      await p8.getByRole('button', { name: 'Sign in' }).click();
      await p8.waitForTimeout(4000);
      await p8.goto(`${APP}/admin/branding`);
      await p8.waitForTimeout(3000);
      await p8.getByLabel('App name').fill('Northwind Connect');
      await p8.getByLabel('Primary color').fill('#0EA5E9');
      await p8.getByLabel('Accent color').fill('#F97316');
      await p8.getByRole('switch', { name: 'Start everyone on this theme' }).click();
      await p8
        .getByLabel('Sign-in message')
        .fill('Northwind staff: use your work email. Help: #it-help.');
      const chooser = p8.waitForEvent('filechooser');
      await p8.getByRole('button', { name: 'Add logo' }).click();
      await (
        await chooser
      ).setFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAyElEQVR4nO3QyRGAMAzFUCqg/wYojirgCgynbLIT/RnfrbdtzjnnnOu5/Tiv0qN/r1pNeFqIltHpMEbEh0QYGR4OgozHEehwFIEORhHoUBSBDkQR6DAcgY5CAeggFIEOwRHoCAFIADoAR6CfRwHox3EE+mkBBBBAAAEEEEAAAQQQQAABCIBZEIrjBZgAoTpeAAHyIjSLz4jQPF6ARAjd4jMgdI+PjDAsPiLC8PhICFh8BAS6/bVlw59bOv67JaP/tmy4c8654LsB57d4K/DEVr0AAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await p8.waitForTimeout(1500);
      await p8.screenshot({ path: `${out}/107-branding-editor.png` });
      console.log('shot 107-branding-editor');
      await p8.getByRole('button', { name: 'Save branding' }).click();
      await p8.waitForTimeout(2500);
      const saved = await api('GET', '/v1/branding', undefined, priyaTok);
      check(
        'the owner saves branding from the phone',
        saved.appName === 'Northwind Connect' &&
          saved.primary.toUpperCase() === '#0EA5E9' &&
          saved.useBrandTheme === true &&
          /^data:image\/png;base64,/.test(saved.logo ?? '') &&
          /Saved\./.test(await p8.innerText('body')),
      );
      await ctx8.close();

      // Sam (never picked a theme in this context) starts on the organization theme.
      const ctx9 = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
      const p9 = await ctx9.newPage();
      await p9.goto(`${APP}/`, { waitUntil: 'networkidle' });
      await p9.waitForTimeout(1500);
      const f9 = p9.locator('input');
      await f9.nth(0).fill(API);
      await f9.nth(1).fill('northwind');
      await p9.waitForTimeout(1500);
      check(
        'the sign-in screen shows the workspace branding',
        /Northwind Connect/.test(await p9.innerText('body')) &&
          /use your work email/.test(await p9.innerText('body')) &&
          (await p9.getByLabel('Northwind Connect logo').count()) > 0,
      );
      await p9.screenshot({ path: `${out}/108-branded-sign-in.png` });
      console.log('shot 108-branded-sign-in');
      await f9.nth(2).fill('sam@northwind.test');
      await f9.nth(3).fill(pw);
      await p9.getByRole('button', { name: 'Sign in' }).click();
      await p9.waitForTimeout(5000);
      check(
        'home shows the organization logo',
        (await p9.getByLabel('Northwind Connect logo').count()) > 0,
      );
      await p9.screenshot({ path: `${out}/109-branded-home.png` });
      console.log('shot 109-branded-home');
      await p9.goto(`${APP}/settings/appearance`);
      await p9.waitForTimeout(2500);
      check(
        'members start on the organization theme',
        /You are on the Northwind .*theme/.test(await p9.innerText('body')),
      );
      await api(
        'PUT',
        '/v1/branding',
        {
          ...restore,
          appName: saved.appName,
          logo: saved.logo,
          primary: saved.primary,
          secondary: saved.secondary,
          useBrandTheme: true,
          enforceTheme: true,
          loginMessage: saved.loginMessage,
        },
        priyaTok,
      );
      await p9.reload({ waitUntil: 'networkidle' });
      await p9.waitForTimeout(4000);
      check(
        'an enforced theme locks the choice',
        /sets the theme for everyone/.test(await p9.innerText('body')) &&
          (await p9.getByRole('radio', { name: 'Arctic Professional' }).isDisabled()),
      );
      await p9.screenshot({ path: `${out}/110-enforced-theme.png` });
      console.log('shot 110-enforced-theme');
      await ctx9.close();
    } finally {
      await api('PUT', '/v1/branding', restore, priyaTok);
    }
  }
  await b.close();
  if (failures.length) process.exit(1);
})();
