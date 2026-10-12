import { expect, test } from "bun:test";
import type { TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import { describeDraftFailure } from "../keating/judgement/draft-failure";

function snapshot(checks: TeachingPolicyCheck[]): TeachingDraftSnapshot {
  return { phase: "withheld", attempt: 1, maxAttempts: 10, reasoning: "off", standard: "concise", elapsedMs: 10,
    judgeModel: "fixture", selectedAttempt: null, reason: "no-approved-draft",
    attempts: [{ attempt: 1, reasoning: "off", standard: "concise", variant: "default", generationMs: 1, judgementMs: 1, status: "unknown", checks }] };
}

test("failure explanation reports actual release blockers rather than advisory scope scores", () => {
  const text = describeDraftFailure(snapshot([
    { id: "quality_scope", source: "jev", severity: "major", status: "fail", probability: .95 },
    { id: "identity_invented", source: "jev", severity: "critical", status: "unknown", probability: .25 },
  ]));
  expect(text).toContain("Blocking checks: identity_invented.");
  expect(text).not.toContain("response scope");
  expect(text).not.toContain("quality_scope");
});

test("missing review scores remain blockers rather than being misreported as poor quality", () => {
  const text = describeDraftFailure(snapshot([
    { id: "quality_scope", source: "jev", severity: "major", status: "unknown", probability: null },
  ]));
  expect(text).toContain("Blocking checks: quality_scope.");
  expect(text).not.toContain("did not meet");
});
