import type { Migration } from './runner.js';

/**
 * Launch readiness: indexes for the sorted lists that otherwise sort in memory
 * (found by test/performance.test.ts).
 */
export const launchIndexesMigration: Migration = {
  id: '022-launch-indexes',
  async up(db) {
    // Audit log pages sort by time, then id as a tie-breaker for the cursor.
    await db.collection('audit_logs').createIndex({ tenantId: 1, at: -1, _id: -1 });
    await db
      .collection('audit_logs')
      .dropIndex('tenantId_1_at_-1')
      .catch(() => undefined);
    // Device lists: your own, and everyone's for admins, most recent first.
    await db
      .collection('devices')
      .createIndexes([
        { key: { tenantId: 1, userId: 1, lastSeenAt: -1 } },
        { key: { tenantId: 1, lastSeenAt: -1 } },
      ]);
    // Directory, sorted by name.
    await db.collection('users').createIndex({ tenantId: 1, displayName: 1 });
  },
};
