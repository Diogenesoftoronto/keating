import { validateUiDocument, type UiDocument, type UiStudyPlanItem } from "../ui.js";
import { compareContractTimestamps } from "../validation.js";
import type { ActiveWork } from "./active-work.js";

/** Host triggers come from records; decision triggers come from the planning judgment itself. */
export type PlanReviewHostTrigger = "graded-attempt" | "stalled-focus";
export type PlanReviewTrigger = PlanReviewHostTrigger | "progression-requested" | "goal-requested";
export type PlanAction = "continue" | "suggest-advance" | "insert-prerequisite" | "expand-item" | "propose-new-plan";

export interface PlanReview {
  readonly trigger: PlanReviewTrigger;
  readonly action: PlanAction;
}

/** Per-session host memory between turns. Counts only; no learner content. */
export interface PlanReviewMemory {
  readonly itemId: string | null;
  readonly graded: number;
  readonly learnerTurns: number;
}

export const STALLED_FOCUS_TURNS = 6;
export const EMPTY_PLAN_REVIEW_MEMORY: PlanReviewMemory = { itemId: null, graded: 0, learnerTurns: 0 };

const gradedCount = (work: ActiveWork | null | undefined): number => {
  const evidence = work?.focus?.evidence;
  return evidence ? evidence.correct + evidence.incorrect : 0;
};

/**
 * Called once per learner turn, before drafting. Returns the host trigger
 * (if any) and the memory to keep after this turn. A focus change resets the
 * count; a new grade or a review restarts the stall counter.
 */
export function advancePlanReview(work: ActiveWork | null | undefined, memory: PlanReviewMemory = EMPTY_PLAN_REVIEW_MEMORY): { trigger: PlanReviewHostTrigger | null; memory: PlanReviewMemory } {
  const itemId = work?.plan && work.focus ? work.focus.itemId : null;
  if (!itemId) return { trigger: null, memory: EMPTY_PLAN_REVIEW_MEMORY };
  const graded = gradedCount(work);
  if (itemId !== memory.itemId) return { trigger: null, memory: { itemId, graded, learnerTurns: 1 } };
  if (graded > memory.graded) return { trigger: "graded-attempt", memory: { itemId, graded, learnerTurns: 0 } };
  const learnerTurns = memory.learnerTurns + 1;
  if (learnerTurns >= STALLED_FOCUS_TURNS) return { trigger: "stalled-focus", memory: { itemId, graded, learnerTurns: 0 } };
  return { trigger: null, memory: { itemId, graded, learnerTurns } };
}

type Flags = Readonly<Record<string, boolean | null>>;

/**
 * Null counts as false. Without an active plan and focus there is nothing to
 * review. First match wins, from the widest change to the narrowest.
 */
export function projectPlanReview(work: ActiveWork | null | undefined, hostTrigger: PlanReviewHostTrigger | null, decisions: Flags, answers: Flags): PlanReview | null {
  if (!work?.plan || !work.focus) return null;
  const trigger: PlanReviewTrigger | null = hostTrigger
    ?? (decisions.progression_requested === true ? "progression-requested" : decisions.project_goal_requested === true ? "goal-requested" : null);
  if (!trigger) return null;
  const action: PlanAction = answers.goal_diverged === true ? "propose-new-plan"
    : answers.prerequisite_gap === true ? "insert-prerequisite"
    : answers.focus_underspecified === true ? "expand-item"
    : answers.focus_demonstrated === true ? "suggest-advance"
    : "continue";
  return { trigger, action };
}

/**
 * How plan changes land. Autonomous (the default): the tutor calls
 * `revise_study_plan` and the change applies at once, then the learner is told
 * what changed. Approval: the same tool call only proposes, and the learner
 * sees Accept/Decline on the change.
 */
export type PlanChangeMode = "autonomous" | "approval";
export const DEFAULT_PLAN_CHANGE_MODE: PlanChangeMode = "autonomous";

