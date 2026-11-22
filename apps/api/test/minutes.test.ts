import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type AiTranscript,
  type CallMinutesResponse,
  type CallsConfig,
  type ChatExportAccess,
  type Conversation,
  type MeetingMinutes,
  type Message,
  type MinutesConfig,
  type MinutesSettings,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { MessagesService } from '../src/messages/messages.service.js';
import { TranscriptsService } from '../src/ai/transcripts.service.js';
import { TenantDb } from '../src/database/tenant-db.js';
import {
  api,
  connect,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let mia: Session;
let guest: Session;
let team: Conversation;
let tenantId: string;
let ai: Server;
let aiUrl: string;
const seen: string[] = [];

/**
 * One fake for the organization's own servers: Whisper (transcribe and translate to English)
 * and an OpenAI-compatible model (minutes and line-by-line translation).
 */
function fakeServers(req: import('node:http').IncomingMessage, body: string) {
  seen.push(req.url!);
  if (req.url === '/v1/audio/transcriptions') {
    if (body.includes('HINDI'))
      return {
        text: 'सभी का स्वागत है। हम मंगलवार को लॉन्च करेंगे।',
        language: 'hindi',
        segments: [
          { start: 0, end: 2, text: 'सभी का स्वागत है।' },
          { start: 2, end: 5, text: 'हम मंगलवार को लॉन्च करेंगे।' },
        ],
      };
    if (body.includes('CAPTION')) return { text: 'Ravi will send the sample plan by Monday.' };
    return {
      text: 'We agreed to move the soft launch to Tuesday. Ravi will send the revised sample plan by Monday.',
      language: 'english',
      segments: [
        { start: 0, end: 4, text: 'We agreed to move the soft launch to Tuesday.' },
        { start: 4, end: 9, text: 'Ravi will send the revised sample plan by Monday.' },
      ],
    };
  }
  if (req.url === '/v1/audio/translations')
    return {
      text: 'Welcome everyone. We will launch on Tuesday.',
      segments: [
        { start: 0, end: 2, text: 'Welcome everyone.' },
        { start: 2, end: 5, text: 'We will launch on Tuesday.' },
      ],
    };
  if (req.url === '/v1/chat/completions') {
    const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[1]!.content;
    if (prompt.includes('Translate each numbered line')) {
      const target = /BCP 47 tag "([^"]+)"/.exec(prompt)![1];
      const n = Number(/exactly (\d+) entries/.exec(prompt)![1]);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                lines: Array.from({ length: n }, (_, i) => `[${target}] line ${i + 1}`),
              }),
            },
          },
        ],
      };
    }
    const lang = /BCP 47 tag "([^"]+)"/.exec(prompt)?.[1] ?? 'en';
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary:
                lang === 'hi' ? 'टीम ने लॉन्च की तारीख तय की।' : 'The team set the launch date.',
              highlights: [],
              decisions: ['Soft launch moves to Tuesday.'],
              actionItems: [
                { text: 'Send the revised sample plan', assignee: 'Ravi Kumar', due: 'Monday' },
              ],
              openQuestions: [],
            }),
          },
        },
      ],
    };
  }
  return null;
}

const db = () => h.app.get(TenantDb).for(tenantId);

/** An ended call with Owner and Ravi in it (and a guest), as the call server leaves it. */
async function endedCall(minutesAgo = 60) {
  const startedAt = new Date(Date.now() - minutesAgo * 60_000);
  const endedAt = new Date(startedAt.getTime() + 30 * 60_000);
  const doc = await db().calls.insertOne({
    conversationId: team.conversationId,
    media: 'video',
    status: 'ended',
    startedBy: owner.user.userId,
    startedAt,
    endedAt,
    room: `room-${uuidv7()}`,
    participants: [
      {
        userId: owner.user.userId,
        state: 'left',
        joinedAt: startedAt,
        leftAt: endedAt,
        ringUntil: null,
      },
      {
        userId: ravi.user.userId,
        state: 'left',
        joinedAt: new Date(startedAt.getTime() + 60_000),
        leftAt: endedAt,
        ringUntil: null,
      },
      { userId: mia.user.userId, state: 'missed', joinedAt: null, leftAt: null, ringUntil: null },
    ],
    messageId: null,
    lastActivityAt: endedAt,
    guests: [
      {
        guestId: 'g1',
        meetingId: 'm1',
        name: 'Dana Klein',
        email: 'dana@client.test',
        state: 'left',
        decidedBy: owner.user.userId,
        joinedAt: new Date(startedAt.getTime() + 120_000),
        leftAt: endedAt,
      },
    ],
  } as never);
  return doc as unknown as { _id: string; startedAt: Date };
}

