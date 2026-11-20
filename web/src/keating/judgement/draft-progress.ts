/**
 * Content-free reading of a teaching-draft snapshot for the two views of a
 * running reply: learner progress (stages, time, one plain sentence) and the
 * developer review (what needs attention, where the time went, which checks
 * failed in which draft). Nothing here reads private draft text.
 */
import { blocksRelease, describeDecisionPlanningFailure, TUTOR_RATE_LIMIT_REASON, type TeachingDraftAttempt, type TeachingDraftSnapshot, type TeachingPolicyCheck } from "@keating/learner-contracts";
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

/** Recorded relationship to the source draft, including the two blind alternatives. */
export function draftOrigin(snapshot: TeachingDraftSnapshot, attempt: TeachingDraftAttempt): string | undefined {
  if (attempt.repairSourceAttempt) return `Revised draft ${attempt.repairSourceAttempt}.`;
  if (snapshot.parallelAttempts?.includes(attempt.attempt)) {
    const other = snapshot.parallelAttempts.find(number => number !== attempt.attempt);
    return `Started in parallel with draft ${other}.`;
  }
  return undefined;
}

export function comparisonDrafts(snapshot: TeachingDraftSnapshot, released: TeachingDraftAttempt): readonly TeachingDraftAttempt[] {
  if (released.repairSourceAttempt) return snapshot.attempts.filter(attempt => attempt.attempt === released.repairSourceAttempt);
  if (snapshot.parallelAttempts?.includes(released.attempt)) {
    return snapshot.attempts.filter(attempt => attempt.attempt !== released.attempt && snapshot.parallelAttempts?.includes(attempt.attempt));
  }
  return snapshot.attempts.filter(attempt => attempt.attempt < released.attempt).sort((a, b) => a.attempt - b.attempt);
}

/**
 * Four stages in order. Rewrites loop back to "write", so the label says which
 * draft is being written instead of moving the stepper backwards silently.
 */
export function draftStages(snapshot: TeachingDraftSnapshot): DraftStage[] {
  const { phase } = snapshot;
  const parallel = snapshot.parallelAttempts?.includes(snapshot.attempt);
  const labels = { plan: "Plan", write: "Write", check: "Check", choose: "Choose" };
  if (parallel) {
    labels.write = "Write both";
    if (phase === "checking") labels.check = `Check ${snapshot.attempt}`;
  } else if ((snapshot.repairSourceAttempt || !snapshot.pairReviews)
    && (phase === "revising" || (phase === "drafting" || phase === "checking") && snapshot.attempt > 1)) {
    labels.write = `${snapshot.repairSourceAttempt ? "Revise" : "Rewrite"} ${snapshot.attempt}`;
  }
  if (phase === "released") return STAGE_ORDER.map(id => ({ id, label: labels[id], state: "done" }));
  // Terminal without release: stop at the furthest stage the attempts show.
  const reached: DraftStageId = PHASE_STAGE[phase]
    ?? (snapshot.attempts.some(attempt => attempt.status !== "generation-error") ? "check" : snapshot.attempt > 0 ? "write" : "plan");
  const index = STAGE_ORDER.indexOf(reached);
  const terminal = phase === "withheld" || phase === "cancelled";
  return STAGE_ORDER.map((id, position) => ({ id, label: labels[id],
    state: position < index ? "done" : position === index ? terminal ? "stopped" : "active" : "pending" }));
}

export interface LearnerDraftGuidance { readonly headline: string; readonly detail: string; readonly slow: boolean }

const SLOW_MS = 40_000;
const NEAR_LIMIT_MS = 70_000;

