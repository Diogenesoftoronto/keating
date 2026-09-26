import { expect, test } from "bun:test";
import {
  classifyFieldByEmbedding,
  decideHostedField,
  decideLocalModelField,
  domainFieldQuestion,
  type FieldPrototype,
} from "../src/judgement/domain-classification.js";
import type { ChoiceAnswer } from "../src/judgement/contracts.js";

const FIELDS = ["physics", "chemistry"] as const;
const prototypes: FieldPrototype[] = [
  { field: "physics", embedding: [1, 0] },
  { field: "chemistry", embedding: [0, 1] },
];

test("embedding prototypes classify when the margin is wide", () => {
  const decision = classifyFieldByEmbedding([1, 0], prototypes);
  expect(decision).toMatchObject({ source: "embedding", field: "physics", reason: "classified" });
  expect(decision.marginToNext).toBeGreaterThan(1);
});

test("embedding prototypes abstain on a thin margin or degenerate corpus", () => {
  expect(classifyFieldByEmbedding([1, 0], prototypes, { marginFloor: 100 })).toMatchObject({ field: null, reason: "below-margin" });
  expect(classifyFieldByEmbedding([1, 0], [
    { field: "physics", embedding: [1, 0] },
    { field: "chemistry", embedding: [1, 0] },
  ])).toMatchObject({ field: null, reason: "uncalibratable", marginToNext: null });
  expect(classifyFieldByEmbedding([1, 0], [])).toMatchObject({ field: null, reason: "no-prototypes" });
});

test("local-model decisions gate on confidence and reject unknown answers", () => {
  expect(decideLocalModelField({ field: "physics", confidence: 0.93 }, FIELDS)).toMatchObject({ source: "local-model", field: "physics", reason: "classified", confidence: 0.93 });
  expect(decideLocalModelField({ field: "physics", confidence: null }, FIELDS)).toMatchObject({ field: "physics", reason: "classified", confidence: null });
  expect(decideLocalModelField({ field: "physics", confidence: 0.3 }, FIELDS)).toMatchObject({ field: null, reason: "below-confidence" });
  expect(decideLocalModelField({ field: "magic", confidence: 0.99 }, FIELDS)).toMatchObject({ field: null, reason: "abstained" });
  expect(decideLocalModelField(null, FIELDS)).toMatchObject({ field: null, reason: "abstained" });
  expect(decideLocalModelField({ field: "physics", confidence: 1.5 } as never, FIELDS)).toMatchObject({ field: null, reason: "abstained" });
});

test("hosted answers read the abstain option and a confidence floor", () => {
  const answer = (choice: string, confidence: number): ChoiceAnswer =>
    ({ type: "choice", choice, probabilities: { physics: choice === "physics" ? confidence : 1 - confidence, unknown: choice === "unknown" ? confidence : 1 - confidence }, confidence });
  expect(decideHostedField(answer("physics", 0.8), "unknown")).toMatchObject({ source: "hosted", field: "physics", reason: "classified", confidence: 0.8 });
  expect(decideHostedField(answer("unknown", 0.9), "unknown")).toMatchObject({ field: null, reason: "abstained" });
  expect(decideHostedField(answer("physics", 0.3), "unknown")).toMatchObject({ field: null, reason: "below-confidence" });
  expect(decideHostedField(null, "unknown")).toMatchObject({ field: null, reason: "invalid-response" });
});

test("the hosted question carries every rubric and a distinct abstain option", () => {
  const question = domainFieldQuestion(FIELDS, { physics: "Forces, energy and matter.", chemistry: "Atoms, molecules and reactions." }, { option: "unknown", rubric: "No specific academic subject." });
  expect(question.type).toBe("choice");
  expect(Object.keys(question.criteria).sort()).toEqual(["chemistry", "physics", "unknown"]);
  expect(Object.isFrozen(question) && Object.isFrozen(question.criteria)).toBe(true);
  expect(() => domainFieldQuestion(["physics"], { chemistry: "Atoms." }, { option: "unknown", rubric: "No subject." })).toThrow();
  expect(() => domainFieldQuestion(["unknown"], { unknown: "Anything." }, { option: "unknown", rubric: "No subject." })).toThrow();
});