async function callRecording(callId: string, marker: string) {
  const a = await h.app.get(AttachmentsService).ingest(
    tenantId,
    {
      conversationId: team.conversationId,
      uploaderId: owner.user.userId,
      fileName: 'Call recording.m4a',
      mimeType: 'audio/mp4',
      recording: 'call',
      durationMs: 9000,
      callId,
    },
    Readable.from([Buffer.from(`${marker}-fake-m4a`)]),
  );
  const msg = await h.app.get(MessagesService).postSystem(
    tenantId,
    team.conversationId,
    owner.user.userId,
    'Call recording · 0:09',
    {
      recording: {
        callId,
        attachmentId: a._id,
        startedBy: owner.user.userId,
        startedAt: new Date().toISOString(),
        durationMs: 9000,
        audioOnly: true,
        failed: false,
      },
    },
    [
      {
        attachmentId: a._id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        width: null,
        height: null,
        createdAt: a.createdAt,
        recording: 'call',
        durationMs: 9000,
      },
    ],
  );
  await db().attachments.updateOne({ _id: a._id }, { $set: { messageId: msg.messageId } });
  return a._id;
}

const tx = <T>(s: Session, method: string, path: string, body?: unknown) =>
  api<T>(h, method, `/v1/ai/transcripts/${path}`, { token: s.accessToken, body });
const sweep = () => h.app.get(TranscriptsService).sweep(tenantId);

async function download(s: Session, path: string, init: RequestInit = {}) {
  const res = await fetch(h.url + path, {
    ...init,
    headers: {
      authorization: `Bearer ${s.accessToken}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

beforeAll(async () => {
  ai = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const out = fakeServers(req, Buffer.concat(chunks).toString('utf8'));
      if (!out) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => ai.listen(0, '127.0.0.1', r));
  aiUrl = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`;
  h = await startHarness();
  const t = await registerTenant(h, 'Northwind Minutes');
  owner = t.session;
  tenantId = owner.tenant.tenantId;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  guest = await inviteAndLogin(h, owner, t.slug, 'Gus Vendor', 'guest');
  team = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: {
        kind: 'group',
        name: 'Q4 tracker',
        memberIds: [ravi.user.userId, mia.user.userId, guest.user.userId],
      },
    })
  ).body;
  const stt = await api(h, 'PUT', '/v1/admin/integrations/ai.transcription', {
    token: owner.accessToken,
    body: { enabled: true, values: { baseUrl: aiUrl, model: 'whisper-small', translateTo: 'en' } },
  });
  expect(stt.status).toBe(200);
});
afterAll(async () => {
  await h.close();
  await new Promise((r) => ai.close(r));
});

