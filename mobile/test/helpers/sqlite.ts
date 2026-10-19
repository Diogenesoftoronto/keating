/** SQLite adapter for mobile repository tests, with transaction rollback and fault injection. */
import { Database } from "bun:sqlite";
import type { AsyncSqlDatabase, AsyncSqlExecutor, SqlBindValue } from "../../src/lib/learner-repository";

export class SqliteTestDatabase implements AsyncSqlDatabase {
  readonly db = new Database(":memory:");
  private tail: Promise<void> = Promise.resolve();
  failEvidence = false;
  beforeRun: ((sql: string, params: readonly SqlBindValue[]) => void) | undefined;

  async execAsync(sql: string) {
    this.db.exec(sql);
  }

  async runAsync(sql: string, ...params: SqlBindValue[]) {
    this.beforeRun?.(sql, params);
    const result = this.db.query(sql).run(...params);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<T>(sql: string, ...params: SqlBindValue[]) {
    return this.db.query(sql).get(...params) as T | null;
  }

  async getAllAsync<T>(sql: string, ...params: SqlBindValue[]) {
    return this.db.query(sql).all(...params) as T[];
  }

  withExclusiveTransactionAsync(work: (transaction: AsyncSqlExecutor) => Promise<void>) {
    const task = this.tail.catch(() => undefined).then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        await work(this);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }

  async closeAsync() {
    await this.tail;
    this.db.close();
  }
}
