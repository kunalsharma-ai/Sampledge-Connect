import { describe, expect, it } from 'vitest';
import type { Meeting, MeetingReminderEvent } from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { Emitter } from '../lib/emitter';
import { systemText } from '../lib/systemMessages';
import { canJoinNow } from '../lib/time';
import { PEER, SELF } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';
import type { RealtimeClient } from '../sync/realtime';
import { TransportError, type ApiTransport } from '../sync/transport';
import { ConnectEngine } from './engine';

const HOUR = 3_600_000;
const T = Date.now();

function meeting(id: string, over: Partial<Meeting> = {}): Meeting {
  return {
    meetingId: id,
    conversationId: 'c1',
    title: `Meeting ${id}`,
    agenda: '',
    startsAt: new Date(T + HOUR).toISOString(),
    endsAt: new Date(T + 2 * HOUR).toISOString(),
    timeZone: 'UTC',
    organizerId: PEER,
    attendees: [
      { userId: PEER, response: 'accepted', optional: false },
      { userId: SELF, response: 'pending', optional: false },
    ],
    media: 'video',
    remindMinutes: [10],
    status: 'scheduled',
    createdAt: new Date(T - HOUR).toISOString(),
    updatedAt: new Date(T - HOUR).toISOString(),
    ...over,
  };
}

async function setup(state: 'active' | 'demo' = 'active') {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF);
  const sent: string[] = [];
  let mode: 'ok' | 'down' | 'refuse' = 'ok';
  let server: Meeting[] = [meeting('m1'), meeting('m2')];
  const api = {
    listMeetings: async () => {
      if (mode === 'down') throw new TransportError('offline', 'network');
      return server;
    },
    rsvp: async (id: string, response: 'accepted' | 'tentative' | 'declined') => {
      sent.push(`${id}:${response}`);
      if (mode === 'down') throw new TransportError('offline', 'network');
      if (mode === 'refuse') throw new TransportError('cancelled', 'api', 'CONFLICT');
      const m = server.find((x) => x.meetingId === id)!;
      return {
        ...m,
        attendees: m.attendees.map((a) => (a.userId === SELF ? { ...a, response } : a)),
        updatedAt: new Date().toISOString(),
      };
    },
    sync: async () => ({
      conversations: [],
      revokedConversationIds: [],
      changes: [],
      hasMore: false,
    }),
    listUsers: async () => [],
    listNotifications: async () => ({ items: [], unreadCount: 0, nextBefore: null }),
    callsConfig: async () => ({ enabled: false, provider: 'none', ringTimeoutSeconds: 30 }),
    activeCalls: async () => [],
  } as unknown as ApiTransport;
  const session = {
    state,
    events: new Emitter(),
    refresh: async () => null,
  } as unknown as SessionManager;
  const rt = {
    events: new Emitter(),
    state: 'disconnected',
    connect() {},
    disconnect() {},
    reconnect() {},
  };
  const engine = new ConnectEngine(store, api, session, rt as unknown as RealtimeClient);
  await engine.start();
  return {
    store,
    engine,
    sent,
    rt,
    setMode: (m: typeof mode) => (mode = m),
    setServer: (m: Meeting[]) => (server = m),
  };
}

const win = () => ConnectEngine.meetingWindow();

describe('meetings cache', () => {
  it('loads the window and keeps it for offline use', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    await t.engine.refreshMeetings();
    const list = await t.store.listMeetings(win().from, win().to);
    expect(list.map((m) => m.meetingId)).toEqual(['m1', 'm2']);
    expect(list[0]?.myResponse).toBe('pending');
  });

  it('never lets an older copy replace a newer one', async () => {
    const t = await setup();
    await t.store.upsertMeetings([
      meeting('m1', { title: 'New', updatedAt: new Date(T).toISOString() }),
    ]);
    await t.store.upsertMeetings([meeting('m1', { title: 'Old' })]);
    expect((await t.store.getMeeting('m1'))?.title).toBe('New');
  });

  it('drops meetings the server no longer lists for you', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    await t.engine.refreshMeetings();
    t.setServer([meeting('m1')]);
    await t.engine.refreshMeetings();
    expect(await t.store.getMeeting('m2')).toBeUndefined();
  });
});