describe('multilingual transcripts', () => {
  let hindi: string;
  let callId: string;

  it('detects the spoken language and translates into English automatically', async () => {
    callId = (await endedCall(200))._id;
    hindi = await callRecording(callId, 'HINDI');
    await sweep(); // transcribe, then queue the automatic English translation
    await sweep(); // translate
    const t = (await tx<AiTranscript>(ravi, 'GET', hindi)).body;
    expect(t).toMatchObject({ status: 'done', language: 'hi', canEdit: true, revision: 0 });
    // No model server yet: English comes from Whisper's translate mode.
    expect(t.translations).toEqual([
      expect.objectContaining({ language: 'en', status: 'done', engine: 'stt', outdated: false }),
    ]);
    expect(t.translations[0]!.segments.map((s) => s.text)).toEqual([
      'Welcome everyone.',
      'We will launch on Tuesday.',
    ]);
    expect(seen).toContain('/v1/audio/translations');
  });

  it('other languages need the model server, which translates line by line', async () => {
    const no = await tx(ravi, 'POST', `${hindi}/translations`, { language: 'de' });
    expect(no.status).toBe(503);
    await api(h, 'PUT', '/v1/admin/integrations/ai.model', {
      token: owner.accessToken,
      body: { enabled: true, values: { baseUrl: aiUrl, chatModel: 'llama3.1' } },
    });
    const queued = await tx<AiTranscript>(ravi, 'POST', `${hindi}/translations`, {
      language: 'de',
    });
    expect(queued.status).toBe(202);
    expect(queued.body.translations.find((x) => x.language === 'de')?.status).toBe('queued');
    expect((await tx(ravi, 'POST', `${hindi}/translations`, { language: 'hi' })).status).toBe(400);
    await sweep();
    const t = (await tx<AiTranscript>(ravi, 'GET', hindi)).body;
    const de = t.translations.find((x) => x.language === 'de')!;
    expect(de).toMatchObject({ status: 'done', engine: 'model' });
    expect(de.segments.map((s) => [s.startMs, s.text])).toEqual([
      [0, '[de] line 1'],
      [2000, '[de] line 2'],
    ]);
    const st = await api<{ transcription: { translation: string } }>(h, 'GET', '/v1/ai/status', {
      token: ravi.accessToken,
    });
    expect(st.body.transcription.translation).toBe('model');
  });

  it('people in the call correct lines; edits merge, the same line conflicts', async () => {
    // Mia was invited but never joined, so she can read but not correct it.
    const miaView = (await tx<AiTranscript>(mia, 'GET', hindi)).body;
    expect(miaView.canEdit).toBe(false);
    expect(
      (await tx(mia, 'PATCH', hindi, { baseRevision: 0, segments: [{ index: 0, text: 'x' }] }))
        .status,
    ).toBe(403);
    const sock = await connect(h, owner.accessToken);
    const evt = nextEvent(sock, 'transcript:changed', (e) => e.attachmentId === hindi);
    const a = await tx<AiTranscript>(ravi, 'PATCH', hindi, {
      baseRevision: 0,
      segments: [{ index: 0, text: 'सभी का स्वागत है, धन्यवाद।' }],
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ revision: 1, edited: true });
    expect((await evt).revision).toBe(1);
    sock.disconnect();
    // Owner was offline on revision 0: a different line merges...
    const b = await tx<AiTranscript>(owner, 'PATCH', hindi, {
      baseRevision: 0,
      segments: [{ index: 1, text: 'हम मंगलवार को सॉफ्ट लॉन्च करेंगे।' }],
    });
    expect(b.status).toBe(200);
    expect(b.body.segments.map((s) => s.text)).toEqual([
      'सभी का स्वागत है, धन्यवाद।',
      'हम मंगलवार को सॉफ्ट लॉन्च करेंगे।',
    ]);
    // ...the line Ravi already fixed is a conflict, with the current version to reload.
    const c = await tx<{ error: { details: { lines: number[] } } }>(owner, 'PATCH', hindi, {
      baseRevision: 0,
      segments: [{ index: 0, text: 'Something else' }],
    });
    expect(c.status).toBe(409);
    expect(c.body.error.details.lines).toEqual([0]);
    // The English translation is now behind the corrected original.
    expect(b.body.translations.find((x) => x.language === 'en')!.outdated).toBe(true);
    // Mark checked, and correct a translation line.
    const r = await tx<AiTranscript>(ravi, 'PATCH', hindi, { baseRevision: 2, reviewed: true });
    expect(r.body).toMatchObject({ reviewedBy: ravi.user.userId, revision: 3 });
    const tr = await tx<AiTranscript>(ravi, 'PATCH', hindi, {
      baseRevision: 3,
      language: 'en',
      segments: [{ index: 1, text: 'We will soft-launch on Tuesday.' }],
      reviewed: true,
    });
    const en = tr.body.translations.find((x) => x.language === 'en')!;
    expect(en).toMatchObject({ edited: true, reviewedBy: ravi.user.userId });
    expect(en.text).toBe('Welcome everyone. We will soft-launch on Tuesday.');
  });
});

