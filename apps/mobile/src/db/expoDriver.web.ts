import * as SQLite from 'expo-sqlite';
import { createSerialDriver, type SqlDriver, type SqlValue } from './driver';

/** Web preview: expo-sqlite's wasm build (no SQLCipher in browsers, so no PRAGMA key). */
export async function openExpoDriver(name: string): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  // The browser VFS has a small fixed pool of file handles; keep temp tables and the
  // rollback journal in memory so they don't take slots. Acceptable for a preview build.
  await db.execAsync(
    'PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA journal_mode = MEMORY;',
  );
  return createSerialDriver(
    {
      exec: (sql) => db.execAsync(sql),
      run: async (sql, params: SqlValue[] = []) => ({
        changes: (await db.runAsync(sql, params)).changes,
      }),
      all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
      get: async <T>(sql: string, params: SqlValue[] = []) =>
        (await db.getFirstAsync<T>(sql, params)) ?? undefined,
    },
    () => db.closeAsync(),
  );
}

export async function deleteExpoDatabase(name: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(name);
}
