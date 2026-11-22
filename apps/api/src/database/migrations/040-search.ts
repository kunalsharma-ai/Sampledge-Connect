import type { Migration } from './runner.js';
import { date, ensureCollection, str, tenantScoped } from './001-initial.js';

/** Universal Search: recent searches per person, and an index for the "from:" filter. */
export const searchMigration: Migration = {
  id: '040-search',
  async up(db) {
    await ensureCollection(
      db,
      'search_history',
      tenantScoped(['userId', 'recent', 'updatedAt'], {
        userId: str,
        recent: { bsonType: 'array', maxItems: 10, items: { bsonType: 'string', maxLength: 200 } },
        updatedAt: date,
      }),
    );
    await db
      .collection('search_history')
      .createIndex({ tenantId: 1, userId: 1 }, { unique: true, name: 'one_per_user' });
    await db
      .collection('messages')
      .createIndex({ tenantId: 1, senderId: 1, createdAt: -1 }, { name: 'by_sender' });
  },
};
