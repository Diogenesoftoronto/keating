import type { InteractionRecommendation } from "./interaction-affordances.js";
import type { PlanReview } from "./plan-review.js";

/**
 * What one session has left the learner with so far: a study plan, a map of
 * the ideas, something to retrieve, work to carry on with alone. Counts from
 * presentation records and message times; no learner content. Rebuilt by the
 * host every turn.
 */
export interface SessionResources {
  /** Learner turns in this session, including the current one. */
  readonly learnerTurns: number;
  /** A study plan has been shown in this session. */
  readonly plan: boolean;
  /** A concept map has been shown in this session. */
  readonly map: boolean;
  /** Learner turns since a set of items to retrieve or solve was last shown; null when never. */
  readonly turnsSinceRetrieval: number | null;
  /** Learner turns since work away from the chat was last set; null when never. */
  readonly turnsSinceAwayWork: number | null;
}

/** One presented interactive node; `component` is the shared UI node type. */
export interface ResourcePresentation {
  readonly component: string;
  readonly presentedAt: number;
}

export type ResourceGap = "plan" | "retrieval" | "map" | "away-work";

export interface ResourceReview {
  readonly gap: ResourceGap;
  /** A stated goal asks for a plan at once; otherwise the session's length does. */
  readonly trigger: "goal-requested" | "session-length";
}

const PLAN_COMPONENTS: ReadonlySet<string> = new Set(["study-plan"]);
const MAP_COMPONENTS: ReadonlySet<string> = new Set(["concept-map"]);
/**
 * Sets of items the learner works through. A single Question does not count:
 * a tutor that asks one every turn has still left nothing to practise from.
 */
const RETRIEVAL_COMPONENTS: ReadonlySet<string> = new Set(["quiz", "deck", "question-group", "coding-challenge", "language-practice"]);
const AWAY_WORK_COMPONENTS: ReadonlySet<string> = new Set(["task"]);

/**
 * When a missing resource is worth raising, in learner turns. Each gap is
 * raised on `window` consecutive turns and then left alone for the rest of
 * `every`, so a tutor that judged it unhelpful is not asked again every turn.
 * Stateless: a retried turn gets the same answer.
 */
export const RESOURCE_REVIEW_CADENCE = {
  plan: { after: 3, every: 6 },
  retrieval: { after: 5, every: 6 },
  map: { after: 6, every: 8 },
  "away-work": { after: 8, every: 8 },
  window: 2,
} as const;

function due(turns: number, { after, every }: { readonly after: number; readonly every: number }): boolean {
  return turns >= after && (turns - after) % every < RESOURCE_REVIEW_CADENCE.window;
}

/**
 * Called once per learner turn, before drafting. `learnerTurnTimes` are the
 * send times of every learner message in the session, the current one last.
 */
export function sessionResources(presentations: readonly ResourcePresentation[], learnerTurnTimes: readonly number[]): SessionResources {
  const since = (components: ReadonlySet<string>): number | null => {
    let latest: number | null = null;
    for (const { component, presentedAt } of presentations) {
      if (components.has(component) && (latest === null || presentedAt > latest)) latest = presentedAt;
    }
    if (latest === null) return null;
    const shownAt = latest;
    return learnerTurnTimes.filter((time) => time > shownAt).length;
  };
  return {
    learnerTurns: learnerTurnTimes.length,
    plan: presentations.some(({ component }) => PLAN_COMPONENTS.has(component)),
    map: presentations.some(({ component }) => MAP_COMPONENTS.has(component)),
    turnsSinceRetrieval: since(RETRIEVAL_COMPONENTS),
    turnsSinceAwayWork: since(AWAY_WORK_COMPONENTS),
  };
}

type Flags = Readonly<Record<string, boolean | null>>;

export interface ResourceReviewContext {
  readonly interaction: Pick<InteractionRecommendation, "action" | "families">;
  readonly planReview?: PlanReview | null;
  readonly assessment?: "none" | "practice" | "assessed" | "unknown";
}

