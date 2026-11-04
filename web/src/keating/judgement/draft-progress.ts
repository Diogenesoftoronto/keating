/**
 * Content-free reading of a teaching-draft snapshot for the two views of a
 * running reply: learner progress (stages, time, one plain sentence) and the
 * developer review (what needs attention, where the time went, which checks
 * failed in which draft). Nothing here reads private draft text.
 */
import { blocksRelease, type TeachingDraftSnapshot, type TeachingPolicyCheck } from "@keating/learner-contracts";
import { describeTeachingCheck } from "./check-descriptions";
import { describeReviewCause } from "./draft-failure";

/** The web draft gate's default deadline (see draft-gate.ts). */
export const DRAFT_TIME_BUDGET_MS = 90_000;

export type DraftStageId = "plan" | "write" | "check" | "choose";
export type DraftStageState = "done" | "active" | "pending" | "stopped";
export interface DraftStage { readonly id: DraftStageId; readonly label: string; readonly state: DraftStageState }

const STAGE_ORDER: readonly DraftStageId[] = ["plan", "write", "check", "choose"];
const PHASE_STAGE: Partial<Record<TeachingDraftSnapshot["phase"], DraftStageId>> = {
  planning: "plan", drafting: "write", revising: "write", checking: "check", selecting: "choose",
};

/**
 * Four stages in order. Rewrites loop back to "write", so the label says which
 * draft is being written instead of moving the stepper backwards silently.
 */
export function draftStages(snapshot: TeachingDraftSnapshot): DraftStage[] {
  const { phase } = snapshot;
  const rewriting = phase === "revising" || (phase === "drafting" && snapshot.attempt > 1) || (phase === "checking" && snapshot.attempt > 1);
  const label = (id: DraftStageId) => id === "plan" ? "Plan"
    : id === "write" ? rewriting ? `Rewrite ${snapshot.attempt}` : "Write"
    : id === "check" ? "Check" : "Choose";
  if (phase === "released") return STAGE_ORDER.map(id => ({ id, label: label(id), state: "done" }));
  // Terminal without release: stop at the furthest stage the attempts show.
  const reached: DraftStageId = PHASE_STAGE[phase]
    ?? (snapshot.attempts.some(attempt => attempt.status !== "generation-error") ? "check" : snapshot.attempt > 0 ? "write" : "plan");
  const index = STAGE_ORDER.indexOf(reached);
  const terminal = phase === "withheld" || phase === "cancelled";
  return STAGE_ORDER.map((id, position) => ({ id, label: label(id),
    state: position < index ? "done" : position === index ? terminal ? "stopped" : "active" : "pending" }));
}

export interface LearnerDraftGuidance { readonly headline: string; readonly detail: string; readonly slow: boolean }

const SLOW_MS = 40_000;
const NEAR_LIMIT_MS = 70_000;

/** One headline and one sentence a learner can act on, with a nudge when the wait grows long. */
export function learnerDraftGuidance(snapshot: TeachingDraftSnapshot, elapsedMs: number): LearnerDraftGuidance {
  const combining = snapshot.phase === "revising" && !!snapshot.synthesisSourceAttempts?.length;
  const [headline, detail] = snapshot.phase === "planning" ? ["Planning the reply", "Deciding how much help this question needs."]
    : combining ? ["Combining the best drafts", "Two drafts each got something right; Keating is merging them into one reply."]
    : snapshot.phase === "revising" || (snapshot.phase === "drafting" && snapshot.attempt > 1)
      ? ["Improving the reply", "The last draft missed something, so Keating is writing a better one."]
    : snapshot.phase === "drafting" ? ["Writing your reply", "Keating checks every reply before you see it."]
    : snapshot.phase === "checking" ? ["Checking the reply", "Making sure it answers your question and its claims hold up."]
    : snapshot.phase === "selecting" ? ["Picking the best version", "Comparing the drafts that passed."]
    : ["Finishing up", ""];
  if (elapsedMs >= NEAR_LIMIT_MS) return { headline, slow: true,
    detail: "Close to the time limit. If a checked version is ready, Keating will show it; otherwise you'll see what went wrong." };
  if (elapsedMs >= SLOW_MS) return { headline, slow: true,
    detail: `${detail} This is taking longer than usual. You can keep waiting, or press Stop and ask a narrower question.`.trim() };
  return { headline, detail, slow: false };
}

