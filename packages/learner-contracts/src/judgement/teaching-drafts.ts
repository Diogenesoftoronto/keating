/**
 * Generate and review private tutor replies, then release the best usable text.
 * Uncertain or failed semantic checks stay honest in receipts; valid prose can
 * still release as best effort. Tool calls require completed mandatory approval.
 * Recovery requests text only when nothing usable exists. Cancellation never
 * publishes late private output. Ordinary repair stops early; the unusable-output
 * recovery tail and explicit extended refinement remain capped at ten attempts.
 */
import { TeachingDraftSession } from "./teaching-drafts/session.js";
import type { JudgementCaller, JudgementUsage } from "./contracts.js";
import type { TeachingPolicyCheck, TeachingPolicyReply, TeachingPolicyTurn } from "./teaching-policy-types.js";
import type { InteractionFamily, InteractionRecommendation } from "./interaction-affordances.js";
import type { PlanChangeMode, PlanReview, PlanReviewHostTrigger } from "./plan-review.js";
import type { BackgroundActivityGuidance } from "./background-activity-guidance.js";
import type { BackgroundActivityPolicy } from "./background-activity-policy.js";
import type { ActivitySelectionReceipt } from "./activity-learning.js";
import type { ActivitySelection, ActivitySelectionInput, ReleasedActivitySelection } from "./activity-observations.js";
import type { StateComposition } from "./state-metrics.js";

export type TeachingDraftReasoning = "off" | "low" | "medium" | "high";
export type TeachingDraftStandard = "concise" | "supported" | "deep";
export type TeachingDraftRefinement = "ordinary" | "extended";
/** `interactive` and `prose` drafts compete blind; `default` is an unpaired turn. */
export type TeachingDraftVariant = "interactive" | "prose" | "default";
export type TeachingDraftPhase = "planning" | "drafting" | "checking" | "revising" | "selecting" | "released" | "withheld" | "cancelled";
export interface TeachingDraftFeedback {
  readonly id: string;
  readonly probability: number | null;
  /** Code-owned question/repair direction. Never a quotation from a rejected draft. */
  readonly instruction: string;
}
export interface TeachingDraftAttempt {
  /** Content-free provenance; the merged response receives its own full review. */
  readonly synthesisSourceAttempts?: readonly number[];
  readonly attempt: number;
  readonly reasoning: TeachingDraftReasoning;
  readonly standard: TeachingDraftStandard;
  readonly generationMs: number;
  readonly judgementMs: number;
  readonly status: "pass" | "fail" | "unknown" | "generation-error";
  readonly checks: readonly TeachingPolicyCheck[];
  readonly variant: TeachingDraftVariant;
}
/** Content-free record of what the planning judgment recommended. */
export interface TeachingDraftInteraction {
  readonly action: InteractionRecommendation["action"];
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
  readonly phase: TeachingDraftPhase;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly turnsDropped: number;
  readonly before: StateComposition;
  readonly after: StateComposition | null;
}
export interface TeachingDraftSnapshot {
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
  readonly reason: string | null;
  readonly planningMs?: number;
  readonly interaction?: TeachingDraftInteraction;
  /** Why the plan was reviewed this turn and the proposal the tutor was asked to make. */
  readonly planReview?: PlanReview;
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
export interface TeachingDraftOptions<T> {
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
  readonly judge: JudgementCaller;
  /** The active judge's declared request and state-plus-longest-question budgets. */
  readonly judgementModel?: { readonly id: string; readonly requestTokens: number | null; readonly stateQuestionTokens: number | null };
  readonly generate: (input: TeachingDraftGenerationInput) => Promise<{ readonly reply: TeachingPolicyReply; readonly value: T }>;
  readonly maxAttempts?: number;
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
  /** Decides which paired variant is drafted first, so neither always holds `draft_1`. */
  readonly random?: () => number;
  /** A record-derived reason to review plan progress this turn; see `advancePlanReview`. */
  readonly planReview?: PlanReviewHostTrigger | null;
  /** Whether plan changes apply at once (default) or wait for the learner's Accept. */
  readonly planChanges?: PlanChangeMode;
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
