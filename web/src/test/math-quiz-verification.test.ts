import { expect, test } from "bun:test";
import { compileOpenUISourceToSharedDocument, mathProblemPrompt, validateUiDocument, type MathProblem, type UiQuestion } from "@keating/learner-contracts";
import { buildAuthoredQuestions, resolveTopic } from "../keating/core";
import { quizOutcome, summarizeQuiz } from "../keating/openui/quiz-progress";
import { quizEvidenceScore } from "../keating/storage";

const problem: MathProblem = { kind: "linear-equation", left: "2*x+3", right: "11", variable: "x" };
const question: UiQuestion = { id: "q1", kind: "short_answer", prompt: mathProblemPrompt(problem), mathProblem: problem, correctAnswer: "4" };

test("question construction rejects bad keys and binds the prompt to verified math", () => {
  const authored = { question: "A misleading unrelated question", mathProblem: problem, correctAnswer: "4", explanation: "Subtract three and divide by two." };
  const [built] = buildAuthoredQuestions(resolveTopic("algebra"), [authored]);
  expect(built?.question).toBe(mathProblemPrompt(problem));
  expect(built?.mathProblem).toEqual(problem);
  expect(() => buildAuthoredQuestions(resolveTopic("algebra"), [{ ...authored, correctAnswer: "5" }])).toThrow("Math question rejected");
});

test("equivalent answers use exact verification and ignore contradictory model verdicts", () => {
  expect(quizOutcome(question, "8/2", { grades: [{ questionId: "q1", verdict: "incorrect" }] })).toEqual({ kind: "objective", correct: true });
  expect(quizOutcome(question, "5", { grades: [{ questionId: "q1", verdict: "correct" }] })).toEqual({ kind: "objective", correct: false });
  expect(quizOutcome(question, "four", { grades: [{ questionId: "q1", verdict: "incorrect" }] })).toEqual({ kind: "pending" });
  expect(summarizeQuiz([question], { q1: "four" }).decided).toBe(0);
  expect(quizOutcome({ ...question, correctAnswer: "5" }, "5")).toEqual({ kind: "pending" });
});

test("OpenUI compilation retains math, derives its prompt, and rejects wrong keys", () => {
  const source = (answer: string) => `root = LearningSurface([quiz], "Math")\nquiz = Quiz("quiz", "Math", [{id: "q1", type: "short_answer", level: "application", question: "Wrong prose", mathProblem: ${JSON.stringify(problem)}, correctAnswer: "${answer}", explanation: "Subtract then divide."}])`;
  const doc = compileOpenUISourceToSharedDocument(source("4"), { documentId: "math-test", createdAt: "2026-09-09T00:00:00Z" });
  const quiz = doc.nodes.find(node => node.type === "quiz");
  expect(quiz?.type).toBe("quiz");
  if (quiz?.type !== "quiz") throw new Error("Missing quiz");
  expect(quiz.questions[0]?.mathProblem).toEqual(problem);
  expect(quiz.questions[0]?.prompt).toBe(mathProblemPrompt(problem));
  expect(validateUiDocument(doc)).toBe(true);
  quiz.questions[0]!.prompt = "Different question";
  expect(validateUiDocument(doc)).toBe(false);
  expect(() => compileOpenUISourceToSharedDocument(source("5"), { documentId: "math-test", createdAt: "2026-09-09T00:00:00Z" })).toThrow();
});

test("model grades cannot inflate persisted independent math evidence", () => {
  expect(quizEvidenceScore({ id: "result", topic: "algebra", createdAt: 0, score: 0, totalQuestions: 1,
    mathVerification: { q1: { verifier: "exact-rational-v1", problem, status: "rejected", reason: "Wrong", prompt: question.prompt } },
    openEndedGrades: [{ questionId: "q1", verdict: "correct" }],
  })).toBe(0);
});
