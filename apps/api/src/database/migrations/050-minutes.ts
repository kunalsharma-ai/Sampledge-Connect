import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

/**
 * Minutes of meeting (one per call) and live caption lines kept for them when the
 * organization turned that on. Captions expire through a TTL index.
 */
export const minutesMigration: Migration = {
  id: '050-minutes',
  async up(db) {
    await ensureCollection(
      db,
      'meeting_minutes',
      tenantScoped(['callId', 'conversationId', 'status', 'revision', 'createdAt', 'updatedAt'], {
        callId: str,
        conversationId: str,
        meetingId: nullable(str),
        title: { bsonType: 'string', maxLength: 200 },
        status: { enum: ['draft', 'shared'] },
        summary: { bsonType: 'string', maxLength: 8000 },
        notes: { bsonType: 'string', maxLength: 20_000 },
        revision: int,
        createdAt: date,
        updatedAt: date,
      }),
    );
    await db.collection('meeting_minutes').createIndexes([
      { key: { tenantId: 1, callId: 1 }, name: 'one_per_call', unique: true },
      { key: { tenantId: 1, conversationId: 1, startedAt: -1 }, name: 'by_conversation' },
    ]);
    await ensureCollection(
      db,
      'call_captions',
      tenantScoped(['callId', 'conversationId', 'speaker', 'text', 'at', 'expiresAt'], {
        callId: str,
        conversationId: str,
        userId: nullable(str),
        speaker: { bsonType: 'string', maxLength: 120 },
        text: { bsonType: 'string', maxLength: 4000 },
        at: date,
        expiresAt: date,
      }),
    );
    await db.collection('call_captions').createIndexes([
      { key: { tenantId: 1, callId: 1, at: 1 }, name: 'by_call' },
      { key: { expiresAt: 1 }, name: 'ttl', expireAfterSeconds: 0 },
    ]);
    await db
      .collection('ai_transcripts')
      .createIndex(
        { tenantId: 1, 'translations.status': 1 },
        { name: 'translation_queue', sparse: true },
      );
  },
};
