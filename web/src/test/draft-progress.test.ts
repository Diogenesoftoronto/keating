import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftTimeline, DraftCheckGrid } from "../components/DraftProgress";
import { describe, expect, test } from "bun:test";
import type { TeachingDraftAttempt, TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import { checkMatrix, diagnoseDraft, draftStages, learnerDraftGuidance } from "../keating/judgement/draft-progress";
import { turnGuidance, turnStages, turnSteps, turnSummary } from "../keating/judgement/turn-progress";
import type { WebSearchCall } from "../components/web-search-result";

const check = (id: string, status: TeachingPolicyCheck["status"], severity: TeachingPolicyCheck["severity"] = "major"): TeachingPolicyCheck =>
  ({ id, status, severity, source: "jev", probability: status === "pass" ? 0.05 : status === "fail" ? 0.9 : null });
const attempt = (n: number, checks: TeachingPolicyCheck[], overrides: Partial<TeachingDraftAttempt> = {}): TeachingDraftAttempt =>
  ({ attempt: n, reasoning: "low", standard: "supported", generationMs: 8_000, judgementMs: 4_000, status: checks.some(c => c.status === "fail") ? "fail" : "pass", checks, variant: "default", ...overrides });
const snapshot = (overrides: Partial<TeachingDraftSnapshot>): TeachingDraftSnapshot =>
  ({ phase: "drafting", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "supported", elapsedMs: 5_000, attempts: [], judgeModel: "judge", selectedAttempt: null, reason: null, ...overrides });

describe("draft stages", () => {
  test("mark earlier stages done and the current one active", () => {
    expect(draftStages(snapshot({ phase: "checking" })).map(stage => stage.state)).toEqual(["done", "done", "active", "pending"]);
  });
  test("name the rewrite instead of silently moving the stepper back", () => {
    expect(draftStages(snapshot({ phase: "revising", attempt: 2 }))[1]).toMatchObject({ label: "Rewrite 2", state: "active" });
  });
  test("stop at the furthest stage reached when withheld", () => {
    const stages = draftStages(snapshot({ phase: "withheld", attempts: [attempt(1, [check("a", "fail")])] }));
    expect(stages.map(stage => stage.state)).toEqual(["done", "done", "stopped", "pending"]);
  });
  test("are all done when released", () => {
    expect(draftStages(snapshot({ phase: "released" })).every(stage => stage.state === "done")).toBe(true);
  });
});

describe("learner guidance", () => {
  test("distinguishes concurrent alternatives from rewrites and total work from elapsed time", () => {
    const writing = snapshot({ pairReviews: [], attempt: 4, maxAttempts: 4 });
    expect(draftStages(writing)[1]?.label).toBe("Write");
    expect(learnerDraftGuidance(writing, 1000).headline).toBe("Writing candidate replies");
    const checks = [{...check("mastery_overclaimed","unknown"), probability:0.5}];
    const findings = diagnoseDraft({...writing, elapsedMs:75000, attempts:[attempt(1,checks),attempt(2,checks)]});
    expect(findings.map(item=>item.title)).toContain("1 check was inconclusive");
    expect(findings.find(item=>item.title.includes("budget"))?.detail).toContain("combined");
    expect(findings.map(item=>item.title)).not.toContain("1 check returned no verdict");
  });
  test("says what is happening without review jargon", () => {
    expect(learnerDraftGuidance(snapshot({ phase: "checking" }), 3_000)).toMatchObject({ headline: "Checking the reply", slow: false });
  });
  test("offers a way out when the wait grows long, and warns near the limit", () => {
    expect(learnerDraftGuidance(snapshot({}), 45_000)).toMatchObject({ slow: true });
    expect(learnerDraftGuidance(snapshot({}), 45_000).detail).toContain("press Stop");
    expect(learnerDraftGuidance(snapshot({}), 75_000).detail).toContain("time limit");
  });
});

describe("developer diagnosis", () => {
  test("names a check that revision did not fix", () => {
    const findings = diagnoseDraft(snapshot({ phase: "released", attempts: [attempt(1, [check("evidence_claim", "fail")]), attempt(2, [check("evidence_claim", "fail")])] }));
    expect(findings[0]!.title).toContain("failed in 2 of 2 drafts");
    expect(findings[0]!.detail).toContain("Revision did not fix it");
  });
  test("explains a withheld reply with a settings action", () => {
    const [first] = diagnoseDraft(snapshot({ phase: "withheld", reason: "backend-rate-limited" }));
    expect(first).toMatchObject({ tone: "blocked", action: { href: "/chat?settings=judgement" } });
  });
  test("points at the slow step when the budget is nearly spent", () => {
    const slow = diagnoseDraft(snapshot({ phase: "released", elapsedMs: 80_000, attempts: [attempt(1, [check("a", "pass")], { generationMs: 60_000, judgementMs: 10_000 })] }));
    expect(slow.find(finding => finding.title.includes("budget"))?.detail).toContain("reply model is the bottleneck");
  });
  test("reports a clean pass instead of an empty list", () => {
    expect(diagnoseDraft(snapshot({ phase: "released", attempts: [attempt(1, [check("a", "pass")])] }))).toEqual([expect.objectContaining({ tone: "ok", title: "Passed on the first draft" })]);
  });
});

test("the check grid sorts problems first and skips failed generations", () => {
  const matrix = checkMatrix(snapshot({ attempts: [
    attempt(1, [check("zeta", "pass"), check("alpha", "fail", "minor")]),
    attempt(2, [], { status: "generation-error" }),
    attempt(3, [check("zeta", "pass"), check("alpha", "pass", "minor"), check("beta", "unknown", "critical")]),
  ] }));
  expect(matrix.attempts).toEqual([1, 3]);
  expect(matrix.rows.map(row => row.id)).toEqual(["beta", "alpha", "zeta"]);
  expect(matrix.rows[0]!.cells[0]).toBeNull();
});

describe("turn progress", () => {
  const search = (id: string, state: WebSearchCall["state"], sources = 2): WebSearchCall =>
    ({ id, query: `query ${id}`, state, text: "", sites: Array.from({ length: sources }, (_, i) => ({ url: `https://${id}.example/${i}` })) });

  test("research appears only when the turn searched", () => {
    expect(turnStages(snapshot({ phase: "drafting" }), []).map(stage => stage.id)).toEqual(["plan", "write", "check", "choose"]);
    expect(turnStages(snapshot({ phase: "drafting" }), [search("a", "success")]).map(stage => stage.id)).toEqual(["plan", "research", "write", "check", "choose"]);
  });
  test("a running search is the active stage and holds later stages", () => {
    const stages = turnStages(snapshot({ phase: "drafting" }), [search("a", "success"), search("b", "running")]);
    expect(stages.map(stage => [stage.id, stage.state])).toEqual([["plan", "done"], ["research", "active"], ["write", "pending"], ["check", "pending"], ["choose", "pending"]]);
    expect(stages[1]!.badge).toBe("2");
    expect(turnGuidance(snapshot({ phase: "drafting" }), [search("b", "running")], 1_000).headline).toBe("Researching");
  });
  test("keeps guidance visible between searches without showing an active search", () => {
    expect(turnGuidance(null, [search("a", "success")], 0).headline).toBe("Working on the reply");
  });
  test("parallel candidates are presented as independent drafts", () => {
    const candidates = snapshot({ phase: "checking", pairReviews: [], attempt: 2, attempts: [attempt(2, [check("a", "pass")])] });
    expect(turnSteps(candidates, []).map(step => step.title)).toContain("Wrote draft 2");
    expect(turnSteps(candidates, []).at(-1)?.title).toBe("Checking candidate replies");
  });
  test("a rewrite is a badge on Write, not a stepper moving back", () => {
    const write = turnStages(snapshot({ phase: "revising", attempt: 2 }), []).find(stage => stage.id === "write");
    expect(write).toMatchObject({ label: "Write", badge: "×2", state: "active" });
  });
  test("steps name the failed check and the rewrite that follows", () => {
    const steps = turnSteps(snapshot({ phase: "revising", attempt: 2, planningMs: 900, attempts: [attempt(1, [check("quality_scope", "fail", "critical"), check("b", "pass")])] }), [search("a", "success")]);
    expect(steps.map(step => [step.title, step.state])).toEqual([
      ["Planned the reply", "done"], ["Searched the web", "done"], ["Wrote draft 1", "done"], ["Checked draft 1", "warn"], ["Rewriting the reply (draft 2)", "active"],
    ]);
    expect(steps[3]!.detail).toContain("didn’t pass");
    expect(steps[1]!.queries).toEqual([{ id: "a", query: "query a", state: "success", sources: 2 }]);
  });
  test("does not claim a best-effort release passed review", () => {
    const released = snapshot({ phase: "released", reason: "best-effort-draft", selectedAttempt: 1, attempts: [attempt(1, [check("a", "fail", "critical"), check("b", "pass")])] });
    expect(turnSummary(released, [], 0)).toMatchObject({ checked: false, checks: 1 });
  });
  test("summary counts drafts, fixes and the shown draft's checks", () => {
    const released = snapshot({ phase: "released", selectedAttempt: 2, attempts: [attempt(1, [check("a", "fail", "critical")]), attempt(2, [check("a", "pass"), check("b", "pass")])] });
    expect(turnSummary(released, [search("a", "success"), search("b", "error")], 2)).toEqual({ searches: 2, sources: 2, drafts: 2, fixes: 1, checks: 2, checked: true });
  });
});

test("draft time bands preserve sequential offsets and concurrent origins, and absent checks stay missing", () => {
  const data = snapshot({ planningMs: 1000, attempts: [attempt(1, [check("a", "fail")]), attempt(2, [check("b", "unknown")])] });
  const timeline = (value: TeachingDraftSnapshot) => renderToStaticMarkup(createElement(DraftTimeline, { snapshot: value }));
  expect(timeline(data)).toContain("Writing, 13 to 21");
  expect(timeline({ ...data, pairReviews: [] })).toContain("Writing, 0 to 8");
  const grid = renderToStaticMarkup(createElement(DraftCheckGrid, { snapshot: data }));
  expect(grid).toContain("Draft checks");
  expect(grid).toContain("–");
  expect(grid).toContain("P(violation) 0.90");
});
