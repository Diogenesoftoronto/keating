import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initializeRepositorySchema,
  MigrationJournal,
  openLearnerRepository,
  type AsyncSqlDatabase,
  type AsyncSqlExecutor,
  type AsyncSqliteDriver,
  type SqlBindValue,
} from "../src/lib/learner-repository";

const DIGEST = "a".repeat(64);

class BunSqlDatabase implements AsyncSqlDatabase {
  constructor(readonly database = new Database(":memory:")) {}
  async execAsync(source: string): Promise<void> { this.database.exec(source); }
  async runAsync(source: string, ...params: SqlBindValue[]) {
    const result = this.database.query(source).run(...params as Array<string | number | boolean | null | Uint8Array>);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }
  async getFirstAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T | null> {
    return (this.database.query(source).get(...params as Array<string | number | boolean | null | Uint8Array>) as T | null) ?? null;
  }
  async getAllAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T[]> {
    return this.database.query(source).all(...params as Array<string | number | boolean | null | Uint8Array>) as T[];
  }
  async withExclusiveTransactionAsync(task: (transaction: AsyncSqlExecutor) => Promise<void>): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      await task(this);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
  async closeAsync(): Promise<void> { this.database.close(); }
}

interface JournalRow {
  id: string;
  source_version: number;
  target_version: number;
  digest: string;
  phase: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

class FakeDatabase implements AsyncSqlDatabase {
  readonly calls: string[] = [];
  readonly meta = new Map<string, string>();
  readonly journal = new Map<string, JournalRow>();
  exclusiveTransactions = 0;
  closeCalls = 0;
  failOn: string | undefined;
  crossConnectionMigrationInsert: ((row: JournalRow) => void) | undefined;
  migrationInsertFailures: Error[] = [];
  beforeMigrationUpdate: ((row: JournalRow) => void) | undefined;
  private transactionTail: Promise<void> = Promise.resolve();

  async execAsync(source: string): Promise<void> {
    this.calls.push(`exec:${source}`);
    if (this.failOn && source.includes(this.failOn)) throw new Error("injected open failure");
  }

  async runAsync(source: string, ...params: SqlBindValue[]): Promise<{ changes: number; lastInsertRowId: number }> {
    this.calls.push(`run:${source}`);
    if (source.startsWith("INSERT INTO repository_meta")) {
      this.meta.set(String(params[0]), String(params[1]));
    } else if (source.startsWith("UPDATE repository_meta")) {
      this.meta.set(String(params[1]), String(params[0]));
    } else if (source.startsWith("INSERT INTO migration_journal")) {
      const [id, sourceVersion, targetVersion, digest, phase, createdAt, updatedAt, completedAt] = params;
      const row = {
        id: String(id), source_version: Number(sourceVersion), target_version: Number(targetVersion),
        digest: String(digest), phase: String(phase), created_at: String(createdAt),
        updated_at: String(updatedAt), completed_at: completedAt === null ? null : String(completedAt),
      };
      const crossConnectionInsert = this.crossConnectionMigrationInsert;
      this.crossConnectionMigrationInsert = undefined;
      crossConnectionInsert?.(row);
      const failure = this.migrationInsertFailures.shift();
      if (failure) throw failure;
      if (this.journal.has(row.id)) {
        throw new Error("UNIQUE constraint failed: migration_journal.id");
      }
      this.journal.set(String(id), row);
    } else if (source.startsWith("UPDATE migration_journal")) {
      const [phase, updatedAt, completedAt, id, expectedPhase] = params;
      const row = this.journal.get(String(id));
      if (!row) throw new Error("missing journal row");
      this.beforeMigrationUpdate?.(row);
      if (row.phase !== String(expectedPhase)) return { changes: 0, lastInsertRowId: 0 };
      row.phase = String(phase);
      row.updated_at = String(updatedAt);
      row.completed_at = completedAt === null ? null : String(completedAt);
    }
    return { changes: 1, lastInsertRowId: 1 };
  }

  async getFirstAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T | null> {
    return this.getFirstFromJournal(source, params, this.journal);
  }

  async getAllAsync<T>(_source: string, ..._params: SqlBindValue[]): Promise<T[]> {
    return [];
  }

  private async getFirstFromJournal<T>(
    source: string,
    params: SqlBindValue[],
    journal: ReadonlyMap<string, JournalRow>,
  ): Promise<T | null> {
    this.calls.push(`get:${source}`);
    if (source.includes("FROM repository_meta")) {
      const value = this.meta.get(String(params[0]));
      return value === undefined ? null : { value } as T;
    }
    if (source.includes("FROM migration_journal")) {
      const row = journal.get(String(params[0]));
      return row ? { ...row } as T : null;
    }
    return null;
  }

