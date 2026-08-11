import {
  createPortableLearnerEnvelope,
  hasOnlyKeys,
  isContractId,
  isContractTimestamp,
  mergePortableLearnerData,
  parsePortableLearnerEnvelope,
  validatePortableLearnerData,
  type CardReviewRecord,
  type BenchmarkHistoryRecord,
  type EvolutionHistoryRecord,
  type FlashcardDeck,
  type LearnerArtifact,
  type LearnerGoal,
  type LearnerFeedbackEvent,
  type LearnerProfile,
  type LearnerQuestionCheck,
  type LearnerQuizResult,
  type LearnerSession,
  type LearnerUsageEvent,
  type PortableLearnerData,
  type PortableLearnerEnvelope,
  type StudyPriorityRecord,
  type TopicEvidence,
  canonicalUiAction,
  receiptForUiAction,
  UI_ACTION_JOURNAL_KIND,
  UI_CONTRACT_VERSION,
  validateUiActionAgainstDocument,
  validateUiActionJournal,
  validateUiActionResult,
  type UiAction,
  type UiActionJournal,
  type UiActionResult,
  type UiDocument,
} from "@keating/learner-contracts";
import {
  type AsyncSqlDatabase,
  type AsyncSqlExecutor,
  withExclusiveTransaction,
} from "./database";

export type LearnerRecordKind =
  | "session"
  | "artifact"
  | "goal"
  | "question_check"
  | "quiz_result"
  | "deck"
  | "card_review"
  | "feedback_event"
  | "usage_event"
  | "topic_evidence"
  | "benchmark"
  | "evolution";

export interface LocalAttachmentLocation {
  messageId: string;
  attachmentId: string;
  uri: string;
}

type LearnerRecord =
  | LearnerSession
  | LearnerArtifact
  | LearnerGoal
  | LearnerQuestionCheck
  | LearnerQuizResult
  | FlashcardDeck
  | CardReviewRecord
  | LearnerFeedbackEvent
  | LearnerUsageEvent
  | TopicEvidence
  | BenchmarkHistoryRecord
  | EvolutionHistoryRecord;

interface RecordRow {
  kind: LearnerRecordKind;
  id: string;
  sort_timestamp: string;
  payload_json: string;
}

interface ProfileRow {
  payload_json: string;
}

interface PriorityRow {
  id: string;
  target_type: StudyPriorityRecord["targetType"];
  target_id: string;
  updated_at: string;
  payload_json: string;
}

interface MetaRow {
  value: string;
}

interface UiActionJournalRow {
  payload_json: string;
}

const MAX_TOTAL_RECORDS = 90_000;
const MAX_TOTAL_JSON_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_JSON_BYTES = 2 * 1024 * 1024;
const MAX_LOCAL_ATTACHMENTS = 40_000;
const CLEAR_INTENT_META_KEY = "learner_clear_intent";

export interface LearningDataClearIntent {
  id: string;
  createdAt: string;
}

const CLEAR_INTENT_KEYS = new Set(["id", "createdAt"]);

function validateClearIntent(value: unknown): value is LearningDataClearIntent {
  if (!hasOnlyKeys(value, CLEAR_INTENT_KEYS)) return false;
  const intent = value as Partial<LearningDataClearIntent>;
  return isContractId(intent.id) && isContractTimestamp(intent.createdAt);
}

function defaultProfile(): LearnerProfile {
  return { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 };
}