export type DiagnosisTone = "ok" | "caution" | "blocked";
export interface DraftDiagnosis {
  readonly tone: DiagnosisTone;
  readonly title: string;
  readonly detail: string;
  readonly action?: { readonly label: string; readonly href: string };
}

const JUDGEMENT_SETTINGS = { label: "Judgement model settings", href: "/chat?settings=judgement" } as const;
const MODEL_SETTINGS = { label: "Model settings", href: "/chat?settings=models" } as const;
const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)} s`;

/** Ordered findings for developers: what blocked the reply, what is drifting, and where to look. Never empty. */
export function diagnoseDraft(snapshot: TeachingDraftSnapshot, elapsedMs = snapshot.elapsedMs, budgetMs = DRAFT_TIME_BUDGET_MS): DraftDiagnosis[] {
  const findings: DraftDiagnosis[] = [];
  const terminal = ["released", "withheld", "cancelled"].includes(snapshot.phase);
  const reason = snapshot.reason ?? "";
  if (snapshot.phase === "withheld") {
    const cause = describeReviewCause(reason);
    findings.push({ tone: "blocked", title: `Withheld: ${reason || "unknown reason"}`,
      detail: cause ?? "No draft passed the blocking checks. The rows marked ✕ below are what stopped release.",
      ...(reason.startsWith("backend-") || reason === "review-unavailable" || reason === "request-invalid" ? { action: JUDGEMENT_SETTINGS }
        : reason === "generation-unavailable" || reason === "time-budget" ? { action: MODEL_SETTINGS } : {}) });
  }
  if (terminal && snapshot.phase !== "cancelled" && !snapshot.judgeModel)
    findings.push({ tone: "blocked", title: "No reviewer was dispatched", detail: "No judgement model handled this turn, so nothing was checked.", action: JUDGEMENT_SETTINGS });

  const generationErrors = snapshot.attempts.filter(attempt => attempt.status === "generation-error").length;
  if (generationErrors) findings.push({ tone: generationErrors === snapshot.attempts.length ? "blocked" : "caution",
    title: `${generationErrors} of ${snapshot.attempts.length} ${snapshot.attempts.length === 1 ? "draft" : "drafts"} failed to generate`,
    detail: "The reply model errored before finishing. Check the provider connection, credits, or try another reply model.", action: MODEL_SETTINGS });

  const reviewed = snapshot.attempts.filter(attempt => attempt.status !== "generation-error");
  for (const row of checkMatrix(snapshot).rows) {
    const failures = row.cells.filter(cell => cell?.status === "fail").length;
    if (failures < 2 && !(failures === 1 && reviewed.length === 1 && row.blocking)) continue;
    findings.push({ tone: row.blocking && snapshot.phase !== "released" ? "blocked" : "caution",
      title: `“${row.title}” failed in ${failures} of ${reviewed.length} ${reviewed.length === 1 ? "draft" : "drafts"}`,
      detail: (failures > 1 ? "Revision did not fix it. " : "")
        + (row.source === "deterministic" ? "This is an exact runtime check: look at the tool call or markup the model produced."
          : "The judge kept flagging this. Either the reply prompt doesn't steer away from it, or the rule is too strict for this request; compare against your own read of the reply.") });
  }
  const unknown = new Set(reviewed.flatMap(attempt => attempt.checks.filter(check => check.status === "unknown").map(check => check.id)));
  if (unknown.size) findings.push({ tone: "caution", title: `${unknown.size} ${unknown.size === 1 ? "check" : "checks"} returned no verdict`,
    detail: "The judge gave no probability. That usually means missing evidence (an attachment without text) or a question batch that was dropped for size." });

  const generationMs = snapshot.attempts.reduce((sum, attempt) => sum + attempt.generationMs, 0);
  const judgementMs = snapshot.attempts.reduce((sum, attempt) => sum + attempt.judgementMs, 0);
  if (elapsedMs >= budgetMs * 0.7) findings.push({ tone: reason.startsWith("time-budget") ? "blocked" : "caution",
    title: `Used ${Math.round(Math.min(1, elapsedMs / budgetMs) * 100)}% of the ${Math.round(budgetMs / 1_000)} s budget`,
    detail: `Writing took ${seconds(generationMs)}${snapshot.planningMs ? `, planning ${seconds(snapshot.planningMs)}` : ""}, review took ${seconds(judgementMs)}. `
      + (generationMs >= judgementMs ? "The reply model is the bottleneck; a faster reply model or lower reasoning helps most." : "Review is the bottleneck; a faster judgement model or a smaller context helps most."),
    action: generationMs >= judgementMs ? MODEL_SETTINGS : JUDGEMENT_SETTINGS });

  const fill = snapshot.state?.fillRatio ?? null;
  const dropped = snapshot.slides?.reduce((sum, slide) => sum + slide.turnsDropped, 0) ?? 0;
  if ((fill !== null && fill >= 0.8) || dropped) findings.push({ tone: "caution",
    title: dropped ? `Judge context trimmed: ${dropped} ${dropped === 1 ? "turn" : "turns"} removed` : `Judge context ${Math.round(fill! * 100)}% full`,
    detail: "The reviewer saw less of the conversation than the reply model did. Checks that depend on earlier turns are less reliable." });

  if (!findings.length) findings.push({ tone: "ok",
    title: !terminal ? "Nothing needs attention yet" : reviewed.length <= 1 ? "Passed on the first draft" : `Released after ${reviewed.length} drafts`,
    detail: !terminal ? "Findings appear here as drafts are reviewed." : `${snapshot.judgeModel ?? "The reviewer"} found no recurring or blocking problems.` });
  const rank: Record<DiagnosisTone, number> = { blocked: 0, caution: 1, ok: 2 };
  return findings.sort((left, right) => rank[left.tone] - rank[right.tone]);
}

export interface CheckMatrixRow {
  readonly id: string;
  readonly title: string;
  readonly severity: TeachingPolicyCheck["severity"];
  readonly source: TeachingPolicyCheck["source"];
  /** Whether a non-pass result here blocks release. */
  readonly blocking: boolean;
  /** One cell per entry in `attempts`; null when that draft did not run the check. */
  readonly cells: readonly (TeachingPolicyCheck | null)[];
  readonly allPassed: boolean;
}

const SEVERITY_RANK: Record<TeachingPolicyCheck["severity"], number> = { critical: 0, major: 1, minor: 2 };

/** Checks × drafts, problems first (by severity), so the grid reads top-down as "what went wrong". */
export function checkMatrix(snapshot: TeachingDraftSnapshot): { attempts: readonly number[]; rows: readonly CheckMatrixRow[] } {
  const attempts = snapshot.attempts.filter(attempt => attempt.status !== "generation-error");
  const ids = [...new Set(attempts.flatMap(attempt => attempt.checks.map(check => check.id)))];
  const rows = ids.map((id): CheckMatrixRow => {
    const cells = attempts.map(attempt => attempt.checks.find(check => check.id === id) ?? null);
    const sample = cells.find((cell): cell is TeachingPolicyCheck => cell !== null)!;
    return { id, title: describeTeachingCheck(id).title, severity: sample.severity, source: sample.source,
      blocking: cells.some(cell => cell !== null && blocksRelease(cell)),
      cells, allPassed: cells.every(cell => cell === null || cell.status === "pass") };
  });
  rows.sort((left, right) => Number(left.allPassed) - Number(right.allPassed)
    || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.id.localeCompare(right.id));
  return { attempts: attempts.map(attempt => attempt.attempt), rows };
}
