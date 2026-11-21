import * as SQLite from 'expo-sqlite';
import { createSerialDriver, type SqlDriver, type SqlValue } from './driver';

/**
 * Opens the on-device cache. When `encryptionKey` is given the database is keyed with
 * SQLCipher (enabled through the expo-sqlite config plugin in app.json), so cached
 * conversations and the outbox are unreadable without the key held in the OS keystore.
 */
export async function openExpoDriver(name: string, encryptionKey?: string): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  if (encryptionKey) {
    // Key must be applied before any other statement touches the file.
    await db.execAsync(`PRAGMA key = '${encryptionKey.replace(/'/g, "''")}'`);
  }
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return createSerialDriver(
    {
      exec: (sql) => db.execAsync(sql),
      run: async (sql, params: SqlValue[] = []) => {
        const r = await db.runAsync(sql, params);
        return { changes: r.changes };
      },
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
