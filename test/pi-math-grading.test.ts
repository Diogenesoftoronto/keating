import { expect, test } from "bun:test";
import { teachingTools } from "../src/pi/hyper-teacher/tools/teaching.js";
import { pendingQuizResults } from "../src/pi/hyper-teacher/tools/shared.js";

const quizTool = teachingTools.find((tool) => tool.name === "quiz")!;
const gradeTool = teachingTools.find((tool) => tool.name === "grade_quiz")!;
const questions = [
  { question: "Untrusted prose", correctAnswer: "4", explanation: "Compute exactly.", mathProblem: { kind: "arithmetic", expression: "2+2" } },
  { question: "Explain why practice helps you remember a concept.", correctAnswer: "Retrieval strengthens memory.", explanation: "Practice retrieves knowledge.", type: "short_answer" },
];

test("native quiz verifies authored math before showing it", async () => {
  const valid = await quizTool.execute("quiz", { topic: "Arithmetic", questions }, undefined, undefined, {});
  expect(valid.isError).toBeUndefined();
  const quiz = (valid.details as any).quiz;
  expect(quiz.questions[0].mathProblem).toEqual(questions[0].mathProblem);
  expect(quiz.questions[0].question).not.toContain("Untrusted prose");
  const invalid = await quizTool.execute("quiz", { topic: "Arithmetic", questions: [{ ...questions[0], correctAnswer: "5" }, questions[1]] }, undefined, undefined, {});
  expect(invalid.isError).toBe(true);
});

test("native quiz excludes unsupported math and refuses model overrides", async () => {
  const initial = await quizTool.execute("quiz", { topic: "Arithmetic", questions }, undefined, undefined, {});
  const quiz = (initial.details as any).quiz;
  const mathId = quiz.questions.find((question: any) => question.mathProblem).id;
  const openId = quiz.questions.find((question: any) => !question.mathProblem).id;
  const result = await quizTool.execute("quiz", { topic: "Arithmetic", questions }, undefined, undefined, {
    hasUI: true, ui: { custom: async () => ({ [mathId]: "probably four", [openId]: "Practice retrieves knowledge." }) },
  });
  const details = result.details as any;
  try {
    expect(details.pendingMathIds).toEqual([mathId]);
    expect(details.objectiveResults[mathId]).toBeUndefined();
    const override = await gradeTool.execute("grade", { result_id: details.resultId, grades: [
      { question_id: mathId, verdict: "incorrect" }, { question_id: "invented-id", verdict: "correct" },
    ] }, undefined, undefined, {});
    expect(override.isError).toBe(true);
    expect(pendingQuizResults.has(details.resultId)).toBe(true);
    const reviewed = await gradeTool.execute("grade", { result_id: details.resultId, grades: [
      { question_id: mathId, verdict: "correct" }, { question_id: openId, verdict: "correct" },
    ] }, undefined, undefined, {});
    expect(reviewed.isError).toBeUndefined();
    expect((reviewed.details as any).openEndedGrades[mathId].note).toContain("Not independently checked");
    expect(pendingQuizResults.has(details.resultId)).toBe(false);
  } finally { pendingQuizResults.delete(details.resultId); }
});
