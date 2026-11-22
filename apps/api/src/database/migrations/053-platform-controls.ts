import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str } from './001-initial.js';

/**
 * Super admin controls (docs/super-admin.md): platform-wide settings (the default
 * permission policy, activity retention) and reading every organization's activity at once.
 */
export const platformControlsMigration: Migration = {
  id: '053-platform-controls',
  async up(db) {
    await ensureCollection(db, 'platform_settings', {
      bsonType: 'object',
      required: ['_id', 'updatedAt'],
      properties: {
        _id: { enum: ['permissions', 'activity'] },
        updatedAt: date,
        updatedBy: nullable(str),
      },
    });
    await db.collection('audit_logs').createIndex({ at: -1, _id: -1 }, { name: 'all_by_time' });
    await db.collection('audit_logs').createIndex({ action: 1, at: -1 }, { name: 'by_action' });
  },
};
