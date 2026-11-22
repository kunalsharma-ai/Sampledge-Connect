import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type NotificationPage,
  type PushStatus,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
import {
  api,
  connect,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** A stand-in for the Expo Push API that records what the server sends. */
let expo: Server;
let pushed: {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  badge?: number;
}[] = [];
let h: Harness;
let owner: Session;
let ravi: Session;
let mia: Session;
let group: Conversation;
let dm: Conversation;

const send = async (
  s: Session,
  c: Conversation,
  text: string,
  extra: { mentions?: string[]; replyToMessageId?: string } = {},
) =>
  (
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${c.conversationId}/messages`, {
      token: s.accessToken,
      body: {
        clientMessageId: uuidv7(),
        content: { text, mentions: extra.mentions ?? [] },
        replyToMessageId: extra.replyToMessageId ?? null,
      },
    })
  ).body.message;
const register = (s: Session, token: string) =>
  api<PushStatus>(h, 'POST', '/v1/push/token', {
    token: s.accessToken,
    body: { provider: 'expo', token, platform: 'ios' },
  });
const settle = () => new Promise((r) => setTimeout(r, 300));
const level = (s: Session, c: Conversation, l: string) =>
  api<Conversation>(h, 'PUT', `/v1/conversations/${c.conversationId}/notify-level`, {
    token: s.accessToken,
    body: { level: l },
  });

beforeAll(async () => {
  expo = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const batch = JSON.parse(raw) as typeof pushed;
      pushed.push(...batch);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: batch.map((m) =>
            m.to === 'ExponentPushToken[gone]'
              ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok', id: uuidv7() },
          ),
        }),
      );
    });
  });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  const port = (expo.address() as { port: number }).port;
  h = await startHarness({ PUSH_PROVIDER: 'expo', EXPO_PUSH_URL: `http://127.0.0.1:${port}/push` });
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
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
});
afterAll(async () => {
  await h.close();
  expo.close();
});

