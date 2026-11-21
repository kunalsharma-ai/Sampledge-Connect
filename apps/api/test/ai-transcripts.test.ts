import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type AiMeetingSummary,
  type AiSearchResponse,
  type AiStatus,
  type AiSummary,
  type AiTranscript,
  type Attachment,
  type Conversation,
  type Meeting,
  type SendMessageAck,
  type Session,
  type UploadTicket,
} from '@sampledge/contracts';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { MessagesService } from '../src/messages/messages.service.js';
import { TranscriptsService } from '../src/ai/transcripts.service.js';
import { TenantDb } from '../src/database/tenant-db.js';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let outsider: Session;
let mia: Session;
let team: Conversation;
let tenantId: string;
let stt: Server;
let sttUrl: string;
let mode: 'ok' | 'down' = 'ok';
let calls = 0;
let lastForm = '';

/** What the fake Whisper server "hears" for each recording, keyed by a marker in the bytes. */
const HEARD: Record<
  string,
  { text: string; segments: { start: number; end: number; text: string }[] }
> = {
  VOICE1: {
    text: 'Quick update on the Germany bid. The fieldwork vendor confirmed the oncology panel.',
    segments: [
      { start: 0, end: 3.2, text: 'Quick update on the Germany bid.' },
      { start: 3.2, end: 7.9, text: 'The fieldwork vendor confirmed the oncology panel.' },
    ],
  },
  CALL1: {
    text: 'Thanks everyone for joining. We agreed to move the soft launch to Tuesday. Ravi will send the revised sample plan by Monday. What incidence should we assume for cardiologists?',
    segments: [
      { start: 0, end: 2, text: 'Thanks everyone for joining.' },
      { start: 2, end: 6, text: 'We agreed to move the soft launch to Tuesday.' },
      { start: 6, end: 10, text: 'Ravi will send the revised sample plan by Monday.' },
      { start: 10, end: 14, text: 'What incidence should we assume for cardiologists?' },
    ],
  },
};

const tx = <T>(s: Session, method: string, id: string) =>
  api<T>(h, method, `/v1/ai/transcripts/${id}`, { token: s.accessToken });
const svc = () => h.app.get(TranscriptsService);

