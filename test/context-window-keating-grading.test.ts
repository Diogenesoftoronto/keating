import { expect, test } from "bun:test";
import { proposeOpenResponses, isExactGradeMatch } from "../packages/learner-contracts/src/judgement/assessment.js";
import type { JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { gradingFixtures, gradingScenarios } from "../scripts/context-window/keating-grading-cases.js";

test("grading scenarios exactly match requests emitted by the production proposal path", async () => {
  const fixtures = gradingFixtures(), scenarios = gradingScenarios();
  for (const [index, fixture] of fixtures.entries()) {
    const captured: JudgementRequest[] = [];
    await proposeOpenResponses([fixture.input], async (request) => {
      captured.push(request);
      return { ok: false, error: { code: "backend-timeout", retryable: false } };
    });
    expect(captured).toEqual([scenarios[index]!.request]);
    expect(isExactGradeMatch(fixture.input.learnerAnswer, fixture.input.referenceAnswer!)).toBe(false);
  }
});

test("paired grading episodes isolate answer quality while retaining the same authored item and split", () => {
  const fixtures = gradingFixtures();
  expect(fixtures).toHaveLength(10);
  expect(new Set(fixtures.map((row) => row.family)).size).toBe(5);
  for (const family of new Set(fixtures.map((row) => row.family))) {
    const [a, b] = fixtures.filter((row) => row.family === family);
    expect(a!.input.question).toBe(b!.input.question);
    expect(a!.input.rubric).toBe(b!.input.rubric);
    expect(a!.input.referenceAnswer).toBe(b!.input.referenceAnswer);
    expect(a!.split).toBe(b!.split);
    expect(a!.score).not.toBe(b!.score);
    expect([a!.score, b!.score]).toContain(4);
  }
  expect(fixtures.filter((row) => row.split === "holdout")).toHaveLength(6);
});

test("evidence gold is an actual production choice and annotation is kept outside the request", () => {
  for (const scenario of gradingScenarios()) {
    const question = scenario.request.questions.evidence!;
    expect(question.type).toBe("choice");
    if (question.type !== "choice") throw new Error("evidence must be a choice");
    expect(Object.keys(question.criteria)).toContain(scenario.expected.evidence as string);
    expect(scenario.request.state).toEqual(expect.objectContaining({ learner_answer: expect.stringContaining(scenario.expected.evidence as string) }));
    expect(Object.keys(scenario.request.state)).toEqual(["question", "learner_answer", "reference_answer"]);
    expect(JSON.stringify(scenario.request)).not.toContain(scenario.rationale.score!);
    expect(scenario.request.questions.score!.type === "score" && scenario.request.questions.score!.criteria.length).toBe(5);
  }
});

test("manual key distinguishes the five concrete grading failure modes", () => {
  const expected = Object.fromEntries(gradingScenarios().map((row) => [row.id, row.expected.score]));
  expect(expected).toEqual({
    "grading-osmosis-meaning-1": 4, "grading-osmosis-meaning-2": 1,
    "grading-code-output-explanation-1": 2, "grading-code-output-explanation-2": 4,
    "grading-source-quotation-1": 4, "grading-source-quotation-2": 2,
    "grading-multistep-lab-explanation-1": 2, "grading-multistep-lab-explanation-2": 4,
    "grading-missing-lab-evidence-1": 4, "grading-missing-lab-evidence-2": 1,
  });
});
