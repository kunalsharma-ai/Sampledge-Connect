import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str } from './001-initial.js';

/**
 * Integration settings (SMTP, LiveKit, push, AI, connectors, modules…) stored in the
 * database instead of env. tenantId is a tenant id, or null for platform-wide settings.
 */
export const integrationSettingsMigration: Migration = {
  id: '010-integration-settings',
  async up(db) {
    await ensureCollection(db, 'integration_settings', {
      bsonType: 'object',
      required: ['providerId', 'enabled', 'values', 'secrets', 'updatedAt'],
      properties: {
        tenantId: nullable(str),
        providerId: str,
        enabled: { bsonType: 'bool' },
        values: { bsonType: 'object' },
        /** field key → sealed ciphertext */
        secrets: { bsonType: 'object' },
        updatedAt: date,
        updatedBy: nullable(str),
        lastTest: nullable({ bsonType: 'object' }),
      },
    });
    await db
      .collection('integration_settings')
      .createIndex({ tenantId: 1, providerId: 1 }, { name: 'one_per_scope', unique: true });
  },
};