function timestampFor(kind: LearnerRecordKind, record: LearnerRecord): string {
  if (kind === "session" || kind === "artifact" || kind === "goal" || kind === "deck") {
    return (record as LearnerSession | LearnerArtifact | LearnerGoal | FlashcardDeck).updatedAt;
  }
  return (record as LearnerQuestionCheck | LearnerQuizResult | CardReviewRecord | LearnerFeedbackEvent | LearnerUsageEvent | TopicEvidence | BenchmarkHistoryRecord | EvolutionHistoryRecord).createdAt;
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function recordsFrom(data: PortableLearnerData): Array<{ kind: LearnerRecordKind; record: LearnerRecord }> {
  return [
    ...data.sessions.map((record) => ({ kind: "session" as const, record })),
    ...data.artifacts.map((record) => ({ kind: "artifact" as const, record })),
    ...data.goals.map((record) => ({ kind: "goal" as const, record })),
    ...data.questionChecks.map((record) => ({ kind: "question_check" as const, record })),
    ...data.quizResults.map((record) => ({ kind: "quiz_result" as const, record })),
    ...data.decks.map((record) => ({ kind: "deck" as const, record })),
    ...data.cardReviews.map((record) => ({ kind: "card_review" as const, record })),
    ...data.feedbackEvents.map((record) => ({ kind: "feedback_event" as const, record })),
    ...data.usageEvents.map((record) => ({ kind: "usage_event" as const, record })),
    ...data.topicEvidence.map((record) => ({ kind: "topic_evidence" as const, record })),
    ...data.benchmarks.map((record) => ({ kind: "benchmark" as const, record })),
    ...data.evolutions.map((record) => ({ kind: "evolution" as const, record })),
  ];
}

function assertWithinQuota(data: PortableLearnerData): void {
  const records = recordsFrom(data);
  const recordCount = records.length + data.studyPriorities.length;
  if (recordCount > MAX_TOTAL_RECORDS) {
    throw new Error(`Learner repository quota exceeded: ${recordCount} records is above ${MAX_TOTAL_RECORDS}.`);
  }
  let totalBytes = utf8Size(JSON.stringify(data.learnerProfile));
  for (const { record } of records) {
    const size = utf8Size(JSON.stringify(record));
    if (size > MAX_RECORD_JSON_BYTES) {
      throw new Error(`Learner repository quota exceeded by record ${record.id}.`);
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_JSON_BYTES) {
      throw new Error(`Learner repository quota exceeded: portable records are above ${MAX_TOTAL_JSON_BYTES} bytes.`);
    }
  }
  for (const priority of data.studyPriorities) {
    const size = utf8Size(JSON.stringify(priority));
    if (size > MAX_RECORD_JSON_BYTES) {
      throw new Error(`Learner repository quota exceeded by record ${priority.id}.`);
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_JSON_BYTES) {
      throw new Error(`Learner repository quota exceeded: portable records are above ${MAX_TOTAL_JSON_BYTES} bytes.`);
    }
  }
}

function emptyData(generatedAt: string): PortableLearnerData {
  return {
    generatedAt,
    sessions: [],
    artifacts: [],
    goals: [],
    questionChecks: [],
    quizResults: [],
    decks: [],
    cardReviews: [],
    studyPriorities: [],
    feedbackEvents: [],
    usageEvents: [],
    topicEvidence: [],
    benchmarks: [],
    evolutions: [],
    learnerProfile: defaultProfile(),
  };
}

function appendRow(data: PortableLearnerData, row: RecordRow, record: LearnerRecord): void {
  if (record.id !== row.id || timestampFor(row.kind, record) !== row.sort_timestamp) {
    throw new Error(`Learner repository index mismatch for ${row.kind}:${row.id}.`);
  }
  if (row.kind === "session") data.sessions.push(record as LearnerSession);
  else if (row.kind === "artifact") data.artifacts.push(record as LearnerArtifact);
  else if (row.kind === "goal") data.goals.push(record as LearnerGoal);
  else if (row.kind === "question_check") data.questionChecks.push(record as LearnerQuestionCheck);
  else if (row.kind === "quiz_result") data.quizResults.push(record as LearnerQuizResult);
  else if (row.kind === "deck") data.decks.push(record as FlashcardDeck);
  else if (row.kind === "card_review") data.cardReviews.push(record as CardReviewRecord);
  else if (row.kind === "feedback_event") data.feedbackEvents.push(record as LearnerFeedbackEvent);
  else if (row.kind === "usage_event") data.usageEvents.push(record as LearnerUsageEvent);
  else if (row.kind === "topic_evidence") data.topicEvidence.push(record as TopicEvidence);
  else if (row.kind === "benchmark") data.benchmarks.push(record as BenchmarkHistoryRecord);
  else if (row.kind === "evolution") data.evolutions.push(record as EvolutionHistoryRecord);
  else throw new Error(`Learner repository contains unsupported record kind ${String(row.kind)}.`);
}

async function readData(executor: AsyncSqlExecutor, generatedAt: string): Promise<PortableLearnerData> {
  const storedGeneratedAt = await executor.getFirstAsync<MetaRow>(
    "SELECT value FROM repository_meta WHERE key = ?;",
    "portable_generated_at",
  );
  const data = emptyData(storedGeneratedAt?.value ?? generatedAt);
  const rows = await executor.getAllAsync<RecordRow>(
    "SELECT kind, id, sort_timestamp, payload_json FROM learner_records ORDER BY kind, sort_timestamp, id;",
  );
  for (const row of rows) {
    let record: LearnerRecord;
    try {
      record = JSON.parse(row.payload_json) as LearnerRecord;
    } catch {
      throw new Error(`Learner repository contains invalid JSON for ${row.kind}:${row.id}.`);
    }
    appendRow(data, row, record);
  }
  const priorityRows = await executor.getAllAsync<PriorityRow>(
    "SELECT id, target_type, target_id, updated_at, payload_json FROM study_priorities ORDER BY updated_at, target_type, target_id;",
  );
  for (const row of priorityRows) {
    let priority: StudyPriorityRecord;
    try {
      priority = JSON.parse(row.payload_json) as StudyPriorityRecord;
    } catch {
      throw new Error(`Learner repository contains invalid JSON for study_priority:${row.id}.`);
    }
    if (priority.id !== row.id || priority.targetType !== row.target_type
      || priority.targetId !== row.target_id || priority.updatedAt !== row.updated_at) {
      throw new Error(`Learner repository index mismatch for study_priority:${row.id}.`);
    }
    data.studyPriorities.push(priority);
  }
  const profile = await executor.getFirstAsync<ProfileRow>(
    "SELECT payload_json FROM learner_profile WHERE singleton = 1;",
  );
  if (profile) {
    try {
      data.learnerProfile = JSON.parse(profile.payload_json) as LearnerProfile;
    } catch {
      throw new Error("Learner repository contains an invalid profile snapshot.");
    }
  }
  if (!validatePortableLearnerData(data)) {
    throw new Error("Learner repository contains invalid or dangling portable records.");
  }
  return data;
}

async function replaceData(executor: AsyncSqlExecutor, data: PortableLearnerData): Promise<void> {
  if (!validatePortableLearnerData(data)) throw new Error("Cannot store invalid portable learner data.");
  assertWithinQuota(data);
  await executor.runAsync("DELETE FROM learner_records;");
  await executor.runAsync("DELETE FROM learner_profile;");
  await executor.runAsync("DELETE FROM study_priorities;");
  await executor.runAsync(
    "INSERT INTO repository_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
    "portable_generated_at",
    data.generatedAt,
  );
  for (const { kind, record } of recordsFrom(data)) {
    await executor.runAsync(
      "INSERT INTO learner_records (kind, id, sort_timestamp, payload_json) VALUES (?, ?, ?, ?);",
      kind,
      record.id,
      timestampFor(kind, record),
      JSON.stringify(record),
    );
  }
  for (const priority of data.studyPriorities) {
    await executor.runAsync(
      "INSERT INTO study_priorities (id, target_type, target_id, updated_at, payload_json) VALUES (?, ?, ?, ?, ?);",
      priority.id,
      priority.targetType,
      priority.targetId,
      priority.updatedAt,
      JSON.stringify(priority),
    );
  }
  await executor.runAsync(
    "INSERT INTO learner_profile (singleton, payload_json) VALUES (1, ?);",
    JSON.stringify(data.learnerProfile),
  );
}

function validateLocalAttachments(data: PortableLearnerData, locations: readonly LocalAttachmentLocation[]): void {
  if (locations.length > MAX_LOCAL_ATTACHMENTS) throw new Error("Local attachment quota exceeded.");
  const known = new Set(data.sessions.flatMap((session) => session.messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => `${message.id}:${attachment.id}`))));
  const seen = new Set<string>();
  for (const location of locations) {
    const key = `${location.messageId}:${location.attachmentId}`;
    if (!known.has(key)) throw new Error(`Local attachment ${key} has no portable message reference.`);
    if (seen.has(key)) throw new Error(`Local attachment ${key} is duplicated.`);
    if (!location.uri.startsWith("file://") || location.uri.length > 4096) {
      throw new Error(`Local attachment ${key} must use a bounded app-owned file URI.`);
    }
    seen.add(key);
  }
}

