import { expect, test } from "bun:test";
import { extractQuizBoostingFeatures, QUIZ_BOOSTING_FEATURES, QUIZ_BOOSTING_FEATURE_SCHEMA, QUIZ_BOOSTING_TARGET } from "../src/judgement/quiz-boosting-features.js";
import type { UiQuestion } from "../src/ui.js";

function question(patch: Partial<UiQuestion> = {}): UiQuestion {
  return { id: "question-1", prompt: "Pick 🚀", kind: "choice", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correctAnswer: "a", ...patch };
}

test("pins a closed versioned pre-answer feature schema and counts UTF-16 code units", () => {
  expect(QUIZ_BOOSTING_TARGET).toBe("quiz-correct-without-inapp-hint/v1");
  expect(QUIZ_BOOSTING_FEATURE_SCHEMA).toBe("cli-objective-quiz-performance/v1");
  const item = question(), features = extractQuizBoostingFeatures(item, 0.73);
  expect(features).toEqual({ jevProbability: 0.73, choiceCount: 2, questionLength: 7,
    kind_choice: 1, kind_multiple_choice: 0, kind_multi_select: 0, kind_true_false: 0, kind_dropdown: 0 });
  expect(Object.keys(features!)).toEqual([...QUIZ_BOOSTING_FEATURES]);
  expect(Object.isFrozen(features)).toBe(true);
  item.prompt = "Changed"; item.choices!.push({ id: "c", label: "C" });
  expect(features?.choiceCount).toBe(2);
  expect(features?.questionLength).toBe(7);
  expect(Object.isFrozen(item)).toBe(false);
});

test("all five CLI objective kinds get exactly one kind feature and valid canonical answer keys", () => {
  for (const kind of ["choice", "multiple_choice", "multi_select", "true_false", "dropdown"] as const) {
    const item = question({ kind, ...(kind === "multi_select" ? { correctAnswer: undefined, correctAnswers: ["a", "b"], multiSelect: true } : {}) });
    const features = extractQuizBoostingFeatures(item, 0);
    expect(features?.[`kind_${kind}`]).toBe(1);
    expect(QUIZ_BOOSTING_FEATURES.filter(name => name.startsWith("kind_")).reduce((total, name) => total + features![name]!, 0)).toBe(1);
    expect(features?.jevProbability).toBe(0);
  }
  expect(extractQuizBoostingFeatures(question({ correctAnswer: undefined, correctAnswers: ["b"] }), 1)?.jevProbability).toBe(1);
  // A real question ID must never collide with our synthetic validation wrapper.
  expect(extractQuizBoostingFeatures(question({ id: "quiz-boosting-node" }), 0.5)).not.toBeNull();
});

test("non-feature metadata and correct option positions cannot leak into feature values", () => {
  const baseline = extractQuizBoostingFeatures(question(), 0.4);
  const changed = question({ id: "new-id", correctAnswer: "b", hint: "Try reasoning", explanation: "Detailed answer",
    rubric: "Ignore this for features", timeLimit: 1, level: "analysis", header: "Context", allowText: true,
    choices: [{ id: "b", label: "A much longer label" }, { id: "a", label: "Short" }] });
  expect(extractQuizBoostingFeatures(changed, 0.4)).toEqual(baseline);
  for (const field of ["answer", "hintUsed", "correct", "responseMs"]) {
    expect(extractQuizBoostingFeatures({ ...question(), [field]: 1 } as UiQuestion, 0.4)).toBeNull();
  }
});

test("unsupported kinds, math and unverifiable answer keys abstain", () => {
  for (const kind of [undefined, "text", "blanks", "classification", "matching", "ordering", "fill_in", "short_answer", "transfer", "slider"] as const) {
    expect(extractQuizBoostingFeatures(question({ kind }), 0.5)).toBeNull();
  }
  for (const patch of [
    { mathProblem: {} }, { choices: undefined }, { choices: [] }, { correctAnswer: undefined },
    { correctAnswer: "not-an-option" }, { kind: "multi_select", correctAnswers: [] },
    { kind: "multi_select", correctAnswers: ["a", "unknown"] }, { multiSelect: true },
  ]) expect(extractQuizBoostingFeatures(question(patch as Partial<UiQuestion>), 0.5)).toBeNull();
});

test("malformed questions and probabilities are rejected by canonical UI validation", () => {
  for (const probability of [-0.1, 1.1, NaN, Infinity, "0.5", null, undefined]) {
    expect(extractQuizBoostingFeatures(question(), probability as number)).toBeNull();
  }
  for (const malformed of [
    null, undefined, {}, { ...question(), prompt: "" }, { ...question(), prompt: "x".repeat(4097) },
    { ...question(), choices: [{ id: "a", label: "A" }, { id: "a", label: "duplicate" }] },
    { ...question(), choices: [{ id: "a", label: "" }] }, { ...question(), correctAnswers: "a" },
    { ...question(), timeLimit: -1 }, { ...question(), allowText: "yes" },
  ]) expect(extractQuizBoostingFeatures(malformed as UiQuestion, 0.5)).toBeNull();
});
