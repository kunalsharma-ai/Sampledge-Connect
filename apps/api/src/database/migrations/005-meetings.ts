import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

const HHMM = { bsonType: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };

/** Scheduled meetings and per-user working hours (availability for "find a time"). */
export const meetingsMigration: Migration = {
  id: '005-meetings',
  async up(db) {
    await ensureCollection(
      db,
      'meetings',
      tenantScoped(
        [
          'conversationId',
          'title',
          'startsAt',
          'endsAt',
          'timeZone',
          'organizerId',
          'attendees',
          'status',
          'createdAt',
          'updatedAt',
        ],
        {
          conversationId: str,
          title: { bsonType: 'string', maxLength: 120 },
          agenda: { bsonType: 'string', maxLength: 4000 },
          startsAt: date,
          endsAt: date,
          timeZone: str,
          organizerId: str,
          attendees: {
            bsonType: 'array',
            maxItems: 301,
            items: {
              bsonType: 'object',
              required: ['userId', 'response'],
              properties: {
                userId: str,
                response: { enum: ['pending', 'accepted', 'tentative', 'declined'] },
                optional: { bsonType: 'bool' },
              },
            },
          },
          media: { enum: ['audio', 'video'] },
          remindMinutes: { bsonType: 'array', maxItems: 3 },
          remindersSent: { bsonType: 'array' },
          status: { enum: ['scheduled', 'cancelled'] },
          messageId: nullable(str),
          createdAt: date,
          updatedAt: date,
        },
      ),
    );
    await db.collection('meetings').createIndexes([
      // Calendar: my meetings overlapping a range.
      { key: { tenantId: 1, 'attendees.userId': 1, startsAt: 1 }, name: 'calendar' },
      { key: { tenantId: 1, conversationId: 1, startsAt: 1 }, name: 'by_conversation' },
      // Reminder sweeper (all tenants).
      { key: { status: 1, startsAt: 1 }, name: 'upcoming' },
    ]);

    await ensureCollection(
      db,
      'user_settings',
      tenantScoped(['userId', 'workingHours', 'updatedAt'], {
        userId: str,
        workingHours: {
          bsonType: 'object',
          required: ['timeZone', 'days'],
          properties: {
            timeZone: str,
            days: {
              bsonType: 'array',
              maxItems: 14,
              items: {
                bsonType: 'object',
                required: ['day', 'start', 'end'],
                properties: { day: { bsonType: ['int', 'long'] }, start: HHMM, end: HHMM },
              },
            },
          },
        },
        updatedAt: date,
      }),
    );
    await db
      .collection('user_settings')
      .createIndex({ tenantId: 1, userId: 1 }, { unique: true, name: 'one_per_user' });
  },
};
