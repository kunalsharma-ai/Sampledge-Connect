import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

/** Phase 1b: messages scheduled to send later. */
export const scheduledMessagesMigration: Migration = {
  id: '020-scheduled-messages',
  async up(db) {
    await ensureCollection(
      db,
      'scheduled_messages',
      tenantScoped(
        [
          'conversationId',
          'userId',
          'clientMessageId',
          'content',
          'sendAt',
          'status',
          'attempts',
          'createdAt',
          'updatedAt',
        ],
        {
          conversationId: str,
          userId: str,
          clientMessageId: str,
          content: { bsonType: 'object', required: ['text', 'mentions'] },
          replyToMessageId: nullable(str),
          sendAt: date,
          status: { enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'] },
          messageId: nullable(str),
          error: nullable(str),
          attempts: int,
          createdAt: date,
          updatedAt: date,
        },
      ),
    );
    await db.collection('scheduled_messages').createIndexes([
      { key: { status: 1, sendAt: 1 }, name: 'due' },
      { key: { tenantId: 1, userId: 1, status: 1, sendAt: 1 }, name: 'mine' },
      { key: { tenantId: 1, clientMessageId: 1 }, name: 'client_id', unique: true },
    ]);
  },
};