describe('RSVP', () => {
  it('answers offline at once and sends the answer when back online', async () => {
    const t = await setup();
    await t.store.upsertMeetings([meeting('m1')]);
    await t.engine.rsvp('m1', 'accepted');
    let m = await t.store.getMeeting('m1');
    expect(m?.myResponse).toBe('accepted');
    expect(m?.rsvpPending).toBe(true);
    expect(t.sent).toEqual([]);
    t.engine.setNetworkUp(true);
    await t.engine.resume();
    m = await t.store.getMeeting('m1');
    expect(t.sent).toEqual(['m1:accepted']);
    expect(m?.rsvpPending).toBe(false);
    expect(m?.myResponse).toBe('accepted');
  });

  it('the last answer wins', async () => {
    const t = await setup();
    await t.store.upsertMeetings([meeting('m1')]);
    await t.engine.rsvp('m1', 'accepted');
    await t.engine.rsvp('m1', 'declined');
    t.engine.setNetworkUp(true);
    await t.engine.resume();
    expect(t.sent).toEqual(['m1:declined']);
  });

  it('falls back to the server copy when the answer is refused', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    await t.engine.refreshMeetings();
    t.setMode('refuse');
    await t.engine.rsvp('m1', 'tentative');
    const m = await t.store.getMeeting('m1');
    expect(m?.rsvpPending).toBe(false);
    expect(m?.myResponse).toBe('pending');
  });

  it('the demo workspace keeps answers on the phone', async () => {
    const t = await setup('demo');
    await t.store.upsertMeetings([meeting('m1')]);
    await t.engine.rsvp('m1', 'tentative');
    const m = await t.store.getMeeting('m1');
    expect(m?.myResponse).toBe('tentative');
    expect(m?.rsvpPending).toBe(false);
  });
});

describe('reminders and labels', () => {
  it('shows a reminder unless you declined or it was cancelled', async () => {
    const t = await setup();
    const seen: string[] = [];
    t.engine.events.on('meetingReminder', (e) => seen.push(e.meeting.meetingId));
    const emit = (e: MeetingReminderEvent) =>
      (t.rt.events as unknown as Emitter<{ meetingReminder: MeetingReminderEvent }>).emit(
        'meetingReminder',
        e,
      );
    emit({ meeting: meeting('a'), minutesBefore: 10 });
    emit({
      meeting: meeting('b', {
        attendees: [{ userId: SELF, response: 'declined', optional: false }],
      }),
      minutesBefore: 10,
    });
    emit({ meeting: meeting('c', { status: 'cancelled' }), minutesBefore: 10 });
    expect(seen).toEqual(['a']);
  });

  it('opens Join 15 minutes before the start until the end', () => {
    const s = new Date(T + HOUR).toISOString();
    const e = new Date(T + 2 * HOUR).toISOString();
    expect(canJoinNow(s, e, T)).toBe(false);
    expect(canJoinNow(s, e, T + HOUR - 14 * 60_000)).toBe(true);
    expect(canJoinNow(s, e, T + 2 * HOUR)).toBe(false);
  });

  it('describes meeting cards in the chat', () => {
    const base = { meetingId: 'm1', title: 'Kickoff', startsAt: new Date(T).toISOString() };
    expect(systemText('', { meeting: { ...base, status: 'scheduled' } })).toMatch(
      /^“Kickoff” scheduled · /,
    );
    expect(systemText('', { meeting: { ...base, status: 'updated' } })).toMatch(
      /^“Kickoff” moved · /,
    );
    expect(systemText('', { meeting: { ...base, status: 'cancelled' } })).toBe(
      '“Kickoff” was cancelled',
    );
  });
});
