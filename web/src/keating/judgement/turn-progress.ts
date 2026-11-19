/**
 * One learner-facing reading of a whole tutor turn: the draft gate's snapshot
 * plus the web searches the turn ran. Produces the stage rail, the step
 * timeline, and the finished summary. Content-free like draft-progress: check
 * titles, counts and timings only; search queries are the model's own tool
 * arguments, which the chat already shows.
 */
import { blocksRelease, projectTeachingDraftSelection, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import type { WebSearchCall } from "../../components/web-search-result";
import { describeTeachingCheck } from "./check-descriptions";
import { draftStages, learnerDraftGuidance, type DraftStageState } from "./draft-progress";

export type TurnStageId = "plan" | "research" | "write" | "check" | "choose";
export interface TurnStage { readonly id: TurnStageId; readonly label: string; readonly state: DraftStageState; readonly badge?: string }

const searching = (calls: readonly WebSearchCall[]) => calls.some(call => call.state === "running");

/**
 * Plan → Research → Write → Check → Choose. Research appears only when the turn
 * searched. While a search runs, research is the active stage and later stages
 * wait, whatever phase the draft gate last reported.
 */
export function turnStages(snapshot: TeachingDraftSnapshot | null, calls: readonly WebSearchCall[]): TurnStage[] {
  const draft = snapshot
    ? draftStages(snapshot)
    : (["plan", "write", "check", "choose"] as const).map(id => ({ id, label: id === "plan" ? "Plan" : id[0]!.toUpperCase() + id.slice(1), state: (id === "plan" ? "done" : "pending") as DraftStageState }));
  const live = searching(calls);
  const stages: TurnStage[] = draft.map(stage => {
    const write = stage.id === "write" && (snapshot?.attempt ?? 0) > 1;
    const label = stage.id === "write" ? "Write" : stage.label;
    const state = live && stage.id !== "plan" && stage.state === "active" ? "pending" : stage.state;
    return { id: stage.id, label, state: live && stage.id === "plan" ? "done" : state, ...(write ? { badge: `×${snapshot!.attempt}` } : {}) };
  });
  if (!calls.length) return stages;
  const research: TurnStage = {
    id: "research", label: "Research", badge: String(calls.length),
    state: live ? "active" : calls.every(call => call.state === "error") ? "stopped" : "done",
  };
  return [stages[0]!, research, ...stages.slice(1)];
}

export interface TurnGuidance { readonly headline: string; readonly detail: string; readonly slow: boolean }

export function turnGuidance(snapshot: TeachingDraftSnapshot | null, calls: readonly WebSearchCall[], elapsedMs: number): TurnGuidance {
  if (searching(calls)) return { headline: "Researching", detail: "Looking up sources so the answer can cite them.", slow: false };
  if (!snapshot) return { headline: "Working on the reply", detail: "", slow: false };
  return learnerDraftGuidance(snapshot, elapsedMs);
}

export type TurnStepState = "done" | "active" | "warn";
export interface TurnStep {
  readonly id: string;
  readonly state: TurnStepState;
  readonly title: string;
  readonly detail?: string;
  readonly tone?: "ok" | "bad";
  readonly queries?: readonly { readonly id: string; readonly query: string; readonly state: WebSearchCall["state"]; readonly sources: number }[];
  readonly durationMs?: number;
}

const checksWord = (count: number) => `${count} ${count === 1 ? "check" : "checks"}`;

/** The turn as an ordered list of steps; the last unfinished one is active. */
export function turnSteps(snapshot: TeachingDraftSnapshot | null, calls: readonly WebSearchCall[]): TurnStep[] {
  const steps: TurnStep[] = [];
  const phase = snapshot?.phase;
  const parallel = snapshot?.pairReviews !== undefined;
  if (snapshot) steps.push(phase === "planning"
    ? { id: "plan", state: "active", title: "Planning the reply" }
    : { id: "plan", state: "done", title: "Planned the reply", ...(snapshot.planningMs ? { durationMs: snapshot.planningMs } : {}) });
  if (calls.length) {
    const live = searching(calls);
    const failed = calls.filter(call => call.state === "error").length;
    steps.push({
      id: "research", state: live ? "active" : failed === calls.length ? "warn" : "done",
      title: live ? "Searching the web" : failed === calls.length ? "Search failed" : "Searched the web",
      queries: calls.map(call => ({ id: call.id, query: call.query ?? "Web search", state: call.state, sources: call.sites.length })),
    });
  }
  if (!snapshot) return steps;

  for (const attempt of snapshot.attempts) {
    const draft = attempt.attempt === 1 ? "draft 1" : `draft ${attempt.attempt}`;
    if (attempt.status === "generation-error") {
      steps.push({ id: `write-${attempt.attempt}`, state: "warn", title: `Couldn’t write ${draft}`, detail: "The reply model stopped before finishing.", tone: "bad" });
      continue;
    }
    const wrote = parallel || attempt.attempt === 1 ? `Wrote ${draft}` : `Rewrote the reply (${draft})`;
    steps.push({ id: `write-${attempt.attempt}`, state: "done", title: wrote, durationMs: attempt.generationMs });
    const failing = attempt.checks.filter(check => check.status !== "pass" && blocksRelease(check));
    const passed = attempt.checks.filter(check => check.status === "pass").length;
    const flagged = attempt.checks.length - passed;
    const titles = [...new Set(failing.map(check => describeTeachingCheck(check.id).title))];
    steps.push(failing.length
      ? { id: `check-${attempt.attempt}`, state: "warn", tone: "bad", title: `Checked ${draft}`, durationMs: attempt.judgementMs,
        detail: `${titles.slice(0, 2).map(title => `“${title}”`).join(" and ")}${titles.length > 2 ? ` and ${titles.length - 2} more` : ""} didn’t pass` }
      : { id: `check-${attempt.attempt}`, state: "done", tone: "ok", title: `Checked ${draft}`, durationMs: attempt.judgementMs,
        detail: !attempt.checks.length ? "No checks recorded" : flagged ? `${checksWord(passed)} passed, ${flagged} flagged` : `All ${checksWord(passed)} passed` });
  }

  const next = snapshot.attempts.length + 1;
  const combining = phase === "revising" && !!snapshot.synthesisSourceAttempts?.length;
  if (phase === "drafting" || phase === "revising") steps.push({ id: `write-${next}`, state: "active",
    title: combining ? "Combining the best drafts" : parallel ? "Writing candidate replies" : next === 1 ? "Writing draft 1" : `Rewriting the reply (draft ${next})`,
    ...(next > 1 && !combining && !parallel ? { detail: "Aiming at the check that didn’t pass." } : {}) });
  if (phase === "checking") steps.push({ id: "checking", state: "active", title: parallel ? "Checking candidate replies" : `Checking draft ${snapshot.attempt}` });
  if (phase === "selecting") steps.push({ id: "choose", state: "active", title: "Choosing the version to show" });
  if (phase === "released" && snapshot.attempts.length > 1 && snapshot.selectedAttempt)
    steps.push({ id: "choose", state: "done", title: `Showed draft ${snapshot.selectedAttempt}` });
  if (phase === "withheld") steps.push({ id: "withheld", state: "warn", tone: "bad", title: "No draft passed the checks" });
  return steps;
}

export interface TurnSummary {
  readonly searches: number;
  readonly sources: number;
  readonly drafts: number;
  readonly fixes: number;
  readonly checks: number;
  readonly checked: boolean;
}

/** Counts for the folded chips under a finished reply. */
export function turnSummary(snapshot: TeachingDraftSnapshot | null, calls: readonly WebSearchCall[], sources: number): TurnSummary {
  const written = snapshot?.attempts.filter(attempt => attempt.status !== "generation-error") ?? [];
  const selection = snapshot && projectTeachingDraftSelection(snapshot);
  const selected = written.find(attempt => attempt.attempt === selection?.attempt);
  return {
    searches: calls.length,
    sources,
    drafts: written.length,
    fixes: snapshot?.pairReviews ? 0 : written.filter(attempt => attempt.status === "fail").length,
    checks: selected?.checks.filter(check => check.status === "pass").length ?? 0,
    checked: selection?.review === "verified" && Boolean(selected?.checks.length),
  };
}
