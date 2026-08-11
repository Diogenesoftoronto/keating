import {
  ContractValidationError,
  LEGACY_LEARNER_CONTRACT_VERSION,
  LEARNER_CONTRACT_VERSION,
  MergeConflictError,
  PORTABLE_LEARNER_DATA_KIND,
  PREVIOUS_LEARNER_CONTRACT_VERSION,
  type VersionedEnvelope,
} from "./envelope.js";
import {
  mergeBenchmarkHistory,
  mergeEvolutionHistory,
  validateBenchmarkHistoryRecord,
  validateEvolutionHistoryRecord,
  type BenchmarkHistoryRecord,
  type EvolutionHistoryRecord,
} from "./evaluation.js";
import type {
  CardReviewRecord,
  FlashcardDeck,
  LearnerArtifact,
  LearnerGoal,
  LearnerProfile,
  LearnerQuestionCheck,
  LearnerQuizResult,
  StudyPriorityRecord,
} from "./learning.js";
import { validateLearnerFeedbackEvent, type LearnerFeedbackEvent } from "./feedback.js";
import {
  validateCardReviewRecord,
  validateFlashcardDeck,
  validateLearnerArtifact,
  validateLearnerGoal,
  validateLearnerProfile,
  validateLearnerQuestionCheck,
  validateLearnerQuizResult,
  validateStudyPriorityRecord,
} from "./learning.js";
import { validateLearnerSession, type LearnerSession } from "./sessions.js";
import { dueAtAfterReview, initialSrsState } from "./srs.js";
import { validateLearnerUsageEvent, validateTopicEvidence, type LearnerUsageEvent, type TopicEvidence } from "./usage.js";
import { codePointCompare, compareContractTimestamps, hasOnlyKeys, hasUniqueIds, isBoundedArray, isContractId, isContractTimestamp, isRecord } from "./validation.js";

/** @deprecated Import from the package root; retained for portable-module consumers. */
export { MergeConflictError } from "./envelope.js";

export interface PortableLearnerData {
  generatedAt: string;
  sessions: LearnerSession[];
  artifacts: LearnerArtifact[];
  goals: LearnerGoal[];
  questionChecks: LearnerQuestionCheck[];
  quizResults: LearnerQuizResult[];
  decks: FlashcardDeck[];
  cardReviews: CardReviewRecord[];
  /** Explicit learner intent for their review board; never a scheduling signal. */
  studyPriorities: StudyPriorityRecord[];
  /** Explicit helpful/missed reactions to messages, not an assessment or mastery signal. */
  feedbackEvents: LearnerFeedbackEvent[];
  /** Provider-supplied request accounting only; estimates belong to a surface, not this portable boundary. */
  usageEvents: LearnerUsageEvent[];
  /** Factual activity provenance, never inferred competency or mastery. */
  topicEvidence: TopicEvidence[];
  /** Immutable evidence of completed benchmark runs; no score is synthesized from learner activity. */
  benchmarks: BenchmarkHistoryRecord[];
  /** Immutable evidence of completed policy-evolution runs; no run is inferred from a policy artifact. */
  evolutions: EvolutionHistoryRecord[];
  learnerProfile: LearnerProfile;
}

export type PortableLearnerEnvelope = VersionedEnvelope<PortableLearnerData>;

