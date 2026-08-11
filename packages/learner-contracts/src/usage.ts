import { hasOnlyKeys, isBoundedString, isContractId, isContractTimestamp } from "./validation.js";

/**
 * A provider's own usage accounting for one completed request. Values here are
 * deliberately not estimates: absent fields mean the provider did not report
 * that part of the accounting.
 */
export interface LearnerUsageEvent {
  id: string;
  provider: string;
  model: string;
  createdAt: string;
  /** Links usage to a portable lesson only when that lesson is exported too. */
  sessionId?: string;
  providerReported: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    /** Optional because most providers do not return a cost for every request. */
    costUsd?: number;
  };
}

/**
 * A factual reason a topic appears in a learner's activity history. This is
 * evidence of exposure or activity, never a mastery claim.
 */
export interface TopicEvidence {
  id: string;
  topic: string;
  createdAt: string;
  provenance: "session" | "artifact" | "assessment" | "review" | "learner-declared";
  /**
   * A reference is optional for learner-declared evidence, but when supplied
   * it is checked against exported records by the portable-data validator.
   */
  reference?: {
    kind: "session" | "artifact" | "question-check" | "quiz-result" | "card-review";
    id: string;
  };
}

const PROVIDER_USAGE_KEYS = new Set(["id", "provider", "model", "createdAt", "sessionId", "providerReported"]);
const PROVIDER_REPORTED_KEYS = new Set(["inputTokens", "outputTokens", "totalTokens", "costUsd"]);
const TOPIC_EVIDENCE_KEYS = new Set(["id", "topic", "createdAt", "provenance", "reference"]);
const TOPIC_EVIDENCE_REFERENCE_KEYS = new Set(["kind", "id"]);
const PROVENANCE_VALUES = new Set<TopicEvidence["provenance"]>([
  "session", "artifact", "assessment", "review", "learner-declared",
]);
const REFERENCE_KINDS = new Set<NonNullable<TopicEvidence["reference"]>["kind"]>([
  "session", "artifact", "question-check", "quiz-result", "card-review",
]);
const MAX_PROVIDER_LENGTH = 128;
const MAX_MODEL_LENGTH = 256;
const MAX_TOPIC_LENGTH = 512;
const MAX_REPORTED_TOKENS = 1_000_000_000_000;
const MAX_COST_USD = 1_000_000_000;

function isReportedTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= MAX_REPORTED_TOKENS;
}

function isReportedCostUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= 0 && value <= MAX_COST_USD;
}

export function validateLearnerUsageEvent(value: unknown): value is LearnerUsageEvent {
  if (!hasOnlyKeys(value, PROVIDER_USAGE_KEYS)) return false;
  const record = value as Partial<LearnerUsageEvent>;
  if (!isContractId(record.id)
    || !isBoundedString(record.provider, MAX_PROVIDER_LENGTH, false)
    || !isBoundedString(record.model, MAX_MODEL_LENGTH, false)
    || !isContractTimestamp(record.createdAt)
    || (record.sessionId !== undefined && !isContractId(record.sessionId))
    || !record.providerReported
    || !hasOnlyKeys(record.providerReported, PROVIDER_REPORTED_KEYS)) return false;

  const reported = record.providerReported;
  const inputTokens = reported.inputTokens;
  const outputTokens = reported.outputTokens;
  const totalTokens = reported.totalTokens;
  if ((inputTokens !== undefined && !isReportedTokenCount(inputTokens))
    || (outputTokens !== undefined && !isReportedTokenCount(outputTokens))
    || (totalTokens !== undefined && !isReportedTokenCount(totalTokens))
    || (reported.costUsd !== undefined && !isReportedCostUsd(reported.costUsd))) return false;
  if (inputTokens === undefined && outputTokens === undefined
    && totalTokens === undefined && reported.costUsd === undefined) return false;

  if (totalTokens !== undefined) {
    if (inputTokens !== undefined && outputTokens !== undefined
      && totalTokens !== inputTokens + outputTokens) return false;
    if (inputTokens !== undefined && totalTokens < inputTokens) return false;
    if (outputTokens !== undefined && totalTokens < outputTokens) return false;
  }
  return true;
}

export function validateTopicEvidence(value: unknown): value is TopicEvidence {
  if (!hasOnlyKeys(value, TOPIC_EVIDENCE_KEYS)) return false;
  const record = value as Partial<TopicEvidence>;
  if (!isContractId(record.id) || !isBoundedString(record.topic, MAX_TOPIC_LENGTH, false)
    || !isContractTimestamp(record.createdAt)
    || !PROVENANCE_VALUES.has(record.provenance as TopicEvidence["provenance"])) return false;
  if (record.reference === undefined) return record.provenance === "learner-declared";
  const reference = record.reference;
  if (!hasOnlyKeys(reference, TOPIC_EVIDENCE_REFERENCE_KEYS)
    || !REFERENCE_KINDS.has(reference.kind)
    || !isContractId(reference.id)) return false;
  return (record.provenance === "session" && reference.kind === "session")
    || (record.provenance === "artifact" && reference.kind === "artifact")
    || (record.provenance === "assessment"
      && (reference.kind === "question-check" || reference.kind === "quiz-result"))
    || (record.provenance === "review" && reference.kind === "card-review");
}
