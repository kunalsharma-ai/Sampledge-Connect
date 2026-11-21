import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

/** Phase 1b: per-user in-app notifications (mentions, replies). */
export const notificationsMigration: Migration = {
  id: '003-notifications',
  async up(db) {
    await ensureCollection(
      db,
      'notifications',
      tenantScoped(
        ['userId', 'kind', 'conversationId', 'messageId', 'actorId', 'preview', 'createdAt'],
        {
          userId: str,
          kind: { enum: ['mention', 'reply'] },
          conversationId: str,
          messageId: str,
          actorId: str,
          preview: { bsonType: 'string', maxLength: 200 },
          createdAt: date,
          readAt: nullable(date),
        },
      ),
    );
    await db.collection('notifications').createIndexes([
      // Inbox, newest first (ids are time-ordered ObjectId hex).
      { key: { tenantId: 1, userId: 1, _id: -1 }, name: 'inbox' },
      { key: { tenantId: 1, userId: 1, readAt: 1 }, name: 'unread' },
      // One notification per user per message, so a retried fan-out cannot duplicate.
      { key: { tenantId: 1, userId: 1, messageId: 1 }, name: 'one_per_message', unique: true },
      { key: { tenantId: 1, messageId: 1 }, name: 'by_message' },
    ]);
  },
};
