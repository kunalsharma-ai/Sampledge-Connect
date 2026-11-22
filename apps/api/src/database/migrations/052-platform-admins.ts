import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str } from './001-initial.js';

/**
 * Super admin console (docs/super-admin.md): platform admins with roles, the audit log of
 * what they do, and the organization lifecycle (suspension, scheduled deletion).
 */
export const platformAdminsMigration: Migration = {
  id: '052-platform-admins',
  async up(db) {
    await ensureCollection(db, 'platform_admins', {
      bsonType: 'object',
      required: ['_id', 'tenantId', 'userId', 'email', 'role', 'addedAt'],
      properties: {
        _id: str,
        tenantId: str,
        userId: str,
        email: str,
        role: { enum: ['owner', 'admin', 'billing', 'support', 'moderator'] },
        addedAt: date,
        addedBy: nullable(str),
        bootstrap: { bsonType: 'bool' },
      },
    });
    await db.collection('platform_admins').createIndexes([
      { key: { tenantId: 1, userId: 1 }, name: 'account', unique: true },
      { key: { role: 1 }, name: 'role' },
    ]);

    await ensureCollection(db, 'platform_audit', {
      bsonType: 'object',
      required: ['_id', 'action', 'at'],
      properties: {
        _id: str,
        action: str,
        at: date,
        tenantId: nullable(str),
        actor: nullable({ bsonType: 'object' }),
        target: nullable({ bsonType: 'object' }),
        metadata: { bsonType: 'object' },
        ip: nullable(str),
      },
    });
    await db.collection('platform_audit').createIndexes([
      { key: { at: -1, _id: -1 }, name: 'recent' },
      { key: { tenantId: 1, at: -1 }, name: 'by_org' },
    ]);

    await db.collection('tenants').createIndexes([
      { key: { status: 1, createdAt: -1 }, name: 'by_status' },
      { key: { 'deletion.scheduledFor': 1 }, name: 'deletion_due', sparse: true },
    ]);
  },
};
