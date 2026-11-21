import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';
import {
  uuidv7,
  type Attachment,
  type AttachmentUrl,
  type Call,
  type CallJoinResponse,
  type CallsConfig,
  type Conversation,
  type ExportRecordingsResponse,
  type Message,
  type RecordingList,
  type RecordingSettings,
  type RecordingSystemMetadata,
  type SendMessageAck,
  type Session,
  type UploadTicket,
} from '@sampledge/contracts';
import { CallsService } from '../src/calls/calls.service.js';
import { RecordingsService } from '../src/recordings/recordings.service.js';
import {
  api,
  connect,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type ClientSocket,
  type Harness,
} from './harness.js';

const KEY = 'sampledge';
const SECRET = 'test-secret-test-secret-test-secret-1234';
const EGRESS_DIR = '/out';

/**
 * Stand-in for LiveKit's RoomService and Egress (Twirp). StartRoomCompositeEgress "records"
 * by writing a small file into the shared spool folder, like the real egress container does.
 */
function fakeSfu(spool: string) {
  const rooms = new Map<string, Set<string>>();
  const egress = new Map<string, { room: string; filepath: string; status: string }>();
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let failNextStart = false;
  const info = (id: string) => {
    const e = egress.get(id)!;
    return {
      egress_id: id,
      room_name: e.room,
      status: e.status,
      file_results:
        e.status === 'EGRESS_COMPLETE'
          ? [{ filename: e.filepath, size: '9', duration: String(65_000 * 1e6) }]
          : [],
    };
  };
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const method = req.url!.split('/').pop()!;
      try {
        const auth = (req.headers.authorization ?? '').replace('Bearer ', '');
        await jwtVerify(auth, new TextEncoder().encode(SECRET), { issuer: KEY });
      } catch {
        res.writeHead(401).end('{"code":"unauthenticated"}');
        return;
      }
      const body = JSON.parse(raw || '{}');
      calls.push({ method, body });
      res.setHeader('content-type', 'application/json');
      if (method === 'CreateRoom') {
        rooms.set(body.name, rooms.get(body.name) ?? new Set());
        return res.end(JSON.stringify({ name: body.name }));
      }
      if (method === 'ListParticipants') {
        const r = rooms.get(body.room);
        if (!r) return res.writeHead(404).end('{"code":"not_found"}');
        return res.end(JSON.stringify({ participants: [...r].map((identity) => ({ identity })) }));
      }
      if (method === 'StartRoomCompositeEgress') {
        if (failNextStart) {
          failNextStart = false;
          return res.writeHead(503).end('{"code":"unavailable","msg":"no egress"}');
        }
        const id = `EG_${egress.size + 1}`;
        egress.set(id, {
          room: body.room_name,
          filepath: body.file_outputs[0].filepath,
          status: 'EGRESS_STARTING',
        });
        return res.end(JSON.stringify(info(id)));
      }
      if (method === 'StopEgress') {
        const e = egress.get(body.egress_id);
        if (!e) return res.writeHead(404).end('{"code":"not_found"}');
        // Egress writes the file under its own path; the API reads it from the shared spool.
        writeFileSync(join(spool, e.filepath.replace(`${EGRESS_DIR}/`, '')), 'MP4-BYTES');
        e.status = 'EGRESS_ENDING';
        return res.end(JSON.stringify(info(body.egress_id)));
      }
      if (method === 'ListEgress') {
        const e = egress.get(body.egress_id);
        if (e?.status === 'EGRESS_ENDING') e.status = 'EGRESS_COMPLETE';
        return res.end(JSON.stringify({ items: e ? [info(body.egress_id)] : [] }));
      }
      if (method === 'DeleteRoom') {
        rooms.delete(body.room);
        return res.end('{}');
      }
      res.end('{}');
    });
  });
  return {
    server,
    rooms,
    egress,
    calls,
    failStart: () => (failNextStart = true),
    info,
  };
}

let h: Harness;
let sfu: ReturnType<typeof fakeSfu>;
let spool: string;
let slug: string;
let owner: Session;
let ravi: Session;
let mia: Session;
let admin: Session;
let outsider: Session;
let group: Conversation;
let raviSocket: ClientSocket;