  async withExclusiveTransactionAsync(task: (transaction: AsyncSqlExecutor) => Promise<void>): Promise<void> {
    this.exclusiveTransactions += 1;
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const journalSnapshot = new Map(
      [...this.journal].map(([id, row]) => [id, { ...row }]),
    );
    const transaction: AsyncSqlExecutor = {
      execAsync: (source) => this.execAsync(source),
      runAsync: (source, ...params) => this.runAsync(source, ...params),
      getFirstAsync: <T>(source: string, ...params: SqlBindValue[]) =>
        this.getFirstFromJournal<T>(source, params, journalSnapshot),
      getAllAsync: <T>(_source: string, ..._params: SqlBindValue[]) => Promise.resolve([] as T[]),
    };
    try {
      await task(transaction);
    } finally {
      release();
    }
  }

  async closeAsync(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeDriver implements AsyncSqliteDriver {
  openedNames: string[] = [];
  constructor(readonly database: FakeDatabase) {}

  async openDatabaseAsync(name: string): Promise<AsyncSqlDatabase> {
    this.openedNames.push(name);
    return this.database;
  }
}

function clock(): () => string {
  let tick = 0;
  return () => `2026-08-10T00:00:0${tick++}.000Z`;
}

describe("learner repository foundation", () => {
  test("preserves populated v4 rows and indexes while adding evaluation-history kinds", async () => {
    const database = new BunSqlDatabase();
    database.database.exec(`
      CREATE TABLE repository_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO repository_meta (key, value) VALUES ('schema_version', '4');
      CREATE TABLE learner_records (
        kind TEXT NOT NULL CHECK (kind IN ('session', 'artifact', 'goal', 'question_check', 'quiz_result', 'deck', 'card_review', 'feedback_event', 'usage_event', 'topic_evidence')),
        id TEXT NOT NULL, sort_timestamp TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX learner_records_kind_time_idx ON learner_records (kind, sort_timestamp, id);
      INSERT INTO learner_records VALUES ('artifact', 'artifact-before-v5', '2026-08-10T00:00:00.000Z', '{"id":"artifact-before-v5"}');
    `);
    await initializeRepositorySchema(database);
    expect((await database.getFirstAsync<{ value: string }>("SELECT value FROM repository_meta WHERE key = 'schema_version';"))?.value).toBe("5");
    expect((await database.getFirstAsync<{ id: string }>("SELECT id FROM learner_records WHERE kind = 'artifact';"))?.id).toBe("artifact-before-v5");
    await database.runAsync(
      "INSERT INTO learner_records (kind, id, sort_timestamp, payload_json) VALUES (?, ?, ?, ?);",
      "benchmark", "benchmark-after-v5", "2026-08-10T00:01:00.000Z", '{"id":"benchmark-after-v5"}',
    );
    expect((await database.getAllAsync<{ name: string }>("PRAGMA index_list('learner_records');")).map((row) => row.name))
      .toContain("learner_records_kind_time_idx");
    await database.closeAsync();
  });

  test("initializes SQLite in safe order and is metadata-idempotent", async () => {
    const database = new FakeDatabase();
    const driver = new FakeDriver(database);
    const first = await openLearnerRepository(driver);
    await first.close();
    const second = await openLearnerRepository(driver);

    expect(driver.openedNames).toEqual(["keating-learner.sqlite", "keating-learner.sqlite"]);
    expect(database.calls[0]).toContain("PRAGMA foreign_keys = ON");
    expect(database.calls[1]).toContain("PRAGMA journal_mode = WAL");
    expect(database.meta.get("schema_version")).toBe("5");
    expect(database.exclusiveTransactions).toBe(2);
    expect(database.closeCalls).toBe(1);
    expect(database.calls.some((call) => call.includes("CHECK (phase IN ('prepared', 'copied', 'verified', 'completed'))"))).toBe(true);
    expect(database.calls.some((call) => call.includes("phase = 'completed' AND completed_at IS NOT NULL"))).toBe(true);
    expect(database.calls.some((call) => call.includes("CREATE TABLE IF NOT EXISTS study_priorities"))).toBe(true);
    expect(database.calls.some((call) => call.includes("UNIQUE (target_type, target_id)"))).toBe(true);
    expect(database.calls.some((call) => call.includes("CREATE TABLE IF NOT EXISTS ui_action_journals"))).toBe(true);
    await Promise.all([second.close(), second.close()]);
    expect(database.closeCalls).toBe(2);
  });

  test("upgrades v1 and fails closed for malformed, newer, or unsupported schema metadata", async () => {
    const legacyDatabase = new FakeDatabase();
    legacyDatabase.meta.set("schema_version", "1");
    await openLearnerRepository(new FakeDriver(legacyDatabase));
    expect(legacyDatabase.meta.get("schema_version")).toBe("5");

    for (const [stored, message] of [
      ["not-a-version", "metadata is invalid"],
      ["6", "newer app version"],
      ["0", "migration is required"],
    ] as const) {
      const database = new FakeDatabase();
      database.meta.set("schema_version", stored);
      await expect(openLearnerRepository(new FakeDriver(database))).rejects.toThrow(message);
      expect(database.closeCalls).toBe(1);
    }
  });

  test("uses exclusive transactions for journal reads and writes", async () => {
    const database = new FakeDatabase();
    const repository = await openLearnerRepository(new FakeDriver(database), { clock: clock() });
    const before = database.exclusiveTransactions;
    await repository.migrations.start({ id: "async-storage-v1", sourceVersion: 1, targetVersion: 1, digest: DIGEST });
    await repository.migrations.get("async-storage-v1");
    await repository.migrations.advance("async-storage-v1", "copied");
    expect(database.exclusiveTransactions).toBe(before + 3);
  });

  test("preserves journal return values when transactions discard callback returns", async () => {
    const database = new FakeDatabase();
    const journal = new MigrationJournal(database, clock());
    const prepared = await journal.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST });
    const copied = await journal.advance("migration-1", "copied");
    expect(prepared).toMatchObject({ id: "migration-1", phase: "prepared" });
    expect(copied).toMatchObject({ id: "migration-1", phase: "copied" });
  });

  test("serializes concurrent starts into one durable migration and rejects conflicting identity", async () => {
    const database = new FakeDatabase();
    const journal = new MigrationJournal(database, clock());
    const input = { id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST };
    const [first, second] = await Promise.all([journal.start(input), journal.start(input)]);
    expect(first).toEqual(second);
    expect(database.journal.size).toBe(1);
    expect(database.calls.filter((call) => call.startsWith("run:INSERT INTO migration_journal"))).toHaveLength(1);

    const conflictDatabase = new FakeDatabase();
    const conflictJournal = new MigrationJournal(conflictDatabase, clock());
    const results = await Promise.allSettled([
      conflictJournal.start(input),
      conflictJournal.start({ ...input, digest: "b".repeat(64) }),
    ]);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { phase: "prepared" } });
    expect(results[1]?.status).toBe("rejected");
    if (results[1]?.status === "rejected") expect(String(results[1].reason)).toContain("different input");
    expect(conflictDatabase.journal.size).toBe(1);
  });

