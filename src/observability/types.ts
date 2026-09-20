/**
 * The deliberately small, vendor-neutral record Keating may export about a
 * completed local evaluation. It is never a copy of an artifact, prompt,
 * topic, learner record, path, or error message.
 */
export const EVALUATION_OBSERVATION_VERSION = 2 as const;

export type EvaluationOperation =
  | "benchmark"
  | "policy_evolution"
  | "prompt_eval"
  | "prompt_evolution"
  | "auto_improve";

export type EvaluationEngine =
  | "deterministic"
  | "heuristic"
  | "llm"
  | "learner-feedback"
  | "typed-judgement";
export type EvaluationStatus = "success" | "error" | "rejected" | "rolled_back";
export type EvaluationSurface = "cli" | "pi" | "mcp";

export interface EvaluationObservationV1 {
  schemaVersion: typeof EVALUATION_OBSERVATION_VERSION;
  operation: EvaluationOperation;
  engine: EvaluationEngine;
  status: EvaluationStatus;
  suite: string;
  duration_ms: number;
  score?: number;
  before_score?: number;
  after_score?: number;
  outcome_count?: number;
  candidate_count?: number;
  provider?: string;
  model?: string;
  /**
   * Typed-judgement routing identity (§1.4/§7 of the Jev cascade plan).
   * Which judgement backend answered, distinct from the LLM provider above.
   * Present only for `engine: "typed-judgement"`.
   */
  backend?: string;
  /**
   * Hex digest of the calibration the answering backend was fitted against.
   * Thresholds are never shared across backends, so this is what makes that
   * mechanically checkable in telemetry rather than a convention.
   */
  calibration_sha256?: string;
  error_category?: string;
  app_version: string;
  surface: EvaluationSurface;
}

export interface ArizeAvailability {
  enabled: boolean;
  reason:
    | "enabled"
    | "disabled"
    | "missing_api_key"
    | "missing_space_id"
    | "invalid_endpoint"
    | "invalid_project_name";
  evaluationContentEnabled: boolean;
  maxContentChars: number;
  rateLimitPerMinute: number;
}
