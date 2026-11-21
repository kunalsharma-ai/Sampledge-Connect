import { describe, expect, it, beforeEach } from 'vitest';
import type { SendMessageAck, SendMessageRequest, SyncResponse } from '@sampledge/contracts';
import { migrate, rebuildPreservingUnsent, SCHEMA_VERSION } from '../db/migrations';
import { LocalStore } from '../db/store';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { OutboxProcessor } from './outbox';
import { SyncEngine } from './syncEngine';
import { TransportError, type ApiTransport } from './transport';

let clock = 1_000_000;
const now = () => clock;

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(
    db,
    SELF,
    { maxMessagesPerConversation: 5, maxMessagesTotal: 8 },
    now,
  );
  await store.upsertConversations([conversation('c1')]);
  return { db, store };
}

/** Fake server that assigns sequences and is idempotent on clientMessageId, like the real API contract. */
function fakeServer() {
  const accepted = new Map<string, SendMessageAck['message']>();
  let seq = 0;
  return {
    accepted,
    send: async (req: SendMessageRequest): Promise<SendMessageAck> => {
      const prior = accepted.get(req.clientMessageId);
      if (prior) return { clientMessageId: req.clientMessageId, message: prior, duplicate: true };
      seq++;
      const message = serverMessage({
        conversationId: req.conversationId,
        clientMessageId: req.clientMessageId,
        senderId: SELF,
        serverSequence: seq,
        content: { text: req.content.text, mentions: [] },
      });
      accepted.set(req.clientMessageId, message);
      return { clientMessageId: req.clientMessageId, message, duplicate: false };
    },
  };
}

function processor(
  store: LocalStore,
  send: (r: SendMessageRequest) => Promise<SendMessageAck>,
  online = () => true,
) {
  const timers: { fn: () => void; ms: number }[] = [];
  const auth: TransportError[] = [];
  const p = new OutboxProcessor({
    store,
    send,
    canSend: online,
    onAuthError: (e) => auth.push(e),
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return () => undefined;
    },
    now,
    random: () => 0.5,
  });
  return { p, timers, auth };
}

beforeEach(() => {
  clock = 1_000_000;
});

