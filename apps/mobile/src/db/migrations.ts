import type { SqlDriver, SqlExecutor } from './driver';

/**
 * Versioned schema for the on-device cache. Append new migrations; never edit old ones.
 * The schema version lives in SQLite's `PRAGMA user_version`.
 */
export const MIGRATIONS: ReadonlyArray<(tx: SqlExecutor) => Promise<void>> = [
  // v1: initial cache, outbox and settings
  async (tx) => {
    await tx.exec(`
      CREATE TABLE conversations (
        conversation_id   TEXT PRIMARY KEY,
        kind              TEXT NOT NULL,
        name              TEXT,
        topic             TEXT,
        member_ids        TEXT NOT NULL DEFAULT '[]',
        archived_at       TEXT,
        my_role           TEXT,
        last_change_seq   INTEGER NOT NULL DEFAULT 0,
        cursor            INTEGER NOT NULL DEFAULT 0,
        last_message_at   TEXT,
        last_preview      TEXT,
        read_up_to        INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        client_id         TEXT PRIMARY KEY,
        message_id        TEXT UNIQUE,
        conversation_id   TEXT NOT NULL,
        sender_id         TEXT NOT NULL,
        text              TEXT NOT NULL,
        mentions          TEXT NOT NULL DEFAULT '[]',
        reply_to          TEXT,
        server_seq        INTEGER,
        change_seq        INTEGER,
        status            TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        edited_at         TEXT,
        deleted_at        TEXT,
        error             TEXT
      );
      CREATE INDEX messages_by_conversation ON messages (conversation_id, server_seq);
      CREATE TABLE receipts (
        conversation_id   TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        delivered_up_to   INTEGER NOT NULL DEFAULT 0,
        read_up_to        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE TABLE outbox (
        client_id         TEXT PRIMARY KEY REFERENCES messages(client_id) ON DELETE CASCADE,
        conversation_id   TEXT NOT NULL,
        state             TEXT NOT NULL,
        attempts          INTEGER NOT NULL DEFAULT 0,
        next_attempt_at   INTEGER NOT NULL DEFAULT 0,
        last_error        TEXT,
        enqueued_at       INTEGER NOT NULL
      );
      CREATE INDEX outbox_due ON outbox (state, next_attempt_at, enqueued_at);
      CREATE TABLE drafts (
        conversation_id   TEXT PRIMARY KEY,
        text              TEXT NOT NULL,
        updated_at        INTEGER NOT NULL
      );
      CREATE TABLE kv (
        key               TEXT PRIMARY KEY,
        value             TEXT NOT NULL
      );
    `);
  },
  // v2: offline edits and deletes of sent messages
  async (tx) => {
    await tx.exec(`
      CREATE TABLE message_ops (
        client_id         TEXT PRIMARY KEY REFERENCES messages(client_id) ON DELETE CASCADE,
        message_id        TEXT NOT NULL,
        conversation_id   TEXT NOT NULL,
        kind              TEXT NOT NULL,
        text              TEXT,
        mentions          TEXT,
        prev_text         TEXT NOT NULL,
        prev_mentions     TEXT NOT NULL,
        prev_edited_at    TEXT,
        attempts          INTEGER NOT NULL DEFAULT 0,
        next_attempt_at   INTEGER NOT NULL DEFAULT 0,
        last_error        TEXT,
        enqueued_at       INTEGER NOT NULL
      );
      CREATE INDEX message_ops_due ON message_ops (next_attempt_at, enqueued_at);
    `);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  /** True when the cache could not be migrated and was rebuilt (unsent messages are preserved). */
  recovered: boolean;
}

/** Rows rescued from a broken cache before it is rebuilt. Only unsent work matters; the rest re-syncs. */
interface Salvage {
  messages: Record<string, unknown>[];
  outbox: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
}

export async function migrate(db: SqlDriver): Promise<MigrationResult> {
  const fromVersion =
    (await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  try {
    if (fromVersion > SCHEMA_VERSION) {
      throw new Error(`cache schema v${fromVersion} is newer than this app (v${SCHEMA_VERSION})`);
    }
    for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
      await db.transaction(async (tx) => {
        await MIGRATIONS[v]!(tx);
        await tx.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return { fromVersion, toVersion: SCHEMA_VERSION, recovered: false };
  } catch (err) {
    await rebuildPreservingUnsent(db);
    return { fromVersion, toVersion: SCHEMA_VERSION, recovered: true };
  }
}

async function tryAll(db: SqlExecutor, sql: string): Promise<Record<string, unknown>[]> {
  try {
    return await db.all<Record<string, unknown>>(sql);
  } catch {
    return [];
  }
}

/**
 * Cache recovery: rescue queued/failed messages and drafts, drop everything,
 * recreate the schema from scratch and put the rescued rows back.
 * Server-confirmed data is not rescued; cursor sync downloads it again.
 */
export async function rebuildPreservingUnsent(db: SqlDriver): Promise<void> {
  const salvage: Salvage = {
    messages: await tryAll(
      db,
      `SELECT client_id, conversation_id, sender_id, text, mentions, reply_to, created_at FROM messages
       WHERE client_id IN (SELECT client_id FROM outbox) OR status IN ('queued','sending','failed')`,
    ),
    outbox: await tryAll(db, 'SELECT client_id, conversation_id, enqueued_at FROM outbox'),
    drafts: await tryAll(db, 'SELECT conversation_id, text, updated_at FROM drafts'),
  };
  const tables = await tryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  await db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables)
    await db.exec(`DROP TABLE IF EXISTS "${String(t.name).replace(/"/g, '""')}"`);
  await db.exec('PRAGMA foreign_keys = ON');
  await db.transaction(async (tx) => {
    for (const m of MIGRATIONS) await m(tx);
    await tx.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    const now = Date.now();
    for (const m of salvage.messages) {
      await tx.run(
        `INSERT OR IGNORE INTO messages (client_id, conversation_id, sender_id, text, mentions, reply_to, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
        [
          str(m.client_id),
          str(m.conversation_id),
          str(m.sender_id),
          str(m.text),
          str(m.mentions ?? '[]'),
          nullable(m.reply_to),
          str(m.created_at),
        ],
      );
      // Every rescued unsent message goes back into the queue, even if its outbox row was lost.
      await tx.run(
        `INSERT OR IGNORE INTO outbox (client_id, conversation_id, state, enqueued_at) VALUES (?, ?, 'pending', ?)`,
        [
          str(m.client_id),
          str(m.conversation_id),
          Number(salvage.outbox.find((o) => o.client_id === m.client_id)?.enqueued_at ?? now),
        ],
      );
    }
    for (const d of salvage.drafts) {
      await tx.run(
        'INSERT OR IGNORE INTO drafts (conversation_id, text, updated_at) VALUES (?, ?, ?)',
        [str(d.conversation_id), str(d.text), Number(d.updated_at ?? now)],
      );
    }
    await tx.run("INSERT OR REPLACE INTO kv (key, value) VALUES ('cache.recoveredAt', ?)", [
      new Date(now).toISOString(),
    ]);
  });
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const nullable = (v: unknown): string | null => (v == null ? null : String(v));
