import type { Migration } from './runner.js';
import { date, ensureCollection, str, tenantScoped } from './001-initial.js';

/** Suggested tasks a person dismissed, so they stay hidden on all of their devices. */
export const aiSuggestionDismissalsMigration: Migration = {
  id: '014-ai-suggestion-dismissals',
  async up(db) {
    await ensureCollection(
      db,
      'ai_suggestion_dismissals',
      tenantScoped(['userId', 'suggestionId', 'createdAt'], {
        userId: str,
        suggestionId: { bsonType: 'string', pattern: '^[0-9a-f]{16}$' },
        createdAt: date,
      }),
    );
    await db.collection('ai_suggestion_dismissals').createIndexes([
      { key: { tenantId: 1, userId: 1, suggestionId: 1 }, name: 'one_per_user', unique: true },
      { key: { tenantId: 1, userId: 1, createdAt: -1 }, name: 'by_user' },
      { key: { createdAt: 1 }, name: 'ttl', expireAfterSeconds: 180 * 86_400 },
    ]);
  },
};