const FORBIDDEN_PORTABLE_KEY_PARTS = [
  "apikey", "apikeys", "oauthcredentials", "refreshtoken", "accesstoken", "idtoken", "authtoken",
  "sessiontoken", "clientsecret", "password", "cookie", "secret", "token",
  "dpop", "dpopkey", "dpopprivatekey", "assertion", "assertionkey", "assertionprivatekey",
  "privatekey", "credential", "credentials", "authorization", "authheader", "bearertoken", "providerkey",
  "workspacefiles", "workspacefilecontent", "localworkspacefiles", "localworkspacefilecontent",
  "workspacesnapshot", "sandboxfiles", "sandboxfilecontent",
] as const;
const PORTABLE_DATA_KEYS = new Set([
  "generatedAt", "sessions", "artifacts", "goals", "questionChecks", "quizResults", "decks", "cardReviews", "studyPriorities", "feedbackEvents", "usageEvents", "topicEvidence", "benchmarks", "evolutions", "learnerProfile",
]);
const V2_PORTABLE_DATA_KEYS = new Set([
  "generatedAt", "sessions", "artifacts", "goals", "questionChecks", "quizResults", "decks", "cardReviews", "studyPriorities", "feedbackEvents", "usageEvents", "topicEvidence", "learnerProfile",
]);
const V1_PORTABLE_DATA_KEYS = new Set([
  "generatedAt", "sessions", "artifacts", "goals", "questionChecks", "quizResults", "decks", "cardReviews", "feedbackEvents", "usageEvents", "topicEvidence", "learnerProfile",
]);
const MAX_PORTABLE_RECORDS = 10_000;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/i,
  /\b(?:Bearer|DPoP)\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  /\b(?:sk|pk|rk|ghp|github_pat|xox[bap])-?[A-Za-z0-9_-]{16,}\b/i,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
] as const;

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** Token counts are data, not credentials, but only under the closed usage-report shape. */
function isAllowedUsageAccountingKey(path: string, key: string): boolean {
  return (key === "inputTokens" || key === "outputTokens" || key === "totalTokens")
    && /^(?:payload|envelope\.payload)\.usageEvents\[\d+\]\.providerReported$/.test(path);
}

