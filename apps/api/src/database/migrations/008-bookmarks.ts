import type { Migration } from './runner.js';
import { date, ensureCollection, str, tenantScoped } from './001-initial.js';

/** Phase 1: per-user saved messages (bookmarks), plus an index for a conversation's pins. */
export const bookmarksMigration: Migration = {
  id: '008-bookmarks',
  async up(db) {
    await ensureCollection(
      db,
      'bookmarks',
      tenantScoped(['userId', 'messageId', 'conversationId', 'createdAt'], {
        userId: str,
        messageId: str,
        conversationId: str,
        createdAt: date,
      }),
    );
    await db.collection('bookmarks').createIndexes([
      { key: { tenantId: 1, userId: 1, messageId: 1 }, name: 'one_per_message', unique: true },
      { key: { tenantId: 1, userId: 1, _id: -1 }, name: 'saved_newest_first' },
      { key: { tenantId: 1, messageId: 1 }, name: 'by_message' },
    ]);
    await db
      .collection('messages')
      .createIndex(
        { tenantId: 1, conversationId: 1, 'pinned.pinnedAt': -1 },
        { name: 'pins', partialFilterExpression: { 'pinned.pinnedAt': { $type: 'date' } } },
      );
  },
};
