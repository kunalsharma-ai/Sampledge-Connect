import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt, jwtVerify } from 'jose';
import { SMTPServer } from 'smtp-server';
import { uuidv7 } from '@sampledge/contracts';
import type {
  Call,
  CallJoinResponse,
  CallsConfig,
  GuestChatResponse,
  Message,
  GuestJoinState,
  GuestLinkResponse,
  GuestMeetingView,
  Meeting,
  Session,
} from '@sampledge/contracts';
import { CallsService } from '../src/calls/calls.service.js';
import { GuestsService } from '../src/meetings/guests.service.js';
import { TranscriptsService } from '../src/ai/transcripts.service.js';
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

/** A real SMTP server in-process: every message the API sends lands in `inbox`. */
function smtpSink() {
  const inbox: { to: string[]; raw: string }[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString('utf8')));
      stream.on('end', () => {
        inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  return { server, inbox };
}

/** Undo quoted-printable and base64 parts so assertions can read the message. */
function readable(raw: string): string {
  const qp = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const b64 = [
    ...raw.matchAll(
      /Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/g,
    ),
  ]
    .map((m) => Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64').toString('utf8'))
    .join('\n');
  return `${Buffer.from(qp, 'latin1').toString('utf8')}\n${b64}`;
}

/** Minimal LiveKit RoomService stand-in. */
function fakeSfu() {
  const rooms = new Map<string, Set<string>>();
  const removed: string[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const method = req.url!.split('/').pop()!;
      try {
        const auth = (req.headers.authorization ?? '').replace('Bearer ', '');
        await jwtVerify(auth, new TextEncoder().encode(SECRET), { issuer: KEY });
      } catch {
        res.writeHead(401).end('{}');
        return;
      }
      const body = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      if (method === 'CreateRoom') {
        rooms.set(body.name, new Set());
        return res.end(JSON.stringify({ name: body.name }));
      }
      if (method === 'ListParticipants')
        return res.end(
          JSON.stringify({
            participants: [...(rooms.get(body.room) ?? [])].map((identity) => ({ identity })),
          }),
        );
      if (method === 'RemoveParticipant') {
        removed.push(body.identity);
        rooms.get(body.room)?.delete(body.identity);
      }
      if (method === 'DeleteRoom') rooms.delete(body.room);
      res.end('{}');
    });
  });
  return { server, rooms, removed };
}

let h: Harness;
let bare: Harness;
let smtp: ReturnType<typeof smtpSink>;
let sfu: ReturnType<typeof fakeSfu>;
let owner: Session;
let ravi: Session;
let mia: Session;
let slug: string;
let raviSocket: ClientSocket;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const flush = (x: Harness = h) => x.app.get(GuestsService).flush();
const tokenFrom = (raw: string) =>
  /\/join\/([0-9a-f]{24}\.[A-Za-z0-9_-]{32})/.exec(readable(raw))![1]!;
const mailTo = (email: string) => smtp.inbox.filter((m) => m.to.includes(email));
const guestGet = <T>(token: string, path = '') => api<T>(h, 'GET', `/v1/guest/${token}${path}`);
const guestPost = <T>(token: string, path: string, body?: unknown) =>
  api<T>(h, 'POST', `/v1/guest/${token}${path}`, { body });
const getMeeting = async (id: string, s = owner) =>
  (await api<Meeting>(h, 'GET', `/v1/meetings/${id}`, { token: s.accessToken })).body;

beforeAll(async () => {
  smtp = smtpSink();
  await new Promise<void>((r) => smtp.server.listen(0, '127.0.0.1', r));
  sfu = fakeSfu();
  await new Promise<void>((r) => sfu.server.listen(0, '127.0.0.1', r));
  h = await startHarness({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String((smtp.server.server.address() as AddressInfo).port),
    SMTP_FROM: 'Acme Meetings <meetings@acme.test>',
    PUBLIC_WEB_URL: 'https://connect.acme.test',
    FILES_URL_SECRET: 'x'.repeat(40),
    LIVEKIT_PUBLIC_URL: 'ws://rtc.example.test',
    LIVEKIT_API_URL: `http://127.0.0.1:${(sfu.server.address() as AddressInfo).port}`,
    LIVEKIT_API_KEY: KEY,
    LIVEKIT_API_SECRET: SECRET,
  });
  const t = await registerTenant(h);
  slug = t.slug;
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, slug, 'Mia Chen');
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h?.close();
  await bare?.close();
  await new Promise((r) => smtp.server.close(() => r(undefined)));
  sfu.server.close();
});

