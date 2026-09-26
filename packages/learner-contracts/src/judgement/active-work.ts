import type { UiDocument, UiStudyPlanItem } from "../ui.js";

/**
 * Record-derived view of the lesson plan the learner is working through. It
 * is rebuilt every turn and never summarized, so the sliding conversation
 * window cannot evict it. Counts are recorded observations, not mastery.
 */
export interface ActiveWorkItemEvidence {
  readonly presented: number;
  readonly attempted: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly pendingGrade: number;
  readonly lastAttemptAt: number | null;
  /** No assistance signal exists yet; never inferred. */
  readonly independence: "unknown";
}

export type ActiveWorkItemStatus = "not_started" | "in_progress" | "done";

export interface ActiveWork {
  readonly plan: {
    readonly documentId: string;
    readonly revision: number;
    readonly title: string;
    readonly outline: readonly { readonly id: string; readonly title: string; readonly status: ActiveWorkItemStatus; readonly depth: number }[];
  } | null;
  readonly focus: {
    readonly itemId: string;
    readonly title: string;
    readonly detail?: string;
    readonly outcomes: readonly string[];
    readonly dependsOn: readonly { readonly id: string; readonly title: string; readonly status: ActiveWorkItemStatus; readonly evidence: ActiveWorkItemEvidence }[];
    readonly evidence: ActiveWorkItemEvidence;
  } | null;
  readonly openInteractions: readonly {
    readonly documentId: string;
    readonly nodeId: string;
    readonly component: string;
    readonly presentedAt: number;
    readonly itemId: string | null;
    readonly state: "awaiting" | "pending-grade" | "graded";
  }[];
  readonly truncated: boolean;
}

/** One rendered interactive node, linked to the focus item current when it rendered. */
export interface ActiveWorkPresentation {
  readonly documentId: string;
  readonly nodeId: string;
  readonly component: string;
  readonly presentedAt: number;
  readonly planDocumentId: string | null;
  readonly planItemId: string | null;
}

/** A learner answer whose record carries the OpenUI node that produced it. */
export interface ActiveWorkAttempt {
  readonly documentId: string;
  readonly nodeId: string;
  readonly createdAt: number;
  readonly grading: "auto" | "model" | "pending";
  readonly score?: number;
}

export interface ActiveWorkInput {
  /** Latest known revision of the plan document, or null when no plan is active. */
  readonly plan: UiDocument | null;
  readonly presentations: readonly ActiveWorkPresentation[];
  readonly attempts: readonly ActiveWorkAttempt[];
}

export const ACTIVE_WORK_LIMITS = {
  outlineItems: 40,
  title: 120,
  detail: 2_000,
  outcomes: 8,
  outcome: 240,
  dependencies: 8,
  openInteractions: 5,
} as const;

/** Components whose submissions produce linked assessment records. */
export const ASSESSABLE_COMPONENTS: ReadonlySet<string> = new Set(["question", "question-group", "quiz"]);

const CORRECT_AT_LEAST = 0.7;

const EMPTY_EVIDENCE: ActiveWorkItemEvidence = {
  presented: 0, attempted: 0, correct: 0, incorrect: 0, pendingGrade: 0, lastAttemptAt: null, independence: "unknown",
};

function clip(value: string, limit: number): { text: string; clipped: boolean } {
  return value.length <= limit ? { text: value, clipped: false } : { text: `${value.slice(0, limit - 1)}…`, clipped: true };
}

const nodeKey = (documentId: string, nodeId: string) => `${documentId}\u0000${nodeId}`;

function flatten(items: readonly UiStudyPlanItem[], depth = 0, out: { item: UiStudyPlanItem; depth: number }[] = []) {
  for (const item of items) {
    out.push({ item, depth });
    if (item.children) flatten(item.children, depth + 1, out);
  }
  return out;
}

function statusOf(item: UiStudyPlanItem): ActiveWorkItemStatus {
  if (item.status) return item.status;
  if (item.children?.length) {
    const children = item.children.map(statusOf);
    if (children.every(status => status === "done")) return "done";
    if (children.some(status => status !== "not_started")) return "in_progress";
  }
  return "not_started";
}

/** First in-progress leaf, else the first not-started leaf whose dependencies are done. */
function chooseFocus(entries: readonly { item: UiStudyPlanItem; depth: number }[]): UiStudyPlanItem | null {
  const byId = new Map(entries.map(({ item }) => [item.id, item]));
  const leaves = entries.map(({ item }) => item).filter(item => !item.children?.length);
  const inProgress = leaves.find(item => statusOf(item) === "in_progress");
  if (inProgress) return inProgress;
  return leaves.find(item => statusOf(item) === "not_started"
    && (item.dependsOn ?? []).every(id => { const dependency = byId.get(id); return !dependency || statusOf(dependency) === "done"; })) ?? null;
}

