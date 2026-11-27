import { expect, test } from "bun:test";
import { advanceTeachingDelivery, NOTHING_SENT, runTeachingDrafts, teachingAttemptOutcome, teachingContinuationPrompt,
  TUTOR_EMPTY_ERROR, TUTOR_RATE_LIMIT_REASON, TUTOR_TIMEOUT_ERROR, TUTOR_TOKEN_LIMIT_ERROR,
  type JudgementCaller, type JudgementErrorCode } from "../src/index.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const draft = (text: string) => ({ reply: { text, toolCalls: [] }, value: text });

/** Planning succeeds; every review of a draft fails with the given code. */
function reviewFails(code: JudgementErrorCode): JudgementCaller {
  const ok = makeTeachingDraftJudge();
  return async (request, signal) => (request.state as { reply?: unknown }).reply
    ? { ok: false, error: { code, retryable: false } } : ok(request, signal);
}

test.each([
  [TUTOR_TOKEN_LIMIT_ERROR, "token-limit"], [TUTOR_TIMEOUT_ERROR, "timeout"], [TUTOR_RATE_LIMIT_REASON, "rate-limited"],
  [TUTOR_EMPTY_ERROR, "empty"], ["socket closed", "provider-error"],
] as const)("a tutor generation ending with %s is recorded as %s", async (message, finish) => {
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, judge: makeTeachingDraftJudge(), maxAttempts: 1,
    generate: async () => { throw new Error(message); } });
  expect(result.receipt.attempts[0]).toMatchObject({ status: "generation-error", generationFinish: finish });
  expect(teachingAttemptOutcome(result.receipt.attempts[0]!)).toBe(`generation-${finish}`);
});

test.each([
  ["context-limit-exceeded", "reviewer-overflow"], ["backend-unavailable", "reviewer-call-failed"], ["backend-timeout", "reviewer-call-failed"],
] as const)("a reviewer call ending in %s leaves the draft unknown, never rejected, and still releases it", async (code, kind) => {
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, judge: reviewFails(code), maxAttempts: 1, releaseLastResortDraft: true,
    generate: async () => draft("Division splits a quantity into equal groups.") });
  const attempt = result.receipt.attempts[0]!;
  expect(attempt.status).toBe("unknown");
  expect(attempt.reviewFailure).toBe(kind);
  expect(attempt.checks.some(check => check.source === "jev" && check.status === "fail")).toBe(false);
  expect(teachingAttemptOutcome(attempt)).toBe(kind);
  // Replies are never withheld because the reviewer could not answer.
  expect(result.status).toBe("released");
  expect(result.reply?.text).toBe("Division splits a quantity into equal groups.");
});

test("a completed review that rejects a draft is a semantic rejection, with no reviewer failure recorded", async () => {
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1,
    judge: makeTeachingDraftJudge(() => ({ identity_invented: .99 })), generate: async () => draft("I am your teacher from school.") });
  const attempt = result.receipt.attempts[0]!;
  expect(attempt.status).toBe("fail");
  expect(attempt.reviewFailure).toBeUndefined();
  expect(teachingAttemptOutcome(attempt)).toBe("semantic-rejection");
});

test("attempt outcomes keep host gates, passes and inconclusive reviews apart", () => {
  const check = (source: string, status: string) => ({ source, status });
  expect(teachingAttemptOutcome({ status: "pass", checks: [] })).toBe("passed");
  expect(teachingAttemptOutcome({ status: "unknown", checks: [check("jev", "unknown")] })).toBe("review-inconclusive");
  // A failed tool gate rejects even when the reviewer call also failed.
  expect(teachingAttemptOutcome({ status: "fail", reviewFailure: "reviewer-overflow", checks: [check("deterministic", "fail")] })).toBe("host-rejection");
});

test("only a receipt moves delivery forward, and never backward", () => {
  expect(advanceTeachingDelivery(NOTHING_SENT, "opening-emitted", undefined)).toEqual(NOTHING_SENT);
  expect(advanceTeachingDelivery(NOTHING_SENT, "opening-emitted", { text: "" })).toEqual(NOTHING_SENT);
  const opened = advanceTeachingDelivery(NOTHING_SENT, "opening-emitted", { text: "Opening." });
  expect(opened).toEqual({ stage: "opening-emitted", text: "Opening." });
  expect(advanceTeachingDelivery(opened, "opening-emitted", { text: "Other." })).toBe(opened);
  const committed = advanceTeachingDelivery(opened, "reply-committed", { text: "Opening.\n\nMore." });
  expect(committed).toEqual({ stage: "reply-committed", text: "Opening.\n\nMore." });
  expect(advanceTeachingDelivery(committed, "opening-emitted", { text: "Opening." })).toBe(committed);
});

test("the continuation prompt exists only for an emitted opening and quotes its exact text", () => {
  expect(teachingContinuationPrompt(undefined)).toBeNull();
  expect(teachingContinuationPrompt({ text: "Opening." })).toBeNull();
  expect(teachingContinuationPrompt({ text: "Opening.", delivery: "nothing-sent" })).toBeNull();
  const prompt = teachingContinuationPrompt({ text: "Opening.", delivery: "opening-emitted" })!;
  expect(JSON.parse(prompt.data)).toEqual({ deliveryState: "opening-emitted", publishedText: "Opening." });
  expect(prompt.instructions).toContain("has shown the learner");
});
