/**
 * Small structural subset of Expo SQLite's asynchronous API. Keeping the
 * repository on this boundary makes its migration rules testable under Bun
 * without loading a native module.
 */
export type SqlBindValue = string | number | boolean | null | Uint8Array;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface AsyncSqlExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: SqlBindValue[]): Promise<SqlRunResult>;
  getFirstAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T[]>;
}

export interface AsyncSqlDatabase extends AsyncSqlExecutor {
  withExclusiveTransactionAsync(
    task: (transaction: AsyncSqlExecutor) => Promise<void>,
  ): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface AsyncSqliteDriver {
  openDatabaseAsync(name: string): Promise<AsyncSqlDatabase>;
}

/** All repository mutations use Expo SQLite's exclusive async transaction. */
export function withExclusiveTransaction<T>(
  database: AsyncSqlDatabase,
  work: (transaction: AsyncSqlExecutor) => Promise<T>,
): Promise<T> {
  let result!: T;
  let completed = false;
  return database.withExclusiveTransactionAsync(async (transaction) => {
    result = await work(transaction);
    completed = true;
  }).then(() => {
    if (!completed) throw new Error("Exclusive transaction completed without invoking its callback.");
    return result;
  });
}
