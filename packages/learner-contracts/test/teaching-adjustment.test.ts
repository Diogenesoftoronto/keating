import { describe, expect, test } from "bun:test";
import { proposeTeachingAdjustment, teachingAdjustmentInstruction } from "../src/judgement/teaching-adjustment.js";
import { turnAnalysisQuestions } from "../src/judgement/assessment.js";
import { questionDigest, type ChoiceAnswer, type JudgementResponse } from "../src/judgement/contracts.js";
import { thresholdKey, type CalibrationTable } from "../src/judgement/projections.js";

const backend = { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: null };
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
function review(need = "room_to_reason", fit = "overhelp", move = "explanation"): Mutable<JudgementResponse> {
  const choices = { move, need, fit };
  return { backend: { ...backend }, answers: Object.fromEntries(Object.entries(turnAnalysisQuestions()).map(([id, question]) => [id, {
    type: "choice", choice: choices[id as keyof typeof choices], confidence: 1,
    probabilities: Object.fromEntries(Object.keys((question as { criteria: Record<string, unknown> }).criteria).map(key => [key, key === choices[id as keyof typeof choices] ? 1 : 0])),
  }])) };
}
describe("teaching adjustment proposals", () => {
  for (const [need, fit, direction] of [
    ["room_to_reason", "overhelp", "give-room-to-reason"],
    ["explanation_needed", "underhelp", "explain-next-step"],
    ["clarification_needed", "misdirected", "clarify-the-goal"],
  ] as const) test(`composes ${direction} as human review only`, () => {
    const result = proposeTeachingAdjustment(review(need, fit));
    expect(result.status).toBe("review-required");
    if (result.status !== "review-required") throw new Error("Missing proposal");
    expect(result.adjustment).toBe(direction);
    expect(result.source).toBe("proxy");
    expect(result.calibration).toBe("uncalibrated");
    expect(result.answers.fit.choice).toBe(fit);
    expect(teachingAdjustmentInstruction(result.adjustment).length).toBeGreaterThan(40);
  });
  test("unknown, mixed, appropriate, and conflicting dimensions abstain", () => {
    for (const [need, fit] of [["unknown", "overhelp"], ["mixed", "underhelp"], ["room_to_reason", "unknown"], ["room_to_reason", "appropriate"], ["explanation_needed", "overhelp"], ["room_to_reason", "misdirected"]]) {
      expect(proposeTeachingAdjustment(review(need, fit)).status).toBe("unavailable");
    }
  });
  test("invalid answer and alias identity cannot become a proposal", () => {
    const response = review(); response.answers.fit = { type: "choice", choice: "invented", confidence: 1, probabilities: { invented: 1 } };
    expect(proposeTeachingAdjustment(response)).toEqual({ status: "unavailable", reason: "invalid-review" });
    response.backend.model = "jev-latest";
    expect(proposeTeachingAdjustment(response).status).toBe("unavailable");
  });
  test("a tied best option does not pick an arbitrary teaching direction", () => {
    const response = review(); const answer = response.answers.fit as Mutable<ChoiceAnswer>;
    answer.probabilities.overhelp = 0.5; answer.probabilities.underhelp = 0.5;
    expect(proposeTeachingAdjustment(response)).toEqual({ status: "unavailable", reason: "uncertain-review" });
  });
  test("matching all exact question/backend thresholds still requires human review", () => {
    const response = review(); response.backend = { ...backend, calibrationSha256: "a".repeat(64) };
    const table: CalibrationTable = { entries: Object.fromEntries(Object.values(turnAnalysisQuestions()).map(question => [thresholdKey(response.backend, questionDigest(question)), { deferBelow: 0.5, actAtOrAbove: 0.9 }])) };
    const result = proposeTeachingAdjustment(response, table);
    expect(result.status).toBe("review-required");
    expect(result.status === "review-required" && result.calibration).toBe("matched");
    (response.answers.need as Mutable<ChoiceAnswer>).confidence = 0.7;
    const low = proposeTeachingAdjustment(response, table);
    expect(low.status === "review-required" && low.calibration).toBe("below-threshold");
    response.backend.model = "jev-different";
    const drift = proposeTeachingAdjustment(response, table);
    expect(drift.status === "review-required" && drift.calibration).toBe("uncalibrated");
  });
  test("returned review data cannot mutate the source receipt", () => {
    const response = review(); const result = proposeTeachingAdjustment(response);
    if (result.status !== "review-required") throw new Error("Missing proposal");
    (result.answers.fit as Mutable<ChoiceAnswer>).probabilities.overhelp = 0;
    (result.backend as Mutable<typeof result.backend>).model = "changed";
    expect((response.answers.fit as ChoiceAnswer).probabilities.overhelp).toBe(1);
    expect(response.backend.model).toBe("jev-1.13.0");
  });
});
