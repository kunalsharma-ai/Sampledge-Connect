import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type NotificationPage,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
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
let mia: Session;
let outsider: Session;
let group: Conversation;

const send = async (
  s: Session,
  text: string,
  extra: { mentions?: string[]; replyToMessageId?: string; clientMessageId?: string } = {},
) =>
  (
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${group.conversationId}/messages`, {
      token: s.accessToken,
      body: {
        clientMessageId: extra.clientMessageId ?? uuidv7(),
        content: { text, mentions: extra.mentions ?? [] },
        replyToMessageId: extra.replyToMessageId ?? null,
      },
    })
  ).body.message;
const inbox = async (s: Session, q = '') =>
  (await api<NotificationPage>(h, 'GET', `/v1/notifications${q}`, { token: s.accessToken })).body;

beforeAll(async () => {
  h = await startHarness();
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
});
afterAll(() => h.close());

describe('notifications', () => {
  it('notifies mentioned members in real time, never the sender or non-members', async () => {
    const sock = await connect(h, ravi.accessToken);
    const live = nextEvent(sock, 'notification:new');
    await send(owner, '@Ravi Kumar @Outside Person can you check pricing?', {
      mentions: [ravi.user.userId, outsider.user.userId, owner.user.userId],
    });
    const n = await live;
    expect(n).toMatchObject({ kind: 'mention', actorId: owner.user.userId });
    expect(n.preview).toContain('check pricing');
    sock.disconnect();

    const r = await inbox(ravi);
    expect(r.unreadCount).toBe(1);
    expect(r.items).toHaveLength(1);
    expect((await inbox(outsider)).items).toHaveLength(0);
    expect((await inbox(owner)).items).toHaveLength(0);
  });

  it('notifies the parent author on reply; a mention wins over a reply; retries do not duplicate', async () => {
    const parent = await send(mia, 'Draft is in the folder');
    const id = uuidv7();
    await send(ravi, 'Looks good', { replyToMessageId: parent.messageId, clientMessageId: id });
    await send(ravi, 'Looks good', { replyToMessageId: parent.messageId, clientMessageId: id });
    await send(owner, '@Mia Chen thanks', {
      replyToMessageId: parent.messageId,
      mentions: [mia.user.userId],
    });
    const m = await inbox(mia);
    expect(m.items.map((n) => n.kind)).toEqual(['mention', 'reply']);
    expect(m.unreadCount).toBe(2);
  });

  it('marks read by id, by conversation and all, and syncs the count to other devices', async () => {
    const before = await inbox(mia, '?unread=true');
    const sock = await connect(h, mia.accessToken);
    const synced = nextEvent(sock, 'notification:read');
    const one = await api<{ unreadCount: number }>(h, 'POST', '/v1/notifications/read', {
      token: mia.accessToken,
      body: { notificationIds: [before.items[0]!.notificationId] },
    });
    expect(one.body.unreadCount).toBe(1);
    expect((await synced).unreadCount).toBe(1);
    sock.disconnect();
    const conv = await api<{ unreadCount: number }>(h, 'POST', '/v1/notifications/read', {
      token: mia.accessToken,
      body: { conversationId: group.conversationId },
    });
    expect(conv.body.unreadCount).toBe(0);
    // Marking someone else's notification is a no-op, not an error.
    const other = (await inbox(ravi)).items[0]!.notificationId;
    await api(h, 'POST', '/v1/notifications/read', {
      token: mia.accessToken,
      body: { notificationIds: [other] },
    });
    expect((await inbox(ravi)).unreadCount).toBe(1);
    const all = await api<{ unreadCount: number }>(h, 'POST', '/v1/notifications/read', {
      token: ravi.accessToken,
      body: { all: true },
    });
    expect(all.body.unreadCount).toBe(0);
  });

  it('hides notifications after removal from the conversation and after the message is deleted', async () => {
    const m = await send(owner, '@Mia Chen one more', { mentions: [mia.user.userId] });
    expect((await inbox(mia)).unreadCount).toBe(1);
    await api(h, 'DELETE', `/v1/messages/${m.messageId}`, { token: owner.accessToken });
    expect((await inbox(mia)).unreadCount).toBe(0);

    await send(owner, '@Ravi Kumar last one', { mentions: [ravi.user.userId] });
    expect((await inbox(ravi)).unreadCount).toBe(1);
    const rm = await api(
      h,
      'DELETE',
      `/v1/conversations/${group.conversationId}/members/${ravi.user.userId}`,
      { token: owner.accessToken },
    );
    expect(rm.status).toBe(204);
    const after = await inbox(ravi);
    expect(after.unreadCount).toBe(0);
    expect(after.items).toHaveLength(0);
  });

  it('validates input and paginates', async () => {
    const bad = await api(h, 'POST', '/v1/notifications/read', {
      token: mia.accessToken,
      body: { notificationIds: [] },
    });
    expect(bad.status).toBe(400);
    const p1 = await inbox(mia, '?limit=1');
    expect(p1.items).toHaveLength(1);
    expect(p1.nextBefore).not.toBeNull();
    const p2 = await inbox(mia, `?limit=1&before=${p1.nextBefore}`);
    expect(p2.items[0]!.notificationId).not.toBe(p1.items[0]!.notificationId);
  });
});
