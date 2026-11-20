/**
 * Generate and review private tutor replies, then release the best usable text.
 * Uncertain or failed semantic checks stay honest in receipts; valid prose can
 * still release as best effort. Tool calls require completed mandatory approval.
 * Recovery requests text only when nothing usable exists. Cancellation never
 * publishes late private output. A Jev-guided turn compares four private
 * candidates in two parallel pairs. Other judges keep the ordinary repair loop.
 */
import { TeachingDraftSession } from "./teaching-drafts/session.js";
import type { JudgementCaller, JudgementUsage } from "./contracts.js";
import type { TeachingPolicyCheck, TeachingPolicyReply, TeachingPolicyTurn } from "./teaching-policy-types.js";
import type { InteractionFamily, InteractionRecommendation } from "./interaction-affordances.js";
import type { PlanChangeMode, PlanReview, PlanReviewHostTrigger } from "./plan-review.js";
import type { ResourceReview, SessionResources } from "./resource-review.js";
import type { BackgroundActivityGuidance } from "./background-activity-guidance.js";
import type { BackgroundActivityPolicy } from "./background-activity-policy.js";
import type { DebuggingExerciseReview } from "./debugging-exercise.js";
import type { AttemptedCheckpointFeedback } from "./teaching-drafts/attempt-feedback.js";
import type { ActivitySelectionReceipt } from "./activity-learning.js";
import type { ActivitySelection, ActivitySelectionInput, ReleasedActivitySelection } from "./activity-observations.js";
import type { StateComposition } from "./state-metrics.js";
import type { TeachingDraftSelectionRule } from "./teaching-selection.js";
import type { TeachingDraftPairReview } from "./teaching-drafts/pair-review.js";
import type { DecisionPlanningFailure } from "./teaching-drafts/planning-failure.js";

export type { TeachingDraftPairReview } from "./teaching-drafts/pair-review.js";
export { isTutorRateLimit, TUTOR_RATE_LIMIT_MESSAGE, TUTOR_RATE_LIMIT_REASON } from "./teaching-drafts/generation-failure.js";
export { DECISION_PLANNING_NOTICE, describeDecisionPlanningFailure, isDecisionPlanningFailure, type DecisionPlanningFailure } from "./teaching-drafts/planning-failure.js";

