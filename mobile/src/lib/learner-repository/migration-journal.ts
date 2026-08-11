import {
  type AsyncSqlDatabase,
  type AsyncSqlExecutor,
  withExclusiveTransaction,
} from "./database";

export const MIGRATION_PHASES = ["prepared", "copied", "verified", "completed"] as const;
export type MigrationPhase = (typeof MIGRATION_PHASES)[number];
export type MigrationClock = () => string;

export interface MigrationJournalEntry {
  id: string;
  sourceVersion: number;
  targetVersion: number;
  digest: string;
  phase: MigrationPhase;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StartMigrationInput {
  id: string;
  sourceVersion: number;
  targetVersion: number;
  /** Canonical SHA-256 of the immutable legacy snapshot being migrated. */
  digest: string;
}

interface MigrationRow {
  id: string;
  source_version: number;
  target_version: number;
  digest: string;
  phase: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const CONTRACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA_256_HEX = /^[a-f0-9]{64}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const START_ATTEMPTS = 2;

function phaseIndex(phase: unknown): number {
  return typeof phase === "string" ? MIGRATION_PHASES.indexOf(phase as MigrationPhase) : -1;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseTimestamp(value: string, label: string): number {
  if (!UTC_TIMESTAMP.test(value)) throw new Error(`${label} must be a UTC timestamp.`);
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new Error(`${label} must be a calendar-valid UTC timestamp.`);
  }
  return milliseconds;
}

function assertClockTimestamp(value: string): number {
  return parseTimestamp(value, "Migration clock");
}

function assertStartInput(input: StartMigrationInput): void {
  if (!CONTRACT_ID.test(input.id)) throw new Error("Migration journal id is invalid.");
  if (!isVersion(input.sourceVersion) || !isVersion(input.targetVersion)
    || input.targetVersion < input.sourceVersion) {
    throw new Error("Migration journal versions are invalid.");
  }
  if (!SHA_256_HEX.test(input.digest)) throw new Error("Migration journal digest is invalid.");
}

function assertPhase(phase: unknown): asserts phase is MigrationPhase {
  if (phaseIndex(phase) < 0) throw new Error("Migration journal phase is invalid.");
}

function entryFromRow(row: MigrationRow): MigrationJournalEntry {
  assertStartInput({
    id: row.id,
    sourceVersion: row.source_version,
    targetVersion: row.target_version,
    digest: row.digest,
  });
  assertPhase(row.phase);
  const createdAt = parseTimestamp(row.created_at, "Migration created time");
  const updatedAt = parseTimestamp(row.updated_at, "Migration updated time");
  if (updatedAt < createdAt) throw new Error("Migration updated time cannot precede creation time.");
  const completedAt = row.completed_at === null
    ? null
    : parseTimestamp(row.completed_at, "Migration completion time");
  if (completedAt !== null && completedAt < updatedAt) {
    throw new Error("Migration completion time cannot precede update time.");
  }
  if (row.phase === "completed" && row.completed_at === null) {
    throw new Error("Completed migration is missing its completion time.");
  }
  if (row.phase !== "completed" && row.completed_at !== null) {
    throw new Error("Incomplete migration has a completion time.");
  }
  return {
    id: row.id,
    sourceVersion: row.source_version,
    targetVersion: row.target_version,
    digest: row.digest,
    phase: row.phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

async function readMigration(
  executor: AsyncSqlExecutor,
  id: string,
): Promise<MigrationJournalEntry | null> {
  const row = await executor.getFirstAsync<MigrationRow>(
    "SELECT id, source_version, target_version, digest, phase, created_at, updated_at, completed_at FROM migration_journal WHERE id = ?;",
    id,
  );
  return row ? entryFromRow(row) : null;
}

function assertSameMigration(existing: MigrationJournalEntry, input: StartMigrationInput): void {
  if (existing.sourceVersion !== input.sourceVersion || existing.targetVersion !== input.targetVersion
    || existing.digest !== input.digest) {
    throw new Error("Migration journal id already belongs to different input.");
  }
}

function isRecoverableInsertRace(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:SQLITE_(?:CONSTRAINT|BUSY(?:_SNAPSHOT)?)|UNIQUE constraint failed|constraint failed|database is locked)/i.test(error.message);
}

/**
 * Closed, one-step journal transitions make a crash recoverable: retrying the
 * same phase returns the existing durable entry; backwards/skipped phases fail.
 */
export class MigrationJournal {
  constructor(
    private readonly database: AsyncSqlDatabase,
    private readonly now: MigrationClock = () => new Date().toISOString(),
  ) {}

  async get(id: string): Promise<MigrationJournalEntry | null> {
    if (!CONTRACT_ID.test(id)) throw new Error("Migration journal id is invalid.");
    return withExclusiveTransaction(this.database, (transaction) => readMigration(transaction, id));
  }

  async start(input: StartMigrationInput): Promise<MigrationJournalEntry> {
    assertStartInput(input);
    let lastError: unknown;
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt += 1) {
      try {
        return await withExclusiveTransaction(this.database, async (transaction) => {
          const existing = await readMigration(transaction, input.id);
          if (existing) {
            assertSameMigration(existing, input);
            return existing;
          }
          const timestamp = this.now();
          assertClockTimestamp(timestamp);
          await transaction.runAsync(
            "INSERT INTO migration_journal (id, source_version, target_version, digest, phase, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            input.id,
            input.sourceVersion,
            input.targetVersion,
            input.digest,
            "prepared",
            timestamp,
            timestamp,
            null,
          );
          return {
            ...input,
            phase: "prepared",
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        });
      } catch (error) {
        if (!isRecoverableInsertRace(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async advance(id: string, nextPhase: MigrationPhase): Promise<MigrationJournalEntry> {
    if (!CONTRACT_ID.test(id)) throw new Error("Migration journal id is invalid.");
    assertPhase(nextPhase);
    return withExclusiveTransaction(this.database, async (transaction) => {
      const existing = await readMigration(transaction, id);
      if (!existing) throw new Error("Migration journal entry does not exist.");
      const currentIndex = phaseIndex(existing.phase);
      const nextIndex = phaseIndex(nextPhase);
      if (nextIndex < currentIndex) throw new Error("Migration journal phase cannot regress.");
      if (nextIndex === currentIndex) return existing;
      if (nextIndex !== currentIndex + 1) throw new Error("Migration journal phase must advance one step.");

      const timestamp = this.now();
      const timestampMs = assertClockTimestamp(timestamp);
      if (timestampMs < parseTimestamp(existing.updatedAt, "Migration updated time")) {
        throw new Error("Migration clock cannot move backward.");
      }
      const completedAt = nextPhase === "completed" ? timestamp : null;
      const result = await transaction.runAsync(
        "UPDATE migration_journal SET phase = ?, updated_at = ?, completed_at = ? WHERE id = ? AND phase = ?;",
        nextPhase,
        timestamp,
        completedAt,
        id,
        existing.phase,
      );
      if (result.changes !== 1) {
        await readMigration(transaction, id);
        throw new Error("Migration journal changed concurrently; retry from its durable phase.");
      }
      return {
        ...existing,
        phase: nextPhase,
        updatedAt: timestamp,
        ...(completedAt ? { completedAt } : {}),
      };
    });
  }
}