describe('external guest invites', () => {
  let meeting: Meeting;
  let annaToken: string;

  it('emails each guest an invite with a calendar file and a personal join link', async () => {
    const res = await api<Meeting>(h, 'POST', '/v1/meetings', {
      token: owner.accessToken,
      body: {
        title: 'Fieldwork kickoff, client side',
        agenda: 'Timelines; quotas, and sample sources',
        startsAt: inMinutes(24 * 60),
        endsAt: inMinutes(24 * 60 + 45),
        timeZone: 'Asia/Kolkata',
        attendeeIds: [ravi.user.userId],
        guests: [
          { email: 'Anna@Client.example', name: 'Anna Schmidt' },
          { email: 'bo@client.example' },
          { email: 'anna@client.example' }, // duplicate, ignored
        ],
      },
    });
    expect(res.status).toBe(201);
    meeting = res.body;
    expect(meeting.guests!.map((g) => [g.email, g.name, g.response, g.invite.status])).toEqual([
      ['anna@client.example', 'Anna Schmidt', 'pending', 'sending'],
      ['bo@client.example', 'bo', 'pending', 'sending'],
    ]);
    await flush();
    const fresh = await getMeeting(meeting.meetingId);
    expect(fresh.guests!.map((g) => g.invite.status)).toEqual(['sent', 'sent']);

    const [mail] = mailTo('anna@client.example');
    expect(mail).toBeTruthy();
    const text = readable(mail!.raw);
    expect(text).toContain('Subject: Invitation: Fieldwork kickoff, client side');
    expect(text).toMatch(/Content-Type: text\/calendar; ?charset=utf-8; ?method=REQUEST/i);
    expect(text).toContain('METHOD:REQUEST');
    expect(text).toContain(`UID:${meeting.meetingId}@sampledge-connect`);
    expect(text).toContain('SEQUENCE:0');
    expect(text).toContain('SUMMARY:Fieldwork kickoff\\, client side');
    expect(text).toMatch(/ATTENDEE;CN="Anna Schmidt".*:mailto:anna@client\.example/);
    expect(text).toContain('Priya Owner from Acme Research invited you');
    expect(text).toContain('(Asia/Kolkata)');
    annaToken = tokenFrom(mail!.raw);
    expect(readable(mail!.raw)).toContain(`https://connect.acme.test/join/${annaToken}`);
    // Each guest gets their own link.
    expect(tokenFrom(mailTo('bo@client.example')[0]!.raw)).not.toBe(annaToken);
  });

  it("refuses people from the organization as guests (they're attendees)", async () => {
    const res = await api(h, 'POST', '/v1/meetings', {
      token: owner.accessToken,
      body: {
        title: 'x',
        startsAt: inMinutes(60),
        endsAt: inMinutes(90),
        guests: [{ email: `mia.chen@${slug}.test` }],
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Add them as attendees instead');
  });

  it('lets the guest open the link, RSVP and download the invite; bad links are 404', async () => {
    const view = await guestGet<GuestMeetingView>(annaToken);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      title: 'Fieldwork kickoff, client side',
      organizerName: 'Priya Owner',
      organizationName: 'Acme Research',
      status: 'scheduled',
      guest: { name: 'Anna Schmidt', email: 'anna@client.example', response: 'pending' },
    });
    // Nothing about other attendees leaks to the guest page.
    expect(JSON.stringify(view.body)).not.toContain(ravi.user.userId);
    expect(JSON.stringify(view.body)).not.toContain('bo@client.example');

    const forged = annaToken.slice(0, -1) + (annaToken.endsWith('A') ? 'B' : 'A');
    expect((await guestGet(forged)).status).toBe(404);
    expect((await guestGet('nonsense')).status).toBe(404);

    const upsert = nextEvent(
      raviSocket,
      'meeting:upsert',
      (m) => m.meetingId === meeting.meetingId,
    );
    const rsvp = await guestPost<GuestMeetingView>(annaToken, '/rsvp', { response: 'accepted' });
    expect(rsvp.status).toBe(200);
    expect(rsvp.body.guest.response).toBe('accepted');
    expect((await upsert).guests!.find((g) => g.email === 'anna@client.example')!.response).toBe(
      'accepted',
    );

    const ics = await fetch(`${h.url}/v1/guest/${annaToken}/calendar.ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    const body = await ics.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body.replace(/\r\n /g, '')).toContain(`URL:https://connect.acme.test/join/${annaToken}`);
    expect(body.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it('sends updates with a higher SEQUENCE, and a cancellation to a removed guest', async () => {
    smtp.inbox.length = 0;
    const bo = meeting.guests!.find((g) => g.email === 'bo@client.example')!;
    const boToken = (
      await api<GuestLinkResponse>(
        h,
        'GET',
        `/v1/meetings/${meeting.meetingId}/guests/${bo.guestId}/link`,
        { token: owner.accessToken },
      )
    ).body.url.split('/join/')[1]!;
    // Only the organizer can see guests' links.
    expect(
      (
        await api(h, 'GET', `/v1/meetings/${meeting.meetingId}/guests/${bo.guestId}/link`, {
          token: ravi.accessToken,
        })
      ).status,
    ).toBe(403);

    const res = await api<Meeting>(h, 'PATCH', `/v1/meetings/${meeting.meetingId}`, {
      token: owner.accessToken,
      body: {
        startsAt: inMinutes(48 * 60),
        endsAt: inMinutes(48 * 60 + 30),
        removeGuestIds: [bo.guestId],
        addGuests: [{ email: 'chen@vendor.example', name: 'Chen Li' }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.guests!.map((g) => [g.email, g.response])).toEqual([
      ['anna@client.example', 'pending'], // moved: RSVP resets
      ['chen@vendor.example', 'pending'],
    ]);
    await flush();
    const anna = readable(mailTo('anna@client.example')[0]!.raw);
    expect(anna).toContain('Subject: Updated invitation: Fieldwork kickoff');
    expect(anna).toContain('SEQUENCE:1');
    expect(anna).toContain('METHOD:REQUEST');
    const boMail = readable(mailTo('bo@client.example')[0]!.raw);
    expect(boMail).toContain('Subject: Cancelled: Fieldwork kickoff');
    expect(boMail).toContain('METHOD:CANCEL');
    expect(boMail).toContain('STATUS:CANCELLED');
    expect(readable(mailTo('chen@vendor.example')[0]!.raw)).toContain('Subject: Invitation:');
    // Bo's link is dead; Anna's still works.
    expect((await guestGet(boToken)).status).toBe(404);
    expect((await guestGet(annaToken)).status).toBe(200);
  });

  it('keeps a guest out until the meeting window opens', async () => {
    const s = await guestGet<GuestJoinState>(annaToken, '/lobby');
    expect(s.body).toMatchObject({ state: 'too_early', join: null });
  });

  it('cancelling emails every guest and closes their links to joining', async () => {
    smtp.inbox.length = 0;
    await api(h, 'POST', `/v1/meetings/${meeting.meetingId}/cancel`, { token: owner.accessToken });
    await flush();
    const mail = readable(mailTo('anna@client.example')[0]!.raw);
    expect(mail).toContain('METHOD:CANCEL');
    expect(mail).toContain('SEQUENCE:2');
    expect((await guestGet<GuestMeetingView>(annaToken)).body.status).toBe('cancelled');
    expect((await guestGet<GuestJoinState>(annaToken, '/lobby')).body.state).toBe('cancelled');
  });
});

describe('the lobby', () => {
  let meeting: Meeting;
  let tokens: Record<string, string>;
  let call: Call;

  it('waits for the call to start, then holds the guest in the lobby', async () => {
    smtp.inbox.length = 0;
    meeting = (
      await api<Meeting>(h, 'POST', '/v1/meetings', {
        token: owner.accessToken,
        body: {
          title: 'Client debrief',
          startsAt: inMinutes(-5),
          endsAt: inMinutes(40),
          attendeeIds: [ravi.user.userId, mia.user.userId],
          guests: [
            { email: 'dana@client.example', name: 'Dana' },
            { email: 'eli@client.example', name: 'Eli' },
          ],
        },
      })
    ).body;
    await api(h, 'POST', `/v1/conversations/${meeting.conversationId}/messages`, {
      token: owner.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'Internal: their budget is tight' } },
    });
    await flush();
    tokens = {
      dana: tokenFrom(mailTo('dana@client.example')[0]!.raw),
      eli: tokenFrom(mailTo('eli@client.example')[0]!.raw),
    };
    expect((await guestGet<GuestJoinState>(tokens.dana!, '/lobby')).body.state).toBe('not_started');
    // Pressing Join before anyone starts the call doesn't create a lobby entry yet.
    expect(
      (await guestPost<GuestJoinState>(tokens.dana!, '/lobby', { name: 'Dana K' })).body.state,
    ).toBe('not_started');

    const started = await api<CallJoinResponse>(
      h,
      'POST',
      `/v1/conversations/${meeting.conversationId}/calls`,
      { token: owner.accessToken, body: { media: 'video' } },
    );
    call = started.body.call;
    expect((await guestGet<GuestJoinState>(tokens.dana!, '/lobby')).body.state).toBe('ready');

    const updated = nextEvent(raviSocket, 'call:updated', (c) => (c.lobby?.length ?? 0) > 0);
    const asked = await guestPost<GuestJoinState>(tokens.dana!, '/lobby', { name: 'Dana K' });
    expect(asked.body).toMatchObject({ state: 'waiting', callId: call.callId, join: null });
    const seen = await updated;
    expect(seen.lobby).toEqual([
      expect.objectContaining({ name: 'Dana K', email: 'dana@client.example' }),
    ]);
    await guestPost(tokens.eli!, '/lobby', { name: 'Eli' });
  });

  it('only people in the call can admit, and admitted guests get an SFU token', async () => {
    const danaId = meeting.guests!.find((g) => g.email === 'dana@client.example')!.guestId;
    const eliId = meeting.guests!.find((g) => g.email === 'eli@client.example')!.guestId;
    // Ravi is invited (ringing) but hasn't joined.
    const notIn = await api(h, 'POST', `/v1/calls/${call.callId}/lobby/${danaId}/admit`, {
      token: ravi.accessToken,
    });
    expect(notIn.status).toBe(403);

    const admit = await api<Call>(h, 'POST', `/v1/calls/${call.callId}/lobby/${danaId}/admit`, {
      token: owner.accessToken,
    });
    expect(admit.status).toBe(200);
    expect(admit.body.lobby!.map((l) => l.name)).toEqual(['Eli']);
    expect(admit.body.guests).toEqual([
      expect.objectContaining({ guestId: danaId, state: 'admitted', decidedBy: owner.user.userId }),
    ]);
    const deny = await api<Call>(h, 'POST', `/v1/calls/${call.callId}/lobby/${eliId}/deny`, {
      token: owner.accessToken,
    });
    expect(deny.body.lobby).toEqual([]);

    const dana = await guestGet<GuestJoinState>(tokens.dana!, '/lobby');
    expect(dana.body.state).toBe('admitted');
    expect(dana.body.join!.url).toBe('ws://rtc.example.test');
    const claims = decodeJwt(dana.body.join!.token);
    expect(claims.sub).toBe(`guest:${danaId}`);
    expect(claims.name).toBe('Dana K (guest)');
    expect((claims.video as { room: string }).room).toContain(call.callId);
    expect((await guestGet<GuestJoinState>(tokens.eli!, '/lobby')).body).toMatchObject({
      state: 'denied',
      join: null,
    });

    // Meeting chat: Dana sees only messages from this call, and can write; Eli can't.
    const say = (text: string) =>
      api(h, 'POST', `/v1/conversations/${meeting.conversationId}/messages`, {
        token: owner.accessToken,
        body: { clientMessageId: uuidv7(), content: { text } },
      });
    await say('Welcome Dana, slides are in the chat');
    let chat = await guestGet<GuestChatResponse>(tokens.dana!, '/chat');
    expect(chat.status).toBe(200);
    expect(chat.body.messages.map((m) => [m.senderName, m.text, m.fromGuest, m.mine])).toEqual([
      ['Priya Owner', 'Welcome Dana, slides are in the chat', false, false],
    ]);
    const sent = await guestPost<GuestChatResponse>(tokens.dana!, '/chat', {
      text: 'Thanks, I can see you',
    });
    expect(sent.body.messages.at(-1)).toMatchObject({
      senderName: 'Dana K',
      fromGuest: true,
      mine: true,
    });
    const history = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${meeting.conversationId}/messages`, {
        token: ravi.accessToken,
      })
    ).body;
    const fromDana = history.find((m) => m.content.text === 'Thanks, I can see you')!;
    expect(fromDana.senderId).toBe(`guest:${danaId}`);
    expect(fromDana.metadata).toMatchObject({ guest: { guestId: danaId, name: 'Dana K' } });
    expect((await guestGet(tokens.eli!, '/chat')).status).toBe(403);
    expect((await guestPost(tokens.eli!, '/chat', { text: 'let me in' })).status).toBe(403);
    expect((await guestPost(tokens.dana!, '/chat', { text: '' })).status).toBe(400);

    // Live captions: off until the organization has a speech-to-text server.
    const clip = (path: string, opts: { token?: string; type?: string } = {}) =>
      fetch(h.url + path, {
        method: 'POST',
        headers: {
          'content-type': opts.type ?? 'audio/webm;codecs=opus',
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
        body: new Uint8Array(Buffer.from('fake opus audio')),
      });
    const cfgOf = async () =>
      (await api<CallsConfig>(h, 'GET', '/v1/calls/config', { token: owner.accessToken })).body;
    expect((await cfgOf()).captionsEnabled).toBe(false);
    expect(
      (await clip(`/v1/calls/${call.callId}/captions`, { token: owner.accessToken })).status,
    ).toBe(503);
    const transcripts = h.app.get(TranscriptsService);
    const clips: string[] = [];
    transcripts.fetchImpl = (async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get('file') as File;
      clips.push(`${file.name} ${file.type}`);
      return new Response(JSON.stringify({ text: ' Quotas look good. ', segments: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const stt = await api(h, 'PUT', '/v1/admin/integrations/ai.transcription', {
      token: owner.accessToken,
      body: { enabled: true, values: { baseUrl: 'http://stt.acme.test', model: 'whisper-small' } },
    });
    expect(stt.status).toBe(200);
    expect((await cfgOf()).captionsEnabled).toBe(true);
    expect((await guestGet<GuestJoinState>(tokens.dana!, '/lobby')).body.captions).toBe(true);
    const mine = await clip(`/v1/calls/${call.callId}/captions`, { token: owner.accessToken });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ text: 'Quotas look good.' });
    const hers = await clip(`/v1/guest/${tokens.dana!}/captions`, { type: 'audio/mp4' });
    expect(await hers.json()).toEqual({ text: 'Quotas look good.' });
    expect(clips).toEqual(['clip.webm audio/webm', 'clip.m4a audio/mp4']);
    // Not in the call, not audio, or a denied guest: refused.
    expect(
      (await clip(`/v1/calls/${call.callId}/captions`, { token: mia.accessToken })).status,
    ).toBe(403);
    expect(
      (
        await clip(`/v1/calls/${call.callId}/captions`, {
          token: owner.accessToken,
          type: 'text/plain',
        })
      ).status,
    ).toBe(400);
    expect((await clip(`/v1/guest/${tokens.eli!}/captions`)).status).toBe(403);
    await api(h, 'PUT', '/v1/admin/integrations/ai.transcription', {
      token: owner.accessToken,
      body: { enabled: false, values: {} },
    });

    // The SFU reports Dana connecting: she shows as joined, and keeps the call alive.
    const calls = h.app.get(CallsService);
    const room = `sc_${owner.tenant.tenantId}_${call.callId}`;
    await calls.applySfuEvent({
      event: 'participant_joined',
      room: { name: room },
      participant: { identity: `guest:${danaId}` },
    });
    let now = (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: owner.accessToken }))
      .body;
    expect(now.guests!.find((g) => g.guestId === danaId)!.state).toBe('joined');
    expect(now.participants.some((p) => p.userId.startsWith('guest:'))).toBe(false);

    await api(h, 'POST', `/v1/calls/${call.callId}/leave`, { token: owner.accessToken });
    now = (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: ravi.accessToken })).body;
    expect(now.status).toBe('live'); // the guest is still in it

    await calls.applySfuEvent({
      event: 'participant_left',
      room: { name: room },
      participant: { identity: `guest:${danaId}` },
    });
    now = (await api<Call>(h, 'GET', `/v1/calls/${call.callId}`, { token: ravi.accessToken })).body;
    expect(now.status).toBe('ended');
  });

  it('removing a guest during the call drops them from it', async () => {
    const m = (
      await api<Meeting>(h, 'POST', '/v1/meetings', {
        token: owner.accessToken,
        body: {
          title: 'Short sync',
          startsAt: inMinutes(-1),
          endsAt: inMinutes(30),
          attendeeIds: [ravi.user.userId],
          guests: [{ email: 'fay@client.example', name: 'Fay' }],
        },
      })
    ).body;
    await flush();
    const token = tokenFrom(mailTo('fay@client.example').at(-1)!.raw);
    const c = (
      await api<CallJoinResponse>(h, 'POST', `/v1/conversations/${m.conversationId}/calls`, {
        token: owner.accessToken,
        body: { media: 'audio' },
      })
    ).body.call;
    await guestPost(token, '/lobby', { name: 'Fay' });
    const fay = m.guests![0]!.guestId;
    await api(h, 'POST', `/v1/calls/${c.callId}/lobby/${fay}/admit`, { token: owner.accessToken });
    await api(h, 'PATCH', `/v1/meetings/${m.meetingId}`, {
      token: owner.accessToken,
      body: { removeGuestIds: [fay] },
    });
    expect(sfu.removed).toContain(`guest:${fay}`);
    const now = (await api<Call>(h, 'GET', `/v1/calls/${c.callId}`, { token: owner.accessToken }))
      .body;
    expect(now.guests![0]!.state).toBe('denied');
    expect((await guestGet(token, '/lobby')).status).toBe(404);
  });

  it('drops guests who stop polling from the lobby', async () => {
    const m = (
      await api<Meeting>(h, 'POST', '/v1/meetings', {
        token: owner.accessToken,
        body: {
          title: 'Lobby timeout',
          startsAt: inMinutes(-1),
          endsAt: inMinutes(30),
          attendeeIds: [mia.user.userId],
          guests: [{ email: 'gus@client.example', name: 'Gus' }],
        },
      })
    ).body;
    await flush();
    const token = tokenFrom(mailTo('gus@client.example').at(-1)!.raw);
    const c = (
      await api<CallJoinResponse>(h, 'POST', `/v1/conversations/${m.conversationId}/calls`, {
        token: owner.accessToken,
        body: { media: 'audio' },
      })
    ).body.call;
    await guestPost(token, '/lobby', { name: 'Gus' });
    const room = `sc_${owner.tenant.tenantId}_${c.callId}`;
    sfu.rooms.get(room)!.add(owner.user.userId);
    await h.app.get(CallsService).sweep(new Date(Date.now() + 31_000));
    const now = (await api<Call>(h, 'GET', `/v1/calls/${c.callId}`, { token: owner.accessToken }))
      .body;
    expect(now.lobby).toEqual([]);
  });
});

describe('without SMTP configured', () => {
  it('records guests as not emailed and lets the organizer copy their link', async () => {
    bare = await startHarness();
    const t = await registerTenant(bare);
    const res = await api<Meeting>(bare, 'POST', '/v1/meetings', {
      token: t.session.accessToken,
      body: {
        title: 'No mail here',
        startsAt: inMinutes(60),
        endsAt: inMinutes(90),
        guests: [{ email: 'solo@client.example' }],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.guests![0]!.invite.status).toBe('not_configured');
    await flush(bare);
    const g = res.body.guests![0]!;
    const resend = await api(
      bare,
      'POST',
      `/v1/meetings/${res.body.meetingId}/guests/${g.guestId}/resend`,
      { token: t.session.accessToken },
    );
    expect(resend.status).toBe(503);
    const link = await api<GuestLinkResponse>(
      bare,
      'GET',
      `/v1/meetings/${res.body.meetingId}/guests/${g.guestId}/link`,
      { token: t.session.accessToken },
    );
    expect(link.body.url).toMatch(/^http:\/\/localhost:3000\/join\/[0-9a-f]{24}\./);
    const view = await api<GuestMeetingView>(
      bare,
      'GET',
      `/v1/guest/${link.body.url.split('/join/')[1]}`,
    );
    expect(view.body.title).toBe('No mail here');
  });

  it('uses email and call servers saved in Integrations, with no restart and no env', async () => {
    const t = await registerTenant(bare);
    const token = t.session.accessToken;
    const cfg = async () =>
      (await api<CallsConfig>(bare, 'GET', '/v1/calls/config', { token })).body;
    expect((await cfg()).enabled).toBe(false);
    const saveSmtp = await api(bare, 'PUT', '/v1/admin/integrations/smtp', {
      token,
      body: {
        enabled: true,
        values: {
          host: '127.0.0.1',
          port: (smtp.server.server.address() as AddressInfo).port,
          security: 'none',
          from: 'Northwind <meet@northwind.test>',
        },
      },
    });
    expect(saveSmtp.status).toBe(200);
    const saveLk = await api(bare, 'PUT', '/v1/admin/integrations/livekit', {
      token,
      body: {
        enabled: true,
        values: {
          publicUrl: 'ws://rtc.northwind.test',
          apiUrl: `http://127.0.0.1:${(sfu.server.address() as AddressInfo).port}`,
          apiKey: KEY,
          apiSecret: SECRET,
        },
      },
    });
    expect(saveLk.status).toBe(200);
    // The organization's own server: calls work, recording stays off (it needs the shared spool).
    expect(await cfg()).toMatchObject({
      enabled: true,
      provider: 'livekit',
      recordingEnabled: false,
    });

    const before = smtp.inbox.length;
    const res = await api<Meeting>(bare, 'POST', '/v1/meetings', {
      token,
      body: {
        title: 'Mail from the database',
        startsAt: inMinutes(60),
        endsAt: inMinutes(90),
        guests: [{ email: 'db@client.example', name: 'Dee' }],
      },
    });
    expect(res.body.guests![0]!.invite.status).toBe('sending');
    await flush(bare);
    const got = smtp.inbox.slice(before).find((m) => m.to.includes('db@client.example'));
    expect(got?.raw).toMatch(/From: Northwind <meet@northwind\.test>/);

    // Another organization on the same server still has neither.
    const other = await registerTenant(bare, 'Other Co');
    const otherCfg = await api<CallsConfig>(bare, 'GET', '/v1/calls/config', {
      token: other.session.accessToken,
    });
    expect(otherCfg.body.enabled).toBe(false);

    // Turning it off applies at once.
    await api(bare, 'PUT', '/v1/admin/integrations/livekit', {
      token,
      body: { enabled: false, values: {} },
    });
    expect((await cfg()).enabled).toBe(false);
  });
});