/**
 * At most one gap per turn, widest first. Null counts as false: a resource is
 * raised only on a turn the judge positively identified as learning, and never
 * over a learner who asked for a plain reply, is stuck, has work waiting to be
 * graded or answered, or is in the middle of a plan change.
 */
export function projectResourceReview(resources: SessionResources | null | undefined, decisions: Flags, context: ResourceReviewContext): ResourceReview | null {
  if (!resources || decisions.learning_task !== true) return null;
  if (decisions.plain_reply_requested === true || decisions.learner_stuck === true) return null;
  if (context.assessment === "assessed") return null;
  const { action, families } = context.interaction;
  if (action === "grade-first" || action === "continue") return null;
  if (context.planReview && context.planReview.action !== "continue") return null;
  const offered = new Set(action === "create" ? families.map(({ family }) => family) : []);
  // A quiz or deck cannot share a reply with a plan, so the plan waits for the next turn.
  const practiceThisTurn = decisions.practice_requested === true || offered.has("retrieval");
  if (!resources.plan && !practiceThisTurn) {
    if (decisions.project_goal_requested === true) return { gap: "plan", trigger: "goal-requested" };
    if (decisions.direct_answer_requested !== true && due(resources.learnerTurns, RESOURCE_REVIEW_CADENCE.plan)) return { gap: "plan", trigger: "session-length" };
  }
  // A requested practice activity already has its own directive; a learner who declined testing is not handed work to prove themselves on.
  const mayAskForWork = decisions.assessment_declined !== true && decisions.practice_requested !== true;
  if (mayAskForWork && !offered.has("retrieval") && due(resources.turnsSinceRetrieval ?? resources.learnerTurns, RESOURCE_REVIEW_CADENCE.retrieval)) return { gap: "retrieval", trigger: "session-length" };
  // A map tests nothing, so declining a test does not rule it out. One already on offer this turn is enough.
  if (!resources.map && !practiceThisTurn && !offered.has("workspace") && decisions.direct_answer_requested !== true
    && due(resources.learnerTurns, RESOURCE_REVIEW_CADENCE.map)) return { gap: "map", trigger: "session-length" };
  if (mayAskForWork && !offered.has("away") && due(resources.turnsSinceAwayWork ?? resources.learnerTurns, RESOURCE_REVIEW_CADENCE["away-work"])) return { gap: "away-work", trigger: "session-length" };
  return null;
}

/**
 * Tutor-facing. Each names the moment that makes the resource useful and the
 * moment that does not, so the tutor decides; none of them is an order.
 */
export function resourceReviewDirectives(review: ResourceReview | null | undefined): string[] {
  if (!review) return [];
  switch (review.gap) {
    case "plan":
      return [review.trigger === "goal-requested"
        ? "The learner has named something they want to accomplish and this session has no study plan. After answering what they asked, lay the path out as a short StudyPlan: three to six concrete items saying what the learner will do, with dependsOn only where one step truly needs another. If you also ask a question, it stays last."
        : "This session is several turns in with no study plan. If the learner is working toward more than this one reply, add a short StudyPlan after your answer: three to six concrete items saying what the learner will do, with dependsOn only where one step truly needs another. If you also ask a question, it stays last. Leave the plan out if they only want this answer."];
    case "retrieval":
      return ["This session has covered material the learner has not yet practised as a set. If a chunk has now been covered, end this reply with one short Quiz or one Flashcards deck on that material, in place of any other question or activity this turn, and stop there. Leave it out if nothing has been covered yet or they are in the middle of a problem."];
    case "map":
      return ["This session has introduced several ideas and has no concept map. If how they connect matters for what the learner is doing, add one ConceptMap of what has been covered so far, with short labels and explicit relationships. If you also ask a question, it stays last. Leave the map out if the ideas so far do not form a structure worth drawing."];
    case "away-work":
      return ["This session has run long and the learner has nothing to carry on with alone. If this is a natural stopping point, set one piece of work sized to what was covered, with concrete success criteria, in place of any other question or activity this turn: an Assignment for one deliverable, a Practice set for repetition, a Draft for extended writing, or Fieldwork when the evidence is out in the world. Leave it out if they are in the middle of a problem."];
  }
}