export function planReviewDirectives(review: PlanReview | null, work: ActiveWork | null | undefined, mode: PlanChangeMode = DEFAULT_PLAN_CHANGE_MODE): string[] {
  if (!review || review.action === "continue" || !work?.focus) return [];
  const item = `"${work.focus.title}" (item id "${work.focus.itemId}")`;
  const tool = `Call revise_study_plan with plan document "${work.plan?.documentId ?? ""}"`;
  const land = mode === "autonomous"
    ? "The change applies immediately; tell the learner in one sentence what changed and why."
    : "The learner sees Accept/Decline on the change; explain it briefly and do not treat it as applied until they accept.";
  switch (review.action) {
    case "suggest-advance":
      return [`The learner appears to have met ${item}. Summarize the evidence. ${tool} and a complete-item change for that item. ${land}`];
    case "insert-prerequisite":
      return [`The learner's latest attempt suggests a gap in a prerequisite of ${item}. ${tool} and an insert-prerequisite change that adds one concrete prerequisite step before it. ${land}`];
    case "expand-item":
      return [`${item} is too general to choose a concrete next activity. ${tool} and an expand-item change that splits it into specific sub-items. ${land}`];
    case "propose-new-plan":
      return mode === "autonomous"
        ? [`The learner's request goes beyond the active plan "${work.plan?.title ?? ""}". Author a new StudyPlan that covers it and say briefly how it relates to the current plan.`]
        : [`The learner's request goes beyond the active plan "${work.plan?.title ?? ""}". Describe how a new or extended plan would cover it and ask before authoring one.`];
  }
}

/** A structured, bounded change to one study-plan item. Pure data; applied by `applyPlanRevision`. */
export type PlanRevisionChange =
  | { readonly op: "complete-item"; readonly itemId: string }
  | { readonly op: "insert-prerequisite"; readonly beforeItemId: string; readonly item: PlanRevisionItem }
  | { readonly op: "expand-item"; readonly itemId: string; readonly children: readonly PlanRevisionItem[] };

export interface PlanRevisionItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly outcomes?: readonly string[];
}

export const PLAN_REVISION_LIMITS = { children: 8 } as const;

const nowIso = () => new Date().toISOString();

function reviseItems(items: readonly UiStudyPlanItem[], change: PlanRevisionChange): { items: UiStudyPlanItem[]; hit: boolean } {
  let hit = false;
  const out: UiStudyPlanItem[] = [];
  for (const item of items) {
    const children = item.children ? reviseItems(item.children, change) : null;
    if (children?.hit) hit = true;
    let next: UiStudyPlanItem = children?.hit ? { ...item, children: children.items } : item;
    if (change.op === "complete-item" && item.id === change.itemId) {
      hit = true;
      next = { ...next, status: "done" };
    } else if (change.op === "expand-item" && item.id === change.itemId) {
      hit = true;
      // Work moves to the new children; the parent is done when they are.
      next = { ...next, status: "in_progress", children: [...(next.children ?? []), ...change.children.map(toPlanItem)] };
    } else if (change.op === "insert-prerequisite" && item.id === change.beforeItemId) {
      hit = true;
      out.push({ ...toPlanItem(change.item), dependsOn: [...(item.dependsOn ?? [])] });
      next = { ...next, status: next.status === "done" ? "done" : "not_started", dependsOn: [...(item.dependsOn ?? []), change.item.id] };
    }
    out.push(next);
  }
  return { items: out, hit };
}

function toPlanItem(item: PlanRevisionItem): UiStudyPlanItem {
  return {
    id: item.id, title: item.title, status: "not_started",
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    ...(item.outcomes?.length ? { outcomes: [...item.outcomes] } : {}),
  };
}

/**
 * Apply one change to the study-plan node of `document` as a new revision.
 * Returns null when the target item is missing, the change is out of bounds,
 * or the result does not validate; the caller surfaces that, never a partial edit.
 */
export function applyPlanRevision(document: UiDocument, change: PlanRevisionChange, now: string = nowIso()): UiDocument | null {
  if (change.op === "expand-item" && (change.children.length === 0 || change.children.length > PLAN_REVISION_LIMITS.children)) return null;
  let hit = false;
  const nodes = document.nodes.map(node => {
    if (hit || node.type !== "study-plan" || !node.items?.length) return node;
    const revised = reviseItems(node.items, change);
    if (!revised.hit) return node;
    hit = true;
    return { ...node, items: revised.items };
  });
  if (!hit) return null;
  const next: UiDocument = {
    ...document, nodes, revision: document.revision + 1,
    updatedAt: compareContractTimestamps(now, document.updatedAt) < 0 ? document.updatedAt : now,
  };
  return validateUiDocument(next) ? next : null;
}
