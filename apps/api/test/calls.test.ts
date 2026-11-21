import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';
import {
  type Call,
  type CallJoinResponse,
  type CallsConfig,
  type CallSystemMetadata,
  type Conversation,
  type Message,
  type Session,
} from '@sampledge/contracts';
import { CallsService } from '../src/calls/calls.service.js';
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

/**
 * A stand-in for LiveKit's RoomService (Twirp over HTTP). It checks every request carries a
 * token signed with the API secret, and lets the test decide who is "in" each room.
 */
function fakeSfu() {
  const rooms = new Map<string, Set<string>>();
  const calls: { method: string; body: Record<string, unknown> }[] = [];
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
      if (method === 'DeleteRoom') {
        rooms.delete(body.room);
        return res.end('{}');
      }
      res.end('{}');
    });
  });
  return { server, rooms, calls };
}

let h: Harness;
let off: Harness;
let sfu: ReturnType<typeof fakeSfu>;
let owner: Session;
let ravi: Session;
let mia: Session;
let outsider: Session;
let group: Conversation;
let dm: Conversation;
let raviSocket: ClientSocket;
let ownerSocket: ClientSocket;

const callOf = async (s: Session, conversationId: string, media: 'audio' | 'video' = 'video') =>
  api<CallJoinResponse>(h, 'POST', `/v1/conversations/${conversationId}/calls`, {
    token: s.accessToken,
    body: { media },
  });
const post = (s: Session, path: string) => api<Call>(h, 'POST', path, { token: s.accessToken });
const cardOf = async (s: Session, conversationId: string) => {
  const msgs = (
    await api<Message[]>(h, 'GET', `/v1/conversations/${conversationId}/messages`, {
      token: s.accessToken,
    })
  ).body;
  return msgs.filter((m) => m.messageType === 'system').at(-1)!;
};
const sweep = (now: Date) => h.app.get(CallsService).sweep(now);
const roomOf = (callId: string) => [...sfu.rooms.keys()].find((r) => r.endsWith(callId))!;