function currentDraftGuidance(snapshot: TeachingDraftSnapshot): readonly [string, string] {
  const parallel = snapshot.parallelAttempts?.includes(snapshot.attempt);
  if (snapshot.pairReviews && !parallel && !snapshot.repairSourceAttempt) {
    if (snapshot.phase === "drafting") return ["Writing candidate replies", "Keating is preparing alternatives for Jev to review."];
    if (snapshot.phase === "checking") return ["Checking candidate replies", "Jev is reviewing how well each reply answers you."];
    if (snapshot.phase === "selecting") return ["Choosing your reply", "Keating is choosing among the eligible drafts."];
  }
  switch (snapshot.phase) {
    case "planning": return ["Planning the reply", "Deciding how much help this question needs."];
    case "drafting":
    case "revising":
      if (snapshot.phase === "revising" && snapshot.synthesisSourceAttempts?.length) return ["Combining the best drafts", "Keating is bringing material from both drafts into one reply."];
      if (parallel) return snapshot.attempts.length
        ? [`Finishing draft ${snapshot.attempt}`, "Both drafts started together. Keating is waiting for this one to finish."]
        : ["Writing two drafts", "Keating is trying two approaches to your question in parallel."];
      if (snapshot.repairSourceAttempt) return [`Revising draft ${snapshot.repairSourceAttempt}`, "Keating is addressing the part flagged in review."];
      if (snapshot.phase === "revising" || snapshot.attempt > 1) return ["Improving the reply", "Keating is writing another version of the answer."];
      return ["Writing your reply", "Keating checks every reply before you see it."];
    case "checking":
      return parallel || snapshot.repairSourceAttempt
        ? [`Checking draft ${snapshot.attempt}`, "Reviewing this version before choosing what to show."]
        : ["Checking the reply", "Making sure it answers your question and its claims hold up."];
    case "selecting": return ["Picking the best version", "Comparing the eligible drafts."];
    default: return ["Finishing up", ""];
  }
}

