import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Conversation,
  FindTimesResponse,
  Meeting,
  MeetingSystemMetadata,
  Message,
  Session,
  WorkingHours,
} from '@sampledge/contracts';
import { MeetingsService } from '../src/meetings/meetings.service.js';
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

let h: Harness;
let owner: Session;
let ravi: Session;
let mia: Session;
let outsider: Session;
let raviSocket: ClientSocket;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const create = (s: Session, body: Record<string, unknown>) =>
  api<Meeting>(h, 'POST', '/v1/meetings', { token: s.accessToken, body });
const lastCard = async (s: Session, conversationId: string) =>
  (
    await api<Message[]>(h, 'GET', `/v1/conversations/${conversationId}/messages`, {
      token: s.accessToken,
    })
  ).body
    .filter((m) => m.messageType === 'system')
    .at(-1)!;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  outsider = await inviteAndLogin(h, owner, t.slug, 'Outside Person');
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h.close();
});

describe('meetings', () => {
  it('schedules a meeting in a new meeting chat, invites people and posts a card', async () => {
    const invited = nextEvent(raviSocket, 'meeting:upsert');
    const res = await create(owner, {
      title: 'Wave 3 quota review',
      agenda: 'Walk through Germany and the 18-24 cell',
      startsAt: inMinutes(60),
      endsAt: inMinutes(90),
      timeZone: 'Europe/Berlin',
      attendeeIds: [ravi.user.userId],
      optionalAttendeeIds: [mia.user.userId],
    });
    expect(res.status).toBe(201);
    const m = res.body;
    expect(m.attendees).toEqual([
      { userId: owner.user.userId, response: 'accepted', optional: false },
      { userId: ravi.user.userId, response: 'pending', optional: false },
      { userId: mia.user.userId, response: 'pending', optional: true },
    ]);
    expect((await invited).meetingId).toBe(m.meetingId);

    const conv = (
      await api<Conversation>(h, 'GET', `/v1/conversations/${m.conversationId}`, {
        token: ravi.accessToken,
      })
    ).body;
    expect(conv.kind).toBe('group');
    expect(conv.name).toBe('Wave 3 quota review');
    const card = await lastCard(ravi, m.conversationId);
    expect(card.metadata.meeting as MeetingSystemMetadata).toMatchObject({
      meetingId: m.meetingId,
      status: 'scheduled',
    });
  });

  it('uses a DM for a one-to-one meeting, and can hold a meeting in an existing chat', async () => {
    const one = (
      await create(owner, {
        title: '1:1',
        startsAt: inMinutes(120),
        endsAt: inMinutes(150),
        attendeeIds: [mia.user.userId],
      })
    ).body;
    const dm = (
      await api<Conversation>(h, 'GET', `/v1/conversations/${one.conversationId}`, {
        token: mia.accessToken,
      })
    ).body;
    expect(dm.kind).toBe('dm');

    const group = (
      await api<Conversation>(h, 'POST', '/v1/conversations', {
        token: owner.accessToken,
        body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
      })
    ).body;
    const inChat = (
      await create(owner, {
        title: 'Bid review',
        startsAt: inMinutes(200),
        endsAt: inMinutes(230),
        conversationId: group.conversationId,
      })
    ).body;
    expect(inChat.conversationId).toBe(group.conversationId);
    expect(inChat.attendees.map((a) => a.userId).sort()).toEqual(
      [owner.user.userId, ravi.user.userId, mia.user.userId].sort(),
    );
  });

  it('rejects bad times and empty invite lists', async () => {
    expect(
      (
        await create(owner, {
          title: 'x',
          startsAt: inMinutes(60),
          endsAt: inMinutes(30),
          attendeeIds: [ravi.user.userId],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await create(owner, {
          title: 'x',
          startsAt: inMinutes(-90),
          endsAt: inMinutes(-60),
          attendeeIds: [ravi.user.userId],
        })
      ).status,
    ).toBe(400);
    expect(
      (await create(owner, { title: 'x', startsAt: inMinutes(60), endsAt: inMinutes(90) })).status,
    ).toBe(400);
  });

  it('lists only my meetings, RSVPs, and lets only the organizer change or cancel', async () => {
    const m = (
      await create(owner, {
        title: 'Weighting walkthrough',
        startsAt: inMinutes(300),
        endsAt: inMinutes(345),
        attendeeIds: [ravi.user.userId, mia.user.userId],
      })
    ).body;
    const range = `from=${encodeURIComponent(inMinutes(0))}&to=${encodeURIComponent(inMinutes(24 * 60))}`;
    const mine = (
      await api<Meeting[]>(h, 'GET', `/v1/meetings?${range}`, { token: ravi.accessToken })
    ).body;
    expect(mine.map((x) => x.meetingId)).toContain(m.meetingId);
    const theirs = (
      await api<Meeting[]>(h, 'GET', `/v1/meetings?${range}`, { token: outsider.accessToken })
    ).body;
    expect(theirs).toEqual([]);
    expect(
      (await api(h, 'GET', `/v1/meetings/${m.meetingId}`, { token: outsider.accessToken })).status,
    ).toBe(404);

    const rsvp = await api<Meeting>(h, 'POST', `/v1/meetings/${m.meetingId}/rsvp`, {
      token: ravi.accessToken,
      body: { response: 'accepted' },
    });
    expect(rsvp.body.attendees.find((a) => a.userId === ravi.user.userId)?.response).toBe(
      'accepted',
    );

    expect(
      (
        await api(h, 'PATCH', `/v1/meetings/${m.meetingId}`, {
          token: ravi.accessToken,
          body: { title: 'mine now' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await api(h, 'POST', `/v1/meetings/${m.meetingId}/cancel`, { token: ravi.accessToken }))
        .status,
    ).toBe(403);

    // Moving the meeting resets RSVPs and updates the card.
    const moved = await api<Meeting>(h, 'PATCH', `/v1/meetings/${m.meetingId}`, {
      token: owner.accessToken,
      body: { startsAt: inMinutes(330), endsAt: inMinutes(375) },
    });
    expect(moved.body.attendees.find((a) => a.userId === ravi.user.userId)?.response).toBe(
      'pending',
    );
    expect(
      (await lastCard(ravi, m.conversationId)).metadata.meeting as MeetingSystemMetadata,
    ).toMatchObject({
      status: 'updated',
      startsAt: moved.body.startsAt,
    });

    const cancelled = await api<Meeting>(h, 'POST', `/v1/meetings/${m.meetingId}/cancel`, {
      token: owner.accessToken,
    });
    expect(cancelled.body.status).toBe('cancelled');
    const after = (
      await api<Meeting[]>(h, 'GET', `/v1/meetings?${range}`, { token: ravi.accessToken })
    ).body;
    expect(after.map((x) => x.meetingId)).not.toContain(m.meetingId);
    expect(
      ((await lastCard(ravi, m.conversationId)).metadata.meeting as MeetingSystemMetadata).status,
    ).toBe('cancelled');
  });

  it('finds times inside everyone’s working hours (own time zones) and around busy meetings', async () => {
    // Monday 1 March 2027. Owner works 09:00–17:30 UTC; Ravi 09:00–17:30 in Kolkata (03:30–12:00 UTC).
    await api<WorkingHours>(h, 'PUT', '/v1/me/working-hours', {
      token: owner.accessToken,
      body: {
        timeZone: 'UTC',
        days: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:30' })),
      },
    });
    const set = await api<WorkingHours>(h, 'PUT', '/v1/me/working-hours', {
      token: ravi.accessToken,
      body: {
        timeZone: 'Asia/Kolkata',
        days: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:30' })),
      },
    });
    expect(set.status).toBe(200);
    expect(
      (await api<WorkingHours>(h, 'GET', '/v1/me/working-hours', { token: ravi.accessToken })).body
        .timeZone,
    ).toBe('Asia/Kolkata');
    // The owner is busy 10:00–11:00 UTC.
    await create(owner, {
      title: 'Client check-in',
      startsAt: '2027-03-01T10:00:00.000Z',
      endsAt: '2027-03-01T11:00:00.000Z',
      attendeeIds: [mia.user.userId],
    });
    const res = await api<FindTimesResponse>(h, 'POST', '/v1/meetings/find-times', {
      token: owner.accessToken,
      body: {
        attendeeIds: [ravi.user.userId],
        durationMinutes: 60,
        from: '2027-03-01T00:00:00.000Z',
        to: '2027-03-02T00:00:00.000Z',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.slots.map((s) => s.startsAt)).toEqual([
      '2027-03-01T09:00:00.000Z',
      '2027-03-01T11:00:00.000Z',
    ]);
    expect(res.body.busy[owner.user.userId]).toEqual([
      { startsAt: '2027-03-01T10:00:00.000Z', endsAt: '2027-03-01T11:00:00.000Z' },
    ]);
    expect(res.body.busy[ravi.user.userId]).toEqual([]);

    const bad = await api(h, 'PUT', '/v1/me/working-hours', {
      token: ravi.accessToken,
      body: { timeZone: 'Mars/Olympus', days: [] },
    });
    expect(bad.status).toBe(400);
  });

  it('sends each reminder once, to people who have not declined', async () => {
    const m = (
      await create(owner, {
        title: 'Standup',
        startsAt: inMinutes(5),
        endsAt: inMinutes(20),
        attendeeIds: [ravi.user.userId, mia.user.userId],
        remindMinutes: [10],
      })
    ).body;
    const svc = h.app.get(MeetingsService);
    const reminder = nextEvent(
      raviSocket,
      'meeting:reminder',
      (e) => e.meeting.meetingId === m.meetingId,
    );
    expect(await svc.sendDueReminders(new Date())).toBeGreaterThanOrEqual(1);
    expect((await reminder).minutesBefore).toBe(10);
    expect(await svc.sendDueReminders(new Date())).toBe(0);
  });
});
