import type { Migration } from './runner.js';

/** Call backgrounds: one choice per person, and their own uploaded images. */
export const callBackgroundsMigration: Migration = {
  id: '042-call-backgrounds',
  async up(db) {
    await db
      .collection('call_background_prefs')
      .createIndexes([{ key: { tenantId: 1, userId: 1 }, name: 'one_per_user', unique: true }]);
    await db
      .collection('call_background_images')
      .createIndexes([{ key: { tenantId: 1, userId: 1 }, name: 'by_user' }]);
  },
};
