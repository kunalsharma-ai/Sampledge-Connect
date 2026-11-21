import { describe, expect, it, vi } from 'vitest';
import { openConnectDb, type ConnectDb } from './db.js';
import { SyncEngine, displayStatus, listConversationMessages, wipeLocalData } from './engine.js';
import { FakeServer } from './fake-server.js';

let n = 0;
async function setup(server: FakeServer, opts: { name?: string; userId?: string } = {}) {
  const name = opts.name ?? `test-db-${n++}`;
  const { db } = await openConnectDb(name);
  const onSessionExpired = vi.fn();
  const engine = new SyncEngine({
    db,
    transport: server.transportFor(opts.userId ?? 'me'),
    tenantId: 't1',
    userId: opts.userId ?? 'me',
    backoff: { baseMs: 5, capMs: 20, floorMs: 1 },
    maxAttempts: 4,
    syncDebounceMs: 5,
    onSessionExpired,
  });
  await engine.start();
  return { db, engine, name, onSessionExpired };
}

const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
};
const statuses = async (db: ConnectDb, c = 'c1') =>
  (await listConversationMessages(db, c)).map((m) => m.status);

describe('offline-first outbox', () => {
  it('persists and shows a queued message before any network attempt', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    const { db, engine } = await setup(server); // network not available yet
    const m = await engine.compose('c1', 'hello');
    expect(m.status).toBe('queued');
    expect(await statuses(db)).toEqual(['queued']);
    expect(await db.outbox.count()).toBe(1);
    expect(server.sendCalls).toBe(0);
    expect(engine.getState().queued).toBe(1);
  });

  it('keeps queued messages across a reload and sends them in order on reconnect', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    const first = await setup(server);
    await first.engine.compose('c1', 'one');
    await first.engine.compose('c1', 'two');
    await first.engine.compose('c1', 'three');
    first.engine.stop();
    first.db.close();

    // "Browser refresh": a new engine on the same database.
    const second = await setup(server, { name: first.name });
    expect(await statuses(second.db)).toEqual(['queued', 'queued', 'queued']);
    second.engine.setNetworkAvailable(true);
    await waitFor(async () => (await second.db.outbox.count()) === 0);
    expect(server.messages.map((m) => m.content.text)).toEqual(['one', 'two', 'three']);
    const local = await listConversationMessages(second.db, 'c1');
    expect(local.map((m) => [m.content.text, m.status, m.serverSequence])).toEqual([
      ['one', 'sent', 1],
      ['two', 'sent', 2],
      ['three', 'sent', 3],
    ]);
  });

  it('does not duplicate when the ack is lost after the server committed', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    const { db, engine } = await setup(server);
    server.failNext('drop-ack');
    engine.setNetworkAvailable(true);
    await engine.compose('c1', 'only once');
    await waitFor(async () => (await db.outbox.count()) === 0);
    expect(server.messages).toHaveLength(1);
    expect(server.sendCalls).toBeGreaterThanOrEqual(2);
    expect((await listConversationMessages(db, 'c1')).map((m) => m.status)).toEqual(['sent']);
  });

  it('never reports sent while the server is unreachable', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    server.online = false;
    const { db, engine } = await setup(server);
    engine.setNetworkAvailable(true);
    await engine.compose('c1', 'into the void');
    await new Promise((r) => setTimeout(r, 40));
    const [m] = await listConversationMessages(db, 'c1');
    expect(['queued', 'sending', 'failed']).toContain(m!.status);
    expect(m!.serverSequence).toBeNull();
  });

  it('retries retryable errors with backoff, then surfaces failed with manual retry', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    server.failNext('network', 'network', 'network', 'network');
    const { db, engine } = await setup(server);
    engine.setNetworkAvailable(true);
    const m = await engine.compose('c1', 'stubborn');
    await waitFor(async () => (await db.messages.get(m.clientMessageId))?.status === 'failed');
    expect(server.sendCalls).toBe(4);
    expect(engine.getState().failed).toBe(1);
    await engine.retry(m.clientMessageId);
    await waitFor(async () => (await db.messages.get(m.clientMessageId))?.status === 'sent');
    expect(server.messages).toHaveLength(1);
  });

  it('fails non-retryable errors immediately and lets the user discard', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    server.failNext({ code: 'FORBIDDEN', message: 'Removed from channel' });
    const { db, engine } = await setup(server);
    engine.setNetworkAvailable(true);
    const m = await engine.compose('c1', 'nope');
    await waitFor(async () => (await db.messages.get(m.clientMessageId))?.status === 'failed');
    expect((await db.messages.get(m.clientMessageId))!.error?.code).toBe('FORBIDDEN');
    expect(server.sendCalls).toBe(1);
    await engine.discard(m.clientMessageId);
    expect(await db.messages.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('pauses on session expiry without spending attempts, and resumes', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    server.failNext({ code: 'SESSION_EXPIRED', message: 'expired' });
    const { db, engine, onSessionExpired } = await setup(server);
    engine.setNetworkAvailable(true);
    const m = await engine.compose('c1', 'after refresh');
    await waitFor(() => engine.getState().authPaused);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    const item = await db.outbox.get(m.clientMessageId);
    expect(item).toMatchObject({ state: 'queued', attempts: 0 });
    engine.resume();
    await waitFor(async () => (await db.messages.get(m.clientMessageId))?.status === 'sent');
  });

  it('resets messages stuck in sending after a crash', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    const first = await setup(server);
    const m = await first.engine.compose('c1', 'mid-flight');
    await first.db.outbox.update(m.clientMessageId, { state: 'sending' });
    await first.db.messages.update(m.clientMessageId, { status: 'sending' });
    first.db.close();
    const second = await setup(server, { name: first.name });
    expect((await second.db.outbox.get(m.clientMessageId))!.state).toBe('queued');
    expect((await second.db.messages.get(m.clientMessageId))!.status).toBe('queued');
  });
});

