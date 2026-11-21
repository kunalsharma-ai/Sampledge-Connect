import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type SendMessageAck,
  type Session,
  type SyncResponse,
} from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let group: Conversation;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  const third = await inviteAndLogin(h, owner, t.slug, 'Meera Iyer');
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', memberIds: [ravi.user.userId, third.user.userId], name: 'QA' },
    })
  ).body;
});
afterAll(() => h.close());

const send = (s: Session, text: string) =>
  api<SendMessageAck>(h, 'POST', `/v1/conversations/${group.conversationId}/messages`, {
    token: s.accessToken,
    body: { clientMessageId: uuidv7(), content: { text } },
  });
const sync = (s: Session, after: number, limit = 200) =>
  api<SyncResponse>(h, 'POST', '/v1/sync', {
    token: s.accessToken,
    body: {
      cursors: [{ conversationId: group.conversationId, afterChangeSequence: after }],
      limitPerConversation: limit,
    },
  });

describe('cursor sync', () => {
  it('returns everything after the cursor, in order, including edits and deletes', async () => {
    const base =
      (await sync(ravi, 0)).body.results.find((r) => r.conversationId === group.conversationId)
        ?.nextCursor ?? 0;
    const m1 = (await send(owner, 'one')).body.message;
    const m2 = (await send(owner, 'two')).body.message;
    await api(h, 'PATCH', `/v1/messages/${m1.messageId}`, {
      token: owner.accessToken,
      body: { content: { text: 'one (edited)' } },
    });
    await api(h, 'DELETE', `/v1/messages/${m2.messageId}`, { token: owner.accessToken });

    const res = (await sync(ravi, base)).body;
    const r = res.results.find((x) => x.conversationId === group.conversationId)!;
    const seqs = r.changes.map((c) => c.changeSequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const byId = new Map(r.changes.map((c) => [c.messageId, c]));
    expect(byId.get(m1.messageId)!.content.text).toBe('one (edited)');
    expect(byId.get(m2.messageId)!.deletedAt).not.toBeNull();
    expect(r.hasMore).toBe(false);

    // Re-sync from the returned cursor yields nothing new.
    const again = (await sync(ravi, r.nextCursor)).body.results.find(
      (x) => x.conversationId === group.conversationId,
    );
    expect(again?.changes ?? []).toEqual([]);
  });

  it('pages with hasMore and never skips a change', async () => {
    const start = (await sync(ravi, 0)).body.results.find(
      (x) => x.conversationId === group.conversationId,
    )!.nextCursor;
    for (let i = 0; i < 12; i++) await send(owner, `bulk ${i}`);
    let cursor = start;
    const seen: string[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const r = (await sync(ravi, cursor, 5)).body.results.find(
        (x) => x.conversationId === group.conversationId,
      );
      if (!r || r.changes.length === 0) break;
      seen.push(...r.changes.map((c) => c.content.text));
      cursor = r.nextCursor;
      if (!r.hasMore) break;
    }
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `bulk ${i}`));
  });

  it('includes receipts and lists conversations the caller lost access to', async () => {
    const m = (await send(owner, 'read me')).body.message;
    await api(h, 'POST', '/v1/messages/receipts', {
      token: ravi.accessToken,
      body: { conversationId: group.conversationId, kind: 'read', upToSequence: m.serverSequence },
    });
    const r = (await sync(owner, m.changeSequence - 1)).body.results.find(
      (x) => x.conversationId === group.conversationId,
    )!;
    expect(r.receipts.find((x) => x.userId === ravi.user.userId)).toMatchObject({
      readUpTo: m.serverSequence,
      deliveredUpTo: m.serverSequence,
    });

    await api(
      h,
      'DELETE',
      `/v1/conversations/${group.conversationId}/members/${ravi.user.userId}`,
      { token: owner.accessToken },
    );
    const after = (await sync(ravi, 0)).body;
    expect(after.revokedConversationIds).toContain(group.conversationId);
    expect(after.conversations.map((c) => c.conversationId)).not.toContain(group.conversationId);
  });
});
