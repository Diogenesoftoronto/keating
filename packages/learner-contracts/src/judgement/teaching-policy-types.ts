import type { ActiveWork } from "./active-work.js";
import type { JudgementOutcome } from "./contracts.js";
import type { InteractionRecommendation } from "./interaction-affordances.js";
import type { PlanReview } from "./plan-review.js";

/** Observations supplied by the runtime, never inferred permissions or benchmark labels. */
export interface TeachingPolicyTurn {
  readonly learnerMessage: string;
  readonly conversation: readonly { readonly role: "user" | "assistant" | "tool"; readonly content: string }[];
  readonly learnerEvidence: readonly { readonly kind: string; readonly content: string }[];
  readonly availableTools: readonly string[];
  readonly toolResults: readonly { readonly name: string; readonly status: "success" | "error"; readonly content: string }[];
  readonly sources: readonly { readonly id: string; readonly url: string; readonly text: string }[];
  readonly assessment: "none" | "practice" | "assessed" | "unknown";
  readonly pendingSubmissions?: readonly { readonly kind: "quiz" | "comprehension"; readonly id: string; readonly questionIds: readonly string[]; readonly topic?: string; readonly questionText?: string }[];
  readonly improvementRuns: number | null;
  readonly domain: "unknown" | "general" | "mathematics" | "philosophy" | "science" | "code" | "law" | "medicine" | "history" | "psychology" | "politics" | "art";
  /** Record-derived plan position; rebuilt each turn and never evicted by the conversation window. */
  readonly activeWork?: ActiveWork;
}

export interface TeachingPolicyReply {
  readonly text: string;
  /** Proposed calls, not evidence that a tool executed. */
  readonly toolCalls: readonly { readonly name: string; readonly arguments: unknown }[];
}

export interface TeachingPolicyPlan {
  readonly version: string;
  readonly status: "guided" | "abstained";
  readonly decisions: Readonly<Record<string, boolean | null>>;
  /** Properties of the material; null is uncertain and never earns an activity. */
  readonly features: Readonly<Record<string, boolean | null>>;
  /** Code-owned mapping of features to OpenUI components. */
  readonly interaction: InteractionRecommendation;
  /** Present only on a triggered plan-review turn with an active plan. */
  readonly planReview: PlanReview | null;
  readonly directives: readonly string[];
  readonly uncertain: readonly string[];
  /** Advisory subset; a host must independently enforce schemas and authorization. */
  readonly allowedTools: readonly string[];
}

export interface TeachingPolicyCheck {
  readonly id: string;
  readonly status: "pass" | "fail" | "unknown";
  readonly source: "deterministic" | "jev";
  readonly severity: "critical" | "major" | "minor";
  /** Always P(violation); null means missing evidence or no model judgment. */
  readonly probability: number | null;
}

export interface TeachingPolicyAssessment {
  readonly version: string;
  readonly status: "pass" | "fail" | "unknown";
  readonly checks: readonly TeachingPolicyCheck[];
  readonly failed: readonly string[];
  readonly uncertain: readonly string[];
  readonly calibration: "uncalibrated";
  readonly humanLearning: "unmeasured";
}

/** Fixtures are authored proxy labels, not human-learning measurements. */
export interface TeachingPolicyCase {
  readonly id: string;
  readonly family: string;
  readonly split: "development" | "holdout";
  readonly turn: TeachingPolicyTurn;
  /** Optional focused rule IDs; global invariants are always checked as well. */
  readonly ruleIds: readonly string[];
  /** Never included in generation or judgment state. */
  readonly expectedDecisions: Readonly<Record<string, boolean>>;
}

export interface TeachingPolicyJudgeFixture {
  readonly id: string;
  readonly family: string;
  readonly split: "development" | "holdout";
  readonly turn: TeachingPolicyTurn;
  readonly reply: TeachingPolicyReply;
  /** A label per narrow violation, true = the violation is present. */
  readonly violations: Readonly<Record<string, boolean>>;
}

export interface TeachingPolicyJudgementRecord {
  readonly elapsedMs: number;
  readonly outcome: JudgementOutcome;
}
