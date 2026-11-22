import type { Migration } from './runner.js';
import { date, ensureCollection, str, tenantScoped } from './001-initial.js';

/** Help center queries (docs/help-center.md). */
export const supportMigration: Migration = {
  id: '054-support',
  async up(db) {
    await ensureCollection(
      db,
      'support_queries',
      tenantScoped(['clientId', 'requesterId', 'subject', 'status', 'route', 'createdAt'], {
        clientId: str,
        requesterId: str,
        subject: str,
        status: { enum: ['open', 'in_progress', 'answered', 'resolved'] },
        route: { enum: ['org', 'platform'] },
        createdAt: date,
        updatedAt: date,
      }),
    );
    await db.collection('support_queries').createIndexes([
      {
        key: { tenantId: 1, requesterId: 1, clientId: 1 },
        name: 'one_per_client_id',
        unique: true,
      },
      { key: { tenantId: 1, requesterId: 1, updatedAt: -1 }, name: 'mine_newest' },
      { key: { tenantId: 1, updatedAt: -1 }, name: 'org_newest' },
      { key: { route: 1, updatedAt: -1 }, name: 'platform_newest' },
    ]);
  },
};