/** One headline and one sentence a learner can act on, with a nudge when the wait grows long. */
export function learnerDraftGuidance(snapshot: TeachingDraftSnapshot, elapsedMs: number): LearnerDraftGuidance {
  const [headline, detail] = currentDraftGuidance(snapshot);
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
  if (snapshot.decisionFailure) {
    const failure = snapshot.decisionFailure;
    findings.push({ tone: "blocked", title: "Decision planning failed", detail: describeDecisionPlanningFailure(failure)
      + (failure.configuredModel ? " The configured model is " + failure.configuredModel + "." : "")
      + " The recorded reason is " + failure.reason + ".", action: JUDGEMENT_SETTINGS });
  } else if (snapshot.phase === "withheld") {
    const cause = describeReviewCause(reason);
    findings.push({ tone: "blocked", title: `Withheld: ${reason || "unknown reason"}`,
      detail: cause ?? "No draft passed the blocking checks. The rows marked ✕ below are what stopped release.",
      ...(reason.startsWith("backend-") || reason === "review-unavailable" || reason === "request-invalid" ? { action: JUDGEMENT_SETTINGS }
        : reason === TUTOR_RATE_LIMIT_REASON || reason === "generation-unavailable" || reason === "time-budget" ? { action: MODEL_SETTINGS } : {}) });
  }
  if (terminal && snapshot.phase !== "cancelled" && !snapshot.judgeModel && !snapshot.decisionFailure)
    findings.push({ tone: "blocked", title: "No reviewer response was recorded", detail: "This receipt has no response identifying the judgement model.", action: JUDGEMENT_SETTINGS });

  const generationErrors = snapshot.attempts.filter(attempt => attempt.status === "generation-error").length;
  const rateLimited = snapshot.attempts.filter(attempt => attempt.generationFailure === TUTOR_RATE_LIMIT_REASON).length;
  if (generationErrors) findings.push({ tone: generationErrors === snapshot.attempts.length ? "blocked" : "caution",
    title: `${generationErrors} of ${snapshot.attempts.length} ${snapshot.attempts.length === 1 ? "draft" : "drafts"} failed to generate`,
    detail: rateLimited ? `The reply provider returned HTTP 429 for ${rateLimited} of these attempts.`
      : "The reply model errored before finishing. Check the provider connection, credits, or try another reply model.", action: MODEL_SETTINGS });

  const reviewed = snapshot.attempts.filter(attempt => attempt.status !== "generation-error");
  const selected = reviewed.findIndex(attempt => attempt.attempt === snapshot.selectedAttempt);
  for (const row of checkMatrix(snapshot).rows) {
    const failures = row.cells.filter(cell => cell?.status === "fail").length;
    if (failures < 2 && !(failures === 1 && (reviewed.length === 1 || row.cells[selected]?.status === "fail"))) continue;
    findings.push({ tone: row.blocking && snapshot.phase !== "released" ? "blocked" : "caution",
      title: `“${row.title}” failed in ${failures} of ${reviewed.length} ${reviewed.length === 1 ? "draft" : "drafts"}`,
      detail: (failures > 1 ? ((snapshot.parallelAttempts || snapshot.pairReviews) ? "Multiple independent drafts failed this check. " : "Revision did not fix it. ") : "")
        + (row.source === "deterministic" ? "This is an exact runtime check: look at the tool call or markup the model produced."
          : "Compare the judge’s finding with the actual reply to see whether it answers the request.") });
  }
  const uncertain = reviewed.flatMap(attempt => attempt.checks.filter(check => check.status === "unknown"));
  const gray = new Set(uncertain.filter(check => check.probability !== null).map(check => check.id));
  const missing = new Set(uncertain.filter(check => check.probability === null).map(check => check.id));
  if (gray.size) findings.push({ tone: "caution", title: `${gray.size} ${gray.size === 1 ? "check was" : "checks were"} inconclusive`,
    detail: "The reviewer returned a probability in the uncertain range. Expand the check grid to inspect it for each draft." });
  if (missing.size) findings.push({ tone: "caution", title: `${missing.size} ${missing.size === 1 ? "check" : "checks"} returned no verdict`,
    detail: "These checks have no recorded probability. Inspect the review requests and the evidence available to the judge." });

  const generationMs = snapshot.attempts.reduce((sum, attempt) => sum + attempt.generationMs, 0);
  const judgementMs = snapshot.attempts.reduce((sum, attempt) => sum + attempt.judgementMs, 0);
  if (elapsedMs >= budgetMs * 0.7) findings.push({ tone: reason.startsWith("time-budget") ? "blocked" : "caution",
    title: `Used ${Math.round(Math.min(1, elapsedMs / budgetMs) * 100)}% of the ${Math.round(budgetMs / 1_000)} s budget`,
    detail: snapshot.decisionFailure ? `The planning step ended before tutor generation began.${snapshot.planningMs === undefined ? "" : " Planning took " + seconds(snapshot.planningMs) + "."}`
      : (snapshot.parallelAttempts || snapshot.pairReviews) ? `This turn has taken ${seconds(elapsedMs)}. The concurrent drafts used a combined ${seconds(generationMs)} for generation and ${seconds(judgementMs)} for individual reviews.`
      : `Writing took ${seconds(generationMs)}${snapshot.planningMs ? `, planning ${seconds(snapshot.planningMs)}` : ""}, review took ${seconds(judgementMs)}. `
      + (generationMs >= judgementMs ? "The reply model is the bottleneck; a faster reply model or lower reasoning helps most." : "Review is the bottleneck; a faster judgement model or a smaller context helps most."),
    ...(snapshot.pairReviews ? {} : { action: snapshot.decisionFailure || generationMs < judgementMs ? JUDGEMENT_SETTINGS : MODEL_SETTINGS }) });

  const fill = snapshot.state?.fillRatio ?? null;
  const dropped = snapshot.slides?.reduce((sum, slide) => sum + slide.turnsDropped, 0) ?? 0;
  if ((fill !== null && fill >= 0.8) || dropped) findings.push({ tone: "caution",
    title: dropped ? `Judge context trimmed: ${dropped} ${dropped === 1 ? "turn" : "turns"} removed` : `Judge context ${Math.round(fill! * 100)}% full`,
    detail: "The reviewer saw less of the conversation than the reply model did. Checks that depend on earlier turns are less reliable." });

  if (!findings.length && snapshot.phase === "cancelled") findings.push({ tone: "caution",
    title: "Review stopped", detail: "The turn ended before a draft was released." });
  if (!findings.length && snapshot.reason === "best-effort-draft") findings.push({ tone: "caution",
    title: "Released as best effort", detail: "Keating selected the best available reply with review concerns outstanding." });
  if (!findings.length && snapshot.phase === "released" && !reviewed.some(attempt => attempt.checks.length)) {
    findings.push({ tone: "caution", title: "No check results recorded", detail: "This receipt records a release without individual check results." });
  }
  if (!findings.length) findings.push({ tone: "ok",
    title: !terminal ? "Nothing needs attention yet" : reviewed.length === 1
      ? reviewed[0]!.attempt === 1 ? "Passed on the first draft" : `Released draft ${reviewed[0]!.attempt}`
      : `Released after ${reviewed.length} drafts`,
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
