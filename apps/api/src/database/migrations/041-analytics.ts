import type { Migration } from './runner.js';

/** Analytics: messages, calls and task completions by time across the organization. */
export const analyticsMigration: Migration = {
  id: '041-analytics',
  async up(db) {
    await db
      .collection('messages')
      .createIndex({ tenantId: 1, createdAt: -1 }, { name: 'by_created' });
    await db
      .collection('calls')
      .createIndex({ tenantId: 1, startedAt: -1 }, { name: 'by_started' });
    await db
      .collection('tasks')
      .createIndex({ tenantId: 1, completedAt: -1 }, { name: 'by_completed', sparse: true });
  },
};
