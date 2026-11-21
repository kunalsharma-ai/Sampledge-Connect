import { describe, expect, it } from 'vitest';
import { forwardedOf, type SendMessageAck, type SendMessageRequest } from '@sampledge/contracts';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { forwardFrom, forwardSnapshot, forwardTargets } from '../lib/forward';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { OutboxProcessor } from './outbox';

const now = () => 1_000_000;

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, now);
  await store.upsertConversations([
    conversation('c1', { kind: 'group', name: 'Board', allowForwarding: false }),
    conversation('c2'),
    conversation('c3', { archivedAt: '2026-11-01T00:00:00.000Z' }),
  ]);
  const sent: SendMessageRequest[] = [];
  const send = async (req: SendMessageRequest): Promise<SendMessageAck> => {
    sent.push(req);
    const message = serverMessage({
      conversationId: req.conversationId,
      clientMessageId: req.clientMessageId,
      senderId: SELF,
      serverSequence: 100 + sent.length,
      content: { text: req.content.text, mentions: [] },
    });
    return { clientMessageId: req.clientMessageId, message, duplicate: false };
  };
  const outbox = new OutboxProcessor({
    store,
    send,
    canSend: () => true,
    onAuthError: () => undefined,
    schedule: () => () => undefined,
    now,
    random: () => 0.5,
  });
  return { store, outbox, sent };
}

describe('forwarding', () => {
  it('shows the forward at once with the original quoted, then sends forwardOf', async () => {
    const { store, outbox, sent } = await setup();
    const src = serverMessage({
      conversationId: 'c1',
      senderId: PEER,
      serverSequence: 1,
      content: { text: 'Budget approved for wave 3', mentions: [] },
    });
    await store.applyServerMessages([src]);
    const local = (await store.listMessages('c1')).find((m) => m.messageId === src.messageId)!;
    const snapshot = forwardSnapshot(local, 'Board');
    const m = await store.enqueueSend({
      conversationId: 'c2',
      text: '',
      forward: { of: src.messageId, snapshot },
    });
    expect(forwardedOf(m)).toMatchObject({
      messageId: src.messageId,
      senderId: PEER,
      text: 'Budget approved for wave 3',
      from: 'Board',
    });
    expect((await store.getConversation('c2'))!.lastPreview).toBe(
      'Forwarded: Budget approved for wave 3',
    );
    await outbox.kick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ conversationId: 'c2', forwardOf: src.messageId });
    expect(sent[0]!.content.text).toBe('');
  });

  it('forwarding a forward keeps the first original but sends the message you picked', () => {
    const fwd = {
      messageId: 'm2',
      conversationId: 'c2',
      senderId: SELF,
      text: 'fyi',
      createdAt: '2026-11-21T10:00:00.000Z',
      metadata: {
        forwarded: {
          messageId: 'm1',
          conversationId: 'c1',
          senderId: PEER,
          text: 'original',
          createdAt: '2026-11-20T10:00:00.000Z',
          from: 'Board',
        },
      },
    } as unknown as Parameters<typeof forwardSnapshot>[0];
    expect(forwardSnapshot(fwd, 'DM')).toMatchObject({ messageId: 'm1', text: 'original' });
  });

  it('when forwarding is off it can only be shared inside the same conversation', async () => {
    const { store } = await setup();
    const all = await store.listConversations();
    const board = all.find((c) => c.conversationId === 'c1')!;
    expect(board.allowForwarding).toBe(false);
    expect(forwardTargets(board, all).map((c) => c.conversationId)).toEqual(['c1']);
    const dm = all.find((c) => c.conversationId === 'c2')!;
    expect(dm.allowForwarding).toBe(true);
    // Archived conversations are not offered.
    expect(
      forwardTargets(dm, all)
        .map((c) => c.conversationId)
        .sort(),
    ).toEqual(['c1', 'c2']);
  });

  it('names where it came from like the server does', () => {
    const nameOf = (id: string) => (id === PEER ? 'Priya Shah' : 'Me');
    expect(forwardFrom({ kind: 'channel_public', name: 'ops', memberIds: [] }, nameOf, SELF)).toBe(
      '#ops',
    );
    expect(forwardFrom({ kind: 'group', name: 'Board', memberIds: [] }, nameOf, SELF)).toBe(
      'Board',
    );
    expect(forwardFrom({ kind: 'dm', name: null, memberIds: [SELF, PEER] }, nameOf, SELF)).toBe(
      'Priya Shah',
    );
  });
});