async function upload(
  s: Session,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
  recording?: string,
) {
  const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
    token: s.accessToken,
    body: {
      conversationId: team.conversationId,
      sizeBytes: bytes.length,
      fileName,
      mimeType,
      ...(recording ? { recording, durationMs: 8000 } : {}),
    },
  });
  await fetch(h.url + t.body.uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${s.accessToken}`,
      'content-type': 'application/octet-stream',
    },
    body: bytes,
  });
  const a = (
    await api<Attachment>(h, 'POST', `/v1/uploads/${t.body.uploadId}/complete`, {
      token: s.accessToken,
    })
  ).body;
  const sent = await api<SendMessageAck>(
    h,
    'POST',
    `/v1/conversations/${team.conversationId}/messages`,
    {
      token: s.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: '' }, attachmentIds: [a.attachmentId] },
    },
  );
  return { attachment: a, message: sent.body.message };
}

/** A call recording arrives the way the call server delivers it: ingested, then a system message. */
async function callRecording(marker: string) {
  const attachments = h.app.get(AttachmentsService);
  const doc = await attachments.ingest(
    tenantId,
    {
      conversationId: team.conversationId,
      uploaderId: owner.user.userId,
      fileName: 'Call recording 2026-11-21 10-00.m4a',
      mimeType: 'audio/mp4',
      recording: 'call',
      durationMs: 14_000,
      callId: null,
    },
    Readable.from([Buffer.from(`${marker}-fake-m4a-bytes`)]),
  );
  const msg = await h.app.get(MessagesService).postSystem(
    tenantId,
    team.conversationId,
    owner.user.userId,
    'Call recording · 0:14',
    {
      recording: {
        callId: 'call-1',
        attachmentId: doc._id,
        startedBy: owner.user.userId,
        startedAt: new Date().toISOString(),
        durationMs: 14_000,
        audioOnly: true,
        failed: false,
      },
    },
    [
      {
        attachmentId: doc._id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        width: null,
        height: null,
        createdAt: doc.createdAt,
        recording: 'call',
        durationMs: 14_000,
      },
    ],
  );
  await h.app
    .get(TenantDb)
    .for(tenantId)
    .attachments.updateOne({ _id: doc._id }, { $set: { messageId: msg.messageId } });
  return { attachmentId: doc._id, messageId: msg.messageId };
}

const configure = (values: Record<string, unknown>, enabled = true, s = owner) =>
  api(h, 'PUT', '/v1/admin/integrations/ai.transcription', {
    token: s.accessToken,
    body: { enabled, values },
  });

beforeAll(async () => {
  stt = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      calls++;
      const body = Buffer.concat(chunks).toString('latin1');
      lastForm = body;
      if (mode === 'down' || req.url !== '/v1/audio/transcriptions') {
        res.writeHead(mode === 'down' ? 500 : 404).end('internal details that must not leak');
        return;
      }
      expect(req.headers['content-type']).toMatch(/^multipart\/form-data/);
      const marker = Object.keys(HEARD).find((k) => body.includes(k));
      const heard = marker ? HEARD[marker]! : { text: '', segments: [] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          text: heard.text,
          language: 'english',
          duration: 14,
          segments: heard.segments,
        }),
      );
    });
  });
  await new Promise<void>((r) => stt.listen(0, '127.0.0.1', r));
  sttUrl = `http://127.0.0.1:${(stt.address() as AddressInfo).port}`;

  h = await startHarness();
  const t = await registerTenant(h, 'Northwind Transcripts');
  owner = t.session;
  tenantId = owner.tenant.tenantId;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  outsider = await inviteAndLogin(h, owner, t.slug, 'Omar Outside');
  team = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Germany bid', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
});
afterAll(async () => {
  await h.close();
  await new Promise((r) => stt.close(r));
});

