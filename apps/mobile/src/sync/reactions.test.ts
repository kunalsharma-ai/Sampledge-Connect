import { describe, expect, it } from 'vitest';
import type { Message, SetReactionRequest } from '@sampledge/contracts';
import { migrate } from '../db/migrations';
import { LocalStore, overlayReactions } from '../db/store';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { OutboxProcessor } from './outbox';
import { TransportError } from './transport';

const now = () => 1_000_000;

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, now);
  await store.upsertConversations([conversation('c1')]);
  let server: Message = serverMessage({
    conversationId: 'c1',
    serverSequence: 1,
    reactions: [{ emoji: '👍', userIds: [PEER], count: 1 }],
  });
  await store.applyServerMessages([server]);
  const calls: SetReactionRequest[] = [];
  let mode: 'ok' | 'down' | 'refuse' = 'ok';
  const react = async (req: SetReactionRequest): Promise<Message> => {
    calls.push(req);
    if (mode === 'down') throw new TransportError('offline', 'network');
    if (mode === 'refuse') throw new TransportError('deleted', 'api', 'CONFLICT');
    const others = server.reactions.filter((r) => r.emoji !== req.emoji);
    const cur = server.reactions.find((r) => r.emoji === req.emoji);
    const ids = new Set(cur?.userIds ?? []);
    if (req.op === 'add') ids.add(SELF);
    else ids.delete(SELF);
    server = {
      ...server,
      changeSequence: server.changeSequence + 1,
      reactions: ids.size
        ? [...others, { emoji: req.emoji, userIds: [...ids], count: ids.size }]
        : others,
    };
    return server;
  };
  const outbox = new OutboxProcessor({
    store,
    send: async () => {
      throw new Error('unused');
    },
    react,
    canSend: () => true,
    onAuthError: () => undefined,
    schedule: () => () => undefined,
    now,
    random: () => 0.5,
  });
  const [msg] = await store.listMessages('c1');
  return {
    store,
    outbox,
    calls,
    clientId: msg!.clientId,
    setMode: (m: typeof mode) => (mode = m),
    server: () => server,
  };
}

describe('reactions', () => {
  it('overlays queued intents on the server reactions', () => {
    const server = [{ emoji: '👍', userIds: [PEER], count: 3 }];
    expect(overlayReactions(server, [{ emoji: '👍', op: 'add' }], SELF)).toEqual([
      { emoji: '👍', count: 4, userIds: [PEER, SELF], mine: true, pending: true },
    ]);
    expect(overlayReactions(server, [{ emoji: '🎉', op: 'remove' }], SELF)).toHaveLength(1);
  });

  it('shows your reaction at once and confirms it with the server copy', async () => {
    const { store, outbox, clientId, setMode, server } = await setup();
    setMode('down');
    await store.toggleReaction(clientId, '👍');
    let m = (await store.getMessage(clientId))!;
    expect(m.reactions).toEqual([
      { emoji: '👍', count: 2, userIds: [PEER, SELF], mine: true, pending: true },
    ]);
    expect(await store.pendingCount()).toBe(1);
    setMode('ok');
    await store.markReactionRetry((await store.nextDueReaction())!, 0, 'reset');
    await outbox.kick();
    m = (await store.getMessage(clientId))!;
    expect(m.reactions[0]).toMatchObject({ count: 2, mine: true, pending: false });
    expect(server().reactions[0]!.userIds).toContain(SELF);
    expect(await store.pendingCount()).toBe(0);
  });

  it('collapses offline toggles into the last intent, or nothing', async () => {
    const { store, outbox, clientId, setMode, calls } = await setup();
    setMode('down');
    await store.toggleReaction(clientId, '🎉'); // add
    await store.toggleReaction(clientId, '🎉'); // remove: back to the server state
    expect(await store.pendingCount()).toBe(0);
    await store.toggleReaction(clientId, '🎉');
    await store.toggleReaction(clientId, '🎉');
    await store.toggleReaction(clientId, '🎉'); // net: add
    setMode('ok');
    await outbox.kick();
    expect(calls.filter((c) => c.op === 'add' && c.emoji === '🎉').length).toBeGreaterThan(0);
    expect(
      (await store.getMessage(clientId))!.reactions.find((r) => r.emoji === '🎉'),
    ).toMatchObject({
      mine: true,
      pending: false,
    });
  });

  it('drops a refused intent and shows the server state', async () => {
    const { store, outbox, clientId, setMode } = await setup();
    setMode('refuse');
    await store.toggleReaction(clientId, '❤️');
    await outbox.kick();
    const m = (await store.getMessage(clientId))!;
    expect(m.reactions.map((r) => r.emoji)).toEqual(['👍']);
    expect(await store.pendingCount()).toBe(0);
  });
});