/** Reject secrets and local workspace bytes even when nested in arbitrary metadata. */
export function assertPortableDataSafe(value: unknown, path = "payload"): void {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new ContractValidationError(`Portable data contains credential-like text at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPortableDataSafe(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new ContractValidationError(`Portable data may not contain non-string keys at ${path}.`);
    }
    const entry = (value as Record<string, unknown>)[key];
    const normalized = normalizedKey(key);
    if (!isAllowedUsageAccountingKey(path, key)
      && FORBIDDEN_PORTABLE_KEY_PARTS.some((part) => normalized.includes(part))) {
      throw new ContractValidationError(`Portable data may not contain ${key} at ${path}.`);
    }
    assertPortableDataSafe(entry, `${path}.${key}`);
  }
}

export function validatePortableLearnerData(value: unknown): value is PortableLearnerData {
  if (!hasOnlyKeys(value, PORTABLE_DATA_KEYS)) return false;
  const data = value as Partial<PortableLearnerData>;
  const shapeIsValid = isContractTimestamp(data.generatedAt)
    && isBoundedArray(data.sessions, MAX_PORTABLE_RECORDS)
    && data.sessions.every(validateLearnerSession)
    && isBoundedArray(data.artifacts, MAX_PORTABLE_RECORDS) && data.artifacts.every(validateLearnerArtifact)
    && isBoundedArray(data.goals, MAX_PORTABLE_RECORDS) && data.goals.every(validateLearnerGoal)
    && isBoundedArray(data.questionChecks, MAX_PORTABLE_RECORDS) && data.questionChecks.every(validateLearnerQuestionCheck)
    && isBoundedArray(data.quizResults, MAX_PORTABLE_RECORDS) && data.quizResults.every(validateLearnerQuizResult)
    && isBoundedArray(data.decks, MAX_PORTABLE_RECORDS) && data.decks.every(validateFlashcardDeck)
    && isBoundedArray(data.cardReviews, MAX_PORTABLE_RECORDS) && data.cardReviews.every(validateCardReviewRecord)
    && isBoundedArray(data.studyPriorities, MAX_PORTABLE_RECORDS) && data.studyPriorities.every(validateStudyPriorityRecord)
    && isBoundedArray(data.feedbackEvents, MAX_PORTABLE_RECORDS) && data.feedbackEvents.every(validateLearnerFeedbackEvent)
    && isBoundedArray(data.usageEvents, MAX_PORTABLE_RECORDS) && data.usageEvents.every(validateLearnerUsageEvent)
    && isBoundedArray(data.topicEvidence, MAX_PORTABLE_RECORDS) && data.topicEvidence.every(validateTopicEvidence)
    && isBoundedArray(data.benchmarks, MAX_PORTABLE_RECORDS) && data.benchmarks.every(validateBenchmarkHistoryRecord)
    && isBoundedArray(data.evolutions, MAX_PORTABLE_RECORDS) && data.evolutions.every(validateEvolutionHistoryRecord)
    && validateLearnerProfile(data.learnerProfile);
  if (!shapeIsValid) return false;
  const portable = data as PortableLearnerData;

  const sessionsById = new Map(portable.sessions.map((session) => [session.id, session]));
  if (sessionsById.size !== portable.sessions.length) return false;
  for (const session of portable.sessions) {
    if (!session.parentSessionId) continue;
    const parent = sessionsById.get(session.parentSessionId);
    if (!parent || (session.forkedFromMessageId !== undefined
      && !parent.messages.some((message) => message.id === session.forkedFromMessageId))) return false;
    const visited = new Set<string>();
    let cursor: LearnerSession | undefined = session;
    while (cursor?.parentSessionId) {
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = sessionsById.get(cursor.parentSessionId);
    }
  }

  if (!hasUniqueIds(portable.artifacts) || !hasUniqueIds(portable.goals)
    || !hasUniqueIds(portable.questionChecks) || !hasUniqueIds(portable.quizResults)
    || !hasUniqueIds(portable.decks) || !hasUniqueIds(portable.cardReviews)
    || !hasUniqueIds(portable.studyPriorities)
    || !hasUniqueIds(portable.feedbackEvents)
    || !hasUniqueIds(portable.usageEvents) || !hasUniqueIds(portable.topicEvidence)
    || !hasUniqueIds(portable.benchmarks) || !hasUniqueIds(portable.evolutions)) return false;
  const attachmentIds = portable.artifacts.flatMap((artifact) => artifact.attachment ? [artifact.attachment.id] : []);
  if (new Set(attachmentIds).size !== attachmentIds.length) return false;

  for (const artifact of portable.artifacts) {
    const source = artifact.sourceSessionId ? sessionsById.get(artifact.sourceSessionId) : undefined;
    if (artifact.sourceSessionId && !source) return false;
    if (artifact.sourceMessageId && (!source || !source.messages.some((message) => message.id === artifact.sourceMessageId))) return false;
  }
  if (portable.questionChecks.some((check) => check.sessionId && !sessionsById.has(check.sessionId))) return false;
  if (portable.quizResults.some((result) => result.sessionId && !sessionsById.has(result.sessionId))) return false;
  if (portable.usageEvents.some((record) => record.sessionId && !sessionsById.has(record.sessionId))) return false;
  if (portable.benchmarks.some((record) => record.sessionId && !sessionsById.has(record.sessionId))) return false;
  if (portable.evolutions.some((record) => record.sessionId && !sessionsById.has(record.sessionId))) return false;
  if (portable.feedbackEvents.some((event) => !sessionsById.get(event.sessionId)?.messages
    .some((message) => message.id === event.messageId))) return false;

  const cardsByDeckId = new Map(portable.decks.map((deck) => [deck.id, new Map(deck.cards.map((card) => [card.id, card]))]));
  const latestCanonicalReviewByCard = new Map<string, CardReviewRecord>();
  const cardReviewsAreValid = portable.cardReviews.every((review) => {
    const cards = cardsByDeckId.get(review.deckId);
    if (!cards?.has(review.cardId) || (review.sessionId && !sessionsById.has(review.sessionId))) return false;
    if (review.legacyScheduleUnknown) return true;
    try {
      if (review.nextDueAt !== dueAtAfterReview(review.createdAt, review.rating, review.appliedIntervalDays)) return false;
    } catch {
      return false;
    }
    const key = `${review.deckId}:${review.cardId}`;
    const current = latestCanonicalReviewByCard.get(key);
    if (!current || compareContractTimestamps(review.createdAt, current.createdAt) > 0
      || (compareContractTimestamps(review.createdAt, current.createdAt) === 0 && codePointCompare(review.id, current.id) > 0)) {
      latestCanonicalReviewByCard.set(key, review);
    }
    return true;
  });
  if (!cardReviewsAreValid) return false;
  for (const [key, review] of latestCanonicalReviewByCard) {
    const [deckId, cardId] = key.split(":", 2);
    const card = deckId && cardId ? cardsByDeckId.get(deckId)?.get(cardId) : undefined;
    if (!card || card.srs.ease !== review.easeAfter || card.srs.intervalDays !== review.appliedIntervalDays
      || card.srs.dueAt !== review.nextDueAt || card.srs.lastReviewedAt !== review.createdAt
      || card.srs.lastRating !== review.rating || card.srs.repetitions !== review.repetitionsAfter
      || card.srs.lapses !== review.lapsesAfter) return false;
  }

  const priorityTargets = new Set<string>();
  const artifactById = new Map(portable.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const priority of portable.studyPriorities) {
    const targetKey = `${priority.targetType}:${priority.targetId}`;
    if (priorityTargets.has(targetKey)) return false;
    priorityTargets.add(targetKey);
    if (priority.targetType === "deck" && !cardsByDeckId.has(priority.targetId)) return false;
    if (priority.targetType === "goal" && !portable.goals.some((goal) => goal.id === priority.targetId)) return false;
    if (priority.targetType === "verification" && artifactById.get(priority.targetId)?.kind !== "verification") return false;
  }

  const artifactsById = artifactById;
  const questionChecksById = new Map(portable.questionChecks.map((check) => [check.id, check]));
  const quizResultsById = new Map(portable.quizResults.map((result) => [result.id, result]));
  const cardReviewsById = new Map(portable.cardReviews.map((review) => [review.id, review]));
  const decksById = new Map(portable.decks.map((deck) => [deck.id, deck]));
  return portable.topicEvidence.every((evidence) => {
    const reference = evidence.reference;
    if (!reference) return evidence.provenance === "learner-declared";
    if (reference.kind === "session") return sessionsById.has(reference.id);
    if (reference.kind === "artifact") return artifactsById.has(reference.id);
    if (reference.kind === "question-check") return questionChecksById.get(reference.id)?.topic === evidence.topic;
    if (reference.kind === "quiz-result") return quizResultsById.get(reference.id)?.topic === evidence.topic;
    const review = cardReviewsById.get(reference.id);
    return !!review && decksById.get(review.deckId)?.topic === evidence.topic;
  });
}

export function createPortableLearnerEnvelope(data: PortableLearnerData): PortableLearnerEnvelope {
  assertPortableDataSafe(data);
  if (!validatePortableLearnerData(data)) {
    throw new ContractValidationError("Portable learner data has an invalid shape.");
  }
  return {
    kind: PORTABLE_LEARNER_DATA_KIND,
    schemaVersion: LEARNER_CONTRACT_VERSION,
    payload: structuredClone(data),
  };
}

function assertPortableEnvelopeShape(value: unknown): asserts value is VersionedEnvelope<unknown> {
  if (!isRecord(value)) throw new ContractValidationError("Contract envelope must be an object.");
  if (!hasOnlyKeys(value, new Set(["kind", "schemaVersion", "payload"]))) {
    throw new ContractValidationError("Contract envelope contains unknown fields.");
  }
  if (value.kind !== PORTABLE_LEARNER_DATA_KIND) {
    throw new ContractValidationError(`Unsupported contract kind: ${String(value.kind)}.`);
  }
  if (!("payload" in value)) throw new ContractValidationError("Contract envelope has no payload.");
}

/**
 * v1 had no portable scheduler fields. Migration preserves the old reviews as
 * explicitly schedule-unknown history and starts cards as due at generatedAt;
 * it never fabricates a historical due date, mastery claim, or review state.
 */
export function migratePortableLearnerV1(value: unknown): PortableLearnerData {
  if (!isRecord(value) || !hasOnlyKeys(value, V1_PORTABLE_DATA_KEYS)) {
    throw new ContractValidationError("Portable learner v1 data has an invalid shape.");
  }
  const raw = value as Record<string, unknown>;
  if (!isContractTimestamp(raw.generatedAt) || !Array.isArray(raw.decks) || !Array.isArray(raw.cardReviews)) {
    throw new ContractValidationError("Portable learner v1 data has an invalid shape.");
  }
  const migrated: unknown = {
    ...structuredClone(raw),
    decks: raw.decks.map((deck) => {
      if (!isRecord(deck) || !Array.isArray(deck.cards)) return deck;
      return { ...deck, cards: deck.cards.map((card) => isRecord(card)
        ? { ...card, srs: initialSrsState(raw.generatedAt as string) }
        : card) };
    }),
    cardReviews: raw.cardReviews.map((review) => isRecord(review)
      ? { ...review, legacyScheduleUnknown: true }
      : review),
    studyPriorities: [],
    benchmarks: [],
    evolutions: [],
  };
  if (!validatePortableLearnerData(migrated)) {
    throw new ContractValidationError("Portable learner v1 data cannot be migrated safely.");
  }
  return structuredClone(migrated);
}

/**
 * v2 predated portable evaluation history. Its absence carries no claim that
 * no runs occurred, so migration adds empty histories rather than inferring
 * benchmark or evolution records from artifacts, policies, or learner data.
 */
export function migratePortableLearnerV2(value: unknown): PortableLearnerData {
  if (!isRecord(value) || !hasOnlyKeys(value, V2_PORTABLE_DATA_KEYS)) {
    throw new ContractValidationError("Portable learner v2 data has an invalid shape.");
  }
  const migrated: unknown = { ...structuredClone(value), benchmarks: [], evolutions: [] };
  if (!validatePortableLearnerData(migrated)) {
    throw new ContractValidationError("Portable learner v2 data cannot be migrated safely.");
  }
  return structuredClone(migrated);
}

export function parsePortableLearnerEnvelope(value: unknown): PortableLearnerEnvelope {
  assertPortableEnvelopeShape(value);
  assertPortableDataSafe(value, "envelope");
  if (value.schemaVersion === LEGACY_LEARNER_CONTRACT_VERSION) {
    return {
      kind: PORTABLE_LEARNER_DATA_KIND,
      schemaVersion: LEARNER_CONTRACT_VERSION,
      payload: migratePortableLearnerV1(value.payload),
    };
  }
  if (value.schemaVersion === PREVIOUS_LEARNER_CONTRACT_VERSION) {
    return {
      kind: PORTABLE_LEARNER_DATA_KIND,
      schemaVersion: LEARNER_CONTRACT_VERSION,
      payload: migratePortableLearnerV2(value.payload),
    };
  }
  if (value.schemaVersion !== LEARNER_CONTRACT_VERSION) {
    throw new ContractValidationError(`Unsupported ${PORTABLE_LEARNER_DATA_KIND} schema version: ${String(value.schemaVersion)}.`);
  }
  if (!validatePortableLearnerData(value.payload)) {
    throw new ContractValidationError("Portable learner data has an invalid shape.");
  }
  return {
    kind: PORTABLE_LEARNER_DATA_KIND,
    schemaVersion: LEARNER_CONTRACT_VERSION,
    payload: structuredClone(value.payload),
  };
}

export interface DatedRecord {
  id: string;
  updatedAt?: string;
  createdAt?: string;
}

function recordDate(record: DatedRecord): string {
  return record.updatedAt ?? record.createdAt ?? "";
}

function hasValidRecordTimestamps(record: DatedRecord): boolean {
  if (record.createdAt !== undefined && !isContractTimestamp(record.createdAt)) return false;
  if (record.updatedAt !== undefined && !isContractTimestamp(record.updatedAt)) return false;
  return isContractTimestamp(recordDate(record))
    && (record.createdAt === undefined || record.updatedAt === undefined
      || compareContractTimestamps(record.updatedAt, record.createdAt) >= 0);
}

function stableRecordJson(record: DatedRecord): string {
  const timestampNormalizedRecord = Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    (key === "createdAt" || key === "updatedAt") && typeof value === "string" && isContractTimestamp(value)
      ? new Date(value).toISOString()
      : value,
  ]));
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => codePointCompare(left, right))
      .map(([key, entry]) => [key, sort(entry)]));
  };
  return JSON.stringify(sort(timestampNormalizedRecord));
}

/** Newer records win. Concurrent equal-timestamp changes fail closed instead of silently discarding work. */
export function mergeDatedRecords<T extends DatedRecord>(...lists: ReadonlyArray<ReadonlyArray<T>>): T[] {
  const records = new Map<string, T>();
  for (const list of lists) {
    for (const candidate of list) {
      if (!isContractId(candidate.id) || !hasValidRecordTimestamps(candidate)) {
        throw new ContractValidationError(`Cannot merge malformed record ${candidate.id}.`);
      }
      const current = records.get(candidate.id);
      const dateComparison = current ? compareContractTimestamps(recordDate(candidate), recordDate(current)) : 1;
      if (current && dateComparison === 0
        && stableRecordJson(candidate) !== stableRecordJson(current)) {
        throw new MergeConflictError(`Concurrent records conflict for ${candidate.id}.`);
      }
      if (!current
        || dateComparison > 0
        || (dateComparison === 0 && stableRecordJson(candidate) === stableRecordJson(current))) {
        records.set(candidate.id, structuredClone(candidate));
      }
    }
  }
  return [...records.values()].sort((left, right) =>
    compareContractTimestamps(recordDate(left), recordDate(right)) || codePointCompare(left.id, right.id));
}

function unionStrings(...lists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  return [...new Set(lists.flat())].sort(codePointCompare);
}

/**
 * Priority IDs are device-local. Merge by the learner-selected target instead:
 * a newer choice wins, while equal-time differing choices fail closed.
 */
export function mergeStudyPriorities(
  ...lists: ReadonlyArray<ReadonlyArray<StudyPriorityRecord>>
): StudyPriorityRecord[] {
  const byTarget = new Map<string, StudyPriorityRecord>();
  for (const list of lists) {
    for (const candidate of list) {
      if (!validateStudyPriorityRecord(candidate)) {
        throw new ContractValidationError("Cannot merge malformed study priority.");
      }
      const target = `${candidate.targetType}:${candidate.targetId}`;
      const current = byTarget.get(target);
      if (!current) {
        byTarget.set(target, structuredClone(candidate));
        continue;
      }
      const comparison = compareContractTimestamps(candidate.updatedAt, current.updatedAt);
      if (comparison === 0 && candidate.priority !== current.priority) {
        throw new MergeConflictError(`Concurrent study priorities conflict for ${target}.`);
      }
      if (comparison > 0 || (comparison === 0 && codePointCompare(candidate.id, current.id) < 0)) {
        byTarget.set(target, structuredClone(candidate));
      }
    }
  }
  return [...byTarget.values()].sort((left, right) =>
    compareContractTimestamps(left.updatedAt, right.updatedAt)
    || codePointCompare(`${left.targetType}:${left.targetId}`, `${right.targetType}:${right.targetId}`));
}

function mergedProfile(left: LearnerProfile, right: LearnerProfile): LearnerProfile {
  return {
    topicsExplored: unionStrings(left.topicsExplored, right.topicsExplored),
    strengths: unionStrings(left.strengths, right.strengths),
    weaknesses: unionStrings(left.weaknesses, right.weaknesses),
    sessionsCount: Math.max(left.sessionsCount, right.sessionsCount),
    ...(left.lastSessionAt || right.lastSessionAt
      ? { lastSessionAt: [left.lastSessionAt, right.lastSessionAt].filter((value): value is string => !!value).sort(compareContractTimestamps).at(-1) }
      : {}),
  };
}

export function mergePortableLearnerData(
  left: PortableLearnerData,
  right: PortableLearnerData,
): PortableLearnerData {
  if (!validatePortableLearnerData(left) || !validatePortableLearnerData(right)) {
    throw new ContractValidationError("Cannot merge invalid portable learner data.");
  }
  const generatedAt = compareContractTimestamps(left.generatedAt, right.generatedAt) >= 0 ? left.generatedAt : right.generatedAt;
  const merged: PortableLearnerData = {
    generatedAt,
    sessions: mergeDatedRecords(left.sessions, right.sessions),
    artifacts: mergeDatedRecords(left.artifacts, right.artifacts),
    goals: mergeDatedRecords(left.goals, right.goals),
    questionChecks: mergeDatedRecords(left.questionChecks, right.questionChecks),
    quizResults: mergeDatedRecords(left.quizResults, right.quizResults),
    decks: mergeDatedRecords(left.decks, right.decks),
    cardReviews: mergeDatedRecords(left.cardReviews, right.cardReviews),
    studyPriorities: mergeStudyPriorities(left.studyPriorities, right.studyPriorities),
    feedbackEvents: mergeDatedRecords(left.feedbackEvents, right.feedbackEvents),
    usageEvents: mergeDatedRecords(left.usageEvents, right.usageEvents),
    topicEvidence: mergeDatedRecords(left.topicEvidence, right.topicEvidence),
    benchmarks: mergeBenchmarkHistory(left.benchmarks, right.benchmarks),
    evolutions: mergeEvolutionHistory(left.evolutions, right.evolutions),
    learnerProfile: mergedProfile(left.learnerProfile, right.learnerProfile),
  };
  if (!validatePortableLearnerData(merged)) {
    throw new MergeConflictError("Merged learner data has dangling references or invalid lineage.");
  }
  return merged;
}
