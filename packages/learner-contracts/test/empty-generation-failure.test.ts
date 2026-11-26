import { expect, test } from "bun:test";
import { runTeachingDrafts, TUTOR_EMPTY_ERROR, TUTOR_EMPTY_REASON, TUTOR_RATE_LIMIT_REASON } from "../src/judgement/teaching-drafts.js";
import { isOpenUiDiagnosticGateIssue } from "../src/openui-diagnostic-issues.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

test("a provider that finishes with an empty reply is recorded as such, not as a generic error", async () => {
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, judge: makeTeachingDraftJudge(), maxAttempts: 2,
    generate: async () => { throw new Error(TUTOR_EMPTY_ERROR); } });
  expect(result.status).not.toBe("released");
  expect(result.receipt.attempts.length).toBeGreaterThan(0);
  expect(result.receipt.attempts.every(attempt => attempt.status === "generation-error" && attempt.generationFailure === TUTOR_EMPTY_REASON)).toBe(true);
  // Other failures stay unclassified, and the reason may leave the private review as a diagnostic.
  const other = await runTeachingDrafts({ turn: teachingDraftTurn, judge: makeTeachingDraftJudge(), maxAttempts: 1,
    generate: async () => { throw new Error("socket closed"); } });
  expect(other.receipt.attempts[0]?.generationFailure).toBeUndefined();
  expect(isOpenUiDiagnosticGateIssue(TUTOR_EMPTY_REASON)).toBe(true);
  expect(TUTOR_EMPTY_REASON).not.toBe(TUTOR_RATE_LIMIT_REASON);
});