export type TeachingDraftReasoning = "off" | "low" | "medium" | "high";
export type TeachingDraftStandard = "concise" | "supported" | "deep";
export type TeachingDraftRefinement = "ordinary" | "extended";
/** The ordinary teaching prompt uses `default`. A recommended activity can pair `interactive` and `prose` alternatives. */
export type TeachingDraftVariant = "interactive" | "prose" | "default";
export type TeachingDraftPhase = "planning" | "drafting" | "checking" | "revising" | "selecting" | "released" | "withheld" | "cancelled";
export interface TeachingDraftFeedback {
  readonly id: string;
  readonly probability: number | null;
  /** Code-owned question/repair direction. Never a quotation from a rejected draft. */
  readonly instruction: string;
}
export interface TeachingDraftAttempt {
  /** Present only on a failed tutor transport when the provider's rate limit was observed. */
  readonly generationFailure?: "generation-rate-limited";
  /** This candidate was explicitly written as a visible reply to the existing ungraded question. */
  readonly feedbackOnly?: true;
  /** This candidate was asked to collect the learner's next answer in one OpenUI Question. */
  readonly predictionQuestionOnly?: true;
  /** One saved comprehension item, with grade_question_checks as the sole available tool. */
  readonly gradeOnly?: true;
  /** The earlier attempt whose outstanding checks prompted this repair. */
  readonly repairSourceAttempt?: number;
  /** Content-free provenance; the merged response receives its own full review. */
  readonly synthesisSourceAttempts?: readonly number[];
  /** Only the text ending at the checkpoint was reviewed for publication. */
  readonly trimmedCheckpointSuffix?: true;
  /** A required prediction was removed from an optional control brief before the whole candidate was reviewed. */
  readonly repairedAssessmentBrief?: true;
  /** Full typed distributions for the example and disclosure checks, when requested. */
  readonly debuggingExercise?: DebuggingExerciseReview;
  /** Content-free, raw categorical answers when review inspected a free-text response to the preceding question. */
  readonly attemptedCheckpointFeedback?: AttemptedCheckpointFeedback;
  readonly attempt: number;
  readonly reasoning: TeachingDraftReasoning;
  readonly standard: TeachingDraftStandard;
  readonly generationMs: number;
  readonly judgementMs: number;
  readonly status: "pass" | "fail" | "unknown" | "generation-error";
  readonly checks: readonly TeachingPolicyCheck[];
  readonly variant: TeachingDraftVariant;
  /**
   * Tool names this draft tried to call that the session does not offer. Names
   * only, never arguments: without them a failed tool check cannot be traced.
   */
  readonly unavailableTools?: readonly string[];
}
/** Content-free record of what the planning judgment recommended. */
export interface TeachingDraftInteraction {
  readonly action: InteractionRecommendation["action"];
  readonly reason?: InteractionRecommendation["reason"];
  readonly codePracticeLanguage?: InteractionRecommendation["codePracticeLanguage"];
  readonly families: readonly { readonly family: InteractionFamily; readonly components: readonly string[] }[];
  /** Interaction-feature ids the planning judge answered true. */
  readonly features: readonly string[];
  readonly continueNodeId?: string;
  readonly lead?: "answer-first";
  /** Whether an interactive and a prose draft competed. */
  readonly paired: boolean;
}
export interface TeachingStateSample {
  readonly phase: TeachingDraftPhase;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly requestIndex: number;
  readonly state: StateComposition;
}
export interface TeachingWindowSlide {
  /** Set when the model rejected a request that passed local sizing. Older receipts omit this. */
  readonly reason?: "provider-context-limit";
  readonly phase: TeachingDraftPhase;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly turnsDropped: number;
  readonly before: StateComposition;
  readonly after: StateComposition | null;
}
/** The final judge's observed preference between the two eligible pair nominees. */
export interface TeachingDraftFinalComparison {
  readonly candidateAttempts: readonly [number, number];
  readonly preferredAttempt: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence?: number;
  readonly model: string;
}
export interface TeachingDraftSnapshot {
  /** Only present on release after a valid two-nominee vote. The published winner is selectedAttempt. */
  readonly finalComparison?: TeachingDraftFinalComparison;
  /** Present on Jev's paired path. Includes only attempt IDs, judgements and timing. */
  readonly pairReviews?: readonly TeachingDraftPairReview[];
  /** The two independent generations actually dispatched together on this round. */
  readonly parallelAttempts?: readonly [number, number];
  readonly repairSourceAttempt?: number;
  readonly synthesisSourceAttempts?: readonly number[];
  /** Preference from a policy captured before this turn; no background job is awaited. */
  readonly backgroundActivity?: BackgroundActivityGuidance;
  /** Numerical selection diagnostics only; never includes private candidate text. */
  readonly activityLearning?: ActivitySelectionReceipt;
  /** Last actual dispatched request; no request or learner content is retained. */
  readonly state?: StateComposition;
  readonly slides?: readonly TeachingWindowSlide[];
  readonly stateHistory?: readonly TeachingStateSample[];
  readonly phase: TeachingDraftPhase;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly reasoning: TeachingDraftReasoning;
  readonly standard: TeachingDraftStandard;
  readonly elapsedMs: number;
  readonly attempts: readonly TeachingDraftAttempt[];
  readonly judgeModel: string | null;
  readonly selectedAttempt: number | null;
  /** Observed prediction-specific selection rule on a released draft. Older receipts omit it. */
  readonly selectionRule?: TeachingDraftSelectionRule;
  readonly reason: string | null;
  /** A failed typed planning outcome on this round. Missing in older or unobserved rounds. */
  readonly decisionFailure?: DecisionPlanningFailure;
  readonly planningMs?: number;
  readonly interaction?: TeachingDraftInteraction;
  /** Why the plan was reviewed this turn and the proposal the tutor was asked to make. */
  readonly planReview?: PlanReview;
  /** A resource this session lacked that the tutor was invited to add this turn. */
  readonly resourceReview?: ResourceReview;
}
export interface TeachingDraftReceipt extends TeachingDraftSnapshot {
  readonly version: string;
  readonly calibration: "uncalibrated";
  readonly qualityThreshold: number;
  readonly judgeUsage: JudgementUsage | null;
  readonly selectorProbabilities: Readonly<Record<string, number>> | null;
  readonly selectionCandidateAttempts: readonly number[];
  readonly selectionOmittedForBudget: readonly number[];
}
export interface TeachingDraftGenerationInput {
  /** Already approved prose. Return only the missing addition, without tools. */
  readonly continuation?: { readonly text: string };
  /** The prompt variant actually sent for this attempt. */
  readonly variant?: TeachingDraftVariant;
  /** One independent reply to the current ungraded question. Hosts omit tool schemas for this candidate. */
  readonly feedbackOnly?: true;
  /** One new, ungraded OpenUI Question. Hosts keep the OpenUI grammar and omit tools for this candidate. */
  readonly predictionQuestionOnly?: true;
  /** One saved comprehension item, with grade_question_checks as the sole available tool. */
  readonly gradeOnly?: true;
  /** Last-budget recovery when no usable response exists; hosts must disable tool dispatch. */
  readonly textOnlyRecovery?: true;
  /** Private, untrusted source material. Never publish or copy into diagnostics. */
  readonly synthesis?: { readonly sources: readonly {
    readonly attempt: number;
    readonly text: string;
    readonly passedChecks: readonly string[];
    readonly repairChecks: readonly string[];
  }[] };
  readonly attempt: number;
  readonly reasoning: TeachingDraftReasoning;
  readonly systemPrompt: string;
  readonly feedback: readonly TeachingDraftFeedback[];
  readonly signal: AbortSignal;
}
/** Explicit opt-in inspection of generated answer text. Never reasoning or tool arguments. */
export interface TeachingDraftCandidateText {
  readonly attempt: number;
  readonly variant: TeachingDraftVariant;
  readonly text: string;
}
/** The current host joined a completed learner form action to this exact pending local record. */
export interface SubmittedComprehensionAnswer {
  readonly id: string;
  readonly topic: string;
  readonly question: string;
  readonly answer: string;
}