describe('minutes of meeting', () => {
  let callId: string;
  let minutes: MeetingMinutes;

  it('are offered to people who were in the call once it ends', async () => {
    const live = await db().calls.insertOne({
      conversationId: team.conversationId,
      media: 'audio',
      status: 'live',
      startedBy: owner.user.userId,
      startedAt: new Date(),
      endedAt: null,
      room: `room-${uuidv7()}`,
      participants: [
        {
          userId: owner.user.userId,
          state: 'joined',
          joinedAt: new Date(),
          leftAt: null,
          ringUntil: null,
        },
      ],
      messageId: null,
      lastActivityAt: new Date(),
    } as never);
    const liveRes = await api<CallMinutesResponse>(h, 'GET', `/v1/calls/${live._id}/minutes`, {
      token: owner.accessToken,
    });
    expect(liveRes.body).toMatchObject({ minutes: null, canCreate: false });
    expect(liveRes.body.blockedReason).toMatch(/once the call ends/);
    await db().calls.updateOne(
      { _id: live._id },
      { $set: { status: 'ended', endedAt: new Date() } },
    );

    const call = await endedCall(90);
    callId = call._id;
    await callRecording(callId, 'ENGLISH');
    await sweep();
    // Chat during the call counts too.
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${team.conversationId}/messages`, {
      token: ravi.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'Shared the deck in the files tab' } },
    });
    await db().messages.updateMany(
      { conversationId: team.conversationId, 'content.text': 'Shared the deck in the files tab' },
      { $set: { createdAt: new Date(call.startedAt.getTime() + 5 * 60_000) } },
    );
    const asRavi = await api<CallMinutesResponse>(h, 'GET', `/v1/calls/${callId}/minutes`, {
      token: ravi.accessToken,
    });
    expect(asRavi.body).toMatchObject({ minutes: null, canCreate: true, blockedReason: null });
    // Mia missed the call and is not a moderator.
    const asMia = await api<CallMinutesResponse>(h, 'GET', `/v1/calls/${callId}/minutes`, {
      token: mia.accessToken,
    });
    expect(asMia.body.canCreate).toBe(false);
    expect(
      (await api(h, 'POST', `/v1/calls/${callId}/minutes`, { token: mia.accessToken, body: {} }))
        .status,
    ).toBe(403);
  });

  it('are drafted from transcripts and chat, in the language asked for', async () => {
    const sock = await connect(h, mia.accessToken);
    const evt = nextEvent(sock, 'minutes:changed', (e) => e.callId === callId);
    const r = await api<MeetingMinutes>(h, 'POST', `/v1/calls/${callId}/minutes`, {
      token: ravi.accessToken,
      body: { language: 'hi' },
    });
    expect(r.status).toBe(200);
    minutes = r.body;
    expect(minutes).toMatchObject({
      status: 'draft',
      language: 'hi',
      engine: 'model',
      summary: 'टीम ने लॉन्च की तारीख तय की।',
      decisions: ['Soft launch moves to Tuesday.'],
      canEdit: true,
      sources: { transcripts: 1, chatMessages: 1, spokenLanguages: ['en'] },
    });
    expect(minutes.attendees.map((a) => [a.name, a.guest])).toEqual([
      ['Priya Owner', false],
      ['Ravi Kumar', false],
      ['Dana Klein', true],
    ]);
    expect(minutes.actionItems[0]).toMatchObject({
      text: 'Send the revised sample plan',
      ownerId: ravi.user.userId,
      due: 'Monday',
    });
    // Everyone in the conversation hears that something changed, but drafts stay private.
    expect((await evt).deleted).toBe(false);
    sock.disconnect();
    expect(
      (await api(h, 'GET', `/v1/minutes/${minutes.minutesId}`, { token: mia.accessToken })).status,
    ).toBe(404);
    const list = await api<{ items: MeetingMinutes[] }>(h, 'GET', '/v1/minutes', {
      token: mia.accessToken,
    });
    expect(list.body.items).toEqual([]);
    // Pressing again returns the same draft; regenerate writes it again.
    const again = await api<MeetingMinutes>(h, 'POST', `/v1/calls/${callId}/minutes`, {
      token: owner.accessToken,
      body: {},
    });
    expect(again.body.minutesId).toBe(minutes.minutesId);
  });

  it('are edited by the people in the call, merging different fields', async () => {
    const edit = (s: Session, body: Record<string, unknown>) =>
      api<MeetingMinutes & { error?: { details: { fields: string[] } } }>(
        h,
        'PATCH',
        `/v1/minutes/${minutes.minutesId}`,
        { token: s.accessToken, body },
      );
    const a = await edit(ravi, { baseRevision: minutes.revision, title: 'Q4 tracker kickoff' });
    expect(a.status).toBe(200);
    // Owner edits another field from the same starting revision (offline): it merges.
    const b = await edit(owner, {
      baseRevision: minutes.revision,
      decisions: ['Soft launch moves to Tuesday.', 'Use the German oncology panel.'],
    });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ title: 'Q4 tracker kickoff', revision: minutes.revision + 2 });
    // Same field from a stale revision: conflict with the fields named.
    const c = await edit(owner, { baseRevision: minutes.revision, title: 'Kickoff' });
    expect(c.status).toBe(409);
    expect(c.body.error?.details.fields).toEqual(['title']);
    expect((await edit(mia, { baseRevision: 0, notes: 'x' })).status).toBe(404);
    minutes = b.body;
  });

  it('download as PDF and Word in every template, with an optional transcript appendix', async () => {
    for (const template of ['classic', 'modern', 'executive', 'compact']) {
      const pdf = await download(
        ravi,
        `/v1/minutes/${minutes.minutesId}/document?format=pdf&template=${template}&tz=Asia/Kolkata&transcript=1`,
      );
      expect(pdf.res.status).toBe(200);
      expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
      expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    }
    const docx = await download(ravi, `/v1/minutes/${minutes.minutesId}/document?format=docx`);
    expect(docx.res.headers.get('content-type')).toMatch(/wordprocessingml/);
    expect(decodeURIComponent(docx.res.headers.get('content-disposition')!)).toMatch(
      /Minutes - Q4 tracker kickoff - \d{4}-\d{2}-\d{2}\.docx/,
    );
    expect(docx.bytes.subarray(0, 2).toString()).toBe('PK');
    expect((await download(mia, `/v1/minutes/${minutes.minutesId}/document`)).res.status).toBe(404);
  });

  it('are shared with the conversation as a card, then readable by everyone in it', async () => {
    const r = await api<MeetingMinutes>(h, 'POST', `/v1/minutes/${minutes.minutesId}/share`, {
      token: ravi.accessToken,
    });
    expect(r.body).toMatchObject({ status: 'shared', sharedBy: ravi.user.userId });
    const twice = await api<MeetingMinutes>(h, 'POST', `/v1/minutes/${minutes.minutesId}/share`, {
      token: owner.accessToken,
    });
    expect(twice.body.sharedBy).toBe(ravi.user.userId);
    const msgs = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${team.conversationId}/messages`, {
        token: mia.accessToken,
      })
    ).body;
    const cards = msgs.filter((m) => m.metadata?.minutes);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.metadata!.minutes).toMatchObject({
      minutesId: minutes.minutesId,
      decisions: 2,
      actionItems: 1,
    });
    const asMia = await api<MeetingMinutes>(h, 'GET', `/v1/minutes/${minutes.minutesId}`, {
      token: mia.accessToken,
    });
    expect(asMia.body).toMatchObject({ status: 'shared', canEdit: false });
    expect((await download(mia, `/v1/minutes/${minutes.minutesId}/document`)).res.status).toBe(200);
    const audit = await db()
      .audit_logs.find({ action: { $regex: /^minutes\./ } })
      .toArray();
    expect(new Set(audit.map((a) => a.action))).toEqual(
      new Set(['minutes.create', 'minutes.update', 'minutes.download', 'minutes.share']),
    );
  });

  it('use kept live captions, with speaker names, when the organization turns that on', async () => {
    const put = (s: Session, body: Partial<MinutesSettings>) =>
      api<MinutesSettings>(h, 'PUT', '/v1/admin/minutes-settings', { token: s.accessToken, body });
    expect((await put(ravi, { keepCaptions: true })).status).toBe(403);
    expect(
      (await put(owner, { keepCaptions: true, defaultTemplate: 'executive' })).body,
    ).toMatchObject({
      keepCaptions: true,
      chatExport: 'members',
      defaultTemplate: 'executive',
    });
    const cfg = await api<CallsConfig>(h, 'GET', '/v1/calls/config', { token: ravi.accessToken });
    expect(cfg.body.captionsSaved).toBe(true);
    const mc = await api<MinutesConfig>(h, 'GET', '/v1/minutes/config', {
      token: ravi.accessToken,
    });
    expect(mc.body).toMatchObject({
      keepCaptions: true,
      model: true,
      defaultTemplate: 'executive',
    });

    const live = await db().calls.insertOne({
      conversationId: team.conversationId,
      media: 'audio',
      status: 'live',
      startedBy: owner.user.userId,
      startedAt: new Date(Date.now() - 60_000),
      endedAt: null,
      room: `room-${uuidv7()}`,
      participants: [
        {
          userId: owner.user.userId,
          state: 'joined',
          joinedAt: new Date(),
          leftAt: null,
          ringUntil: null,
        },
        {
          userId: ravi.user.userId,
          state: 'joined',
          joinedAt: new Date(),
          leftAt: null,
          ringUntil: null,
        },
      ],
      messageId: null,
      lastActivityAt: new Date(),
    } as never);
    const clip = await fetch(`${h.url}/v1/calls/${live._id}/captions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ravi.accessToken}`, 'content-type': 'audio/webm' },
      body: new Uint8Array(Buffer.from('CAPTION audio')),
    });
    expect(await clip.json()).toEqual({ text: 'Ravi will send the sample plan by Monday.' });
    const kept = await db().call_captions.find({ callId: live._id }).toArray();
    expect(kept.map((k) => [k.speaker, k.text])).toEqual([
      ['Ravi Kumar', 'Ravi will send the sample plan by Monday.'],
    ]);
    expect(kept[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await db().calls.updateOne(
      { _id: live._id },
      { $set: { status: 'ended', endedAt: new Date() } },
    );
    const m = await api<MeetingMinutes>(h, 'POST', `/v1/calls/${live._id}/minutes`, {
      token: ravi.accessToken,
      body: { language: 'en' },
    });
    expect(m.body.sources).toMatchObject({ transcripts: 0, captionLines: 1 });
    await put(owner, { keepCaptions: false });
  });

  it('can be deleted by an editor; the shared card says so', async () => {
    const r = await api(h, 'DELETE', `/v1/minutes/${minutes.minutesId}`, {
      token: ravi.accessToken,
    });
    expect(r.status).toBe(200);
    const msgs = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${team.conversationId}/messages`, {
        token: mia.accessToken,
      })
    ).body;
    expect(msgs.find((m) => m.metadata?.minutes)?.content.text).toBe('Minutes of meeting deleted');
  });
});

describe('chat export', () => {
  const exportAs = (s: Session, body: Record<string, unknown>) =>
    download(s, `/v1/conversations/${team.conversationId}/export`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

  it('exports what the person can read as text, PDF or Word, and audits it', async () => {
    await api(h, 'POST', `/v1/conversations/${team.conversationId}/messages`, {
      token: mia.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'नमस्ते, the quotas look good' } },
    });
    const txt = await exportAs(mia, {
      format: 'txt',
      tz: 'Asia/Kolkata',
      includeTranscripts: true,
    });
    expect(txt.res.status).toBe(200);
    expect(txt.res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const text = txt.bytes.toString('utf8');
    expect(text).toContain('Mia Chen: नमस्ते, the quotas look good');
    expect(text).toContain('Transcript: We agreed to move the soft launch to Tuesday.');
    expect(text).toContain('Exported by Mia Chen');
    const pdf = await exportAs(mia, { format: 'pdf' });
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const docx = await exportAs(mia, { format: 'docx', includeSystem: false });
    expect(docx.bytes.subarray(0, 2).toString()).toBe('PK');
    const audit = await db()
      .audit_logs.find({ action: 'conversation.export' }, { sort: { at: 1 } })
      .toArray();
    expect(audit.map((a) => a.metadata.format)).toEqual(['txt', 'pdf', 'docx']);
    expect(audit[0]!.metadata).toMatchObject({ includeTranscripts: true, truncated: false });
  });

  it('follows the organization policy; guests never export', async () => {
    const access = (s: Session) =>
      api<ChatExportAccess>(h, 'GET', `/v1/conversations/${team.conversationId}/export`, {
        token: s.accessToken,
      });
    expect((await access(guest)).body).toMatchObject({ allowed: false });
    expect((await exportAs(guest, { format: 'txt' })).res.status).toBe(403);
    await api(h, 'PUT', '/v1/admin/minutes-settings', {
      token: owner.accessToken,
      body: { chatExport: 'moderators' },
    });
    expect((await access(mia)).body).toMatchObject({ allowed: false, policy: 'moderators' });
    expect((await exportAs(mia, { format: 'txt' })).res.status).toBe(403);
    expect((await exportAs(owner, { format: 'txt' })).res.status).toBe(200);
    await api(h, 'PUT', '/v1/admin/minutes-settings', {
      token: owner.accessToken,
      body: { chatExport: 'off' },
    });
    expect((await exportAs(owner, { format: 'txt' })).res.status).toBe(403);
    expect((await access(owner)).body.reason).toMatch(/turned chat export off/);
    expect(
      (
        await exportAs(mia, {
          format: 'txt',
          from: '2026-12-02T00:00:00Z',
          to: '2026-12-01T00:00:00Z',
        })
      ).res.status,
    ).toBe(400);
  });
});
