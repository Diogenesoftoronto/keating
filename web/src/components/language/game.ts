import type { UiAction, UiLanguagePracticeNode, UiLanguageRound, UiLanguageRoundResult } from "@keating/learner-contracts";
import { normalizeLanguagePracticeAnswer } from "@keating/learner-contracts";

export type LanguageCompletion = Omit<Extract<UiAction, { type: "complete-language-practice" }>, "schemaVersion" | "documentId" | "documentRevision" | "idempotencyKey">;

/** Case and sentence punctuation are forgiving; accents and words still matter. */
export function normalizeLanguageAnswer(value: string): string {
  return normalizeLanguagePracticeAnswer(value);
}

export function checkLanguageAnswer(round: UiLanguageRound, answer: string | readonly string[]): boolean {
  if (round.kind === "pronunciation") return false;
  if (round.kind === "word-order") return Array.isArray(answer) && answer.length === round.correctOrder.length && answer.every((id, index) => id === round.correctOrder[index]);
  return typeof answer === "string" && round.acceptedAnswers.some((accepted) => normalizeLanguageAnswer(accepted) === normalizeLanguageAnswer(answer));
}

export function languageReferenceAnswer(round: UiLanguageRound): string {
  if (round.kind === "word-order") return round.correctOrder.map((id) => round.tokens.find((token) => token.id === id)?.label ?? "").join(" ");
  return round.kind === "pronunciation" ? round.text : round.acceptedAnswers[0] ?? round.text;
}

export function languageCompletion(node: UiLanguagePracticeNode, rounds: UiLanguageRoundResult[], totalMs: number): LanguageCompletion {
  return {
    type: "complete-language-practice",
    nodeId: node.id,
    rounds,
    correct: rounds.filter((round) => round.outcome === "correct").length,
    objectiveTotal: node.rounds.filter((round) => round.kind !== "pronunciation").length,
    pronunciationPracticed: rounds.filter((round) => round.outcome === "practiced").length,
    totalMs: Math.max(0, Math.round(totalMs)),
  };
}