export type RepositoryClock = () => string;

export type PortableLearnerMutation = (
  current: PortableLearnerData,
  now: string,
) => PortableLearnerData;

export interface UiActionMutationResult {
  data: PortableLearnerData;
  resultingDocument: UiDocument;
  message?: string;
}

export type UiActionMutation = (
  current: PortableLearnerData,
  now: string,
) => UiActionMutationResult;

function systemClock(): string {
  return new Date().toISOString();
}

/** Typed, transaction-backed boundary for all portable learner records. */
export class LearnerRecordStore {
  constructor(
    private readonly database: AsyncSqlDatabase,
    private readonly clock: RepositoryClock = systemClock,
  ) {}

  snapshot(): Promise<PortableLearnerData> {
    return withExclusiveTransaction(this.database, (transaction) => readData(transaction, this.clock()));
  }

  replace(data: PortableLearnerData): Promise<void> {
    return withExclusiveTransaction(this.database, (transaction) => replaceData(transaction, data));
  }

  /**
   * Applies one learner-semantic change against a fresh transaction snapshot.
   * The callback receives a clone, so a failed validation or write cannot
   * mutate the caller's cached snapshot. Portable-only imported records remain
   * present unless the semantic mutation explicitly changes them.
   */
  mutatePortable(mutation: PortableLearnerMutation): Promise<PortableLearnerData> {
    return withExclusiveTransaction(this.database, async (transaction) => {
      const now = this.clock();
      const current = await readData(transaction, now);
      const candidate = mutation(structuredClone(current), now);
      const next = { ...candidate, generatedAt: now };
      await replaceData(transaction, next);
      return structuredClone(next);
    });
  }

