export type SqlValue = string | number | null;

/** Minimal async SQL surface the stores need. Implemented by expo-sqlite on device and node:sqlite in tests. */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
}

export interface SqlDriver extends SqlExecutor {
  /** Runs `fn` atomically. All other statements wait until it commits or rolls back. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Serialises access so a transaction never interleaves with unrelated statements. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** Builds a SqlDriver from a raw executor that has no locking of its own. */
export function createSerialDriver(raw: SqlExecutor, close: () => Promise<void>): SqlDriver {
  const queue = new SerialQueue();
  return {
    exec: (sql) => queue.run(() => raw.exec(sql)),
    run: (sql, params) => queue.run(() => raw.run(sql, params)),
    all: (sql, params) => queue.run(() => raw.all(sql, params)),
    get: (sql, params) => queue.run(() => raw.get(sql, params)),
    transaction: (fn) =>
      queue.run(async () => {
        await raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(raw);
          await raw.exec('COMMIT');
          return result;
        } catch (err) {
          await raw.exec('ROLLBACK').catch(() => undefined);
          throw err;
        }
      }),
    close: () => queue.run(close),
  };
}
