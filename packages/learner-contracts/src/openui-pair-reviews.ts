import type { JudgementErrorCode } from "./judgement/contracts.js";
import type { TeachingDraftPairReview } from "./judgement/teaching-drafts/pair-review.js";
import type { TeachingDraftFinalComparison } from "./judgement/teaching-drafts.js";
import { OPENUI_DIAGNOSTIC_GATE_ISSUES, isOpenUiDiagnosticGateIssue } from "./openui-diagnostic-issues.js";

/** Pair evidence retained by the classroom, exports and fleet analytics. */
export type OpenUiPairReview = Omit<TeachingDraftPairReview, "probabilities">;
export type OpenUiFinalComparison = TeachingDraftFinalComparison;
const errors = ["request-invalid", "backend-unavailable", "backend-unauthorized", "backend-payment-required",
  "backend-rate-limited", "backend-overloaded", "backend-timeout", "response-malformed", "cancelled"] as const satisfies readonly JudgementErrorCode[];
const modelPattern = "^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$";
const modelId = new RegExp(modelPattern);
const policyPattern = "^keating-teaching-policy/v[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$";
const policyId = new RegExp(policyPattern);
const pairFields = ["pair", "candidateAttempts", "status", "preferredAttempt", "model", "error",
  "eligibleAttempts", "feedbackOnlyAttempts", "predictionQuestionAttempts", "candidateIssueIds", "finalistAttempt", "startedAtMs", "finishedAtMs", "policyVersion"];

function members(value: unknown, allowed: readonly number[]): value is number[] {
  return Array.isArray(value) && value.every(n => allowed.includes(n)) && new Set(value).size === value.length;
}

function validReview(value: unknown): value is OpenUiPairReview {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !pairFields.includes(k))) return false;
  const r = value as Record<string, unknown>;
  if (r.pair !== 1 && r.pair !== 2) return false;
  if (r.policyVersion !== undefined && (typeof r.policyVersion !== "string" || !policyId.test(r.policyVersion))) return false;
  if (!members(r.candidateAttempts, r.pair === 1 ? [1, 2] : [3, 4])) return false;
  if (r.model !== null && (typeof r.model !== "string" || !modelId.test(r.model))) return false;
  if (r.error !== undefined && !errors.some(code => code === r.error)) return false;
  if (r.status === "compared") {
    if (r.model === null || r.error !== undefined || r.candidateAttempts.length !== 2 || !r.candidateAttempts.includes(r.preferredAttempt as number)) return false;
  } else if (r.status === "incomplete" || r.status === "unavailable") {
    if (r.preferredAttempt !== null || (r.candidateAttempts.length < 2) !== (r.status === "incomplete")) return false;
  } else return false;
  if (r.eligibleAttempts !== undefined && !members(r.eligibleAttempts, r.candidateAttempts)) return false;
  const feedback = r.feedbackOnlyAttempts;
  const predictions = r.predictionQuestionAttempts;
  if (feedback !== undefined && !members(feedback, r.candidateAttempts)) return false;
  if (predictions !== undefined && !members(predictions, r.candidateAttempts)) return false;
  if (feedback && predictions && predictions.some(id => feedback.includes(id))) return false;
  if (r.candidateIssueIds !== undefined) {
    if (!Array.isArray(r.candidateIssueIds) || r.candidateIssueIds.length > 2) return false;
    const seen = new Set<number>();
    for (const entry of r.candidateIssueIds) {
      if (!entry || typeof entry !== "object" || Object.keys(entry).some(key => key !== "attempt" && key !== "issues")
        || !r.candidateAttempts.includes(entry.attempt) || seen.has(entry.attempt)
        || !Array.isArray(entry.issues) || new Set(entry.issues).size !== entry.issues.length
        || !entry.issues.every((id: unknown) => typeof id === "string" && isOpenUiDiagnosticGateIssue(id))) return false;
      seen.add(entry.attempt);
    }
  }
  if (r.finalistAttempt !== undefined && (r.eligibleAttempts === undefined ||
    (r.finalistAttempt === null ? r.eligibleAttempts.length !== 0 : !r.eligibleAttempts.includes(r.finalistAttempt as number)))) return false;
  if (r.startedAtMs === undefined && r.finishedAtMs === undefined) return true;
  return r.status !== "incomplete" && typeof r.startedAtMs === "number" && typeof r.finishedAtMs === "number"
    && Number.isFinite(r.startedAtMs) && Number.isFinite(r.finishedAtMs) && r.startedAtMs >= 0 && r.finishedAtMs >= r.startedAtMs;
}

export function validOpenUiPairReviews(value: unknown): value is OpenUiPairReview[] {
  return Array.isArray(value) && value.length <= 2 && value.every(validReview) && new Set(value.map(r => r.pair)).size === value.length;
}

/** Project only closed fields. Never store draft text, tool arguments or an upstream error body. */
export function projectOpenUiPairReviews(source?: readonly TeachingDraftPairReview[]): OpenUiPairReview[] | undefined {
  if (!Array.isArray(source) || source.length > 2 || source.some(row => !row || typeof row !== "object")) return;
  const rows = source.map(({ pair, policyVersion, candidateAttempts, status, preferredAttempt, model, error, eligibleAttempts, feedbackOnlyAttempts, predictionQuestionAttempts, candidateIssueIds, finalistAttempt, startedAtMs, finishedAtMs }) =>
    ({ pair, candidateAttempts, status, preferredAttempt, model, ...(error === undefined ? {} : { error }),
      ...(eligibleAttempts === undefined ? {} : { eligibleAttempts }), ...(finalistAttempt === undefined ? {} : { finalistAttempt }),
      ...(feedbackOnlyAttempts === undefined ? {} : { feedbackOnlyAttempts }),
      ...(policyVersion === undefined ? {} : { policyVersion }),
      ...(predictionQuestionAttempts === undefined ? {} : { predictionQuestionAttempts }),
      ...(candidateIssueIds === undefined ? {} : { candidateIssueIds }),
      ...(startedAtMs === undefined ? {} : { startedAtMs }), ...(finishedAtMs === undefined ? {} : { finishedAtMs }) }));
  return validOpenUiPairReviews(rows) ? structuredClone(rows).sort((a, b) => a.pair - b.pair) : undefined;
}

