/**
 * Typed judgement contracts shared by every Keating surface.
 *
 * A judgement asks a closed-vocabulary question and gets back a probability
 * distribution over answers the caller declared in advance. Because the
 * vocabulary is fixed by code, an answer can be *selected* but never invented.
 * That single property is what lets a judgement stand in for an LLM-as-judge
 * without giving up the evidence trail.
 *
 * This module is pure: no network, no clock, no crypto, no platform globals.
 * Transports live in `src/judgement/` (CLI) and `web/src/keating/judgement/`.
 */

/**
 * Absolute yes/no, answered with P(yes).
 *
 * A Noul deliberately carries no confidence. A value near 0.5 means yes and no
 * are equally likely — it does not mean "medium", which is the documented way
 * this primitive gets misread.
 */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
  /**
   * Optional poles. `true` must describe the yes case; a Noul whose `true`
   * describes "no" performs measurably worse, so the asymmetry is load-bearing.
   */
  readonly criteria?: { readonly true: string; readonly false: string };
}

/** Relative selection over a closed option set: which one, not how much. */
export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  /** Option -> rubric, `null` where an option needs no elaboration. */
  readonly criteria: Readonly<Record<string, string | null>>;
}

/** Ordered levels, worst first. Levels are ordinal labels, not a numeric scale. */
export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type JudgementQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  readonly type: "noul";
  /** P(yes), 0..1. There is no confidence field, and one must not be invented. */
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  /** Always byte-identical to one of the declared option keys. */
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  /**
   * `score` is a probability-weighted value that can land between levels. It is
   * weak in numerical calibration, so it is never interpolated back into a
   * magnitude — decisions read `modalLevel` or a threshold instead.
   */
  readonly type: "score";
  readonly score: number;
  readonly legend: Readonly<Record<string, string>>;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export type JudgementAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export function isNoulAnswer(answer: JudgementAnswer): answer is NoulAnswer {
  return answer.type === "noul";
}
export function isChoiceAnswer(answer: JudgementAnswer): answer is ChoiceAnswer {
  return answer.type === "choice";
}
export function isScoreAnswer(answer: JudgementAnswer): answer is ScoreAnswer {
  return answer.type === "score";
}

/**
 * Our guardrails, not the provider's: the HTTP contract documents no limits.
 * Keeping them here means both transports inherit the same ceiling.
 */
export const MAX_QUESTIONS_PER_REQUEST = 64;
export const MAX_STATE_CHARS = 96_000;
/** A Choice accepts at most 255 options; past that, narrow in two stages. */
export const MAX_CHOICE_OPTIONS = 255;
/** A Score needs at least two levels to be ordered at all. */
export const MIN_SCORE_LEVELS = 2;

export type JudgementState = string | Readonly<Record<string, unknown>> | readonly unknown[];

export interface JudgementRequest {
  /**
   * Assembled, never dumped. Accuracy falls as irrelevant material grows, so
   * retrieval and filtering happen in code before anything is asked.
   */
  readonly state: JudgementState;
  /** Caller-chosen keys; answers come back under the same keys. */
  readonly questions: Readonly<Record<string, JudgementQuestion>>;
}

/**
 * Stable diagnostic codes. Upstream error bodies can echo a learner's own text,
 * so they never reach a caller, a log line, or a screen.
 */
export type JudgementErrorCode =
  | "request-invalid"
  | "backend-unavailable"
  | "backend-unauthorized"
  | "backend-rate-limited"
  | "backend-overloaded"
  | "backend-timeout"
  | "response-malformed"
  | "cancelled";

export interface JudgementError {
  readonly code: JudgementErrorCode;
  /** Rate-limited and overloaded are the retryable pair; the rest are not. */
  readonly retryable: boolean;
}

/** Which implementation answered. Routing identity, distinct from the manifest below. */
export type JudgementBackend = "system-one" | "local" | "fixture";

export interface JudgementBackendKey {
  readonly backend: JudgementBackend;
  readonly model: string;
  /** Null until fitted. An uncalibrated backend has no thresholds to trust. */
  readonly calibrationSha256: string | null;
}

export interface JudgementUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface JudgementResponse {
  readonly answers: Readonly<Record<string, JudgementAnswer>>;
  readonly backend: JudgementBackendKey;
  readonly usage?: JudgementUsage;
}

export type JudgementOutcome =
  | { readonly ok: true; readonly response: JudgementResponse }
  | { readonly ok: false; readonly error: JudgementError };

/**
 * The one interface every backend implements. Failures are returned, never
 * thrown: a judgement that could not be made is an ordinary answer shape, and
 * callers must already handle abstention.
 */
export type JudgementCaller = (
  request: JudgementRequest,
  signal?: AbortSignal,
) => Promise<JudgementOutcome>;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** The protocol pinned by `scripts/training/benchmark_response_grading.py`. */
export const TUTOR_RESPONSE_PROTOCOL = "contextual-tutor-response/v1";

