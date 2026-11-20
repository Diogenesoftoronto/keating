import type { JudgementError, JudgementErrorCode } from "../contracts.js";

/** The model selected in Settings can be an alias. It is never proof that a provider answered. */
export interface DecisionPlanningFailure {
  readonly stage: "planning";
  readonly reason: JudgementErrorCode;
  readonly detail?: JudgementError["detail"];
  readonly configuredModel?: string;
}

const explanations = {
  "backend-unauthorized": "The decision request was denied access. Check access to the decision service and its relay, including the configured credentials.",
  "backend-unavailable": "The decision model was unavailable. Check the judgement model in Settings and try again.",
  "backend-payment-required": "The decision request could not be funded. Check your account credit and request spending limit.",
  "backend-rate-limited": "The decision service rate limited the planning request. Try again.",
  "backend-overloaded": "The decision service was overloaded. Try again.",
  "backend-timeout": "The decision request timed out. Try again or choose a different judgement model in Settings.",
  "context-limit-exceeded": "The review request exceeded the decision model’s context window. Shorten your current request or choose a model with a larger context window.",
  "request-invalid": "Keating could not prepare a valid review request within the decision model’s limits.",
  "response-malformed": "The decision service returned an invalid or inconsistent planning response.",
  "cancelled": "The decision request was cancelled.",
} satisfies Record<JudgementErrorCode, string>;
const modelPattern = "^(?!.*://)[a-zA-Z0-9][a-zA-Z0-9._:/+~-]{0,159}$";
const modelId = new RegExp(modelPattern);

export const DECISION_PLANNING_FAILURE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["stage", "reason"],
  properties: { stage: { const: "planning" }, reason: { enum: Object.keys(explanations) },
    detail: { const: "relay-origin-denied" }, configuredModel: { type: "string", pattern: modelPattern } },
  allOf: [{ if: { required: ["detail"] }, then: { properties: { reason: { const: "backend-unauthorized" } } } }],
};

export function makeDecisionPlanningFailure(error: JudgementError, configuredModel?: string | null): DecisionPlanningFailure {
  return { stage: "planning", reason: Object.hasOwn(explanations, error.code) ? error.code : "response-malformed",
    ...(error.code === "backend-unauthorized" && error.detail === "relay-origin-denied" ? { detail: error.detail } : {}),
    ...(typeof configuredModel === "string" && modelId.test(configuredModel) ? { configuredModel } : {}) };
}

export function isDecisionPlanningFailure(value: unknown): value is DecisionPlanningFailure {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const failure = value as Record<string, unknown>;
  return Object.keys(failure).every(key => Object.hasOwn(DECISION_PLANNING_FAILURE_SCHEMA.properties, key))
    && failure.stage === "planning" && typeof failure.reason === "string" && Object.hasOwn(explanations, failure.reason)
    && (failure.detail === undefined || failure.detail === "relay-origin-denied" && failure.reason === "backend-unauthorized")
    && (failure.configuredModel === undefined || typeof failure.configuredModel === "string" && modelId.test(failure.configuredModel));
}

/** Shared, code-owned learner feedback. Upstream error bodies are never included. */
export const DECISION_PLANNING_NOTICE = "Decision planning stopped before the tutor could draft a reply.";
export function describeDecisionPlanningFailure(failure: DecisionPlanningFailure): string {
  if (failure.detail === "relay-origin-denied") return DECISION_PLANNING_NOTICE
    + " Keating’s decision relay rejected the page’s origin. The app operator can check the public origin and proxy configuration.";
  return DECISION_PLANNING_NOTICE + " " + explanations[failure.reason];
}
