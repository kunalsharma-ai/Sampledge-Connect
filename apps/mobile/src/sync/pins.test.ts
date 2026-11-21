import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, () => 1_000_000);
  await store.upsertConversations([conversation('c1')]);
  return { db, store };
}

describe('pins on the device', () => {
  it('keeps pins from sync, lists the newest pin first, and drops them on unpin or delete', async () => {
    const { store } = await setup();
    const a = serverMessage({ conversationId: 'c1', serverSequence: 1 });
    const b = serverMessage({ conversationId: 'c1', serverSequence: 2 });
    await store.applyServerMessages([a, b]);
    expect(await store.listPinned('c1')).toEqual([]);

    await store.applyServerMessages([
      { ...a, changeSequence: 3, pinned: { pinnedBy: PEER, pinnedAt: '2026-11-21T10:00:00.000Z' } },
      { ...b, changeSequence: 4, pinned: { pinnedBy: SELF, pinnedAt: '2026-11-21T11:00:00.000Z' } },
    ]);
    const pins = await store.listPinned('c1');
    expect(pins.map((m) => m.messageId)).toEqual([b.messageId, a.messageId]);
    expect(pins[1]!.pinned).toEqual({ pinnedBy: PEER, pinnedAt: '2026-11-21T10:00:00.000Z' });
    expect(
      (await store.listMessages('c1')).find((m) => m.messageId === a.messageId)?.pinned,
    ).not.toBeNull();

    // A stale copy (older change) must not bring a removed pin back.
    await store.applyServerMessages([{ ...b, changeSequence: 5, pinned: null }]);
    await store.applyServerMessages([
      { ...b, changeSequence: 4, pinned: { pinnedBy: SELF, pinnedAt: '2026-11-21T11:00:00.000Z' } },
    ]);
    // Deleting a pinned message removes its pin too.
    await store.applyServerMessages([
      {
        ...a,
        changeSequence: 6,
        deletedAt: '2026-11-21T12:00:00.000Z',
        pinned: { pinnedBy: PEER, pinnedAt: '2026-11-21T10:00:00.000Z' },
      },
    ]);
    expect(await store.listPinned('c1')).toEqual([]);
  });

  it('upgrading to v10 re-downloads history so earlier pins show up', async () => {
    const db = openNodeDriver();
    await migrate(db);
    const store = new LocalStore(db, SELF, undefined, () => 1_000_000);
    await store.upsertConversations([conversation('c1')]);
    const m = serverMessage({ conversationId: 'c1', serverSequence: 7 });
    await store.applyServerMessages([m]);
    await store.setCursor('c1', 7);
    // Simulate a v9 cache: drop back one version and migrate again.
    await db.exec('PRAGMA user_version = 9');
    await db.exec('ALTER TABLE messages DROP COLUMN pinned');
    await db.exec('ALTER TABLE messages DROP COLUMN poll');
    await migrate(db);
    expect(await store.cursors()).toEqual([{ conversationId: 'c1', afterChangeSequence: 0 }]);
    // Same change as before (pinned before the upgrade), so it only applies after the reset.
    await store.applyServerMessages([
      { ...m, pinned: { pinnedBy: PEER, pinnedAt: '2026-11-20T09:00:00.000Z' } },
    ]);
    expect((await store.listPinned('c1')).length).toBe(1);
  });
});