/**
 * Backend identity, field-for-field with `validate_classifier` in
 * `scripts/training/benchmark_response_grading.py`.
 *
 * The snake_case is deliberate. The Python benchmark and this runtime have to
 * describe a backend identically or `calibration_sha256` stops being a
 * cross-language check, and "thresholds are never shared across backends"
 * degrades from a mechanical guarantee into a convention.
 *
 * Note that Jev needs no new `kind`: reached over HTTP it is a `model_api`,
 * which keeps the existing Python validator passing unchanged.
 */
export interface JudgementClassifierManifest {
  readonly kind: "model_api" | "activation_probe" | "fixture";
  readonly id: string;
  readonly revision: string;
  readonly protocol: string;
  readonly artifact_sha256: string;
  /** Null is "uncalibrated", which the Python report surfaces by that name. */
  readonly calibration_sha256: string | null;
  /** Predeclared escalation threshold; must be greater than zero. */
  readonly minimum_confidence: number;
  readonly observer_manifest_sha256?: string;
}

const MANIFEST_REQUIRED = [
  "kind", "id", "revision", "protocol",
  "artifact_sha256", "calibration_sha256", "minimum_confidence",
] as const;
const MANIFEST_OPTIONAL = ["observer_manifest_sha256"] as const;
const MANIFEST_KINDS = new Set(["model_api", "activation_probe", "fixture"]);

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Mirrors the Python validator's checks, including the activation-probe extras. */
export function validateClassifierManifest(
  value: unknown,
  protocol: string = TUTOR_RESPONSE_PROTOCOL,
): value is JudgementClassifierManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set<string>([...MANIFEST_REQUIRED, ...MANIFEST_OPTIONAL]);
  const keys = Reflect.ownKeys(value);
  if (!keys.every((key) => typeof key === "string" && allowed.has(key))) return false;
  const manifest = value as Partial<JudgementClassifierManifest>;
  if (!MANIFEST_REQUIRED.every((key) => key in manifest)) return false;
  if (typeof manifest.kind !== "string" || !MANIFEST_KINDS.has(manifest.kind)) return false;
  if (!isNonEmptyText(manifest.id) || !isNonEmptyText(manifest.revision)) return false;
  if (manifest.protocol !== protocol) return false;
  if (!isSha256Hex(manifest.artifact_sha256)) return false;
  const calibration = manifest.calibration_sha256;
  if (calibration !== null && !isSha256Hex(calibration)) return false;
  const floor = manifest.minimum_confidence;
  if (typeof floor !== "number" || !Number.isFinite(floor) || floor <= 0) return false;
  if (manifest.kind === "activation_probe") {
    return calibration !== null && isSha256Hex(manifest.observer_manifest_sha256);
  }
  return manifest.observer_manifest_sha256 === undefined
    || isSha256Hex(manifest.observer_manifest_sha256);
}

function stableJson(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([key, child]) => [key, sort(child)]));
  };
  return JSON.stringify(sort(value));
}

/**
 * A structural key for a question — not a cryptographic hash. It exists so a
 * calibration can be filed against the exact question it was fitted on. Edit
 * the instructions or the criteria and the key changes, which is precisely when
 * the old thresholds stop applying.
 */
export function questionDigest(question: JudgementQuestion): string {
  return stableJson(question);
}

export function stateCharacterCount(state: JudgementState): number {
  return typeof state === "string" ? state.length : JSON.stringify(state).length;
}

/**
 * Returns an authored reason, or null when the request is well formed. The text
 * describes our own construction mistake, never upstream content, so it is safe
 * to log. Transports map any non-null result to `request-invalid`.
 */
export function judgementRequestProblem(request: JudgementRequest): string | null {
  const entries = Object.entries(request.questions);
  if (entries.length === 0) return "A judgement request needs at least one question.";
  if (entries.length > MAX_QUESTIONS_PER_REQUEST) {
    return `A judgement request carries at most ${MAX_QUESTIONS_PER_REQUEST} questions.`;
  }
  if (stateCharacterCount(request.state) > MAX_STATE_CHARS) {
    return `Judgement state exceeds ${MAX_STATE_CHARS} characters; filter it in code first.`;
  }
  for (const [key, question] of entries) {
    if (!isNonEmptyText(key)) return "Every question needs a non-empty key.";
    if (!isNonEmptyText(question.instructions)) {
      return `Question "${key}" needs instructions.`;
    }
    if (question.type === "choice") {
      const options = Object.keys(question.criteria);
      if (options.length < 2) return `Choice "${key}" needs at least two options.`;
      if (options.length > MAX_CHOICE_OPTIONS) {
        return `Choice "${key}" exceeds ${MAX_CHOICE_OPTIONS} options; narrow in two stages.`;
      }
      if (options.some((option) => option.length === 0)) {
        return `Choice "${key}" has an empty option key.`;
      }
    }
    if (question.type === "score" && question.criteria.length < MIN_SCORE_LEVELS) {
      return `Score "${key}" needs at least ${MIN_SCORE_LEVELS} ordered levels.`;
    }
  }
  return null;
}