describe('push tokens', () => {
  it('registers per device session and reports status', async () => {
    const before = await api<PushStatus>(h, 'GET', '/v1/push/status', { token: ravi.accessToken });
    expect(before.body).toEqual({ enabled: true, provider: 'expo', tokenRegistered: false });
    const r = await register(ravi, 'ExponentPushToken[ravi]');
    expect(r.status).toBe(200);
    expect(r.body.tokenRegistered).toBe(true);
    const bad = await api(h, 'POST', '/v1/push/token', {
      token: ravi.accessToken,
      body: { provider: 'carrier-pigeon', token: 'x', platform: 'ios' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('push delivery', () => {
  it('pushes DMs, mentions and replies with badge data, but not to a device with a live socket', async () => {
    pushed = [];
    const m = await send(owner, dm, 'Pricing locked?');
    await settle();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      to: 'ExponentPushToken[ravi]',
      title: owner.user.displayName,
      body: 'Pricing locked?',
    });
    expect(pushed[0]!.data).toMatchObject({
      type: 'message',
      kind: 'dm',
      messageId: m.messageId,
      notificationId: null,
    });

    pushed = [];
    await send(owner, group, '@Ravi Kumar check this', { mentions: [ravi.user.userId] });
    await settle();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.data).toMatchObject({ kind: 'mention', unreadCount: 1 });
    expect(pushed[0]!.data.notificationId).toEqual(expect.any(String));
    expect(pushed[0]!.badge).toBe(1);
    expect(pushed[0]!.title).toContain('in Bid team');

    // App open on that device: no push (it gets the message live).
    const sock = await connect(h, ravi.accessToken);
    pushed = [];
    await send(owner, dm, 'Still there?');
    await settle();
    expect(pushed).toHaveLength(0);
    sock.disconnect();
    await settle();
  });

  it('honours notify levels for in-app notifications and push', async () => {
    const r = await level(ravi, group, 'mentions');
    expect(r.status).toBe(200);
    expect(r.body.myNotifyLevel).toBe('mentions');
    const listed = await api<Conversation[]>(h, 'GET', '/v1/conversations', {
      token: ravi.accessToken,
    });
    expect(listed.body.find((c) => c.conversationId === group.conversationId)?.myNotifyLevel).toBe(
      'mentions',
    );

    const parent = await send(ravi, group, 'Draft attached');
    pushed = [];
    const before = (
      await api<NotificationPage>(h, 'GET', '/v1/notifications', { token: ravi.accessToken })
    ).body.unreadCount;
    await send(owner, group, 'Thanks', { replyToMessageId: parent.messageId });
    await settle();
    expect(pushed).toHaveLength(0);
    const after = (
      await api<NotificationPage>(h, 'GET', '/v1/notifications', { token: ravi.accessToken })
    ).body.unreadCount;
    expect(after).toBe(before);

    await send(owner, group, '@Ravi Kumar urgent', { mentions: [ravi.user.userId] });
    await settle();
    expect(pushed).toHaveLength(1);

    await level(ravi, group, 'none');
    pushed = [];
    await send(owner, group, '@Ravi Kumar again', { mentions: [ravi.user.userId] });
    await settle();
    expect(pushed).toHaveLength(0);
    await level(ravi, group, 'all');
  });

  it('only members may set a level; invalid levels are rejected', async () => {
    const outsider = await level(owner, { ...group, conversationId: dm.conversationId }, 'loud');
    expect(outsider.status).toBe(400);
    const notMember = await api(h, 'PUT', `/v1/conversations/${dm.conversationId}/notify-level`, {
      token: mia.accessToken,
      body: { level: 'none' },
    });
    expect([403, 404]).toContain(notMember.status);
  });

  it('clears tokens Expo reports as unregistered, on sign-out, and on explicit delete', async () => {
    await register(mia, 'ExponentPushToken[gone]');
    pushed = [];
    await send(owner, group, '@Mia Chen hello', { mentions: [mia.user.userId] });
    await settle();
    expect(pushed).toHaveLength(1);
    const s = await api<PushStatus>(h, 'GET', '/v1/push/status', { token: mia.accessToken });
    expect(s.body.tokenRegistered).toBe(false);

    const del = await api<PushStatus>(h, 'DELETE', '/v1/push/token', { token: ravi.accessToken });
    expect(del.body.tokenRegistered).toBe(false);
    pushed = [];
    await send(owner, dm, 'Anyone?');
    await settle();
    expect(pushed).toHaveLength(0);

    await register(ravi, 'ExponentPushToken[ravi]');
    await api(h, 'POST', '/v1/auth/logout', { token: ravi.accessToken });
    pushed = [];
    await send(owner, dm, 'After logout');
    await settle();
    expect(pushed).toHaveLength(0);
  });
});

describe('do-not-disturb', () => {
  it('stops push while do-not-disturb is on, by hand or by schedule, but keeps in-app notifications', async () => {
    await register(mia, 'ExponentPushToken[mia-dnd]');
    const setStatus = (body: unknown) =>
      api(h, 'PUT', '/v1/me/status', { token: mia.accessToken, body });
    expect((await setStatus({ availability: 'dnd', text: 'Focus time', emoji: '🎧' })).status).toBe(
      200,
    );
    pushed = [];
    await send(owner, group, '@Mia Chen quick one', { mentions: [mia.user.userId] });
    await settle();
    expect(pushed.filter((p) => p.to === 'ExponentPushToken[mia-dnd]')).toHaveLength(0);
    const inbox = await api<{ items: unknown[] }>(h, 'GET', '/v1/notifications', {
      token: mia.accessToken,
    });
    expect(inbox.body.items.length).toBeGreaterThan(0);

    // Back to automatic: pushes again.
    await setStatus({ availability: 'auto' });
    pushed = [];
    await send(owner, group, '@Mia Chen and now?', { mentions: [mia.user.userId] });
    await settle();
    expect(pushed.filter((p) => p.to === 'ExponentPushToken[mia-dnd]')).toHaveLength(1);

    // A schedule covering every minute of every day.
    const all = await api(h, 'PUT', '/v1/me/dnd-schedule', {
      token: mia.accessToken,
      body: {
        enabled: true,
        timeZone: 'UTC',
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '00:00',
        end: '23:59',
      },
    });
    expect(all.status).toBe(200);
    pushed = [];
    const now = new Date();
    await send(owner, group, '@Mia Chen scheduled quiet', { mentions: [mia.user.userId] });
    await settle();
    const quietMinute = now.getUTCHours() * 60 + now.getUTCMinutes() < 23 * 60 + 59;
    expect(pushed.filter((p) => p.to === 'ExponentPushToken[mia-dnd]')).toHaveLength(
      quietMinute ? 0 : 1,
    );
    await api(h, 'PUT', '/v1/me/dnd-schedule', {
      token: mia.accessToken,
      body: { enabled: false, timeZone: 'UTC', days: [], start: '00:00', end: '23:59' },
    });
  });
});
