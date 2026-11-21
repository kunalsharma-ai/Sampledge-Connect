import type { Migration } from './runner.js';

/**
 * External meeting guests are embedded in their meeting (`meetings.guests`); a guest's join
 * link carries only the guest id, so it needs a cross-tenant lookup by that id. The lobby and
 * admitted guests live on the call record and need no index of their own.
 */
export const guestsMigration: Migration = {
  id: '007-guests',
  async up(db) {
    await db.collection('meetings').createIndex(
      { 'guests.guestId': 1 },
      {
        name: 'by_guest',
        partialFilterExpression: { 'guests.guestId': { $type: 'string' } },
      },
    );
  },
};
