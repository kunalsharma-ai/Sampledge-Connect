import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

/** Phase 1b: file attachments (metadata here; bytes in the storage adapter). */
export const attachmentsMigration: Migration = {
  id: '002-attachments',
  async up(db) {
    await ensureCollection(
      db,
      'attachments',
      tenantScoped(
        [
          'conversationId',
          'uploaderId',
          'fileName',
          'mimeType',
          'sizeBytes',
          'status',
          'createdAt',
        ],
        {
          conversationId: str,
          uploaderId: str,
          fileName: { bsonType: 'string', maxLength: 255 },
          mimeType: { bsonType: 'string', maxLength: 127 },
          sizeBytes: { ...int, minimum: 1 },
          storedBytes: nullable(int),
          sha256: nullable(str),
          width: nullable(int),
          height: nullable(int),
          status: { enum: ['pending', 'ready'] },
          storageKey: nullable(str),
          messageId: nullable(str),
          createdAt: date,
          completedAt: nullable(date),
        },
      ),
    );
    await db.collection('attachments').createIndexes([
      { key: { tenantId: 1, conversationId: 1, createdAt: -1 }, name: 'conversation_files' },
      { key: { tenantId: 1, messageId: 1 }, name: 'by_message' },
      // Abandoned uploads are cleaned up by a sweeper (planned); index supports it.
      { key: { status: 1, createdAt: 1 }, name: 'pending_age' },
    ]);
  },
};
