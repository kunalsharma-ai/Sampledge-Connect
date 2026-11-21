import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

/** Voice and video calls (media runs through the self-hosted SFU; this is the call record). */
export const callsMigration: Migration = {
  id: '004-calls',
  async up(db) {
    await ensureCollection(
      db,
      'calls',
      tenantScoped(
        [
          'conversationId',
          'media',
          'status',
          'startedBy',
          'startedAt',
          'room',
          'participants',
          'lastActivityAt',
        ],
        {
          conversationId: str,
          media: { enum: ['audio', 'video'] },
          status: { enum: ['live', 'ended'] },
          startedBy: str,
          startedAt: date,
          endedAt: nullable(date),
          room: str,
          participants: {
            bsonType: 'array',
            maxItems: 1000,
            items: {
              bsonType: 'object',
              required: ['userId', 'state'],
              properties: {
                userId: str,
                state: { enum: ['ringing', 'joined', 'left', 'declined', 'missed'] },
                joinedAt: nullable(date),
                leftAt: nullable(date),
                ringUntil: nullable(date),
              },
            },
          },
          messageId: nullable(str),
          lastActivityAt: date,
        },
      ),
    );
    await db.collection('calls').createIndexes([
      // At most one live call per conversation: concurrent "start" requests converge on it.
      {
        key: { tenantId: 1, conversationId: 1 },
        name: 'one_live_per_conversation',
        unique: true,
        partialFilterExpression: { status: 'live' },
      },
      { key: { tenantId: 1, conversationId: 1, startedAt: -1 }, name: 'history' },
      { key: { room: 1 }, name: 'by_room', unique: true },
      // Sweeper: live calls with expiring rings or no activity.
      { key: { status: 1, lastActivityAt: 1 }, name: 'sweep' },
    ]);
  },
};
