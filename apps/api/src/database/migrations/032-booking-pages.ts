import type { Migration } from './runner.js';
import { date, ensureCollection, str, tenantScoped } from './001-initial.js';

/** Public booking pages. The public link carries only the slug, so slugs are unique globally. */
export const bookingPagesMigration: Migration = {
  id: '032-booking-pages',
  async up(db) {
    await ensureCollection(
      db,
      'booking_pages',
      tenantScoped(
        [
          'slug',
          'title',
          'durationMinutes',
          'hostIds',
          'mode',
          'enabled',
          'createdBy',
          'createdAt',
          'updatedAt',
        ],
        {
          slug: { bsonType: 'string', pattern: '^[a-z0-9-]{3,60}$' },
          title: { bsonType: 'string', maxLength: 120 },
          description: { bsonType: 'string', maxLength: 2000 },
          durationMinutes: { bsonType: ['int', 'long'], minimum: 10, maximum: 240 },
          hostIds: { bsonType: 'array', minItems: 1, maxItems: 20, items: str },
          mode: { enum: ['all', 'any'] },
          enabled: { bsonType: 'bool' },
          createdBy: str,
          createdAt: date,
          updatedAt: date,
        },
      ),
    );
    await db.collection('booking_pages').createIndexes([
      { key: { slug: 1 }, name: 'unique_slug', unique: true },
      { key: { tenantId: 1, hostIds: 1 }, name: 'by_host' },
    ]);
  },
};