describe('sync and recovery', () => {
  it('recovers messages missed while offline, in order, and advances cursors', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    const { db, engine } = await setup(server);
    server.injectFrom('b', 'c1', 'while you were away 1');
    server.injectFrom('b', 'c1', 'while you were away 2');
    engine.setNetworkAvailable(true);
    await engine.syncNow();
    expect((await listConversationMessages(db, 'c1')).map((m) => m.content.text)).toEqual([
      'while you were away 1',
      'while you were away 2',
    ]);
    expect((await db.cursors.get('c1'))!.afterChangeSequence).toBe(2);
    expect(engine.getState().lastSyncAt).not.toBeNull();
  });

  it('pages through large backlogs', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    for (let i = 0; i < 450; i++) server.injectFrom('b', 'c1', `m${i}`);
    const { db, engine } = await setup(server);
    engine.setNetworkAvailable(true);
    await engine.syncNow();
    expect(await db.messages.count()).toBe(450);
  });

  it('reconciles a message sent from another device of the same user', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    const laptop = await setup(server);
    const phone = await setup(server);
    laptop.engine.setNetworkAvailable(true);
    phone.engine.setNetworkAvailable(true);
    const m = await laptop.engine.compose('c1', 'from laptop');
    await waitFor(async () => (await laptop.db.outbox.count()) === 0);
    await phone.engine.syncNow();
    const onPhone = await phone.db.messages.get(m.clientMessageId);
    expect(onPhone).toMatchObject({ senderId: 'me', status: 'sent' });
    expect(await phone.db.messages.count()).toBe(1);
  });

  it('purges conversations the user lost access to but keeps unsent drafts as failed', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    server.injectFrom('b', 'c1', 'old');
    const { db, engine } = await setup(server);
    engine.setNetworkAvailable(true);
    await engine.syncNow();
    engine.setNetworkAvailable(false);
    const draft = await engine.compose('c1', 'unsent');
    server.conversations.get('c1')!.memberIds = ['b'];
    engine.setNetworkAvailable(true);
    await engine.syncNow();
    const left = await listConversationMessages(db, 'c1');
    expect(left.map((m) => [m.content.text, m.status])).toEqual([['unsent', 'failed']]);
    expect(await db.conversations.get('c1')).toBeUndefined();
    expect(draft.clientMessageId).toBe(left[0]!.clientMessageId);
  });

  it('derives delivered/read from receipts only for server-confirmed messages', async () => {
    const conv = { memberIds: ['me', 'b'] };
    const base = {
      clientMessageId: 'x',
      senderId: 'me',
      serverSequence: 3,
      status: 'sent',
    } as never;
    expect(
      displayStatus(base, conv, [
        { conversationId: 'c1', userId: 'b', deliveredUpTo: 3, readUpTo: 0, updatedAt: '' },
      ]),
    ).toBe('delivered');
    expect(
      displayStatus(
        { ...(base as object), status: 'queued', serverSequence: null } as never,
        conv,
        [{ conversationId: 'c1', userId: 'b', deliveredUpTo: 9, readUpTo: 9, updatedAt: '' }],
      ),
    ).toBe('queued');
  });

  it('evicts old confirmed messages under storage pressure, never unsent ones', async () => {
    const server = new FakeServer();
    server.addConversation('c1', ['me', 'b']);
    for (let i = 0; i < 30; i++) server.injectFrom('b', 'c1', `m${i}`);
    const { db, engine } = await setup(server);
    engine.setNetworkAvailable(true);
    await engine.syncNow();
    engine.setNetworkAvailable(false);
    await engine.compose('c1', 'pending');
    const evicted = await engine.enforceQuota({
      estimate: async () => ({ usage: 95, quota: 100 }),
      keepPerConversation: 10,
    });
    expect(evicted).toBe(20);
    const rest = await listConversationMessages(db, 'c1');
    expect(rest).toHaveLength(11);
    expect(rest.at(-1)!.status).toBe('queued');
  });

  it('wipes local data on logout', async () => {
    const server = new FakeServer();
    const { db, engine, name } = await setup(server);
    await engine.compose('c1', 'secret');
    engine.stop();
    await wipeLocalData(db);
    const reopened = await openConnectDb(name);
    expect(await reopened.db.messages.count()).toBe(0);
  });
});
