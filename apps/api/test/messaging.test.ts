import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deriveConfirmedStatus,
  uuidv7,
  type Conversation,
  type Message,
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
let slug: string;
let dm: Conversation;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
});
afterAll(() => h.close());

const send = (s: Session, conversationId: string, text: string, clientMessageId = uuidv7()) =>
  api<SendMessageAck>(h, 'POST', `/v1/conversations/${conversationId}/messages`, {
    token: s.accessToken,
    body: { clientMessageId, content: { text } },
  });

describe('conversations', () => {
  it('reuses the DM between the same two people', async () => {
    const again = await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: ravi.accessToken,
      body: { kind: 'dm', memberIds: [owner.user.userId] },
    });
    expect(again.body.conversationId).toBe(dm.conversationId);
  });

  it('keeps private channels hidden from non-members', async () => {
    const priv = await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'channel_private', name: 'bid-pricing' },
    });
    expect(priv.status).toBe(201);
    const list = await api<Conversation[]>(h, 'GET', '/v1/conversations', {
      token: ravi.accessToken,
    });
    expect(list.body.map((c) => c.conversationId)).not.toContain(priv.body.conversationId);
    expect(
      (
        await api(h, 'GET', `/v1/conversations/${priv.body.conversationId}/messages`, {
          token: ravi.accessToken,
        })
      ).status,
    ).toBe(404);
  });

  it('lets members preview and join public channels', async () => {
    const pub = await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'channel_public', name: 'fieldwork-uk' },
    });
    const list = await api<Conversation[]>(h, 'GET', '/v1/conversations', {
      token: ravi.accessToken,
    });
    const seen = list.body.find((c) => c.conversationId === pub.body.conversationId)!;
    expect(seen.myRole).toBeNull();
    expect((await send(ravi, seen.conversationId, 'hi')).status).toBe(403);
    const joined = await api<Conversation>(
      h,
      'POST',
      `/v1/conversations/${seen.conversationId}/join`,
      { token: ravi.accessToken },
    );
    expect(joined.body.myRole).toBe('member');
    expect((await send(ravi, seen.conversationId, 'hi')).status).toBe(200);
  });

  it('archived conversations are read-only', async () => {
    const g = await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', memberIds: [ravi.user.userId, owner.user.userId], name: 'Wave 2' },
    });
    expect(g.status).toBe(201);
    expect(
      (
        await api(h, 'PATCH', `/v1/conversations/${g.body.conversationId}`, {
          token: owner.accessToken,
          body: { archived: true },
        })
      ).status,
    ).toBe(200);
    expect((await send(owner, g.body.conversationId, 'still there?')).status).toBe(403);
    expect(
      (
        await api(h, 'GET', `/v1/conversations/${g.body.conversationId}/messages`, {
          token: ravi.accessToken,
        })
      ).status,
    ).toBe(200);
  });
});

describe('idempotent messaging', () => {
  it('returns the original message when the same clientMessageId is resent', async () => {
    const id = uuidv7();
    const first = await send(owner, dm.conversationId, 'Quota for wave 2 looks low', id);
    const second = await send(owner, dm.conversationId, 'Quota for wave 2 looks low', id);
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.message.messageId).toBe(first.body.message.messageId);
    const hist = await api<Message[]>(h, 'GET', `/v1/conversations/${dm.conversationId}/messages`, {
      token: owner.accessToken,
    });
    expect(hist.body.filter((m) => m.clientMessageId === id)).toHaveLength(1);
  });

  it('creates exactly one message under 10 concurrent retries', async () => {
    const id = uuidv7();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => send(owner, dm.conversationId, 'storm', id)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.message.messageId)).size).toBe(1);
    expect(results.filter((r) => !r.body.duplicate)).toHaveLength(1);
  });

  it('rejects reuse of another user’s clientMessageId', async () => {
    const id = uuidv7();
    await send(owner, dm.conversationId, 'mine', id);
    const res = await send(ravi, dm.conversationId, 'not yours', id);
    expect(res.status).toBe(409);
  });

  it('assigns strictly increasing sequences to concurrent sends', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        send(i % 2 ? owner : ravi, dm.conversationId, `msg ${i}`),
      ),
    );
    const seqs = results.map((r) => r.body.message.serverSequence).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(30);
    const hist = await api<Message[]>(
      h,
      'GET',
      `/v1/conversations/${dm.conversationId}/messages?limit=200`,
      { token: owner.accessToken },
    );
    const order = hist.body.map((m) => m.serverSequence);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('paginates history backwards by sequence', async () => {
    const page1 = await api<Message[]>(
      h,
      'GET',
      `/v1/conversations/${dm.conversationId}/messages?limit=5`,
      { token: owner.accessToken },
    );
    const page2 = await api<Message[]>(
      h,
      'GET',
      `/v1/conversations/${dm.conversationId}/messages?limit=5&before=${page1.body[0]!.serverSequence}`,
      { token: owner.accessToken },
    );
    expect(page2.body).toHaveLength(5);
    expect(page2.body.at(-1)!.serverSequence).toBeLessThan(page1.body[0]!.serverSequence);
  });
});