describe('transcripts without a speech-to-text server', () => {
  it('says it is not set up, and does not queue anything', async () => {
    const st = await api<AiStatus>(h, 'GET', '/v1/ai/status', { token: ravi.accessToken });
    expect(st.body.transcription).toEqual({
      configured: false,
      autoTranscribeCalls: false,
      autoTranscribeVoice: false,
    });
    const { attachment } = await upload(
      ravi,
      'Voice message.webm',
      'audio/webm',
      Buffer.from('OggS-nothing'),
      'voice',
    );
    expect((await tx<AiTranscript>(ravi, 'GET', attachment.attachmentId)).body.status).toBe(
      'not_configured',
    );
    const r = await tx(ravi, 'POST', attachment.attachmentId);
    expect(r.status).toBe(503);
    expect(await svc().sweep(tenantId)).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('transcripts from the organization’s own speech-to-text server', () => {
  let voice: { attachment: Attachment; message: { messageId: string } };
  let call: { attachmentId: string; messageId: string };

  it('only admins set it up in Integrations, and Test connection reaches the server', async () => {
    expect(
      (await configure({ baseUrl: sttUrl, model: 'Systran/faster-whisper-small' }, true, ravi))
        .status,
    ).toBe(403);
    expect(
      (
        await configure({
          baseUrl: sttUrl,
          model: 'Systran/faster-whisper-small',
          apiKey: 'sk-stt',
        })
      ).status,
    ).toBe(200);
    const test = await api<{ ok: boolean; message: string }>(
      h,
      'POST',
      '/v1/admin/integrations/ai.transcription/test',
      { token: owner.accessToken, body: {} },
    );
    expect(test.body).toMatchObject({ ok: true });
    expect(lastForm).toContain('faster-whisper-small');
    const st = await api<AiStatus>(h, 'GET', '/v1/ai/status', { token: ravi.accessToken });
    expect(st.body.transcription).toEqual({
      configured: true,
      autoTranscribeCalls: true,
      autoTranscribeVoice: false,
    });
  });

  it('transcribes a voice message on request, for people who can read the chat', async () => {
    voice = await upload(
      ravi,
      'Voice message.webm',
      'audio/webm',
      Buffer.from('OggS-VOICE1-bytes'),
      'voice',
    );
    const id = voice.attachment.attachmentId;
    expect((await tx<AiTranscript>(ravi, 'GET', id)).body.status).toBe('none');
    // Voice messages are not automatic by default.
    await svc().sweep(tenantId);
    expect((await tx<AiTranscript>(ravi, 'GET', id)).body.status).toBe('none');

    expect((await tx(outsider, 'GET', id)).status).toBe(404);
    expect((await tx(outsider, 'POST', id)).status).toBe(404);
    const q = await tx<AiTranscript>(owner, 'POST', id);
    expect(q.status).toBe(202);
    expect(q.body.status).toBe('queued');
    expect(await svc().sweep(tenantId)).toBe(1);
    const done = (await tx<AiTranscript>(ravi, 'GET', id)).body;
    expect(done).toMatchObject({
      status: 'done',
      language: 'en',
      model: 'Systran/faster-whisper-small',
    });
    expect(done.text).toMatch(/oncology panel/);
    expect(done.segments[1]).toEqual({
      startMs: 3200,
      endMs: 7900,
      text: 'The fieldwork vendor confirmed the oncology panel.',
    });
    // Asking again does not transcribe twice.
    const before = calls;
    expect((await tx<AiTranscript>(owner, 'POST', id)).body.status).toBe('done');
    await svc().sweep(tenantId);
    expect(calls).toBe(before);
  });

  it('refuses files that are not audio or video', async () => {
    const { attachment } = await upload(
      ravi,
      'notes.txt',
      'text/plain',
      Buffer.from('VOICE1 but text'),
    );
    expect((await tx(ravi, 'POST', attachment.attachmentId)).status).toBe(400);
  });

  it('transcribes call recordings automatically and uses them in summaries and search', async () => {
    call = await callRecording('CALL1');
    expect(await svc().sweep(tenantId)).toBe(1);
    const t = (await tx<AiTranscript>(ravi, 'GET', call.attachmentId)).body;
    expect(t.status).toBe('done');
    expect(t.messageId).toBe(call.messageId);

    const s = (
      await api<AiSummary>(h, 'POST', `/v1/ai/conversations/${team.conversationId}/summary`, {
        token: ravi.accessToken,
        body: { range: 'recent' },
      })
    ).body;
    expect(s.decisions.join(' ')).toMatch(/soft launch to Tuesday/);
    expect(s.actionItems.map((a) => a.text).join(' ')).toMatch(/revised sample plan/);
    expect(s.openQuestions.join(' ')).toMatch(/cardiologists/);

    const found = (
      await api<AiSearchResponse>(h, 'POST', '/v1/ai/search', {
        token: ravi.accessToken,
        body: { query: 'when is the soft launch' },
      })
    ).body;
    const hit = found.hits.find((x) => x.messageId === call.messageId);
    expect(hit).toMatchObject({ fromTranscript: true });
    expect(hit!.text).toMatch(/soft launch to Tuesday/);
    const voiceHit = (
      await api<AiSearchResponse>(h, 'POST', '/v1/ai/search', {
        token: ravi.accessToken,
        body: { query: 'oncology panel vendor' },
      })
    ).body.hits.find((x) => x.messageId === voice.message.messageId);
    expect(voiceHit?.fromTranscript).toBe(true);
    // Not readable, not searchable.
    const theirs = (
      await api<AiSearchResponse>(h, 'POST', '/v1/ai/search', {
        token: outsider.accessToken,
        body: { query: 'when is the soft launch' },
      })
    ).body;
    expect(theirs.hits).toHaveLength(0);
  });

  it('includes call transcripts in meeting summaries', async () => {
    const m = (
      await api<Meeting>(h, 'POST', '/v1/meetings', {
        token: owner.accessToken,
        body: {
          title: 'Soft launch check-in',
          agenda: 'Launch timing',
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 35 * 60_000).toISOString(),
          timeZone: 'Europe/Berlin',
          attendeeIds: [ravi.user.userId],
        },
      })
    ).body;
    // Record the call in the meeting's own chat.
    const prev = team;
    team = { ...team, conversationId: m.conversationId };
    await callRecording('CALL1');
    team = prev;
    await svc().sweep(tenantId);
    const r = await api<AiMeetingSummary>(h, 'POST', `/v1/ai/meetings/${m.meetingId}/summary`, {
      token: ravi.accessToken,
    });
    expect(r.body).toMatchObject({ transcriptIncluded: true, transcriptCount: 1 });
    expect(r.body.decisions.join(' ')).toMatch(/soft launch/);
  });

  it('deleting the recording deletes its transcript, and search forgets it', async () => {
    const del = await api(h, 'DELETE', `/v1/recordings/${voice.attachment.attachmentId}`, {
      token: ravi.accessToken,
    });
    expect(del.status).toBe(200);
    expect((await tx(ravi, 'GET', voice.attachment.attachmentId)).status).toBe(404);
    await svc().sweep(tenantId);
    const rows = await h.app
      .get(TenantDb)
      .for(tenantId)
      .ai_transcripts.countDocuments({ attachmentId: voice.attachment.attachmentId });
    expect(rows).toBe(0);
    const found = (
      await api<AiSearchResponse>(h, 'POST', '/v1/ai/search', {
        token: ravi.accessToken,
        body: { query: 'oncology panel vendor' },
      })
    ).body;
    expect(found.hits.map((x) => x.messageId)).not.toContain(voice.message.messageId);
  });

  it('a failing server marks the job failed with a plain reason, and it can be retried', async () => {
    const { attachment } = await upload(
      ravi,
      'Voice message.webm',
      'audio/webm',
      Buffer.from('OggS-VOICE1-again'),
      'voice',
    );
    mode = 'down';
    await tx(ravi, 'POST', attachment.attachmentId);
    for (let i = 0; i < 3; i++) await svc().sweep(tenantId);
    const failed = (await tx<AiTranscript>(ravi, 'GET', attachment.attachmentId)).body;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Speech-to-text server returned HTTP 500');
    expect(JSON.stringify(failed)).not.toContain('internal details');
    mode = 'ok';
    expect((await tx<AiTranscript>(ravi, 'POST', attachment.attachmentId)).body.status).toBe(
      'queued',
    );
    await svc().sweep(tenantId);
    expect((await tx<AiTranscript>(ravi, 'GET', attachment.attachmentId)).body.status).toBe('done');
  });

  it('refuses cloud metadata addresses, and is off when the organization turns AI off', async () => {
    await configure({ baseUrl: 'http://169.254.169.254', model: 'x' });
    expect(
      (await api<AiStatus>(h, 'GET', '/v1/ai/status', { token: ravi.accessToken })).body
        .transcription.configured,
    ).toBe(false);
    await configure({ baseUrl: sttUrl, model: 'Systran/faster-whisper-small' });
    await api(h, 'PUT', '/v1/ai/settings', { token: owner.accessToken, body: { enabled: false } });
    expect((await tx(ravi, 'GET', call.attachmentId)).status).toBe(403);
    await api(h, 'PUT', '/v1/ai/settings', { token: owner.accessToken, body: { enabled: true } });
    expect((await tx(ravi, 'GET', call.attachmentId)).status).toBe(200);
  });
});
