import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type Message,
  type SendMessageAck,
  type Session,
  type SyncResponse,
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
let outsider: Session;
let dm: Conversation;
let msg: Message;

const path = (id: string, emoji: string) =>
  `/v1/messages/${id}/reactions/${encodeURIComponent(emoji)}`;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  outsider = await inviteAndLogin(h, owner, t.slug, 'Outside Person');
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
  msg = (
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${dm.conversationId}/messages`, {
      token: owner.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'Pricing locked?' } },
    })
  ).body.message;
});
afterAll(() => h.close());

describe('reactions', () => {
  it('adds idempotently, bumps changeSequence once, and broadcasts message:updated', async () => {
    const sock = await connect(h, owner.accessToken);
    const updated = nextEvent(sock, 'message:updated');
    const a = await api<Message>(h, 'PUT', path(msg.messageId, '👍'), { token: ravi.accessToken });
    expect(a.status).toBe(200);
    expect(a.body.reactions).toEqual([{ emoji: '👍', userIds: [ravi.user.userId], count: 1 }]);
    expect(a.body.changeSequence).toBeGreaterThan(msg.changeSequence);
    expect((await updated).reactions[0]?.count).toBe(1);

    const again = await api<Message>(h, 'PUT', path(msg.messageId, '👍'), {
      token: ravi.accessToken,
    });
    expect(again.body.changeSequence).toBe(a.body.changeSequence);
    sock.disconnect();
  });

  it('aggregates reactors, removes idempotently, and reaches other devices through sync', async () => {
    const b = await api<Message>(h, 'PUT', path(msg.messageId, '👍'), { token: owner.accessToken });
    expect(b.body.reactions[0]).toMatchObject({ emoji: '👍', count: 2 });

    const r = await api<Message>(h, 'DELETE', path(msg.messageId, '👍'), {
      token: ravi.accessToken,
    });
    expect(r.body.reactions).toEqual([{ emoji: '👍', userIds: [owner.user.userId], count: 1 }]);
    const r2 = await api<Message>(h, 'DELETE', path(msg.messageId, '👍'), {
      token: ravi.accessToken,
    });
    expect(r2.body.changeSequence).toBe(r.body.changeSequence);

    const sync = await api<SyncResponse>(h, 'POST', '/v1/sync', {
      token: ravi.accessToken,
      body: {
        cursors: [{ conversationId: dm.conversationId, afterChangeSequence: msg.changeSequence }],
      },
    });
    const changes = sync.body.results.find((x) => x.conversationId === dm.conversationId)!.changes;
    expect(changes.at(-1)).toMatchObject({
      messageId: msg.messageId,
      reactions: [{ emoji: '👍', count: 1 }],
    });
  });

  it('supports reacting over the socket', async () => {
    const sock = await connect(h, ravi.accessToken);
    const ack = await sock.timeout(5000).emitWithAck('reaction:set', {
      messageId: msg.messageId,
      emoji: '🎉',
      op: 'add',
    });
    expect(ack.ok).toBe(true);
    expect((ack as { data: Message }).data.reactions.map((x) => x.emoji)).toEqual(['👍', '🎉']);
    sock.disconnect();
  });

  it('rejects non-members, non-emoji, and deleted messages', async () => {
    expect(
      (await api(h, 'PUT', path(msg.messageId, '👍'), { token: outsider.accessToken })).status,
    ).toBe(404);
    expect(
      (await api(h, 'PUT', path(msg.messageId, 'lol'), { token: ravi.accessToken })).status,
    ).toBe(400);
    expect(
      (await api(h, 'PUT', path(msg.messageId, '👍👍'), { token: ravi.accessToken })).status,
    ).toBe(400);
    await api(h, 'DELETE', `/v1/messages/${msg.messageId}`, { token: owner.accessToken });
    expect(
      (await api(h, 'PUT', path(msg.messageId, '🔥'), { token: ravi.accessToken })).status,
    ).toBe(409);
  });
});
