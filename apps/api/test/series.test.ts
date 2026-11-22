import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { SMTPServer } from 'smtp-server';
import type { GuestMeetingView, Meeting, Message, Session } from '@sampledge/contracts';
import { GuestsService } from '../src/meetings/guests.service.js';
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

/** Decoded message text, with iCalendar lines unfolded. */
function readable(raw: string): string {
  const qp = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, x: string) => String.fromCharCode(parseInt(x, 16)));
  const b64 = [
    ...raw.matchAll(
      /Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/g,
    ),
  ]
    .map((m) => Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64').toString('utf8'))
    .join('\n');
  return `${Buffer.from(qp, 'latin1').toString('utf8')}\n${b64}`.replace(/\r\n /g, '');
}

let h: Harness;
let smtp: ReturnType<typeof smtpSink>;
let owner: Session;
let ravi: Session;
let raviSocket: ClientSocket;

const DAY = 86_400_000;
/** Tomorrow at 09:00 UTC (10:00 in London in winter). */
const tomorrowAt = (hour: number, minute = 0) => {
  const d = new Date(Date.now() + DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};
const flush = () => h.app.get(GuestsService).flush();
const mailTo = (email: string) => smtp.inbox.filter((m) => m.to.includes(email));
const tokenFrom = (raw: string) =>
  /\/join\/([0-9a-f]{24}\.[A-Za-z0-9_-]{32})/.exec(readable(raw))![1]!;
const list = async (s: Session = owner, days = 60, includeCancelled = false) =>
  (
    await api<Meeting[]>(
      h,
      'GET',
      `/v1/meetings?from=${new Date(Date.now() - DAY).toISOString()}&to=${new Date(Date.now() + days * DAY).toISOString()}${includeCancelled ? '&includeCancelled=true' : ''}`,
      { token: s.accessToken },
    )
  ).body;
const ofSeries = (all: Meeting[], seriesId: string) =>
  all.filter((m) => m.series?.seriesId === seriesId);
const patch = (id: string, body: unknown) =>
  api<Meeting>(h, 'PATCH', `/v1/meetings/${id}`, { token: owner.accessToken, body });

beforeAll(async () => {
  smtp = smtpSink();
  await new Promise<void>((r) => smtp.server.listen(0, '127.0.0.1', r));
  h = await startHarness({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String((smtp.server.server.address() as AddressInfo).port),
    SMTP_FROM: 'Acme Meetings <meetings@acme.test>',
    PUBLIC_WEB_URL: 'https://connect.acme.test',
    FILES_URL_SECRET: 'y'.repeat(40),
  });
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h?.close();
  await new Promise((r) => smtp.server.close(() => r(undefined)));
});

describe('recurring meetings', () => {
  let first: Meeting;
  let seriesId: string;
  let token: string;

  it('creates every meeting of a weekly series and sends guests one recurring invite', async () => {
    const start = tomorrowAt(9);
    const upsert = nextEvent(raviSocket, 'meeting:upsert');
    const res = await api<Meeting>(h, 'POST', '/v1/meetings', {
      token: owner.accessToken,
      body: {
        title: 'Weekly fieldwork sync',
        agenda: 'Quotas and blockers',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
        timeZone: 'Europe/London',
        attendeeIds: [ravi.user.userId],
        guests: [{ email: 'anna@client.example', name: 'Anna Schmidt' }],
        recurrence: { frequency: 'weekly', endsAfter: 4 },
      },
    });
    expect(res.status).toBe(201);
    first = res.body;
    seriesId = first.series!.seriesId;
    expect(first.startsAt).toBe(start.toISOString());
    expect(first.series).toMatchObject({ detached: false, recurrence: { frequency: 'weekly' } });
    expect(first.series!.summary).toMatch(/^Weekly on \w+day, 4 times$/);
    expect((await upsert).series?.seriesId).toBe(seriesId);

    const all = ofSeries(await list(ravi), seriesId);
    expect(all.map((m) => Date.parse(m.startsAt) - start.getTime())).toEqual([
      0,
      7 * DAY,
      14 * DAY,
      21 * DAY,
    ]);
    expect(new Set(all.map((m) => m.conversationId)).size).toBe(1);

    const msgs = await api<Message[]>(
      h,
      'GET',
      `/v1/conversations/${first.conversationId}/messages`,
      {
        token: owner.accessToken,
      },
    );
    const card = msgs.body.filter((m) => m.messageType === 'system').at(-1)!;
    expect(card.content.text).toContain('Scheduled a recurring meeting: Weekly fieldwork sync');
    expect(card.metadata?.meeting).toMatchObject({ seriesId, recurrence: first.series!.summary });

    await flush();
    const mails = mailTo('anna@client.example');
    expect(mails).toHaveLength(1);
    const text = readable(mails[0]!.raw);
    expect(text).toContain('Subject: Invitation: Weekly fieldwork sync (Weekly on');
    expect(text).toContain('invited you to a recurring meeting');
    expect(text).toContain(`UID:${seriesId}@sampledge-connect`);
    expect(text).toContain('BEGIN:VTIMEZONE');
    expect(text).toContain('TZID:Europe/London');
    expect(text).toMatch(/DTSTART;TZID=Europe\/London:\d{8}T0900\d\d/);
    expect(text).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=\w\w;COUNT=4;WKST=MO/);
    token = tokenFrom(mails[0]!.raw);
    // Every meeting of the series shows the invite as sent.
    expect(
      ofSeries(await list(), seriesId).every((m) => m.guests![0]!.invite.status === 'sent'),
    ).toBe(true);
  });

  it("one guest link opens the series' next meeting; a guest answers for the whole series", async () => {
    const view = await api<GuestMeetingView>(h, 'GET', `/v1/guest/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.meetingId).toBe(first.meetingId);
    expect(view.body.recurrence).toBe(first.series!.summary);
    await api(h, 'POST', `/v1/guest/${token}/rsvp`, { body: { response: 'accepted' } });
    expect(ofSeries(await list(), seriesId).map((m) => m.guests![0]!.response)).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
    ]);
  });

  it('members answer one meeting or the series', async () => {
    const all = ofSeries(await list(ravi), seriesId);
    const one = await api<Meeting>(h, 'POST', `/v1/meetings/${all[0]!.meetingId}/rsvp`, {
      token: ravi.accessToken,
      body: { response: 'declined' },
    });
    expect(one.status).toBe(200);
    const series = await api<Meeting>(h, 'POST', `/v1/meetings/${all[1]!.meetingId}/rsvp`, {
      token: ravi.accessToken,
      body: { response: 'accepted', scope: 'series' },
    });
    expect(series.status).toBe(200);
    const mine = (m: Meeting) => m.attendees.find((a) => a.userId === ravi.user.userId)!.response;
    // A series answer covers every upcoming meeting, including the declined one.
    expect(ofSeries(await list(ravi), seriesId).map(mine)).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
    ]);
  });

  it('changes one meeting on its own and tells guests about that day only', async () => {
    const all = ofSeries(await list(), seriesId);
    const second = all[1]!;
    await flush();
    smtp.inbox.length = 0;
    const res = await patch(second.meetingId, {
      startsAt: new Date(Date.parse(second.startsAt) + 3_600_000).toISOString(),
      endsAt: new Date(Date.parse(second.endsAt) + 3_600_000).toISOString(),
      title: 'Weekly fieldwork sync (client joins)',
    });
    expect(res.status).toBe(200);
    expect(res.body.series!.detached).toBe(true);
    const after = ofSeries(await list(), seriesId);
    expect(after.map((m) => m.title)).toEqual([
      'Weekly fieldwork sync',
      'Weekly fieldwork sync (client joins)',
      'Weekly fieldwork sync',
      'Weekly fieldwork sync',
    ]);
    await flush();
    const text = readable(mailTo('anna@client.example')[0]!.raw);
    expect(text).toContain('changed one meeting in this series');
    expect(text).toMatch(/RECURRENCE-ID;TZID=Europe\/London:\d{8}T090000/);
    expect(text).toMatch(/DTSTART;TZID=Europe\/London:\d{8}T100000/);
    expect(text).not.toContain('RRULE');

    const msgs = await api<Message[]>(
      h,
      'GET',
      `/v1/conversations/${first.conversationId}/messages`,
      {
        token: owner.accessToken,
      },
    );
    expect(msgs.body.at(-1)!.content.text).toMatch(/^Changed one meeting of Weekly fieldwork sync/);

    const guests = await patch(second.meetingId, { addGuests: [{ email: 'bo@client.example' }] });
    expect(guests.status).toBe(400);
    expect(JSON.stringify(guests.body)).toContain('whole series');
  });

  it('a series change keeps answers; the downloadable invite lists exceptions', async () => {
    const all = ofSeries(await list(), seriesId);
    const res = await patch(all[2]!.meetingId, { scope: 'series', agenda: 'New agenda' });
    expect(res.status).toBe(200);
    const after = ofSeries(await list(ravi), seriesId);
    expect(after.every((m) => m.agenda === 'New agenda')).toBe(true);
    // Answers are kept (the meeting moved on its own earlier was reset by that move).
    expect(
      after.map((m) => m.attendees.find((a) => a.userId === ravi.user.userId)!.response),
    ).toEqual(['accepted', 'pending', 'accepted', 'accepted']);
    // The changed meeting keeps its own time.
    expect(after[1]!.startsAt).toBe(all[1]!.startsAt);

    const cancelOne = await api<Meeting>(h, 'POST', `/v1/meetings/${all[3]!.meetingId}/cancel`, {
      token: owner.accessToken,
    });
    expect(cancelOne.body.status).toBe('cancelled');
    expect(ofSeries(await list(), seriesId)).toHaveLength(3);

    const ics = (await (await fetch(`${h.url}/v1/guest/${token}/calendar.ics`)).text()).replace(
      /\r\n /g,
      '',
    );
    expect(ics).toMatch(/EXDATE;TZID=Europe\/London:\d{8}T090000/);
    expect(ics).toMatch(/RECURRENCE-ID;TZID=Europe\/London:\d{8}T090000/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('moving the series time recreates the upcoming meetings at the new time', async () => {
    const all = ofSeries(await list(), seriesId);
    await flush();
    smtp.inbox.length = 0;
    const res = await patch(all[0]!.meetingId, {
      scope: 'series',
      startsAt: new Date(Date.parse(all[0]!.startsAt) + 30 * 60_000).toISOString(),
      endsAt: new Date(Date.parse(all[0]!.startsAt) + 75 * 60_000).toISOString(),
    });
    expect(res.status).toBe(200);
    const after = ofSeries(await list(ravi), seriesId);
    expect(after).toHaveLength(4);
    const start = tomorrowAt(9, 30).getTime();
    expect(after.map((m) => Date.parse(m.startsAt) - start)).toEqual([
      0,
      7 * DAY,
      14 * DAY,
      21 * DAY,
    ]);
    expect(after.every((m) => Date.parse(m.endsAt) - Date.parse(m.startsAt) === 45 * 60_000)).toBe(
      true,
    );
    expect(after.every((m) => !m.series!.detached && m.agenda === 'New agenda')).toBe(true);
    expect(
      after.every(
        (m) => m.attendees.find((a) => a.userId === ravi.user.userId)!.response === 'pending',
      ),
    ).toBe(true);
    await flush();
    const text = readable(mailTo('anna@client.example')[0]!.raw);
    expect(text).toContain('changed this meeting series');
    expect(text).toMatch(/DTSTART;TZID=Europe\/London:\d{8}T093000/);
    expect(text).toContain('SEQUENCE:');
    // The guest link follows the series.
    const view = await api<GuestMeetingView>(h, 'GET', `/v1/guest/${token}`);
    expect(view.body.meetingId).toBe(after[0]!.meetingId);
  });

  it('cancelling the series cancels every upcoming meeting', async () => {
    const all = ofSeries(await list(), seriesId);
    await flush();
    smtp.inbox.length = 0;
    const res = await api<Meeting>(h, 'POST', `/v1/meetings/${all[1]!.meetingId}/cancel`, {
      token: owner.accessToken,
      body: { scope: 'series' },
    });
    expect(res.status).toBe(200);
    expect(ofSeries(await list(), seriesId)).toHaveLength(0);
    await flush();
    const text = readable(mailTo('anna@client.example')[0]!.raw);
    expect(text).toContain('METHOD:CANCEL');
    expect(text).toContain(`UID:${seriesId}@sampledge-connect`);
    expect(text).toContain('cancelled this meeting series');
    const view = await api<GuestMeetingView>(h, 'GET', `/v1/guest/${token}`);
    expect(view.body.status).toBe('cancelled');
  });

  it('open-ended series are created ahead and extended over time', async () => {
    const start = tomorrowAt(8);
    const res = await api<Meeting>(h, 'POST', '/v1/meetings', {
      token: owner.accessToken,
      body: {
        title: 'Daily standup',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 15 * 60_000).toISOString(),
        attendeeIds: [ravi.user.userId],
        recurrence: { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5] },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.series!.summary).toBe('Every weekday');
    const id = res.body.series!.seriesId;
    const client = await MongoClient.connect(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017');
    const count = () =>
      client.db(h.dbName).collection('meetings').countDocuments({ 'series.seriesId': id });
    const before = await count();
    // About 180 days of weekdays.
    expect(before).toBeGreaterThan(120);
    expect(before).toBeLessThan(132);
    const svc = h.app.get(MeetingsService);
    expect(await svc.extendSeries(new Date())).toBe(0);
    // The first batch runs to 180 days after the first meeting, so measure two weeks from there
    // (measuring from now made the count depend on the weekday the test ran).
    const added = await svc.extendSeries(new Date(start.getTime() + 14 * DAY));
    expect(added).toBe(10);
    expect(await count()).toBe(before + 10);
    await client.close();
  });

  it('rejects rules without upcoming meetings', async () => {
    const start = tomorrowAt(8);
    const res = await api(h, 'POST', '/v1/meetings', {
      token: owner.accessToken,
      body: {
        title: 'x',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 15 * 60_000).toISOString(),
        attendeeIds: [ravi.user.userId],
        recurrence: { frequency: 'daily', endsOn: '2020-01-01' },
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('before its first meeting');
  });
});
