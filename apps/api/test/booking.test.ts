import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BookingConfirmation,
  BookingPage,
  BookingSlotsResponse,
  Meeting,
  PublicBookingPage,
  Session,
} from '@sampledge/contracts';
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
let raviSocket: ClientSocket;
const slug = `sales-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 86_400_000;

const pub = <T>(method: string, path: string, body?: unknown) =>
  api<T>(h, method, `/v1/book/${path}`, { body });
const range = () =>
  `from=${new Date().toISOString()}&to=${new Date(Date.now() + 10 * DAY).toISOString()}`;
const meetingsOf = async (s: Session) =>
  (
    await api<Meeting[]>(
      h,
      'GET',
      `/v1/meetings?from=${new Date().toISOString()}&to=${new Date(Date.now() + 20 * DAY).toISOString()}`,
      { token: s.accessToken },
    )
  ).body;

beforeAll(async () => {
  h = await startHarness({ PUBLIC_WEB_URL: 'https://connect.acme.test' });
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h?.close();
});

describe('booking pages', () => {
  let page: BookingPage;

  it('hosts create a page with a public link; links are unique', async () => {
    const miaSocket = await connect(h, mia.accessToken);
    const live = Promise.all([
      nextEvent(raviSocket, 'meetings:changed', (e) => e.area === 'booking_pages'),
      nextEvent(miaSocket, 'meetings:changed', (e) => e.area === 'booking_pages'),
    ]);
    const res = await api<BookingPage>(h, 'POST', '/v1/booking-pages', {
      token: ravi.accessToken,
      body: {
        slug,
        title: 'Intro call with Sales',
        description: 'Tell us about your study.',
        durationMinutes: 30,
        hostIds: [mia.user.userId],
        mode: 'any',
        minNoticeMinutes: 0,
        horizonDays: 14,
      },
    });
    expect(res.status).toBe(201);
    page = res.body;
    // Both hosts' devices hear about the new page live.
    await live;
    miaSocket.disconnect();
    expect(page.hostIds).toEqual([ravi.user.userId, mia.user.userId]);
    expect(page.url).toBe(`https://connect.acme.test/book/${slug}`);
    const dup = await api(h, 'POST', '/v1/booking-pages', {
      token: owner.accessToken,
      body: { slug: slug.toUpperCase(), title: 'x' },
    });
    expect(dup.status).toBe(409);
    expect(
      (await api(h, 'GET', '/v1/booking-pages', { token: mia.accessToken })).body,
    ).toHaveLength(1);
    const notHost = await api(h, 'PATCH', `/v1/booking-pages/${page.bookingPageId}`, {
      token: owner.accessToken,
      body: { title: 'Mine now' },
    });
    expect(notHost.status).toBe(403);
  });

  it('shows the page publicly without emails, with free times', async () => {
    const view = await pub<PublicBookingPage>('GET', slug);
    expect(view.status).toBe(200);
    expect(view.body.hosts.map((x) => x.name)).toEqual(['Ravi Kumar', 'Mia Chen']);
    expect(JSON.stringify(view.body)).not.toContain('@');
    const slots = await pub<BookingSlotsResponse>('GET', `${slug}/slots?${range()}`);
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBeGreaterThan(10);
    // Inside default working hours (09:00 to 17:30 UTC, weekdays).
    for (const s of slots.body.slots) {
      const d = new Date(s.startsAt);
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
      expect(d.getUTCHours()).toBeGreaterThanOrEqual(9);
    }
    expect((await pub('GET', 'no-such-page')).status).toBe(404);
  });

  it('booking creates a meeting with the booker as guest; the time is then taken for that host', async () => {
    const slots = (await pub<BookingSlotsResponse>('GET', `${slug}/slots?${range()}`)).body.slots;
    const first = slots[0]!;
    const upsert = nextEvent(raviSocket, 'meeting:upsert');
    const res = await pub<BookingConfirmation>('POST', slug, {
      startsAt: first.startsAt,
      name: 'Anna Schmidt',
      email: 'anna@client.example',
      notes: 'Panel for DACH',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startsAt: first.startsAt, hostNames: ['Ravi Kumar'] });
    expect(res.body.joinUrl).toMatch(/^https:\/\/connect\.acme\.test\/join\/[0-9a-f]{24}\./);
    const m = await upsert;
    expect(m.title).toBe('Intro call with Sales: Anna Schmidt');
    expect(m.agenda).toContain('Panel for DACH');
    expect(m.guests![0]).toMatchObject({ email: 'anna@client.example', name: 'Anna Schmidt' });

    // "any" mode: the same time goes to the other host next.
    const again = await pub<BookingConfirmation>('POST', slug, {
      startsAt: first.startsAt,
      name: 'Bo',
      email: 'bo@client.example',
    });
    expect(again.status).toBe(201);
    expect(again.body.hostNames).toEqual(['Mia Chen']);
    // Now both hosts are busy then.
    const after = (await pub<BookingSlotsResponse>('GET', `${slug}/slots?${range()}`)).body.slots;
    expect(after.some((s) => s.startsAt === first.startsAt)).toBe(false);
    const third = await pub('POST', slug, {
      startsAt: first.startsAt,
      name: 'Cy',
      email: 'cy@client.example',
    });
    expect(third.status).toBe(409);
    expect((await meetingsOf(mia)).some((x) => x.title === 'Intro call with Sales: Bo')).toBe(true);
  });

  it('"all" pages need every host free; bad times and disabled pages are refused', async () => {
    await api(h, 'PATCH', `/v1/booking-pages/${page.bookingPageId}`, {
      token: mia.accessToken,
      body: { mode: 'all' },
    });
    const slots = (await pub<BookingSlotsResponse>('GET', `${slug}/slots?${range()}`)).body.slots;
    const res = await pub<BookingConfirmation>('POST', slug, {
      startsAt: slots[0]!.startsAt,
      name: 'Dee',
      email: 'dee@client.example',
    });
    expect(res.status).toBe(201);
    expect(res.body.hostNames.sort()).toEqual(['Mia Chen', 'Ravi Kumar']);

    const odd = new Date(Date.parse(slots[1]!.startsAt) + 7 * 60_000).toISOString();
    expect(
      (await pub('POST', slug, { startsAt: odd, name: 'E', email: 'e@x.example' })).status,
    ).toBe(400);
    const past = new Date(Date.now() - DAY).toISOString();
    expect(
      (await pub('POST', slug, { startsAt: past, name: 'E', email: 'e@x.example' })).status,
    ).toBe(400);
    // Members book as attendees, not guests.
    const member = await pub('POST', slug, {
      startsAt: slots[2]!.startsAt,
      name: 'Owner',
      email: owner.user.email,
    });
    expect(member.status).toBe(400);

    await api(h, 'PATCH', `/v1/booking-pages/${page.bookingPageId}`, {
      token: ravi.accessToken,
      body: { enabled: false },
    });
    expect((await pub('GET', slug)).status).toBe(404);
    const del = await api(h, 'DELETE', `/v1/booking-pages/${page.bookingPageId}`, {
      token: ravi.accessToken,
    });
    expect(del.status).toBe(200);
  });
});

describe('working hours', () => {
  it('a change reaches all of my devices live', async () => {
    const live = nextEvent(raviSocket, 'meetings:changed', (e) => e.area === 'working_hours');
    const res = await api(h, 'PUT', '/v1/me/working-hours', {
      token: ravi.accessToken,
      body: {
        timeZone: 'Asia/Kolkata',
        days: [1, 2, 3, 4, 5].map((day) => ({ day, start: '10:00', end: '18:00' })),
      },
    });
    expect(res.status).toBe(200);
    expect(await live).toEqual({ area: 'working_hours' });
  });
});
