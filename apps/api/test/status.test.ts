import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PresenceInfo, Session, UserSummary } from '@sampledge/contracts';
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

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
});
afterAll(() => h.close());

const users = async (s: Session) =>
  (await api<UserSummary[]>(h, 'GET', '/v1/users', { token: s.accessToken })).body;

describe('availability and custom status', () => {
  it('sets a status everyone sees live, and clears it', async () => {
    const sock = await connect(h, owner.accessToken);
    const live = nextEvent(sock, 'directory:updated', (e) => e.userId === ravi.user.userId);
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const r = await api<PresenceInfo>(h, 'PUT', '/v1/me/status', {
      token: ravi.accessToken,
      body: { availability: 'busy', emoji: '📞', text: 'Client calls all afternoon', expiresAt },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toMatchObject({
      availability: 'busy',
      text: 'Client calls all afternoon',
      expiresAt,
    });
    expect(r.body.dndActive).toBe(false);
    await live;
    const seen = (await users(owner)).find((u) => u.userId === ravi.user.userId)!;
    expect(seen.userStatus).toMatchObject({ availability: 'busy', emoji: '📞' });

    await api(h, 'PUT', '/v1/me/status', {
      token: ravi.accessToken,
      body: { availability: 'auto' },
    });
    expect(
      (await users(owner)).find((u) => u.userId === ravi.user.userId)!.userStatus,
    ).toBeUndefined();
    sock.disconnect();
  });

  it('validates input', async () => {
    const past = await api(h, 'PUT', '/v1/me/status', {
      token: ravi.accessToken,
      body: { availability: 'dnd', expiresAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(past.status).toBe(400);
    const tz = await api(h, 'PUT', '/v1/me/dnd-schedule', {
      token: ravi.accessToken,
      body: { enabled: true, timeZone: 'Mars/Olympus', days: [1], start: '19:00', end: '08:00' },
    });
    expect(tz.status).toBe(400);
    const bad = await api(h, 'PUT', '/v1/me/dnd-schedule', {
      token: ravi.accessToken,
      body: { enabled: true, timeZone: 'UTC', days: [1], start: '25:00', end: '08:00' },
    });
    expect(bad.status).toBe(400);
  });

  it('stores quiet hours and reports do-not-disturb', async () => {
    const r = await api<PresenceInfo>(h, 'PUT', '/v1/me/dnd-schedule', {
      token: ravi.accessToken,
      body: {
        enabled: true,
        timeZone: 'Asia/Kolkata',
        days: [5, 1, 1],
        start: '19:00',
        end: '08:00',
      },
    });
    expect(r.body.dndSchedule).toEqual({
      enabled: true,
      timeZone: 'Asia/Kolkata',
      days: [1, 5],
      start: '19:00',
      end: '08:00',
    });
    const me = await api<PresenceInfo>(h, 'GET', '/v1/me/status', { token: ravi.accessToken });
    expect(me.body.dndSchedule.timeZone).toBe('Asia/Kolkata');
    const dnd = await api<PresenceInfo>(h, 'PUT', '/v1/me/status', {
      token: ravi.accessToken,
      body: { availability: 'dnd' },
    });
    expect(dnd.body.dndActive).toBe(true);
    const seen = (await users(owner)).find((u) => u.userId === ravi.user.userId)!;
    expect(seen.dndSchedule?.start).toBe('19:00');
  });
});