  replaceWithLocalAttachments(
    data: PortableLearnerData,
    locations: readonly LocalAttachmentLocation[],
  ): Promise<void> {
    validateLocalAttachments(data, locations);
    return withExclusiveTransaction(this.database, async (transaction) => {
      await replaceData(transaction, data);
      await transaction.runAsync("DELETE FROM local_message_attachments;");
      for (const location of locations) {
        await transaction.runAsync(
          "INSERT INTO local_message_attachments (message_id, attachment_id, uri) VALUES (?, ?, ?);",
          location.messageId,
          location.attachmentId,
          location.uri,
        );
      }
    });
  }

  getLocalAttachments(): Promise<LocalAttachmentLocation[]> {
    return withExclusiveTransaction(this.database, (transaction) =>
      transaction.getAllAsync<LocalAttachmentLocation>(
        "SELECT message_id AS messageId, attachment_id AS attachmentId, uri FROM local_message_attachments ORDER BY message_id, attachment_id;",
      ));
  }

  exportPortable(): Promise<PortableLearnerEnvelope> {
    return this.snapshot().then(createPortableLearnerEnvelope);
  }

  importPortable(candidate: unknown): Promise<PortableLearnerData> {
    const incoming = parsePortableLearnerEnvelope(candidate).payload;
    return withExclusiveTransaction(this.database, async (transaction) => {
      const current = await readData(transaction, this.clock());
      const merged = mergePortableLearnerData(current, incoming);
      await replaceData(transaction, merged);
      return merged;
    });
  }

  /** Starts an idempotent cross-store delete that startup can safely resume. */
  beginClear(intent: LearningDataClearIntent): Promise<void> {
    if (!validateClearIntent(intent)) return Promise.reject(new Error("Learning-data clear intent is invalid."));
    return withExclusiveTransaction(this.database, async (transaction) => {
      const existing = await transaction.getFirstAsync<MetaRow>(
        "SELECT value FROM repository_meta WHERE key = ?;",
        CLEAR_INTENT_META_KEY,
      );
      if (existing) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(existing.value) as unknown;
        } catch {
          throw new Error("Learning-data clear intent is corrupt.");
        }
        if (!validateClearIntent(parsed)) throw new Error("Learning-data clear intent is corrupt.");
        if (parsed.id !== intent.id || parsed.createdAt !== intent.createdAt) {
          throw new Error("Another learning-data clear is already pending.");
        }
        return;
      }
      await transaction.runAsync(
        "INSERT INTO repository_meta (key, value) VALUES (?, ?);",
        CLEAR_INTENT_META_KEY,
        JSON.stringify(intent),
      );
    });
  }

  pendingClear(): Promise<LearningDataClearIntent | null> {
    return withExclusiveTransaction(this.database, async (transaction) => {
      const row = await transaction.getFirstAsync<MetaRow>(
        "SELECT value FROM repository_meta WHERE key = ?;",
        CLEAR_INTENT_META_KEY,
      );
      if (!row) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value) as unknown;
      } catch {
        throw new Error("Learning-data clear intent is corrupt.");
      }
      if (!validateClearIntent(parsed)) throw new Error("Learning-data clear intent is corrupt.");
      return parsed;
    });
  }

  completeClear(intentId: string): Promise<void> {
    if (!isContractId(intentId)) return Promise.reject(new Error("Learning-data clear id is invalid."));
    return withExclusiveTransaction(this.database, async (transaction) => {
      const row = await transaction.getFirstAsync<MetaRow>(
        "SELECT value FROM repository_meta WHERE key = ?;",
        CLEAR_INTENT_META_KEY,
      );
      if (!row) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value) as unknown;
      } catch {
        throw new Error("Learning-data clear intent is corrupt.");
      }
      if (!validateClearIntent(parsed) || parsed.id !== intentId) {
        throw new Error("Learning-data clear completion does not match the pending intent.");
      }
      await transaction.runAsync("DELETE FROM repository_meta WHERE key = ?;", CLEAR_INTENT_META_KEY);
    });
  }

  clear(): Promise<void> {
    return withExclusiveTransaction(this.database, async (transaction) => {
      await transaction.runAsync("DELETE FROM learner_records;");
      await transaction.runAsync("DELETE FROM learner_profile;");
      await transaction.runAsync("DELETE FROM study_priorities;");
      await transaction.runAsync("DELETE FROM local_message_attachments;");
      await transaction.runAsync("DELETE FROM ui_action_journals;");
      await transaction.runAsync("DELETE FROM repository_meta WHERE key = ?;", "portable_generated_at");
    });
  }
}

