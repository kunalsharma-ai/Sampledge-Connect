import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

/**
 * Transcripts of call recordings and voice messages, made by the organization's own
 * speech-to-text server (Integrations › Speech-to-text). One per attachment.
 */
export const aiTranscriptsMigration: Migration = {
  id: '012-ai-transcripts',
  async up(db) {
    await ensureCollection(
      db,
      'ai_transcripts',
      tenantScoped(['attachmentId', 'conversationId', 'status', 'createdAt', 'updatedAt'], {
        attachmentId: str,
        conversationId: str,
        messageId: nullable(str),
        status: { enum: ['queued', 'processing', 'done', 'failed'] },
        text: nullable({ bsonType: 'string', maxLength: 2_000_000 }),
        segments: { bsonType: 'array', maxItems: 20_000 },
        attempts: int,
        createdAt: date,
        updatedAt: date,
      }),
    );
    await db.collection('ai_transcripts').createIndexes([
      { key: { tenantId: 1, attachmentId: 1 }, name: 'one_per_attachment', unique: true },
      { key: { tenantId: 1, messageId: 1 }, name: 'by_message' },
      { key: { tenantId: 1, status: 1, updatedAt: 1 }, name: 'queue' },
    ]);
  },
};
