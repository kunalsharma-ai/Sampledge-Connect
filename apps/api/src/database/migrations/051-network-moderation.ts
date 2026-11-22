import type { Migration } from './runner.js';
import { date, ensureCollection, str, tenantScoped } from './001-initial.js';

/**
 * SampConnect Network moderation: reports are actioned or dismissed (no longer "reviewed"),
 * and the queues by community and by target.
 */
export const networkModerationMigration: Migration = {
  id: '051-network-moderation',
  async up(db) {
    await db
      .collection('network_reports')
      .updateMany({ status: 'reviewed' }, { $set: { status: 'dismissed' } });
    await ensureCollection(
      db,
      'network_reports',
      tenantScoped(['reporterId', 'targetType', 'targetId', 'reason', 'status', 'createdAt'], {
        reporterId: str,
        targetType: { enum: ['user', 'status', 'community', 'message'] },
        targetId: str,
        reason: str,
        status: { enum: ['open', 'actioned', 'dismissed'] },
        createdAt: date,
      }),
    );
    await db.collection('network_reports').createIndexes([
      { key: { tenantId: 1, communityId: 1, status: 1, createdAt: -1 }, name: 'community_queue' },
      { key: { tenantId: 1, targetType: 1, targetId: 1, status: 1 }, name: 'by_target' },
    ]);
    await db
      .collection('network_profiles')
      .createIndex({ tenantId: 1, suspendedAt: 1 }, { name: 'suspended', sparse: true });
    await db
      .collection('communities')
      .createIndex({ tenantId: 1, suspendedAt: 1 }, { name: 'suspended', sparse: true });
  },
};
