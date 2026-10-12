import type { JudgementOutcome } from "./contracts.js";
import { TEACHING_INTERACTION_FEATURES, TEACHING_POLICY_DECISIONS } from "./teaching-policy-catalog.js";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "./teaching-policy-types.js";
import { decodeAnswer } from "./wire.js";
import type { ActivitySelectionReceipt } from "./activity-learning.js";

/** Fixed meanings keep historical feature rows comparable. These are interpretations, not facts. */
export const ACTIVITY_SIGNALS = ["explanation_requested", "learner_stuck", "attempt_present", "misconception_visible",
  "practice_requested", "variable_relationship", "discrete_recall", "visual_reference"] as const;
export type ActivitySignal = typeof ACTIVITY_SIGNALS[number];
/** Change detection only, not a signature or an authorization token. */
function questionFingerprint(): string {
  const definitions = [...TEACHING_POLICY_DECISIONS, ...TEACHING_INTERACTION_FEATURES];
  const source = JSON.stringify(ACTIVITY_SIGNALS.map(id => [id, definitions.find(entry => entry.id === id)!.question]));
  let hash = 2166136261, second = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    second = Math.imul(second ^ source.charCodeAt(index), 2246822519);
  }
  return `questions-v1-${(hash >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}
export const ACTIVITY_QUESTION_FINGERPRINT = questionFingerprint();
export interface ActivityObservations {
  readonly version: 1;
  /** Legacy rows remain readable, but background learning requires matching provenance. */
  readonly questionFingerprint?: string;
  readonly judgeModel: string | null;
  readonly inferred: Readonly<Record<ActivitySignal, number | null>>;
  readonly observed: {
    readonly focusPresented: number | null;
    readonly focusAttempted: number | null;
    readonly focusCorrect: number | null;
    readonly focusIncorrect: number | null;
    readonly pendingGrades: number;
    readonly priorLearnerTurns: number;
  };
}
export interface ActivitySelectionCandidate {
  readonly attempt: number;
  readonly reply: TeachingPolicyReply;
  readonly variant: "interactive" | "prose" | "default";
}
export interface ActivitySelectionInput {
  readonly turn: TeachingPolicyTurn;
  readonly observations: ActivityObservations;
  /** Only complete, independently approved replies within the semantic selector's budget. */
  readonly candidates: readonly ActivitySelectionCandidate[];
  readonly baselineAttempt: number;
  readonly signal: AbortSignal;
}
export interface ActivitySelection {
  readonly attempt: number;
  readonly receipt: ActivitySelectionReceipt;
}
export interface ReleasedActivitySelection {
  readonly observations: ActivityObservations;
  readonly candidate: ActivitySelectionCandidate;
  readonly receipt: ActivitySelectionReceipt;
}

/** Reuse the planning request's independent questions; do not add another model call. */
export function projectActivityObservations(turn: TeachingPolicyTurn, outcome: JudgementOutcome | null): ActivityObservations {
  const definitions = [...TEACHING_POLICY_DECISIONS, ...TEACHING_INTERACTION_FEATURES];
  const inferred = Object.fromEntries(ACTIVITY_SIGNALS.map(id => {
    const question = definitions.find(entry => entry.id === id)!.question;
    const answer = outcome?.ok ? decodeAnswer(question, outcome.response.answers[id]) : null;
    return [id, answer?.type === "noul" ? answer.noul : null];
  })) as Record<ActivitySignal, number | null>;
  const evidence = turn.activeWork?.focus?.evidence;
  return { version: 1, questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT, judgeModel: outcome?.ok ? outcome.response.backend.model : null, inferred,
    observed: { focusPresented: evidence?.presented ?? null, focusAttempted: evidence?.attempted ?? null,
      focusCorrect: evidence?.correct ?? null, focusIncorrect: evidence?.incorrect ?? null,
      pendingGrades: evidence?.pendingGrade ?? turn.pendingSubmissions?.length ?? 0,
      priorLearnerTurns: turn.conversation.filter(message => message.role === "user").length } };
}

const OBSERVED = ["focusPresented", "focusAttempted", "focusCorrect", "focusIncorrect", "pendingGrades", "priorLearnerTurns"] as const;
export const ACTIVITY_OBSERVATION_FEATURES: readonly string[] = [
  ...ACTIVITY_SIGNALS.map(id => `inferred_${id}`), ...ACTIVITY_SIGNALS.map(id => `known_${id}`),
  ...OBSERVED.map(id => `observed_${id}_log1p_unknown_minus_one`),
];
/** Only fixed numerical features leave the device. Missing judgments remain distinguishable from zero. */
export function activityObservationFeatures(value: ActivityObservations): number[] {
  return [...ACTIVITY_SIGNALS.map(id => value.inferred[id] ?? 0),
    ...ACTIVITY_SIGNALS.map(id => Number(value.inferred[id] !== null)),
    ...OBSERVED.map(id => value.observed[id] === null ? -1 : Math.log1p(value.observed[id]!))];
}