/** Overlap of the two recorded judge invocations. Missing timing is distinct from zero overlap. */
export function pairReviewOverlapMs(rows: readonly OpenUiPairReview[]): number | null {
  const [a, b] = rows;
  if (a?.startedAtMs === undefined || b?.startedAtMs === undefined || a.finishedAtMs === undefined || b.finishedAtMs === undefined) return null;
  return Math.max(0, Math.min(a.finishedAtMs, b.finishedAtMs) - Math.max(a.startedAtMs, b.startedAtMs));
}

function pairSchema(pair: number, attempts: number[]) {
  const list = { type: "array", uniqueItems: true, maxItems: 2, items: { enum: attempts } };
  const idOrNull = { enum: [...attempts, null] };
  return {
    type: "object", additionalProperties: false, required: ["pair", "candidateAttempts", "status", "preferredAttempt", "model"],
    properties: { pair: { const: pair }, candidateAttempts: list, eligibleAttempts: list, feedbackOnlyAttempts: list, predictionQuestionAttempts: list, preferredAttempt: idOrNull, finalistAttempt: idOrNull,
      model: { anyOf: [{ type: "string", pattern: modelPattern }, { type: "null" }] },
      policyVersion: { type: "string", pattern: policyPattern },
      candidateIssueIds: { type: "array", maxItems: 2, items: {
        type: "object", additionalProperties: false, required: ["attempt", "issues"],
        properties: { attempt: { enum: attempts }, issues: { type: "array", uniqueItems: true, items: { enum: OPENUI_DIAGNOSTIC_GATE_ISSUES } } },
      } },
      status: { enum: ["compared", "incomplete", "unavailable"] }, error: { enum: errors },
      startedAtMs: { type: "number", minimum: 0 }, finishedAtMs: { type: "number", minimum: 0 } },
    dependentRequired: { startedAtMs: ["finishedAtMs"], finishedAtMs: ["startedAtMs"], finalistAttempt: ["eligibleAttempts"] },
    allOf: [
      { if: { properties: { status: { const: "compared" } } },
        then: { properties: { preferredAttempt: { enum: attempts }, model: { type: "string" } }, not: { required: ["error"] } },
        else: { properties: { preferredAttempt: { const: null } } } },
      { if: { properties: { status: { const: "incomplete" } } },
        then: { properties: { candidateAttempts: { maxItems: 1 } }, not: { required: ["startedAtMs"] } },
        else: { properties: { candidateAttempts: { minItems: 2 } } } },
    ],
  };
}
export const OPENUI_PAIR_REVIEWS_SCHEMA = {
  type: "array", maxItems: 2, items: { oneOf: [pairSchema(1, [1, 2]), pairSchema(2, [3, 4])] },
  allOf: [1, 2].map(pair => ({ contains: { properties: { pair: { const: pair } } }, minContains: 0, maxContains: 1 })),
};

const draftIds = [1, 2, 3, 4];
const scoreSchema = { type: "number", minimum: 0, maximum: 1 };
const isScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export const OPENUI_FINAL_COMPARISON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["model", "candidateAttempts", "preferredAttempt", "probabilities"],
  properties: {
    model: { type: "string", pattern: modelPattern },
    candidateAttempts: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: { enum: draftIds } },
    preferredAttempt: { enum: draftIds }, confidence: scoreSchema,
    probabilities: { type: "object", minProperties: 2, maxProperties: 2, additionalProperties: false,
      properties: Object.fromEntries(draftIds.map(id => ["draft_" + id, scoreSchema])) },
  },
};
export function validOpenUiFinalComparison(value: unknown, pairs?: readonly OpenUiPairReview[]): value is OpenUiFinalComparison {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => !Object.hasOwn(OPENUI_FINAL_COMPARISON_SCHEMA.properties, key))) return false;
  const { model, candidateAttempts, preferredAttempt, probabilities, confidence } = value as Record<string, unknown>;
  if (typeof model !== "string" || !modelId.test(model) || !members(candidateAttempts, draftIds) || candidateAttempts.length !== 2 ||
    (candidateAttempts[0]! <= 2) === (candidateAttempts[1]! <= 2) || !candidateAttempts.includes(preferredAttempt as number) ||
    !probabilities || typeof probabilities !== "object" || Array.isArray(probabilities) || Object.keys(probabilities).length !== 2 ||
    (confidence !== undefined && !isScore(confidence))) return false;
  const scores = probabilities as Record<string, unknown>;
  if (pairs?.some(pair => pair.finalistAttempt !== undefined &&
    (pair.finalistAttempt === null || !candidateAttempts.includes(pair.finalistAttempt)))) return false;
  const [a, b] = candidateAttempts.map(id => scores["draft_" + id]);
  return isScore(a) && isScore(b) && Math.abs(a + b - 1) <= 1e-6 && scores["draft_" + preferredAttempt] === Math.max(a, b);
}
export function projectOpenUiFinalComparison(value: unknown): OpenUiFinalComparison | undefined {
  return validOpenUiFinalComparison(value) ? structuredClone(value) : undefined;
}
