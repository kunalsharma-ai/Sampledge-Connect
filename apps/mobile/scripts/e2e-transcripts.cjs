const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Transcripts end to end: Sam opens the transcript of his voice message, corrects a line, marks
// it checked, corrects another line offline (sent on reconnect), follows Priya's correction
// live, and reads a translation that is out of date.
// Usage: pnpm web:export, then node scripts/e2e-transcripts.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs and Mongo on localhost. There is no speech-to-text server here, so
// the finished transcript is written straight into the database.
const out = process.argv[2];
const API = process.env.API ?? 'http://localhost:4000';
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

(async () => {
  const sam = await login('sam@northwind.test');
  const priya = await login('priya@northwind.test');
  // The organization's speech-to-text server (never reached here: the transcript is seeded).
  await api(
    'PUT',
    '/v1/admin/integrations/ai.transcription',
    {
      enabled: true,
      values: {
        baseUrl: 'http://stt.northwind.test:8000',
        model: 'whisper-small',
        autoTranscribeVoice: false,
        autoTranscribeCalls: false,
      },
    },
    priya,
  );
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const list = Array.isArray(convs) ? convs : (convs.items ?? convs.conversations);
  const conv = list.find((c) => c.name === 'fieldwork-ops') ?? list[0];

  // Voice messages left by earlier runs are deleted, so the new one is the only clip.
  const { MongoClient, ObjectId } = require(
    pathMod.join(__dirname, '../../api/node_modules/mongodb'),
  );
  const mongo = await MongoClient.connect('mongodb://localhost:27017');
  const mdb = mongo.db('sampledge_connect');
  const tenant = await mdb.collection('tenants').findOne({ slug: 'northwind' });
  const earlier = await mdb
    .collection('attachments')
    .find({ tenantId: tenant._id, fileName: 'voice-message.wav', deletedAt: null })
    .toArray();
  for (const x of earlier)
    await api('DELETE', `/v1/recordings/${x._id}`, undefined, sam).catch(() => undefined);

  // Sam's voice message.
  const bytes = fs.readFileSync(pathMod.join(__dirname, 'e2e-fixtures', 'voice-note.wav'));
  const ticket = await api(
    'POST',
    '/v1/uploads',
    {
      conversationId: conv.conversationId,
      fileName: 'voice-message.wav',
      mimeType: 'audio/wav',
      sizeBytes: bytes.length,
      recording: 'voice',
      durationMs: 6000,
    },
    sam,
  );
  const put = await fetch(API + ticket.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${sam}`, 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  if (!put.ok) throw new Error(`upload PUT ${put.status}`);
  await api('POST', `/v1/uploads/${ticket.uploadId}/complete`, undefined, sam);
  const msg = await api(
    'POST',
    `/v1/conversations/${conv.conversationId}/messages`,
    {
      conversationId: conv.conversationId,
      clientMessageId: crypto.randomUUID(),
      messageType: 'text',
      content: { text: '', mentions: [] },
      attachmentIds: [ticket.uploadId],
    },
    sam,
  );
  const attachmentId = ticket.uploadId;

  const now = new Date();
  const segments = [
    { startMs: 0, endMs: 1800, text: 'Quick update on the wave three field work.' },
    { startMs: 1800, endMs: 3600, text: 'Quotas in pune are at eighty percent.' },
    { startMs: 3600, endMs: 5000, text: 'We need two more interviewers for Mumbai.' },
    { startMs: 5000, endMs: 6000, text: 'Thanks everyone.' },
  ];
  await mdb.collection('ai_transcripts').insertOne({
    _id: new ObjectId().toHexString(),
    tenantId: tenant._id,
    attachmentId,
    conversationId: conv.conversationId,
    messageId: msg.messageId ?? msg.message?.messageId ?? null,
    kind: 'voice',
    status: 'done',
    text: segments.map((s) => s.text).join(' '),
    segments,
    language: 'en',
    model: 'whisper-small',
    error: null,
    attempts: 1,
    requestedBy: null,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    translations: [
      {
        language: 'hi',
        status: 'done',
        text: 'वेव तीन फील्ड वर्क पर एक छोटा अपडेट। पुणे में कोटा अस्सी प्रतिशत है। मुंबई के लिए दो और इंटरव्यूअर चाहिए। सभी का धन्यवाद।',
        segments: [
          { startMs: 0, endMs: 1800, text: 'वेव तीन फील्ड वर्क पर एक छोटा अपडेट।' },
          { startMs: 1800, endMs: 3600, text: 'पुणे में कोटा अस्सी प्रतिशत है।' },
          { startMs: 3600, endMs: 5000, text: 'मुंबई के लिए दो और इंटरव्यूअर चाहिए।' },
          { startMs: 5000, endMs: 6000, text: 'सभी का धन्यवाद।' },
        ],
        engine: 'model',
        error: null,
        attempts: 1,
        sourceRevision: 0,
        requestedBy: null,
        updatedAt: now,
      },
    ],
  });
  const server = () => api('GET', `/v1/ai/transcripts/${attachmentId}`, undefined, sam);

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const signIn = async (scheme, email) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
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
    await inputs.nth(0).fill(API);
    await inputs.nth(1).fill('northwind');
    await inputs.nth(2).fill(email);
    await inputs.nth(3).fill(pw);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.waitForTimeout(5000);
    return { ctx, p };
  };
  const { ctx, p } = await signIn('dark', 'sam@northwind.test');
  const shot = async (page, n) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = () => p.innerText('body');

  // The voice message in the conversation has a Transcript button.
  await p.goto(`${APP}/conversation/${conv.conversationId}`);
  await p.waitForTimeout(4000);
  const btn = p.getByRole('button', { name: 'Transcript of Voice message' }).last();
  check('Transcript button on the voice message', (await btn.count()) > 0);
  await btn.scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(p, '01-clip');
  await btn.click();
  await p.waitForTimeout(3000);
  check('lines shown', /Quotas in pune are at eighty percent/.test(await body()));
  check('machine transcript note', /Machine transcript · English/.test(await body()));
  await shot(p, '02-transcript');

  // Correct a line.
  await p.getByRole('button', { name: 'Correct', exact: true }).click();
  await p.getByLabel('Line 2', { exact: true }).fill('Quotas in Pune are at 80%.');
  await shot(p, '03-correct');
  await p.getByRole('button', { name: 'Save corrections' }).click();
  await p.waitForTimeout(2500);
  let s = await server();
  check('correction saved', s.segments[1].text === 'Quotas in Pune are at 80%.' && s.edited);
  check('shows corrected by people', /corrected by people/.test(await body()));

  // Mark checked.
  await p.getByRole('button', { name: 'Mark checked' }).click();
  await p.waitForTimeout(2500);
  s = await server();
  check('marked checked', !!s.reviewedAt);
  check('checked shown', /Checked against the recording/.test(await body()));

  // Offline: correct another line; it goes up on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: 'Correct', exact: true }).click();
  await p.getByLabel('Line 3', { exact: true }).fill('We need two more interviewers in Mumbai.');
  await p.getByRole('button', { name: 'Save corrections' }).click();
  await p.waitForTimeout(1200);
  check('shown at once offline', /two more interviewers in Mumbai/.test(await body()));
  check('saved on this phone note', /Saved on this phone/.test(await body()));
  check('not sent while offline', (await server()).segments[2].text.endsWith('for Mumbai.'));
  await shot(p, '04-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  check(
    'sent on reconnect',
    (await server()).segments[2].text === 'We need two more interviewers in Mumbai.',
  );
  check('offline note cleared', !/Saved on this phone/.test(await body()));

  // Priya corrects the last line on her device: Sam sees it live.
  s = await server();
  await api(
    'PATCH',
    `/v1/ai/transcripts/${attachmentId}`,
    { baseRevision: s.revision, segments: [{ index: 3, text: 'Thanks, everyone!' }] },
    priya,
  );
  await p.waitForTimeout(3500);
  check('follows Priya live', /Thanks, everyone!/.test(await body()));

  // The Hindi translation is out of date now that the original was corrected.
  await p.getByRole('radio', { name: /Hindi/ }).click();
  await p.waitForTimeout(1200);
  check('translation shown', /पुणे में कोटा/.test(await body()));
  check('out of date notice', /corrected after this was translated/.test(await body()));
  await shot(p, '05-translation');

  // Light theme, from the recordings list.
  const light = await signIn('light', 'sam@northwind.test');
  await light.p.goto(`${APP}/recordings`);
  await light.p.waitForTimeout(4000);
  check(
    'Transcript button in recordings',
    (await light.p.getByRole('button', { name: 'Transcript of Voice message' }).count()) > 0,
  );
  await shot(light.p, '06-recordings-light');
  await light.p.getByRole('button', { name: 'Transcript of Voice message' }).first().click();
  await light.p.waitForTimeout(3000);
  await shot(light.p, '07-transcript-light');

  await mdb.collection('ai_transcripts').deleteOne({ attachmentId });
  await api(
    'PUT',
    '/v1/admin/integrations/ai.transcription',
    {
      enabled: false,
      values: { baseUrl: 'http://stt.northwind.test:8000', model: 'whisper-small' },
    },
    priya,
  ).catch(() => undefined);
  await mongo.close();
  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