describe('migrations', () => {
  it('creates the schema at the latest version', async () => {
    const db = openNodeDriver();
    const r = await migrate(db);
    expect(r).toEqual({ fromVersion: 0, toVersion: SCHEMA_VERSION, recovered: false });
    expect((await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(
      SCHEMA_VERSION,
    );
  });

  it('rebuilds a cache written by a newer app version but keeps unsent messages and drafts', async () => {
    const { db, store } = await setup();
    await store.applyServerMessages([serverMessage({ conversationId: 'c1', serverSequence: 1 })]);
    const queued = await store.enqueueSend({ conversationId: 'c1', text: 'do not lose me' });
    await store.saveDraft('c2', 'half written');
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);

    const r = await migrate(db);
    expect(r.recovered).toBe(true);
    const msgs = await store.listMessages('c1');
    expect(msgs.map((m) => m.text)).toEqual(['do not lose me']); // confirmed data re-syncs later
    expect((await store.nextDueOutbox())?.clientId).toBe(queued.clientId);
    expect(await store.getDraft('c2')).toBe('half written');
    expect(await store.getSetting('cache.recoveredAt')).toBeTruthy();
  });

  it('recovers from a corrupted schema', async () => {
    const db = openNodeDriver();
    await db.exec('CREATE TABLE messages (garbage TEXT); PRAGMA user_version = 0;');
    await rebuildPreservingUnsent(db);
    const store = new LocalStore(db, SELF);
    expect(await store.listConversations()).toEqual([]);
  });
});

describe('durable send queue', () => {
  it('writes the message and outbox entry before any network attempt', async () => {
    const { store } = await setup();
    await store.saveDraft('c1', 'hi there');
    const m = await store.enqueueSend({ conversationId: 'c1', text: '  hi there ' });
    expect(m.status).toBe('queued');
    expect(m.text).toBe('hi there');
    expect(m.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.pendingCount()).toBe(1);
    expect(await store.getDraft('c1')).toBe('');
  });

  it('sends in order and marks messages sent with server sequence', async () => {
    const { store } = await setup();
    const server = fakeServer();
    await store.enqueueSend({ conversationId: 'c1', text: 'one' });
    clock++;
    await store.enqueueSend({ conversationId: 'c1', text: 'two' });
    await processor(store, server.send).p.kick();
    const msgs = await store.listMessages('c1');
    expect(msgs.map((m) => [m.text, m.status, m.serverSeq])).toEqual([
      ['one', 'sent', 1],
      ['two', 'sent', 2],
    ]);
    expect(await store.pendingCount()).toBe(0);
  });

  it('keeps messages queued while offline and retries with backoff', async () => {
    const { store } = await setup();
    await store.enqueueSend({ conversationId: 'c1', text: 'offline' });
    const down = async (): Promise<SendMessageAck> => {
      throw new TransportError('Network request failed', 'network');
    };
    const { p, timers } = processor(store, down);
    await p.kick();
    const [m] = await store.listMessages('c1');
    expect(m!.status).toBe('queued');
    expect(m!.error).toBe('Network request failed');
    expect(timers.at(-1)!.ms).toBeGreaterThan(0);
    expect(await store.nextDueOutbox()).toBeUndefined(); // not due until backoff elapses
    clock += 120_000;
    expect(await store.nextDueOutbox()).toBeDefined();
  });

  it('does not send while canSend() is false', async () => {
    const { store } = await setup();
    const server = fakeServer();
    await store.enqueueSend({ conversationId: 'c1', text: 'wait' });
    await processor(store, server.send, () => false).p.kick();
    expect(server.accepted.size).toBe(0);
    expect((await store.listMessages('c1'))[0]!.status).toBe('queued');
  });

  it('a retry after a lost ack does not duplicate (server idempotency)', async () => {
    const { store } = await setup();
    const server = fakeServer();
    await store.enqueueSend({ conversationId: 'c1', text: 'once' });
    // First attempt reaches the server but the response is lost.
    const lossy = async (req: SendMessageRequest) => {
      await server.send(req);
      throw new TransportError('socket hang up', 'network');
    };
    await processor(store, lossy).p.kick();
    clock += 120_000;
    await processor(store, server.send).p.kick();
    expect(server.accepted.size).toBe(1);
    const msgs = await store.listMessages('c1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe('sent');
  });

  it('moves non-retryable failures to failed and supports manual retry and discard', async () => {
    const { store } = await setup();
    const m = await store.enqueueSend({ conversationId: 'c1', text: 'nope' });
    const reject = async (): Promise<SendMessageAck> => {
      throw new TransportError('You cannot post in this channel', 'api', 'FORBIDDEN');
    };
    await processor(store, reject).p.kick();
    let msg = await store.getMessage(m.clientId);
    expect(msg!.status).toBe('failed');
    expect(msg!.error).toBe('You cannot post in this channel');
    expect(await store.nextDueOutbox()).toBeUndefined();

    await store.retry(m.clientId);
    expect((await store.getMessage(m.clientId))!.status).toBe('queued');
    await processor(store, fakeServer().send).p.kick();
    expect((await store.getMessage(m.clientId))!.status).toBe('sent');

    const other = await store.enqueueSend({ conversationId: 'c1', text: 'discard me' });
    await store.discardUnsent(other.clientId);
    expect(await store.getMessage(other.clientId)).toBeUndefined();
  });

  it('pauses on session expiry without losing the message', async () => {
    const { store } = await setup();
    const m = await store.enqueueSend({ conversationId: 'c1', text: 'later' });
    const expired = async (): Promise<SendMessageAck> => {
      throw new TransportError('expired', 'api', 'SESSION_EXPIRED');
    };
    const { p, auth } = processor(store, expired);
    await p.kick();
    expect(auth).toHaveLength(1);
    expect((await store.getMessage(m.clientId))!.status).toBe('queued');
    expect(await store.nextDueOutbox()).toBeDefined();
  });

  it('requeues messages left "sending" by a crash', async () => {
    const { store } = await setup();
    const m = await store.enqueueSend({ conversationId: 'c1', text: 'crash' });
    await store.markSending(m.clientId);
    expect(await store.requeueInflight()).toBe(1);
    expect((await store.getMessage(m.clientId))!.status).toBe('queued');
  });
});

describe('applying server state', () => {
  it('reconciles a message sent from another device by clientMessageId', async () => {
    const { store } = await setup();
    const local = await store.enqueueSend({ conversationId: 'c1', text: 'from phone' });
    // The same message arrives via sync (e.g. the web client already delivered it).
    await store.applyServerMessages([
      serverMessage({
        conversationId: 'c1',
        serverSequence: 3,
        clientMessageId: local.clientId,
        senderId: SELF,
        content: { text: 'from phone', mentions: [] },
      }),
    ]);
    const msgs = await store.listMessages('c1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe('sent');
    expect(await store.pendingCount()).toBe(0);
  });

  it('applies edits and deletes by changeSequence and ignores stale replays', async () => {
    const { store } = await setup();
    const original = serverMessage({ conversationId: 'c1', serverSequence: 1 });
    const edited = {
      ...original,
      changeSequence: 4,
      content: { text: 'edited', mentions: [] },
      editedAt: '2026-11-02T00:00:00.000Z',
    };
    await store.applyServerMessages([edited]);
    await store.applyServerMessages([original]); // late, stale event
    let [m] = await store.listMessages('c1');
    expect(m!.text).toBe('edited');
    await store.applyServerMessages([
      { ...edited, changeSequence: 6, deletedAt: '2026-11-03T00:00:00.000Z' },
    ]);
    [m] = await store.listMessages('c1');
    expect(m!.deletedAt).toBeTruthy();
    expect(m!.text).toBe('');
  });

  it('derives delivered and read from receipt watermarks', async () => {
    const { store } = await setup();
    const local = await store.enqueueSend({ conversationId: 'c1', text: 'ping' });
    await processor(store, fakeServer().send).p.kick();
    await store.applyReceipts([
      { conversationId: 'c1', userId: PEER, deliveredUpTo: 1, readUpTo: 0 },
    ]);
    expect((await store.getMessage(local.clientId))!.status).toBe('delivered');
    await store.applyReceipts([
      { conversationId: 'c1', userId: PEER, deliveredUpTo: 0, readUpTo: 1 },
    ]);
    expect((await store.getMessage(local.clientId))!.status).toBe('read');
    // A re-applied ack does not move it back to sent.
    await store.applyServerMessages([
      {
        ...(
          await fakeServer().send({
            conversationId: 'c1',
            clientMessageId: local.clientId,
            content: { text: 'ping', mentions: [] },
          })
        ).message,
        changeSequence: 9,
      },
    ]);
    expect((await store.getMessage(local.clientId))!.status).toBe('read');
  });

  it('counts unread from the read watermark', async () => {
    const { store } = await setup();
    await store.applyServerMessages(
      [1, 2, 3].map((s) => serverMessage({ conversationId: 'c1', serverSequence: s })),
    );
    expect((await store.getConversation('c1'))!.unread).toBe(3);
    expect(await store.markReadLocally('c1', 2)).toBe(true);
    expect((await store.getConversation('c1'))!.unread).toBe(1);
    expect(await store.markReadLocally('c1', 1)).toBe(false);
  });

  it('enforces the cache quota without evicting unsent messages', async () => {
    const { store } = await setup();
    await store.upsertConversations([conversation('c2')]);
    await store.applyServerMessages(
      Array.from({ length: 7 }, (_, i) =>
        serverMessage({ conversationId: 'c1', serverSequence: i + 1 }),
      ),
    );
    await store.applyServerMessages(
      Array.from({ length: 5 }, (_, i) =>
        serverMessage({ conversationId: 'c2', serverSequence: i + 1 }),
      ),
    );
    const unsent = await store.enqueueSend({ conversationId: 'c1', text: 'keep' });
    const removed = await store.enforceQuota();
    expect(removed).toBe(4); // 2 over the per-conversation cap in c1, then the 2 oldest overall for the total cap of 8
    const c1 = await store.listMessages('c1');
    expect(c1.map((m) => m.serverSeq)).toEqual([3, 4, 5, 6, 7, null]);
    expect((await store.listMessages('c2')).map((m) => m.serverSeq)).toEqual([3, 4, 5]);
    expect(c1.at(-1)!.clientId).toBe(unsent.clientId);
  });

  it('purges conversations the user lost access to', async () => {
    const { store } = await setup();
    await store.applyServerMessages([serverMessage({ conversationId: 'c1', serverSequence: 1 })]);
    await store.purgeConversations(['c1']);
    expect(await store.listConversations()).toEqual([]);
    expect(await store.listMessages('c1')).toEqual([]);
  });
});

describe('cursor sync', () => {
  it('pages through changes, discovers new conversations and stores cursors', async () => {
    const { store } = await setup();
    const calls: number[][] = [];
    const pages: SyncResponse[] = [
      {
        conversations: [
          conversation('c1', { lastChangeSequence: 3 }),
          conversation('c9', { lastChangeSequence: 1 }),
        ],
        results: [
          {
            conversationId: 'c1',
            changes: [1, 2].map((s) => serverMessage({ conversationId: 'c1', serverSequence: s })),
            nextCursor: 2,
            hasMore: true,
            receipts: [],
          },
        ],
        revokedConversationIds: [],
        serverTime: '2026-11-21T00:00:00.000Z',
      },
      {
        conversations: [
          conversation('c1', { lastChangeSequence: 3 }),
          conversation('c9', { lastChangeSequence: 1 }),
        ],
        results: [
          {
            conversationId: 'c1',
            changes: [serverMessage({ conversationId: 'c1', serverSequence: 3 })],
            nextCursor: 3,
            hasMore: false,
            receipts: [],
          },
          {
            conversationId: 'c9',
            changes: [serverMessage({ conversationId: 'c9', serverSequence: 1 })],
            nextCursor: 1,
            hasMore: false,
            receipts: [],
          },
        ],
        revokedConversationIds: [],
        serverTime: '2026-11-21T00:00:01.000Z',
      },
    ];
    const api = {
      sync: async (req: { cursors?: { afterChangeSequence: number }[] }) => {
        calls.push((req.cursors ?? []).map((c) => c.afterChangeSequence));
        return pages[Math.min(calls.length - 1, pages.length - 1)]!;
      },
    } as unknown as ApiTransport;
    const result = await new SyncEngine(store, api).syncAll();
    expect(result.rounds).toBe(2);
    expect(calls[0]).toEqual([0]);
    expect(calls[1]!.sort()).toEqual([0, 2]);
    expect(
      (await store.cursors()).sort((a, b) => a.conversationId.localeCompare(b.conversationId)),
    ).toEqual([
      { conversationId: 'c1', afterChangeSequence: 3 },
      { conversationId: 'c9', afterChangeSequence: 1 },
    ]);
    expect((await store.listMessages('c1')).map((m) => m.serverSeq)).toEqual([1, 2, 3]);
  });
});