  test("resumes retries and completes only through monotonic closed phases", async () => {
    const database = new FakeDatabase();
    const journal = new MigrationJournal(database, clock());
    const input = { id: "async-storage-v1", sourceVersion: 1, targetVersion: 1, digest: DIGEST };
    const prepared = await journal.start(input);
    expect(await journal.start(input)).toEqual(prepared);
    expect(await journal.advance(input.id, "prepared")).toEqual(prepared);
    await expect(journal.advance(input.id, "verified")).rejects.toThrow("one step");
    const copied = await journal.advance(input.id, "copied");
    await expect(journal.advance(input.id, "prepared")).rejects.toThrow("cannot regress");
    const verified = await journal.advance(input.id, "verified");
    const completed = await journal.advance(input.id, "completed");
    expect(copied.phase).toBe("copied");
    expect(verified.phase).toBe("verified");
    expect(completed).toMatchObject({ phase: "completed", completedAt: "2026-08-10T00:00:03.000Z" });
    expect(await journal.advance(input.id, "completed")).toEqual(completed);
  });

  test("rejects invalid journal identity, versions, digest, and conflicting retries", async () => {
    const journal = new MigrationJournal(new FakeDatabase(), clock());
    await expect(journal.start({ id: "bad id", sourceVersion: 1, targetVersion: 1, digest: DIGEST })).rejects.toThrow("id is invalid");
    await expect(journal.start({ id: "migration-1", sourceVersion: 0, targetVersion: 1, digest: DIGEST })).rejects.toThrow("versions are invalid");
    await expect(journal.start({ id: "migration-1", sourceVersion: 2, targetVersion: 1, digest: DIGEST })).rejects.toThrow("versions are invalid");
    await expect(journal.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: "not-a-digest" })).rejects.toThrow("digest is invalid");
    await journal.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST });
    await expect(journal.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: "b".repeat(64) })).rejects.toThrow("different input");
  });

  test("rejects calendar-invalid and backward migration clocks", async () => {
    const invalidClock = new MigrationJournal(new FakeDatabase(), () => "2026-02-30T00:00:00.000Z");
    await expect(invalidClock.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST }))
      .rejects.toThrow("calendar-valid");

    const ticks = ["2026-08-10T00:00:02.000Z", "2026-08-10T00:00:01.000Z"];
    const backwardClock = new MigrationJournal(new FakeDatabase(), () => ticks.shift()!);
    await backwardClock.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST });
    await expect(backwardClock.advance("migration-1", "copied")).rejects.toThrow("cannot move backward");
  });

  test("rejects persisted journal timestamps that are not monotonic", async () => {
    const database = new FakeDatabase();
    database.journal.set("migration-1", {
      id: "migration-1",
      source_version: 1,
      target_version: 1,
      digest: DIGEST,
      phase: "completed",
      created_at: "2026-08-10T00:00:02.000Z",
      updated_at: "2026-08-10T00:00:01.000Z",
      completed_at: "2026-08-10T00:00:03.000Z",
    });
    const journal = new MigrationJournal(database, clock());
    await expect(journal.get("migration-1")).rejects.toThrow("updated time cannot precede");

    database.journal.set("migration-1", {
      id: "migration-1",
      source_version: 1,
      target_version: 1,
      digest: DIGEST,
      phase: "completed",
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:02.000Z",
      completed_at: "2026-08-10T00:00:01.000Z",
    });
    await expect(journal.get("migration-1")).rejects.toThrow("completion time cannot precede");
  });

  test("fails closed when compare-and-set observes a concurrent journal advance", async () => {
    const database = new FakeDatabase();
    const journal = new MigrationJournal(database, clock());
    await journal.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST });
    await journal.advance("migration-1", "copied");
    database.beforeMigrationUpdate = (row) => {
      row.phase = "verified";
      row.updated_at = "2026-08-10T00:00:09.000Z";
    };
    await expect(journal.advance("migration-1", "verified")).rejects.toThrow("changed concurrently");
    expect((await journal.get("migration-1"))?.phase).toBe("verified");
  });

  test("recovers a BUSY_SNAPSHOT winner only after a fresh transaction snapshot", async () => {
    const database = new FakeDatabase();
    const journal = new MigrationJournal(database, clock());
    const input = { id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST };
    database.crossConnectionMigrationInsert = (row) => {
      database.journal.set(row.id, { ...row });
    };
    database.migrationInsertFailures.push(new Error("SQLITE_BUSY_SNAPSHOT: stale snapshot"));
    await expect(journal.start(input)).resolves.toMatchObject({ ...input, phase: "prepared" });
    expect(database.exclusiveTransactions).toBe(2);

    const conflictDatabase = new FakeDatabase();
    conflictDatabase.crossConnectionMigrationInsert = (row) => {
      conflictDatabase.journal.set(row.id, { ...row, digest: "b".repeat(64) });
    };
    conflictDatabase.migrationInsertFailures.push(new Error("SQLITE_BUSY_SNAPSHOT: stale snapshot"));
    const conflictJournal = new MigrationJournal(conflictDatabase, clock());
    await expect(conflictJournal.start(input)).rejects.toThrow("different input");
    expect(conflictDatabase.exclusiveTransactions).toBe(2);
  });

  test("retries a transient busy insert without a durable migration", async () => {
    const busyDatabase = new FakeDatabase();
    busyDatabase.migrationInsertFailures.push(new Error("SQLITE_BUSY: database is locked"));
    const busyJournal = new MigrationJournal(busyDatabase, clock());
    const input = { id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST };
    await expect(busyJournal.start(input)).resolves.toMatchObject({ ...input, phase: "prepared" });
    expect(busyDatabase.exclusiveTransactions).toBe(2);
  });

  test("surfaces repeated busy errors after the bounded retry budget", async () => {
    const database = new FakeDatabase();
    database.migrationInsertFailures.push(
      new Error("SQLITE_BUSY: database is locked"),
      new Error("SQLITE_BUSY: database is locked"),
    );
    const journal = new MigrationJournal(database, clock());
    await expect(journal.start({ id: "migration-1", sourceVersion: 1, targetVersion: 1, digest: DIGEST }))
      .rejects.toThrow("SQLITE_BUSY");
    expect(database.exclusiveTransactions).toBe(2);
  });

  test("closes the opened database when setup fails", async () => {
    const database = new FakeDatabase();
    database.failOn = "journal_mode";
    await expect(openLearnerRepository(new FakeDriver(database))).rejects.toThrow("injected open failure");
    expect(database.closeCalls).toBe(1);
  });
});