export interface TeachingDraftReviewer {
  readonly judge: JudgementCaller;
  readonly judgementModel: { readonly id: string; readonly requestTokens: number | null; readonly stateQuestionTokens: number | null };
  readonly maxQuestionChars?: number;
}
export interface TeachingDraftOptions<T> {
  /** Host-only input. Never reconstructed from learner prose or a teaching decision. */
  readonly submittedComprehension?: SubmittedComprehensionAnswer;
  /** Hosted query answering can generate its two opening alternatives concurrently. */
  readonly parallelDrafts?: boolean;
  /** Commits an independently reviewed, immutable prefix while its addition is prepared. */
  readonly onAnswerStage?: (stage: { readonly reply: TeachingPolicyReply; readonly value: T }) => void;
  /** Ephemeral developer inspection only; never copied into snapshots or receipts. */
  readonly onDraftContent?: (candidate: TeachingDraftCandidateText) => void;
  /** Hosted reply comparison is experimental and must be explicitly selected. */
  readonly activityLearningMode?: "background" | "live";
  /** A tested local policy, captured once before planning. Never a promise or remote lookup. */
  readonly backgroundActivityPolicy?: BackgroundActivityPolicy | null;
  /** Record the eventual released response for later outcomes, independently of inference. */
  readonly recordActivity?: boolean;
  /** Used only in explicit live mode; may select only an already approved, tool-free reply. */
  readonly activityLearning?: (input: ActivitySelectionInput) => Promise<ActivitySelection>;
  readonly turn: TeachingPolicyTurn;
  /** The host selects previously observed source excerpts for this candidate. */
  readonly reviewResearch?: (reply: TeachingPolicyReply) => {
    readonly sources: TeachingPolicyTurn["sources"];
    /** Every proposed operation is a read-only search recognized by the host. */
    readonly searchOnly: boolean;
  };
  /** Shorter observed search passages for an otherwise oversized review. Supplied evidence stays intact. */
  readonly compactResearchSources?: (replies: readonly TeachingPolicyReply[]) => TeachingPolicyTurn["sources"];
  readonly judge: JudgementCaller;
  /** The active judge's declared request and state-plus-longest-question budgets. */
  readonly judgementModel?: TeachingDraftReviewer["judgementModel"];
  /** Permitted reviewers in preference order. The reviewer that completes planning also reviews the drafts. */
  readonly reviewers?: readonly TeachingDraftReviewer[];
  /** Optional transport limit on JSON.stringify(questions).length for each review request. */
  readonly maxQuestionChars?: number;
  /** Primary model selected for planning diagnostics; null when no route was configured. */
  readonly configuredDecisionModel?: string | null;
  readonly generate: (input: TeachingDraftGenerationInput) => Promise<{ readonly reply: TeachingPolicyReply; readonly value: T }>;
  readonly maxAttempts?: number;
  /** Explicit research capture: collect the full bounded attempt budget before selection.
   * Generation failures remain attempts, never fabricated completed candidates. */
  readonly collectAllAttempts?: boolean;
  /** Longer comparison/synthesis is opt-in; response depth alone does not expand retries. */
  readonly refinement?: TeachingDraftRefinement;
  readonly maxReasoning?: TeachingDraftReasoning;
  readonly timeoutMs?: number;
  readonly ruleIds?: readonly string[];
  readonly onProgress?: (snapshot: TeachingDraftSnapshot) => void;
  /** Host schema/evidence checks cannot be overruled by a semantic pass. */
  readonly check?: (reply: TeachingPolicyReply) => readonly TeachingPolicyCheck[];
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  /** Assigns the interactive and prose alternatives to attempt numbers when both are requested. */
  readonly random?: () => number;
  /** A record-derived reason to review plan progress this turn; see `advancePlanReview`. */
  readonly planReview?: PlanReviewHostTrigger | null;
  /** Whether plan changes apply at once (default) or wait for the learner's Accept. */
  readonly planChanges?: PlanChangeMode;
  /** Record-derived counts of what this session has left the learner with; see `sessionResources`. */
  readonly resources?: SessionResources | null;
}

export interface TeachingDraftResult<T> {
  /** Host binds this private selection to the message actually published, never to a draft. */
  readonly activitySelection?: ReleasedActivitySelection;
  readonly status: "released" | "withheld" | "cancelled";
  /** Authoritative reviewed content. Hosts must build public output from this snapshot. */
  readonly reply?: TeachingPolicyReply;
  /** Snapshotted host metadata; this opaque value is not itself reviewed content. */
  readonly value?: T;
  readonly receipt: TeachingDraftReceipt;
}

export { blocksRelease, teachingDraftAttemptLimit } from "./teaching-drafts/policy.js";

/** Run the shared private generation, review, selection, and release flow. */
export async function runTeachingDrafts<T>(options: TeachingDraftOptions<T>): Promise<TeachingDraftResult<T>> {
  return new TeachingDraftSession(options).run();
}
