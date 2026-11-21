import { DatabaseSync } from 'node:sqlite';
import { createSerialDriver, type SqlDriver, type SqlValue } from '../db/driver';

/** node:sqlite-backed driver so the real SQL in the stores runs under test. */
export function openNodeDriver(path = ':memory:'): SqlDriver & { raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  const driver = createSerialDriver(
    {
      exec: async (sql) => void db.exec(sql),
      run: async (sql, params: SqlValue[] = []) => ({
        changes: Number(db.prepare(sql).run(...params).changes),
      }),
      all: async <T>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
      get: async <T>(sql: string, params: SqlValue[] = []) =>
        db.prepare(sql).get(...params) as T | undefined,
    },
    async () => db.close(),
  );
  return Object.assign(driver, { raw: db });
}
