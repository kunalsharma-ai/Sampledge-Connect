import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

/**
 * Recordings: chat clips and call recordings are attachments with a `recording` kind.
 * Adds the indexes the recordings library and the retention sweeper need, and per-tenant
 * recording settings. Existing attachments need no backfill (the new fields are optional).
 */
export const recordingsMigration: Migration = {
  id: '006-recordings',
  async up(db) {
    await db.collection('attachments').createIndexes([
      // Library: recordings in a conversation / tenant, newest first.
      {
        key: { tenantId: 1, conversationId: 1, recording: 1, createdAt: -1 },
        name: 'conversation_recordings',
        partialFilterExpression: { recording: { $type: 'string' } },
      },
      // Retention sweeper (all tenants) and admin export.
      {
        key: { tenantId: 1, createdAt: 1 },
        name: 'recordings_by_age',
        partialFilterExpression: { recording: { $type: 'string' } },
      },
    ]);
    await db.collection('calls').createIndex(
      { 'recording.egressId': 1 },
      {
        name: 'by_egress',
        partialFilterExpression: { 'recording.egressId': { $type: 'string' } },
      },
    );
    await ensureCollection(
      db,
      'tenant_settings',
      tenantScoped(['updatedAt'], {
        recordingRetentionDays: nullable({ bsonType: ['int', 'long'], minimum: 1, maximum: 3650 }),
        callRecordingEnabled: { bsonType: 'bool' },
        updatedAt: date,
        updatedBy: nullable(str),
      }),
    );
    await db
      .collection('tenant_settings')
      .createIndex({ tenantId: 1 }, { unique: true, name: 'one_per_tenant' });
  },
};