const putBytes = (s: Session, path: string, bytes: Buffer) =>
  fetch(h.url + path, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${s.accessToken}`,
      'content-type': 'application/octet-stream',
    },
    body: bytes,
  });

async function clip(
  s: Session,
  body: { fileName: string; mimeType: string; recording?: string; durationMs?: number },
  bytes = Buffer.from('OggS-fake-opus-audio-bytes-0123456789'),
) {
  const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
    token: s.accessToken,
    body: { conversationId: group.conversationId, sizeBytes: bytes.length, ...body },
  });
  if (t.status !== 201) return { status: t.status, attachment: null, message: null };
  await putBytes(s, t.body.uploadUrl, bytes);
  const a = (
    await api<Attachment>(h, 'POST', `/v1/uploads/${t.body.uploadId}/complete`, {
      token: s.accessToken,
    })
  ).body;
  const sent = await api<SendMessageAck>(
    h,
    'POST',
    `/v1/conversations/${group.conversationId}/messages`,
    {
      token: s.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: '' }, attachmentIds: [a.attachmentId] },
    },
  );
  return { status: 201, attachment: a, message: sent.body.message };
}
const urlOf = async (s: Session, id: string) =>
  api<AttachmentUrl>(h, 'GET', `/v1/attachments/${id}/url`, { token: s.accessToken });
const listOf = async (s: Session, q = '') =>
  (await api<RecordingList>(h, 'GET', `/v1/recordings${q}`, { token: s.accessToken })).body;

beforeAll(async () => {
  spool = mkdtempSync(join(tmpdir(), 'sc-spool-'));
  sfu = fakeSfu(spool);
  await new Promise<void>((r) => sfu.server.listen(0, '127.0.0.1', r));
  const port = (sfu.server.address() as { port: number }).port;
  h = await startHarness({
    LIVEKIT_PUBLIC_URL: 'ws://rtc.example.test',
    LIVEKIT_API_URL: `http://127.0.0.1:${port}`,
    LIVEKIT_API_KEY: KEY,
    LIVEKIT_API_SECRET: SECRET,
    RECORDINGS_SPOOL_DIR: spool,
    LIVEKIT_EGRESS_OUTPUT_DIR: EGRESS_DIR,
  });
  const t = await registerTenant(h);
  slug = t.slug;
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, slug, 'Mia Chen');
  admin = await inviteAndLogin(h, owner, slug, 'Ada Admin', 'admin');
  outsider = await inviteAndLogin(h, owner, slug, 'Outside Person');
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Wave 3', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h.close();
  sfu.server.close();
});

