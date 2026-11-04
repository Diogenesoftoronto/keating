import { describe, expect, test } from "bun:test";
import type { TeachingDraftAttempt, TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import { checkMatrix, diagnoseDraft, draftStages, learnerDraftGuidance } from "../keating/judgement/draft-progress";

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
