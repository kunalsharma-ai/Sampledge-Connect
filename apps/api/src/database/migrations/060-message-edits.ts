import type { Migration } from './runner.js';
import { date, ensureCollection, int, str, tenantScoped } from './001-initial.js';

/** Message edit history (docs/editing.md): earlier versions of edited messages. */
export const messageEditsMigration: Migration = {
  id: '060-message-edits',
  async up(db) {
    await ensureCollection(
      db,
      'message_edits',
      tenantScoped(
        ['messageId', 'conversationId', 'version', 'text', 'writtenAt', 'replacedAt', 'replacedBy'],
        {
          messageId: str,
          conversationId: str,
          version: int,
          text: str,
          writtenAt: date,
          replacedAt: date,
          replacedBy: str,
        },
      ),
    );
    await db.collection('message_edits').createIndexes([
      { key: { tenantId: 1, messageId: 1, version: 1 }, name: 'versions', unique: true },
      { key: { tenantId: 1, conversationId: 1 }, name: 'by_conversation' },
    ]);
  },
};
