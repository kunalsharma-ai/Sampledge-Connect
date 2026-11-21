import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

/**
 * Private AI assistant: the message vector index, per-conversation index watermarks, a
 * summary cache, and drafted actions awaiting confirmation. Cache and drafts expire on
 * their own (TTL indexes). The id leaves room for 008-010 from other features.
 */
export const aiMigration: Migration = {
  id: '011-ai',
  async up(db) {
    await ensureCollection(
      db,
      'ai_embeddings',
      tenantScoped(['conversationId', 'messageId', 'model', 'vector', 'createdAt'], {
        conversationId: str,
        messageId: str,
        senderId: str,
        model: str,
        vector: { bsonType: 'array', maxItems: 8192 },
        changeSequence: int,
        createdAt: date,
      }),
    );
    await db.collection('ai_embeddings').createIndexes([
      { key: { tenantId: 1, messageId: 1, model: 1 }, name: 'one_per_message', unique: true },
      { key: { tenantId: 1, model: 1, conversationId: 1, createdAt: -1 }, name: 'scope' },
    ]);

    await db
      .collection('ai_index_state')
      .createIndex(
        { tenantId: 1, conversationId: 1, model: 1 },
        { unique: true, name: 'one_per_conversation' },
      );

    await db.collection('ai_summaries').createIndexes([
      { key: { tenantId: 1, conversationId: 1, key: 1 }, name: 'lookup', unique: true },
      { key: { createdAt: 1 }, name: 'ttl', expireAfterSeconds: 7 * 86_400 },
    ]);

    await ensureCollection(
      db,
      'ai_proposals',
      tenantScoped(['userId', 'kind', 'conversationId', 'text', 'status', 'expiresAt'], {
        userId: str,
        kind: { enum: ['send_message'] },
        conversationId: str,
        text: { bsonType: 'string', maxLength: 8000 },
        status: { enum: ['pending', 'confirmed', 'dismissed'] },
        clientMessageId: str,
        messageId: nullable(str),
        createdAt: date,
        expiresAt: date,
        confirmedAt: nullable(date),
      }),
    );
    // Confirmed drafts are kept a day for idempotent re-confirms, then removed.
    await db.collection('ai_proposals').createIndexes([
      { key: { tenantId: 1, userId: 1, createdAt: -1 }, name: 'mine' },
      { key: { expiresAt: 1 }, name: 'ttl', expireAfterSeconds: 86_400 },
    ]);
  },
};
