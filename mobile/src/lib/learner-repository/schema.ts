import {
  type AsyncSqlDatabase,
  type AsyncSqlExecutor,
  withExclusiveTransaction,
} from "./database";

export const LEARNER_REPOSITORY_DATABASE_NAME = "keating-learner.sqlite";
export const LEARNER_REPOSITORY_SCHEMA_VERSION = 5;

const CREATE_FOUNDATION_SQL = `
CREATE TABLE IF NOT EXISTS repository_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_journal (
  id TEXT PRIMARY KEY NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  target_version INTEGER NOT NULL CHECK (target_version >= source_version),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^a-f0-9]*'),
  phase TEXT NOT NULL CHECK (phase IN ('prepared', 'copied', 'verified', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (phase = 'completed' AND completed_at IS NOT NULL)
    OR (phase <> 'completed' AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS migration_journal_phase_idx
  ON migration_journal (phase, updated_at);
`;

const CREATE_LEARNER_RECORDS_SQL = `
CREATE TABLE IF NOT EXISTS learner_records (
  kind TEXT NOT NULL CHECK (kind IN (
    'session', 'artifact', 'goal', 'question_check', 'quiz_result',
    'deck', 'card_review', 'feedback_event', 'usage_event', 'topic_evidence',
    'benchmark', 'evolution'
  )),
  id TEXT NOT NULL,
  sort_timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 2097152),
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS learner_records_kind_time_idx
  ON learner_records (kind, sort_timestamp, id);
CREATE TABLE IF NOT EXISTS learner_profile (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 2097152)
);
CREATE TABLE IF NOT EXISTS local_message_attachments (
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  uri TEXT NOT NULL CHECK (uri LIKE 'file://%'),
  PRIMARY KEY (message_id, attachment_id)
);
`;

const MIGRATE_EVALUATION_HISTORY_SQL = `
CREATE TABLE learner_records_v5 (
  kind TEXT NOT NULL CHECK (kind IN (
    'session', 'artifact', 'goal', 'question_check', 'quiz_result',
    'deck', 'card_review', 'feedback_event', 'usage_event', 'topic_evidence',
    'benchmark', 'evolution'
  )),
  id TEXT NOT NULL,
  sort_timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 2097152),
  PRIMARY KEY (kind, id)
);
INSERT INTO learner_records_v5 (kind, id, sort_timestamp, payload_json)
  SELECT kind, id, sort_timestamp, payload_json FROM learner_records;
DROP TABLE learner_records;
ALTER TABLE learner_records_v5 RENAME TO learner_records;
CREATE INDEX learner_records_kind_time_idx
  ON learner_records (kind, sort_timestamp, id);
`;

const CREATE_STUDY_PRIORITIES_SQL = `
CREATE TABLE IF NOT EXISTS study_priorities (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('deck', 'goal', 'topic', 'verification')),
  target_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 2097152),
  UNIQUE (target_type, target_id)
);
CREATE INDEX IF NOT EXISTS study_priorities_time_idx
  ON study_priorities (updated_at, target_type, target_id);
`;

const CREATE_UI_ACTION_JOURNALS_SQL = `
CREATE TABLE IF NOT EXISTS ui_action_journals (
  document_id TEXT PRIMARY KEY NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 2097152)
);
CREATE INDEX IF NOT EXISTS ui_action_journals_time_idx
  ON ui_action_journals (updated_at, document_id);
`;

interface MetaRow {
  value: string;
}

function parseStoredSchemaVersion(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

/** Initializes the foundation and upgrades the v1 journal-only database. */
export async function initializeRepositorySchema(database: AsyncSqlDatabase): Promise<void> {
  await database.execAsync("PRAGMA foreign_keys = ON;");
  await database.execAsync("PRAGMA journal_mode = WAL;");
  await withExclusiveTransaction(database, async (transaction) => {
    await transaction.execAsync(CREATE_FOUNDATION_SQL);
    const storedVersion = await ensureFoundationMetadata(transaction);
    await applyOrderedMigrations(transaction, storedVersion);
  });
}

async function ensureFoundationMetadata(transaction: AsyncSqlExecutor): Promise<number> {
  const existing = await transaction.getFirstAsync<MetaRow>(
    "SELECT value FROM repository_meta WHERE key = ?;",
    "schema_version",
  );
  if (!existing) {
    await transaction.runAsync(
      "INSERT INTO repository_meta (key, value) VALUES (?, ?);",
      "schema_version",
      "1",
    );
    return 1;
  }

  const stored = parseStoredSchemaVersion(existing.value);
  if (stored === null) throw new Error("Learner repository schema metadata is invalid.");
  if (stored > LEARNER_REPOSITORY_SCHEMA_VERSION) {
    throw new Error("Learner repository was created by a newer app version.");
  }
  if (stored < 1) {
    throw new Error("Learner repository schema migration is required.");
  }
  return stored;
}

async function applyOrderedMigrations(transaction: AsyncSqlExecutor, storedVersion: number): Promise<void> {
  let currentVersion = storedVersion;
  if (currentVersion === 1) {
    await transaction.execAsync(CREATE_LEARNER_RECORDS_SQL);
    await transaction.runAsync(
      "UPDATE repository_meta SET value = ? WHERE key = ?;",
      "2",
      "schema_version",
    );
    currentVersion = 2;
  }
  if (currentVersion === 2) {
    await transaction.execAsync(CREATE_STUDY_PRIORITIES_SQL);
    await transaction.runAsync(
      "UPDATE repository_meta SET value = ? WHERE key = ?;",
      "3",
      "schema_version",
    );
    currentVersion = 3;
  }
  if (currentVersion === 3) {
    await transaction.execAsync(CREATE_UI_ACTION_JOURNALS_SQL);
    await transaction.runAsync(
      "UPDATE repository_meta SET value = ? WHERE key = ?;",
      "4",
      "schema_version",
    );
    currentVersion = 4;
  }
  if (currentVersion === 4) {
    await transaction.execAsync(MIGRATE_EVALUATION_HISTORY_SQL);
    await transaction.runAsync(
      "UPDATE repository_meta SET value = ? WHERE key = ?;",
      "5",
      "schema_version",
    );
    currentVersion = 5;
  }
  if (currentVersion !== LEARNER_REPOSITORY_SCHEMA_VERSION) {
    throw new Error(`Learner repository has no migration path from schema ${currentVersion}.`);
  }
  // Reapplying idempotent DDL repairs missing indexes without changing records.
  await transaction.execAsync(CREATE_LEARNER_RECORDS_SQL);
  await transaction.execAsync(CREATE_STUDY_PRIORITIES_SQL);
  await transaction.execAsync(CREATE_UI_ACTION_JOURNALS_SQL);
}
