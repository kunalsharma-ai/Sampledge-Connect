import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

/**
 * Recurring meetings: the series rule and template (`meeting_series`), and a lookup of a
 * series' occurrences. Occurrences are ordinary `meetings` documents with `series.seriesId`.
 */
export const meetingSeriesMigration: Migration = {
  id: '030-meeting-series',
  async up(db) {
    await ensureCollection(
      db,
      'meeting_series',
      tenantScoped(
        [
          'conversationId',
          'organizerId',
          'title',
          'timeZone',
          'recurrence',
          'anchorStartsAt',
          'durationMinutes',
          'status',
          'lastStartsAt',
          'createdAt',
          'updatedAt',
        ],
        {
          conversationId: str,
          organizerId: str,
          title: { bsonType: 'string', maxLength: 120 },
          agenda: { bsonType: 'string', maxLength: 4000 },
          timeZone: str,
          recurrence: {
            bsonType: 'object',
            required: ['frequency', 'interval'],
            properties: {
              frequency: { enum: ['daily', 'weekly', 'monthly'] },
              interval: { bsonType: ['int', 'long'], minimum: 1, maximum: 30 },
            },
          },
          anchorStartsAt: date,
          durationMinutes: { bsonType: ['int', 'long', 'double'] },
          status: { enum: ['active', 'cancelled'] },
          lastStartsAt: date,
          complete: { bsonType: 'bool' },
          messageId: nullable(str),
          createdAt: date,
          updatedAt: date,
        },
      ),
    );
    await db.collection('meeting_series').createIndexes([
      // Sweeper: open-ended series that need more occurrences (all tenants).
      { key: { status: 1, complete: 1, lastStartsAt: 1 }, name: 'to_extend' },
    ]);
    await db.collection('meetings').createIndex(
      { tenantId: 1, 'series.seriesId': 1, startsAt: 1 },
      {
        name: 'by_series',
        partialFilterExpression: { 'series.seriesId': { $type: 'string' } },
      },
    );
  },
};
