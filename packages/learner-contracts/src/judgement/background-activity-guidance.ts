import type { ActivityObservations } from "./activity-observations.js";
import type { ActivityKind } from "./activity-learning.js";
import { rankBackgroundActivityKinds, type BackgroundActivityPolicy } from "./background-activity-policy.js";
import type { TeachingPolicyPlan } from "./teaching-policy-types.js";

/** Only material-appropriate components already offered by the ordinary planner are eligible. */
const componentKinds: Readonly<Record<string, ActivityKind>> = {
  Question: "question", Quiz: "question", Flashcards: "recall", Simulation: "simulation",
  LearningImage: "visual", ConceptMap: "visual", LanguagePractice: "practice",
  CodingChallenge: "practice", MusicLab: "practice",
};
const descriptions: Readonly<Record<ActivityKind, string>> = {
  prose: "a prose explanation", question: "a question", recall: "a recall activity",
  simulation: "a simulation", visual: "a visual explanation", practice: "a practice activity", mixed: "a mixed activity",
};
export interface BackgroundActivityGuidance {
  readonly version: 1;
  readonly policyCreatedAt: number;
  readonly preferredKind: ActivityKind;
  readonly target: "next-linked-objective-score";
  readonly causal: false;
}

/** A local preference, never a new permission, factual judgment, grade, or activity requirement. */
export function applyBackgroundActivityGuidance(plan: TeachingPolicyPlan, observations: ActivityObservations,
  policy: BackgroundActivityPolicy | null | undefined, now?: number): { plan: TeachingPolicyPlan; guidance?: BackgroundActivityGuidance } {
  // A pending answer or an existing interaction keeps its exact continuation/grade-first behavior.
  if (plan.interaction.action !== "create") return { plan };
  const offered = [...new Set(plan.interaction.families.flatMap(family => family.components
    .flatMap(component => componentKinds[component] ? [componentKinds[component]!] : [])))];
  if (!offered.length) return { plan };
  // Explicit practice requests retain their exercise requirement, even if prose had better past scores.
  const allowed = plan.decisions.practice_requested === true ? offered : ["prose" as const, ...offered];
  const preferredKind = rankBackgroundActivityKinds(policy, observations, allowed, now)[0];
  if (!preferredKind) return { plan };
  const guidance: BackgroundActivityGuidance = { version: 1, policyCreatedAt: policy!.createdAt, preferredKind, target: "next-linked-objective-score", causal: false };
  const preference = `A saved background learning policy suggests preferring ${descriptions[preferredKind]} among the already permitted options when it serves this request. This is an association with later recorded answer scores, not evidence of causal benefit or learner mastery. Honor the learner's explicit request, current evidence, and all teaching rules first. A required private draft variant still takes precedence.`;
  return { plan: { ...plan, directives: [...plan.directives, preference] }, guidance };
}