function emptyUiActionJournal(documentId: string): UiActionJournal {
  return {
    kind: UI_ACTION_JOURNAL_KIND,
    schemaVersion: UI_CONTRACT_VERSION,
    documentId,
    receipts: [],
  };
}

async function readUiActionJournal(
  executor: AsyncSqlExecutor,
  documentId: string,
): Promise<UiActionJournal> {
  const row = await executor.getFirstAsync<UiActionJournalRow>(
    "SELECT payload_json FROM ui_action_journals WHERE document_id = ?;",
    documentId,
  );
  if (!row) return emptyUiActionJournal(documentId);
  let journal: unknown;
  try {
    journal = JSON.parse(row.payload_json) as unknown;
  } catch {
    throw new Error(`OpenUI action journal ${documentId} contains invalid JSON.`);
  }
  if (!validateUiActionJournal(journal) || journal.documentId !== documentId) {
    throw new Error(`OpenUI action journal ${documentId} is invalid.`);
  }
  return journal;
}

/**
 * Durable idempotency boundary for native OpenUI actions. The semantic learner
 * mutation and its completed receipt commit in the same SQLite transaction,
 * so a force-quit can never save one without the other.
 */
export class UiActionStore {
  constructor(
    private readonly database: AsyncSqlDatabase,
    private readonly clock: RepositoryClock = systemClock,
  ) {}

  getJournal(documentId: string): Promise<UiActionJournal> {
    if (!isContractId(documentId)) return Promise.reject(new Error("OpenUI document id is invalid."));
    return withExclusiveTransaction(this.database, (transaction) => readUiActionJournal(transaction, documentId));
  }

  dispatch(
    action: UiAction,
    sourceDocument: UiDocument,
    mutation: UiActionMutation,
  ): Promise<UiActionResult> {
    if (!validateUiActionAgainstDocument(action, sourceDocument)) {
      return Promise.reject(new Error("This OpenUI action does not apply to the current document revision."));
    }
    return withExclusiveTransaction(this.database, async (transaction) => {
      const journal = await readUiActionJournal(transaction, action.documentId);
      const existing = receiptForUiAction(journal, action);
      if (existing) {
        if (!existing.result) throw new Error("A pending OpenUI action must be recovered before replay.");
        return structuredClone(existing.result);
      }

      const now = this.clock();
      const current = await readData(transaction, now);
      const candidate = mutation(structuredClone(current), now);
      const next = { ...candidate.data, generatedAt: now };
      await replaceData(transaction, next);

      const result: UiActionResult = {
        schemaVersion: UI_CONTRACT_VERSION,
        documentId: action.documentId,
        sourceRevision: action.documentRevision,
        actionIdempotencyKey: action.idempotencyKey,
        status: "completed",
        documentLifecycle: candidate.resultingDocument.lifecycle,
        resultingDocument: candidate.resultingDocument,
        ...(candidate.message === undefined ? {} : { message: candidate.message }),
      };
      if (!validateUiActionResult(result)) throw new Error("OpenUI action produced an invalid completion result.");

      const nextJournal: UiActionJournal = {
        ...journal,
        receipts: [...journal.receipts, {
          schemaVersion: UI_CONTRACT_VERSION,
          action: structuredClone(action),
          actionFingerprint: canonicalUiAction(action),
          state: "completed",
          createdAt: now,
          updatedAt: now,
          result: structuredClone(result),
        }],
      };
      if (!validateUiActionJournal(nextJournal)) throw new Error("OpenUI action journal quota or validation failed.");
      await transaction.runAsync(
        `INSERT INTO ui_action_journals (document_id, updated_at, payload_json) VALUES (?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET updated_at = excluded.updated_at, payload_json = excluded.payload_json;`,
        action.documentId,
        now,
        JSON.stringify(nextJournal),
      );
      return result;
    });
  }
}
