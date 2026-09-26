import type { JudgementRequest } from "../../packages/learner-contracts/src/judgement/contracts.js";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "../../packages/learner-contracts/src/judgement/teaching-policy-types.js";

/** Authored episodes using production contracts, not observed human-learning outcomes. */
export interface KeatingScenario {
  id: string;
  family: string;
  split: "development" | "holdout";
  stage: "planning" | "adherence" | "grading" | "turn-analysis";
  title: string;
  turn: TeachingPolicyTurn;
  reply?: TeachingPolicyReply;
  standard?: "concise" | "supported" | "deep";
  /** Used only by a production grading/turn-analysis builder, never an invented rubric transport. */
  request?: JudgementRequest;
  /** Only independently reasoned assertions are labelled; other questions remain unlabelled. */
  expected: Record<string, boolean | string | number | null>;
  rationale: Record<string, string>;
  failureMode: string;
}
