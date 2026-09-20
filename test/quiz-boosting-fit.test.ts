import { expect, test } from "bun:test";
import { evaluateQuizShallowTree } from "../src/judgement/quiz-boosting-fit.js";
import { extractQuizBoostingFeatures, QUIZ_BOOSTING_FEATURES } from "../packages/learner-contracts/src/judgement/quiz-boosting-features.js";
import type { BoostingDataset } from "../packages/learner-contracts/src/judgement/boosting-artifact.js";

function dataset(): BoostingDataset {
  return { schemaVersion: 1, policy: { minFitRows: 40, minFitGroups: 8, minValidationRows: 20, minValidationGroups: 6, maxValidationEce: 0.15, maxTreeDepth: 3 },
    features: [...QUIZ_BOOSTING_FEATURES], observations: Array.from({ length: 60 }, (_, i) => {
      const label = i % 2 === 0 ? 0 : 1;
      return { rowId: `r${i}`, groupId: `g${i}`, split: i < 40 ? "fit" : "validation", label, baseline: 0.8,
        features: extractQuizBoostingFeatures({ id: `q${i}`, kind: "multiple_choice", prompt: label ? "A long synthetic test question" : "Short", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correctAnswer: "a" }, 0.8)! };
    }) };
}

test("a depth-three CART is measured against raw Jev on held-out groups", () => {
  const result = evaluateQuizShallowTree(dataset());
  expect(result.status).toBe("validated"); expect(result.tree.kind).toBe("split");
  expect(result.comparison?.candidateBrier).toBe(0); expect(result.comparison?.baselineBrier).toBeCloseTo(0.34);
  expect(result.ece).toBe(0); expect(result.counts).toEqual({ fitRows: 40, fitGroups: 40, validationRows: 20, validationGroups: 20 });
});

test("validation labels change gate results but never the fitted tree", () => {
  const original = dataset(); const changed = { ...original, observations: original.observations.map(row => row.split === "validation" ? { ...row, label: (1 - row.label) as 0 | 1 } : row) };
  const before = evaluateQuizShallowTree(original), after = evaluateQuizShallowTree(changed);
  expect(after.tree).toEqual(before.tree); expect(after.status).toBe("failed-validation"); expect(after.comparison?.beatsBaseline).toBe(false);
});

test("missing groups, rows or outcome classes never pass the shallow gate", () => {
  for (const kind of ["rows", "groups", "classes", "no-validation"] as const) {
    const original = dataset();
    const observations = kind === "rows" ? original.observations.slice(1) : kind === "no-validation" ? original.observations.slice(0, 40)
      : original.observations.map(row => kind === "groups" ? { ...row, groupId: row.split } : { ...row, label: 1 as const });
    expect(evaluateQuizShallowTree({ ...original, observations }).status).toBe("insufficient");
  }
});

test("target gate rejects weakened policy, missing features and an unrelated incumbent", () => {
  const original = dataset();
  expect(() => evaluateQuizShallowTree({ ...original, policy: { ...original.policy, minFitRows: 0 } })).toThrow();
  expect(() => evaluateQuizShallowTree({ ...original, observations: original.observations.map(row => ({ ...row, baseline: 0.5 })) })).toThrow();
  expect(() => evaluateQuizShallowTree({ ...original, observations: original.observations.map(row => ({ ...row, features: { jevProbability: 0.8 } })) })).toThrow();
});
