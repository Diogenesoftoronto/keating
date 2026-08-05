/**
 * The deliberately small, vendor-neutral record Keating may export about a
 * completed local evaluation. It is never a copy of an artifact, prompt,
 * topic, learner record, path, or error message.
 */
export const EVALUATION_OBSERVATION_VERSION = 1 as const;

export type EvaluationOperation =
  | "benchmark"
  | "policy_evolution"
  | "prompt_eval"
  | "prompt_evolution"
  | "auto_improve";

export type EvaluationEngine = "deterministic" | "heuristic" | "llm" | "learner-feedback";
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