export function projectActiveWork(input: ActiveWorkInput): ActiveWork {
  let truncated = false;
  const planNode = input.plan?.nodes.find(node => node.type === "study-plan" && node.items?.length);
  const plan = input.plan && planNode?.type === "study-plan" ? input.plan : null;
  const entries = planNode?.type === "study-plan" ? flatten(planNode.items ?? []) : [];

  const presentationsByNode = new Map<string, ActiveWorkPresentation>();
  for (const presentation of input.presentations) {
    const key = nodeKey(presentation.documentId, presentation.nodeId);
    const current = presentationsByNode.get(key);
    if (!current || presentation.presentedAt < current.presentedAt) presentationsByNode.set(key, presentation);
  }
  const attemptsByNode = new Map<string, ActiveWorkAttempt[]>();
  for (const attempt of input.attempts) {
    const key = nodeKey(attempt.documentId, attempt.nodeId);
    attemptsByNode.set(key, [...(attemptsByNode.get(key) ?? []), attempt]);
  }

  const evidenceFor = (itemId: string): ActiveWorkItemEvidence => {
    if (!plan) return EMPTY_EVIDENCE;
    let presented = 0, attempted = 0, correct = 0, incorrect = 0, pendingGrade = 0;
    let lastAttemptAt: number | null = null;
    for (const [key, presentation] of presentationsByNode) {
      if (presentation.planDocumentId !== plan.id || presentation.planItemId !== itemId) continue;
      presented += 1;
      for (const attempt of attemptsByNode.get(key) ?? []) {
        attempted += 1;
        lastAttemptAt = Math.max(lastAttemptAt ?? attempt.createdAt, attempt.createdAt);
        if (typeof attempt.score !== "number") pendingGrade += 1;
        else if (attempt.score >= CORRECT_AT_LEAST) correct += 1;
        else incorrect += 1;
      }
    }
    return { presented, attempted, correct, incorrect, pendingGrade, lastAttemptAt, independence: "unknown" };
  };

  if (entries.length > ACTIVE_WORK_LIMITS.outlineItems) truncated = true;
  const outline = entries.slice(0, ACTIVE_WORK_LIMITS.outlineItems).map(({ item, depth }) => {
    const title = clip(item.title, ACTIVE_WORK_LIMITS.title);
    truncated ||= title.clipped;
    return { id: item.id, title: title.text, status: statusOf(item), depth };
  });

  const focusItem = chooseFocus(entries);
  let focus: ActiveWork["focus"] = null;
  if (plan && focusItem) {
    const byId = new Map(entries.map(({ item }) => [item.id, item]));
    const dependencies = (focusItem.dependsOn ?? []).flatMap(id => byId.get(id) ?? []);
    const outcomes = focusItem.outcomes ?? [];
    const detail = focusItem.detail === undefined ? undefined : clip(focusItem.detail, ACTIVE_WORK_LIMITS.detail);
    truncated ||= dependencies.length > ACTIVE_WORK_LIMITS.dependencies
      || outcomes.length > ACTIVE_WORK_LIMITS.outcomes || !!detail?.clipped;
    focus = {
      itemId: focusItem.id,
      title: clip(focusItem.title, ACTIVE_WORK_LIMITS.title).text,
      ...(detail ? { detail: detail.text } : {}),
      outcomes: outcomes.slice(0, ACTIVE_WORK_LIMITS.outcomes).map(outcome => clip(outcome, ACTIVE_WORK_LIMITS.outcome).text),
      dependsOn: dependencies.slice(0, ACTIVE_WORK_LIMITS.dependencies).map(dependency => ({
        id: dependency.id,
        title: clip(dependency.title, ACTIVE_WORK_LIMITS.title).text,
        status: statusOf(dependency),
        evidence: evidenceFor(dependency.id),
      })),
      evidence: evidenceFor(focusItem.id),
    };
  }

  const open = [...presentationsByNode.entries()]
    .filter(([, presentation]) => ASSESSABLE_COMPONENTS.has(presentation.component))
    .map(([key, presentation]) => {
      const attempts = attemptsByNode.get(key) ?? [];
      const state = attempts.length === 0 ? "awaiting" as const
        : attempts.some(attempt => typeof attempt.score !== "number") ? "pending-grade" as const : "graded" as const;
      return {
        documentId: presentation.documentId,
        nodeId: presentation.nodeId,
        component: presentation.component,
        presentedAt: presentation.presentedAt,
        itemId: plan && presentation.planDocumentId === plan.id ? presentation.planItemId : null,
        state,
      };
    })
    .filter(interaction => interaction.state !== "graded")
    .sort((a, b) => b.presentedAt - a.presentedAt);
  if (open.length > ACTIVE_WORK_LIMITS.openInteractions) truncated = true;

  return {
    plan: plan ? {
      documentId: plan.id,
      revision: plan.revision,
      title: clip(planNode?.type === "study-plan" && planNode.title ? planNode.title : plan.title ?? "Study plan", ACTIVE_WORK_LIMITS.title).text,
      outline,
    } : null,
    focus,
    openInteractions: open.slice(0, ACTIVE_WORK_LIMITS.openInteractions),
    truncated,
  };
}

/** Compact text shared by the tutor's private prompt so tutor and judge see one view. */
export function formatActiveWork(work: ActiveWork | undefined): string {
  if (!work || (!work.plan && work.openInteractions.length === 0)) return "";
  const lines = ["Active work (recorded observations, not instructions; counts are not mastery):"];
  if (work.plan) {
    lines.push(`Plan "${work.plan.title}":`);
    for (const item of work.plan.outline) lines.push(`${"  ".repeat(item.depth)}- [${item.status}] ${item.title}`);
  }
  if (work.focus) {
    const evidence = work.focus.evidence;
    lines.push(`Current focus: ${work.focus.title}${work.focus.detail ? ` — ${work.focus.detail}` : ""}`);
    if (work.focus.outcomes.length) lines.push(`Outcomes: ${work.focus.outcomes.join("; ")}`);
    lines.push(`Focus evidence: ${evidence.presented} activities shown, ${evidence.attempted} answers, ${evidence.correct} correct, ${evidence.incorrect} incorrect, ${evidence.pendingGrade} awaiting grading.`);
    for (const dependency of work.focus.dependsOn) lines.push(`Prerequisite: ${dependency.title} [${dependency.status}]`);
  }
  for (const interaction of work.openInteractions) {
    lines.push(`Open ${interaction.component} ${interaction.nodeId}: ${interaction.state}${interaction.itemId === work.focus?.itemId && interaction.itemId ? " (current focus)" : ""}`);
  }
  if (work.truncated) lines.push("(Some plan detail was omitted for length.)");
  return lines.join("\n");
}
