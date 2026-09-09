import type { UiQuestion, UiRowAnswer } from "../learner-contracts.js";

const normalize = (value: string): string => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** Only grade objective work locally. Null means the tutor must assess it. */
export function gradeTerminalAnswer(question: UiQuestion, answer: string | string[] | UiRowAnswer[]): boolean | null {
  const expected = question.correctAnswers ?? (question.correctAnswer !== undefined ? [question.correctAnswer] : []);
  const choiceId = (value: string): string => {
    const choice = question.choices?.find((item) => item.id === value || normalize(item.label) === normalize(value));
    return choice?.id ?? normalize(value);
  };
  if (question.kind === "classification" || question.kind === "matching") {
    if (question.requireReasons || !question.correctMatches?.length || !Array.isArray(answer)) return null;
    return answer.length === question.correctMatches.length && answer.every((row, index) =>
      typeof row !== "string" && row.item === question.items?.[index] && choiceId(row.optionId) === choiceId(question.correctMatches![index]!));
  }
  if (!expected.length) return null;
  if (question.multiSelect || question.kind === "multi_select") {
    const values = Array.isArray(answer) ? answer : answer.split(",").map((value) => value.trim());
    if (!values.every((value): value is string => typeof value === "string")) return false;
    const selected = new Set(values.map(choiceId));
    const key = new Set(expected.map(choiceId));
    return selected.size === key.size && [...key].every((value) => selected.has(value));
  }
  if (question.kind === "blanks" || question.kind === "fill_in") {
    const values = Array.isArray(answer) ? answer : answer.split("\n");
    return values.length === expected.length && values.every((value, index) => typeof value === "string" && normalize(value) === normalize(expected[index]!));
  }
  if (question.choices?.length || question.kind === "true_false" || question.kind === "slider") {
    return typeof answer === "string" && expected.some((value) => choiceId(value) === choiceId(answer));
  }
  return null;
}
