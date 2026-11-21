import { describe, expect, it } from 'vitest';
import type { Message, SendMessageAck, SendMessageRequest } from '@sampledge/contracts';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { OutboxProcessor } from './outbox';
import { TransportError } from './transport';

const clock = 1_000_000;
const now = () => clock;

/** Fake API that keeps one copy per message and bumps changeSequence on every change. */
function fakeApi() {
  const byId = new Map<string, Message>();
  let seq = 0;
  let down = false;
  let reject: string | null = null;
  const api = {
    byId,
    setDown: (v: boolean) => (down = v),
    setReject: (v: string | null) => (reject = v),
    /** Something else changed on the server (e.g. a reaction), advancing the sequence. */
    bump: () => ++seq,
    send: async (req: SendMessageRequest): Promise<SendMessageAck> => {
      if (down) throw new TransportError('offline', 'network');
      seq++;
      const message = serverMessage({
        conversationId: req.conversationId,
        clientMessageId: req.clientMessageId,
        senderId: SELF,
        serverSequence: seq,
        content: { text: req.content.text, mentions: [...(req.content.mentions ?? [])] },
        replyToMessageId: req.replyToMessageId ?? null,
      });
      byId.set(message.messageId, message);
      return { clientMessageId: req.clientMessageId, message, duplicate: false };
    },
    edit: async (id: string, text: string, mentions: string[]): Promise<Message> => {
      if (down) throw new TransportError('offline', 'network');
      if (reject) throw new TransportError(reject, 'api', 'FORBIDDEN');
      seq++;
      const m = {
        ...byId.get(id)!,
        content: { text, mentions },
        changeSequence: seq,
        editedAt: new Date(clock).toISOString(),
      };
      byId.set(id, m);
      return m;
    },
    remove: async (id: string): Promise<Message> => {
      if (down) throw new TransportError('offline', 'network');
      seq++;
      const m = {
        ...byId.get(id)!,
        content: { text: '', mentions: [] },
        changeSequence: seq,
        deletedAt: new Date(clock).toISOString(),
      };
      byId.set(id, m);
      return m;
    },
  };
  return api;
}

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, now);
  await store.upsertConversations([conversation('c1')]);
  const api = fakeApi();
  const outbox = new OutboxProcessor({
    store,
    send: api.send,
    edit: api.edit,
    remove: api.remove,
    canSend: () => true,
    onAuthError: () => undefined,
    schedule: () => () => undefined,
    now,
    random: () => 0.5,
  });
  return { store, api, outbox };
}

describe('replies and mentions', () => {
  it('sends mentions and the reply target, and keeps them locally', async () => {
    const { store, api, outbox } = await setup();
    const first = await store.enqueueSend({ conversationId: 'c1', text: 'root' });
    await outbox.kick();
    const root = (await store.getMessage(first.clientId))!;
    const reply = await store.enqueueSend({
      conversationId: 'c1',
      text: '@Peer can you check?',
      replyTo: root.messageId,
      mentions: [PEER, PEER],
    });
    expect(reply.mentions).toEqual([PEER]);
    await outbox.kick();
    const sent = [...api.byId.values()].find((m) => m.clientMessageId === reply.clientId)!;
    expect(sent.content.mentions).toEqual([PEER]);
    expect(sent.replyToMessageId).toBe(root.messageId);
    expect((await store.getMessageByServerId(root.messageId!))?.text).toBe('root');
  });

  it('lists messages that mention you', async () => {
    const { store } = await setup();
    await store.applyServerMessages([
      serverMessage({
        conversationId: 'c1',
        serverSequence: 1,
        content: { text: 'hi', mentions: [SELF] },
      }),
      serverMessage({
        conversationId: 'c1',
        serverSequence: 2,
        content: { text: 'no', mentions: [] },
      }),
    ]);
    expect((await store.listMentions()).map((m) => m.text)).toEqual(['hi']);
  });
});

describe('offline edits and deletes', () => {
  it('shows an edit at once, keeps it over older server copies, and confirms it', async () => {
    const { store, api, outbox } = await setup();
    const msg = await store.enqueueSend({ conversationId: 'c1', text: 'draft wording' });
    await outbox.kick();
    api.setDown(true);
    await store.enqueueEdit(msg.clientId, 'final wording');
    await outbox.kick();
    let local = (await store.getMessage(msg.clientId))!;
    expect(local.text).toBe('final wording');
    expect(local.pendingOp).toBe('edit');
    expect(await store.pendingCount()).toBe(1);

    // A newer server copy without the edit arrives by sync: the pending edit stays on top.
    const server = [...api.byId.values()][0]!;
    await store.applyServerMessages([{ ...server, changeSequence: api.bump() }]);
    expect((await store.getMessage(msg.clientId))!.text).toBe('final wording');

    api.setDown(false);
    await store.markOpRetry(msg.clientId, 0, 'reset'); // due now
    await outbox.kick();
    local = (await store.getMessage(msg.clientId))!;
    expect(local.pendingOp).toBeNull();
    expect(api.byId.get(local.messageId!)!.content.text).toBe('final wording');
    expect(local.editedAt).not.toBeNull();
  });

  it('collapses repeated edits and lets a delete replace an edit', async () => {
    const { store, api, outbox } = await setup();
    const msg = await store.enqueueSend({ conversationId: 'c1', text: 'one' });
    await outbox.kick();
    api.setDown(true);
    await store.enqueueEdit(msg.clientId, 'two');
    await store.enqueueEdit(msg.clientId, 'three');
    await store.enqueueDelete(msg.clientId);
    expect(await store.pendingCount()).toBe(1);
    const local = (await store.getMessage(msg.clientId))!;
    expect(local.deletedAt).not.toBeNull();
    api.setDown(false);
    await store.markOpRetry(msg.clientId, 0, 'reset');
    await outbox.kick();
    const server = api.byId.get(local.messageId!)!;
    expect(server.deletedAt).not.toBeNull();
    expect(await store.pendingCount()).toBe(0);
  });

  it('rolls back a refused edit and says why', async () => {
    const { store, api, outbox } = await setup();
    const msg = await store.enqueueSend({ conversationId: 'c1', text: 'original' });
    await outbox.kick();
    api.setReject('Editing window has closed');
    await store.enqueueEdit(msg.clientId, 'changed');
    await outbox.kick();
    const local = (await store.getMessage(msg.clientId))!;
    expect(local.text).toBe('original');
    expect(local.pendingOp).toBeNull();
    expect(local.error).toBe('Edit not saved: Editing window has closed');
  });

  it('discards an unsent message instead of queueing a delete', async () => {
    const { store, api } = await setup();
    api.setDown(true);
    const msg = await store.enqueueSend({ conversationId: 'c1', text: 'oops' });
    await store.enqueueDelete(msg.clientId);
    expect(await store.getMessage(msg.clientId)).toBeUndefined();
    expect(await store.pendingCount()).toBe(0);
  });

  it('does not let you edit someone else’s message', async () => {
    const { store } = await setup();
    await store.applyServerMessages([serverMessage({ conversationId: 'c1', serverSequence: 1 })]);
    const [theirs] = await store.listMessages('c1');
    await expect(store.enqueueEdit(theirs!.clientId, 'x')).rejects.toThrow('own messages');
  });
});