describe('chat recordings', () => {
  it('sends a voice message with its duration and streams it with byte ranges', async () => {
    const bad = await clip(ravi, { fileName: 'x.png', mimeType: 'image/png', recording: 'voice' });
    expect(bad.status).toBe(400);

    const bytes = Buffer.from('OggS-0123456789abcdefghijklmnopqrstuvwxyz');
    const { attachment, message } = await clip(
      ravi,
      {
        fileName: 'Voice message.webm',
        mimeType: 'audio/webm',
        recording: 'voice',
        durationMs: 4200,
      },
      bytes,
    );
    expect(attachment).toMatchObject({ recording: 'voice', durationMs: 4200, deletedAt: null });
    expect(message!.attachments[0]).toMatchObject({ recording: 'voice', durationMs: 4200 });

    const url = (await urlOf(mia, attachment!.attachmentId)).body.url;
    const full = await fetch(h.url + url);
    expect(full.headers.get('content-type')).toBe('audio/webm');
    expect(full.headers.get('content-disposition')).toContain('inline;');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const part = await fetch(h.url + url, { headers: { range: 'bytes=5-14' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 5-14/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer()).toString()).toBe('0123456789');
    const tail = await fetch(h.url + url, { headers: { range: 'bytes=-3' } });
    expect(Buffer.from(await tail.arrayBuffer()).toString()).toBe('xyz');
    expect((await fetch(h.url + url, { headers: { range: 'bytes=999-' } })).status).toBe(416);
    // Backup download: same file, forced to download.
    const dl = await fetch(h.url + url + '&download=1');
    expect(dl.headers.get('content-disposition')).toContain('attachment;');
  });

  it('lists recordings for members only, and lets the recorder, moderators and admins delete', async () => {
    const { attachment, message } = await clip(mia, {
      fileName: 'Screen recording.webm',
      mimeType: 'video/webm',
      recording: 'screen',
      durationMs: 9000,
    });
    const mine = await listOf(ravi);
    const item = mine.items.find((r) => r.recordingId === attachment!.attachmentId)!;
    expect(item).toMatchObject({
      kind: 'screen',
      conversationName: 'Wave 3',
      createdBy: mia.user.userId,
      messageId: message!.messageId,
      expiresAt: null,
      canDelete: false, // Ravi is a plain member and didn't record it
    });
    expect((await listOf(ravi, '?kind=voice')).items.every((r) => r.kind === 'voice')).toBe(true);
    expect((await listOf(outsider)).items).toEqual([]);
    expect(
      (
        await api(h, 'GET', `/v1/recordings?conversationId=${group.conversationId}`, {
          token: outsider.accessToken,
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await api(h, 'DELETE', `/v1/recordings/${attachment!.attachmentId}`, {
          token: ravi.accessToken,
        })
      ).status,
    ).toBe(403);
    const updated = nextEvent(
      raviSocket,
      'message:updated',
      (m: Message) => m.messageId === message!.messageId,
    );
    const del = await api(h, 'DELETE', `/v1/recordings/${attachment!.attachmentId}`, {
      token: mia.accessToken,
    });
    expect(del.status).toBe(200);
    const m = await updated;
    expect(m.attachments[0].deletedAt).toBeTruthy();
    expect((await urlOf(ravi, attachment!.attachmentId)).status).toBe(404);
    expect((await listOf(ravi)).items.map((r) => r.recordingId)).not.toContain(
      attachment!.attachmentId,
    );
    expect(
      (
        await api(h, 'DELETE', `/v1/recordings/${attachment!.attachmentId}`, {
          token: mia.accessToken,
        })
      ).status,
    ).toBe(404);
  });

  it('lets admins set automatic deletion, and applies it', async () => {
    expect(
      (await api(h, 'GET', '/v1/admin/recording-settings', { token: ravi.accessToken })).status,
    ).toBe(403);
    const defaults = await api<RecordingSettings>(h, 'GET', '/v1/admin/recording-settings', {
      token: admin.accessToken,
    });
    expect(defaults.body).toEqual({ retentionDays: null, callRecordingEnabled: true });
    expect(
      (
        await api(h, 'PUT', '/v1/admin/recording-settings', {
          token: admin.accessToken,
          body: { retentionDays: 0, callRecordingEnabled: true },
        })
      ).status,
    ).toBe(400);

    const { attachment } = await clip(ravi, {
      fileName: 'Video message.webm',
      mimeType: 'video/webm',
      recording: 'video',
      durationMs: 3000,
    });
    // An ordinary file is never touched by the recording policy.
    const plain = await clip(ravi, { fileName: 'notes.txt', mimeType: 'text/plain' });

    await api(h, 'PUT', '/v1/admin/recording-settings', {
      token: admin.accessToken,
      body: { retentionDays: 30, callRecordingEnabled: true },
    });
    const listed = (await listOf(ravi)).items.find(
      (r) => r.recordingId === attachment!.attachmentId,
    )!;
    expect(Date.parse(listed.expiresAt!) - Date.parse(listed.createdAt)).toBe(30 * 86_400_000);
    expect(listed.canDelete).toBe(true);

    const svc = h.app.get(RecordingsService);
    expect(await svc.applyRetention(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    expect(await svc.applyRetention(new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThanOrEqual(
      1,
    );
    expect((await urlOf(ravi, attachment!.attachmentId)).status).toBe(404);
    expect((await urlOf(ravi, plain.attachment!.attachmentId)).status).toBe(200);
    await api(h, 'PUT', '/v1/admin/recording-settings', {
      token: admin.accessToken,
      body: { retentionDays: null, callRecordingEnabled: true },
    });
  });

  it('exports recordings as a ZIP with a manifest, through a signed link', async () => {
    const { attachment } = await clip(ravi, {
      fileName: 'Voice message.webm',
      mimeType: 'audio/webm',
      recording: 'voice',
      durationMs: 1500,
    });
    const range = {
      from: new Date(Date.now() - 3_600_000).toISOString(),
      to: new Date(Date.now() + 3_600_000).toISOString(),
    };
    expect(
      (
        await api(h, 'POST', '/v1/admin/recordings/export', {
          token: ravi.accessToken,
          body: range,
        })
      ).status,
    ).toBe(403);
    const ex = await api<ExportRecordingsResponse>(h, 'POST', '/v1/admin/recordings/export', {
      token: admin.accessToken,
      body: range,
    });
    expect(ex.status).toBe(200);
    expect(ex.body.count).toBeGreaterThanOrEqual(1);
    expect(
      (
        await fetch(
          h.url + ex.body.url.replace(/sig=./, (s) => (s.endsWith('x') ? 'sig=y' : 'sig=x')),
        )
      ).status,
    ).toBe(403);
    const res = await fetch(h.url + ex.body.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const zip = Buffer.from(await res.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const file = join(spool, 'export.zip');
    writeFileSync(file, zip);
    if (existsSync('/usr/bin/unzip')) {
      const listing = execFileSync('unzip', ['-l', file]).toString();
      expect(listing).toContain('Wave 3/');
      expect(listing).toContain('manifest.csv');
      execFileSync('unzip', ['-tq', file]); // CRCs check out
      const manifest = execFileSync('unzip', ['-p', file, 'manifest.csv']).toString();
      expect(manifest).toContain(attachment!.attachmentId);
      expect(manifest.split('\n')[0]).toContain('recorded_by');
    }
  });
});

describe('call recordings', () => {
  const startCall = async () =>
    (
      await api<CallJoinResponse>(h, 'POST', `/v1/conversations/${group.conversationId}/calls`, {
        token: owner.accessToken,
        body: { media: 'video' },
      })
    ).body.call;
  const post = (s: Session, path: string) => api<Call>(h, 'POST', path, { token: s.accessToken });

  it('records a call: everyone sees the indicator, and the file lands in the chat', async () => {
    const cfg = await api<CallsConfig>(h, 'GET', '/v1/calls/config', { token: ravi.accessToken });
    expect(cfg.body.recordingEnabled).toBe(true);
    const call = await startCall();
    // Not in the call yet: can't record it.
    expect((await post(ravi, `/v1/calls/${call.callId}/recording/start`)).status).toBe(403);
    await post(ravi, `/v1/calls/${call.callId}/join`);

    const indicator = nextEvent(raviSocket, 'call:updated', (c: Call) => !!c.recording);
    const started = await post(ravi, `/v1/calls/${call.callId}/recording/start`);
    expect(started.status).toBe(200);
    expect(started.body.recording).toMatchObject({
      status: 'starting',
      startedBy: ravi.user.userId,
    });
    expect((await indicator).recording?.startedBy).toBe(ravi.user.userId);
    const req = sfu.calls.find((c) => c.method === 'StartRoomCompositeEgress')!;
    expect(req.body).toMatchObject({ layout: 'speaker', audio_only: false });
    expect(String((req.body.file_outputs as { filepath: string }[])[0].filepath)).toMatch(
      new RegExp(`^${EGRESS_DIR}/.+-${call.callId}-\\d+\\.mp4$`),
    );
    // Starting again is a no-op.
    expect(
      (await post(owner, `/v1/calls/${call.callId}/recording/start`)).body.recording?.startedBy,
    ).toBe(ravi.user.userId);

    // Egress reports it is recording (signed webhook).
    const egressId = [...sfu.egress.keys()].at(-1)!;
    sfu.egress.get(egressId)!.status = 'EGRESS_ACTIVE';
    await h.app.get(CallsService).applySfuEvent({
      event: 'egress_started',
      egressInfo: { egressId, roomName: 'x', status: 'EGRESS_ACTIVE' },
    });
    expect(
      (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: mia.accessToken })).body
        .recording?.status,
    ).toBe('active');

    const posted = nextEvent(
      raviSocket,
      'message:new',
      (m: Message) => !!(m.metadata as { recording?: unknown }).recording,
    );
    const stopped = await post(owner, `/v1/calls/${call.callId}/recording/stop`);
    expect(stopped.body.recording?.status).toBe('stopping');
    // Egress finishes writing the file and sends egress_ended.
    sfu.egress.get(egressId)!.status = 'EGRESS_COMPLETE';
    await h.app.get(CallsService).applySfuEvent({
      event: 'egress_ended',
      egressInfo: sfu.info(egressId),
    });
    const msg = await posted;
    const meta = msg.metadata.recording as RecordingSystemMetadata;
    expect(meta).toMatchObject({
      callId: call.callId,
      startedBy: ravi.user.userId,
      durationMs: 65_000,
      audioOnly: false,
      failed: false,
    });
    expect(msg.attachments[0]).toMatchObject({
      recording: 'call',
      mimeType: 'video/mp4',
      durationMs: 65_000,
    });
    expect(msg.content.text).toBe('Call recording · 1m 05s');
    const url = (await urlOf(mia, meta.attachmentId!)).body.url;
    expect(Buffer.from(await (await fetch(h.url + url)).arrayBuffer()).toString()).toBe(
      'MP4-BYTES',
    );
    // The spool copy is removed once it is in storage.
    expect(
      existsSync(
        join(
          spool,
          String((req.body.file_outputs as { filepath: string }[])[0].filepath).replace(
            `${EGRESS_DIR}/`,
            '',
          ),
        ),
      ),
    ).toBe(false);
    // A duplicate egress_ended doesn't post twice.
    await h.app
      .get(CallsService)
      .applySfuEvent({ event: 'egress_ended', egressInfo: sfu.info(egressId) });
    const list = await listOf(mia, '?kind=call');
    expect(list.items.filter((r) => r.callId === call.callId)).toHaveLength(1);
    expect(
      (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: mia.accessToken })).body
        .recording,
    ).toBeNull();

    // Ending the call while recording stops it; the sweeper picks the file up without a webhook.
    await post(ravi, `/v1/calls/${call.callId}/recording/start`);
    const second = [...sfu.egress.keys()].at(-1)!;
    expect(second).not.toBe(egressId);
    await post(owner, `/v1/calls/${call.callId}/end`);
    expect(sfu.calls.some((c) => c.method === 'StopEgress' && c.body.egress_id === second)).toBe(
      true,
    );
    await h.app.get(CallsService).sweep(new Date(Date.now() + 120_000));
    expect(
      (await listOf(mia, '?kind=call')).items.filter((r) => r.callId === call.callId),
    ).toHaveLength(2);
  });

  it('reports a failed start, and honours the organization switch', async () => {
    const call = await startCall();
    sfu.failStart();
    const res = await post(owner, `/v1/calls/${call.callId}/recording/start`);
    expect(res.status).toBe(503);
    expect(
      (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken })).body
        .recording,
    ).toBeNull();

    await api(h, 'PUT', '/v1/admin/recording-settings', {
      token: owner.accessToken,
      body: { retentionDays: null, callRecordingEnabled: false },
    });
    expect(
      (await api<CallsConfig>(h, 'GET', '/v1/calls/config', { token: owner.accessToken })).body
        .recordingEnabled,
    ).toBe(false);
    expect((await post(owner, `/v1/calls/${call.callId}/recording/start`)).status).toBe(403);
    await post(owner, `/v1/calls/${call.callId}/end`);
  });

  it('rejects forged egress webhooks', async () => {
    const body = JSON.stringify({ event: 'egress_ended', egressInfo: { egressId: 'EG_1' } });
    const { createHash } = await import('node:crypto');
    const jwt = await new SignJWT({ sha256: createHash('sha256').update(body).digest('base64') })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(KEY)
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-secret!!'));
    const res = await fetch(`${h.url}/v1/calls/livekit/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization: jwt },
      body,
    });
    expect(res.status).toBe(401);
  });
});
