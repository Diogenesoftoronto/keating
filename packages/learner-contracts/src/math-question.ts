import { mathProblemPrompt, validateMathProblem, verifyMathAnswer, type MathProblem } from "./math-verification.js";

/** Reject the question, never penalize the learner for a broken answer key. */
export function checkedMathQuestion(input: unknown, correctAnswer: string): { mathProblem: MathProblem; question: string } {
  const mathProblem = validateMathProblem(input);
  if (!mathProblem) throw new Error("Invalid mathProblem. Supply supported arithmetic or a linear equation.");
  const result = verifyMathAnswer(mathProblem, correctAnswer);
  if (result.status !== "verified") throw new Error(`Math question rejected: ${result.reason}`);
  return { mathProblem, question: mathProblemPrompt(mathProblem) };
}

export function mathQuestionCredit(question: { mathProblem?: MathProblem; correctAnswer?: string }, answer: string): number | undefined {
  if (!question.mathProblem || verifyMathAnswer(question.mathProblem, question.correctAnswer ?? "").status !== "verified") return undefined;
  const result = verifyMathAnswer(question.mathProblem, answer);
  return result.status === "verified" ? 1 : result.status === "rejected" ? 0 : undefined;
}
