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
  await b.close();
  if (failures.length) process.exit(1);
})();