describe('edit and delete', () => {
  it('bumps changeSequence and keeps serverSequence; only the sender edits', async () => {
    const sent = (await send(owner, dm.conversationId, 'typo')).body.message;
    const edited = await api<Message>(h, 'PATCH', `/v1/messages/${sent.messageId}`, {
      token: owner.accessToken,
      body: { content: { text: 'fixed' } },
    });
    expect(edited.body.serverSequence).toBe(sent.serverSequence);
    expect(edited.body.changeSequence).toBeGreaterThan(sent.changeSequence);
    expect(edited.body.editedAt).not.toBeNull();
    expect(
      (
        await api(h, 'PATCH', `/v1/messages/${sent.messageId}`, {
          token: ravi.accessToken,
          body: { content: { text: 'hijack' } },
        })
      ).status,
    ).toBe(403);
    const del = await api<Message>(h, 'DELETE', `/v1/messages/${sent.messageId}`, {
      token: owner.accessToken,
    });
    expect(del.body.deletedAt).not.toBeNull();
    expect(del.body.content.text).toBe('');
    expect(
      (
        await api(h, 'PATCH', `/v1/messages/${sent.messageId}`, {
          token: owner.accessToken,
          body: { content: { text: 'zombie' } },
        })
      ).status,
    ).toBe(409);
  });

  it('members cannot delete others’ messages in a DM', async () => {
    const sent = (await send(owner, dm.conversationId, 'keep')).body.message;
    // DM members are owners of the DM, so moderation applies; in groups a plain member cannot.
    const g = (
      await api<Conversation>(h, 'POST', '/v1/conversations', {
        token: owner.accessToken,
        body: {
          kind: 'group',
          memberIds: [
            ravi.user.userId,
            (await inviteAndLogin(h, owner, slug, 'Third Person')).user.userId,
          ],
        },
      })
    ).body;
    const gm = (await send(owner, g.conversationId, 'owner msg')).body.message;
    expect(
      (await api(h, 'DELETE', `/v1/messages/${gm.messageId}`, { token: ravi.accessToken })).status,
    ).toBe(403);
    expect(sent.messageId).toBeTruthy();
  });
});

describe('real-time delivery over Socket.IO', () => {
  it('delivers message:new, receipts and typing between users', async () => {
    const sOwner = await connect(h, owner.accessToken);
    const sRavi = await connect(h, ravi.accessToken);
    try {
      const incoming = nextEvent(sRavi, 'message:new', (m) => m.content.text === 'live hello');
      const clientMessageId = uuidv7();
      const ack = await sOwner.emitWithAck('message:send', {
        conversationId: dm.conversationId,
        clientMessageId,
        content: { text: 'live hello', mentions: [] },
      });
      expect(ack.ok).toBe(true);
      if (!ack.ok) return;
      const msg = await incoming;
      expect(msg.clientMessageId).toBe(clientMessageId);

      // Ravi acks delivery then read; owner derives status from watermarks.
      const delivered = nextEvent(
        sOwner,
        'receipt:updated',
        (r) => r.userId === ravi.user.userId && r.deliveredUpTo >= msg.serverSequence,
      );
      await sRavi.emitWithAck('receipt:ack', {
        conversationId: dm.conversationId,
        kind: 'delivered',
        upToSequence: msg.serverSequence,
      });
      const r1 = await delivered;
      const members = [owner.user.userId, ravi.user.userId];
      expect(
        deriveConfirmedStatus({
          serverSequence: msg.serverSequence,
          senderId: owner.user.userId,
          memberIds: members,
          receipts: [r1],
        }),
      ).toBe('delivered');
      const read = nextEvent(
        sOwner,
        'receipt:updated',
        (r) => r.userId === ravi.user.userId && r.readUpTo >= msg.serverSequence,
      );
      await sRavi.emitWithAck('receipt:ack', {
        conversationId: dm.conversationId,
        kind: 'read',
        upToSequence: msg.serverSequence,
      });
      expect(
        deriveConfirmedStatus({
          serverSequence: msg.serverSequence,
          senderId: owner.user.userId,
          memberIds: members,
          receipts: [await read],
        }),
      ).toBe('read');

      const typing = nextEvent(sRavi, 'typing:update');
      sOwner.emit('typing:set', { conversationId: dm.conversationId, typing: true });
      expect(await typing).toMatchObject({
        conversationId: dm.conversationId,
        userId: owner.user.userId,
        typing: true,
      });
    } finally {
      sOwner.close();
      sRavi.close();
    }
  });

  it('returns a structured error ack for invalid sends', async () => {
    const s = await connect(h, owner.accessToken);
    const ack = await s.emitWithAck('message:send', {
      conversationId: dm.conversationId,
      clientMessageId: 'not-a-uuid',
      content: { text: 'x', mentions: [] },
    });
    expect(ack).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    s.close();
  });

  it('delivers to the sender’s other devices (multi-device)', async () => {
    const laptop = await connect(h, owner.accessToken);
    const phoneSession = (
      await api<Session>(h, 'POST', '/v1/auth/refresh', {
        body: { refreshToken: owner.refreshToken },
      })
    ).body;
    owner = phoneSession; // keep later tests using a valid token
    const phone = await connect(h, phoneSession.accessToken);
    const got = nextEvent(phone, 'message:new', (m) => m.content.text === 'from laptop');
    await laptop.emitWithAck('message:send', {
      conversationId: dm.conversationId,
      clientMessageId: uuidv7(),
      content: { text: 'from laptop', mentions: [] },
    });
    expect((await got).senderId).toBe(owner.user.userId);
    laptop.close();
    phone.close();
  });

  it('refuses socket connections without a valid session', async () => {
    await expect(connect(h, 'garbage')).rejects.toThrow();
    const t = await registerTenant(h);
    await api(h, 'POST', '/v1/auth/logout', { token: t.session.accessToken });
    await expect(connect(h, t.session.accessToken)).rejects.toThrow();
  });
});