beforeAll(async () => {
  sfu = fakeSfu();
  await new Promise<void>((r) => sfu.server.listen(0, '127.0.0.1', r));
  const port = (sfu.server.address() as { port: number }).port;
  h = await startHarness({
    LIVEKIT_PUBLIC_URL: 'ws://rtc.example.test',
    LIVEKIT_API_URL: `http://127.0.0.1:${port}`,
    LIVEKIT_API_KEY: KEY,
    LIVEKIT_API_SECRET: SECRET,
  });
  off = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  outsider = await inviteAndLogin(h, owner, t.slug, 'Outside Person');
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
  raviSocket = await connect(h, ravi.accessToken);
  ownerSocket = await connect(h, owner.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  ownerSocket?.disconnect();
  await h.close();
  await off.close();
  sfu.server.close();
});

describe('calls', () => {
  it('reports calls as disabled, and refuses to start one, when no media server is configured', async () => {
    const t = await registerTenant(off);
    const cfg = await api<CallsConfig>(off, 'GET', '/v1/calls/config', {
      token: t.session.accessToken,
    });
    expect(cfg.body).toMatchObject({ enabled: false, provider: null });
    const conv = (
      await api<Conversation>(off, 'POST', '/v1/conversations', {
        token: t.session.accessToken,
        body: { kind: 'channel_public', name: 'general-calls' },
      })
    ).body;
    const res = await api<{ error: { code: string } }>(
      off,
      'POST',
      `/v1/conversations/${conv.conversationId}/calls`,
      { token: t.session.accessToken, body: { media: 'audio' } },
    );
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UNAVAILABLE');
  });

  it('starts a group call: SFU room, scoped join token, ringing for invitees, call card in chat', async () => {
    const ringing = nextEvent(raviSocket, 'call:ringing');
    const res = await callOf(owner, group.conversationId);
    expect(res.status).toBe(200);
    const { call, join } = res.body;
    expect(call).toMatchObject({
      conversationId: group.conversationId,
      media: 'video',
      status: 'live',
    });
    expect(call.participants.find((p) => p.userId === owner.user.userId)?.state).toBe('joined');
    expect(call.participants.find((p) => p.userId === ravi.user.userId)?.state).toBe('ringing');

    // The token is a LiveKit token for exactly this call's room, for this user.
    expect(join.url).toBe('ws://rtc.example.test');
    const { payload } = await jwtVerify(join.token, new TextEncoder().encode(SECRET), {
      issuer: KEY,
    });
    const room = roomOf(call.callId);
    expect(room).toContain(owner.tenant.tenantId);
    expect(payload.sub).toBe(owner.user.userId);
    expect(payload.video).toMatchObject({ room, roomJoin: true, canPublish: true });
    expect(sfu.calls.find((c) => c.method === 'CreateRoom')?.body.name).toBe(room);

    const e = await ringing;
    expect(e).toMatchObject({
      callerId: owner.user.userId,
      conversationId: group.conversationId,
      media: 'video',
    });
    expect(new Date(e.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const card = await cardOf(owner, group.conversationId);
    const meta = card.metadata.call as CallSystemMetadata;
    expect(card.senderId).toBe(owner.user.userId);
    expect(meta).toMatchObject({
      callId: call.callId,
      status: 'started',
      media: 'video',
      endedAt: null,
    });

    // A system card can't be edited by its "sender".
    const edit = await api(h, 'PATCH', `/v1/messages/${card.messageId}`, {
      token: owner.accessToken,
      body: { content: { text: 'hacked' } },
    });
    expect(edit.status).toBe(403);
  });

  it('starting again returns the live call; non-members cannot see or join it', async () => {
    const live = (
      await api<{ call: Call }>(
        h,
        'GET',
        `/v1/conversations/${group.conversationId}/calls/active`,
        {
          token: ravi.accessToken,
        },
      )
    ).body.call;
    const again = await callOf(ravi, group.conversationId, 'audio');
    expect(again.body.call.callId).toBe(live.callId);
    expect(again.body.call.media).toBe('video');
    expect(again.body.call.participants.find((p) => p.userId === ravi.user.userId)?.state).toBe(
      'joined',
    );

    expect((await callOf(outsider, group.conversationId)).status).toBe(404);
    expect((await post(outsider, `/v1/calls/${live.callId}/join`)).status).toBe(404);
    expect(
      (await api(h, 'GET', `/v1/calls/${live.callId}`, { token: outsider.accessToken })).status,
    ).toBe(404);

    const active = await api<Call[]>(h, 'GET', '/v1/calls/active', { token: mia.accessToken });
    expect(active.body.map((c) => c.callId)).toContain(live.callId);
  });

  it('keeps the call open while someone is in it, then ends it and updates the card', async () => {
    const live = (await callOf(owner, group.conversationId)).body.call;
    const declined = await post(mia, `/v1/calls/${live.callId}/decline`);
    expect(declined.body.participants.find((p) => p.userId === mia.user.userId)?.state).toBe(
      'declined',
    );

    const afterRavi = await post(ravi, `/v1/calls/${live.callId}/leave`);
    expect(afterRavi.body.status).toBe('live'); // owner is still there

    const ended = nextEvent(raviSocket, 'call:ended', (c) => c.callId === live.callId);
    const final = await post(owner, `/v1/calls/${live.callId}/leave`);
    expect(final.body.status).toBe('ended');
    expect((await ended).endedAt).not.toBeNull();

    const card = await cardOf(ravi, group.conversationId);
    const meta = card.metadata.call as CallSystemMetadata;
    expect(meta.status).toBe('ended');
    expect(meta.durationSec).toBeGreaterThanOrEqual(0);
    expect(new Set(meta.participantIds)).toEqual(new Set([owner.user.userId, ravi.user.userId]));
    expect(card.content.text).toMatch(/^Video call ended · /);
    expect(
      sfu.calls.some((c) => c.method === 'DeleteRoom' && c.body.room === roomOf(live.callId)) ||
        !sfu.rooms.has(`sc_${owner.tenant.tenantId}_${live.callId}`),
    ).toBe(true);

    // Joining an ended call is refused.
    expect((await post(mia, `/v1/calls/${live.callId}/join`)).status).toBe(409);
  });

  it('a declined 1:1 call ends straight away and says so', async () => {
    const { call } = (await callOf(owner, dm.conversationId, 'audio')).body;
    const res = await post(ravi, `/v1/calls/${call.callId}/decline`);
    expect(res.body.status).toBe('ended');
    const meta = (await cardOf(owner, dm.conversationId)).metadata.call as CallSystemMetadata;
    expect(meta.status).toBe('declined');
    expect((await cardOf(owner, dm.conversationId)).content.text).toBe('Voice call declined');
  });

  it('unanswered invites turn into a missed call when the ring times out', async () => {
    const { call } = (await callOf(owner, dm.conversationId, 'video')).body;
    sfu.rooms.get(roomOf(call.callId))!.add(owner.user.userId); // the caller is connected
    await sweep(new Date(Date.now() + 10_000));
    expect(
      (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken })).body
        .status,
    ).toBe('live');
    await sweep(new Date(Date.now() + 60_000));
    const after = (
      await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken })
    ).body;
    expect(after.status).toBe('ended');
    expect(after.participants.find((p) => p.userId === ravi.user.userId)?.state).toBe('missed');
    const card = await cardOf(ravi, dm.conversationId);
    expect((card.metadata.call as CallSystemMetadata).status).toBe('missed');
    expect(card.content.text).toBe('Missed video call');
  });

  it('closes a call whose people vanished from the SFU (closed tab, crashed phone)', async () => {
    const { call } = (await callOf(owner, group.conversationId)).body;
    await post(ravi, `/v1/calls/${call.callId}/join`);
    const room = roomOf(call.callId);
    sfu.rooms.get(room)!.add(ravi.user.userId); // only Ravi actually connected
    await sweep(new Date(Date.now() + 5_000)); // inside the connect grace period
    let now = (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken }))
      .body;
    expect(now.participants.find((p) => p.userId === owner.user.userId)?.state).toBe('joined');

    await sweep(new Date(Date.now() + 40_000));
    now = (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken }))
      .body;
    expect(now.participants.find((p) => p.userId === owner.user.userId)?.state).toBe('left');
    expect(now.status).toBe('live');

    sfu.rooms.get(room)!.clear();
    await sweep(new Date(Date.now() + 80_000));
    now = (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken }))
      .body;
    expect(now.status).toBe('ended');
  });

  it('accepts signed LiveKit webhooks and rejects forged ones', async () => {
    const { call } = (await callOf(owner, group.conversationId)).body;
    await post(ravi, `/v1/calls/${call.callId}/join`);
    const body = JSON.stringify({
      event: 'participant_left',
      room: { name: roomOf(call.callId) },
      participant: { identity: ravi.user.userId },
    });
    const sign = (secret: string) =>
      new SignJWT({ sha256: createHash('sha256').update(body).digest('base64') })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(KEY)
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(secret));
    const hook = async (auth: string) =>
      fetch(`${h.url}/v1/calls/livekit/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/webhook+json', authorization: auth },
        body,
      });
    expect((await hook(await sign('wrong-secret-wrong-secret-wrong-secret!!'))).status).toBe(401);
    expect((await hook(await sign(SECRET))).status).toBe(200);
    const now = (
      await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken })
    ).body;
    expect(now.participants.find((p) => p.userId === ravi.user.userId)?.state).toBe('left');
    await post(owner, `/v1/calls/${call.callId}/end`);
  });

  it('only the caller or a moderator can end a call for everyone', async () => {
    const { call } = (await callOf(owner, group.conversationId)).body;
    await post(ravi, `/v1/calls/${call.callId}/join`);
    expect((await post(ravi, `/v1/calls/${call.callId}/end`)).status).toBe(403);
    const res = await post(owner, `/v1/calls/${call.callId}/end`);
    expect(res.body.status).toBe('ended');
  });
});
