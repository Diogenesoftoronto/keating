import { objectiveCredit } from "../objective-quiz.js";
import { UI_CONTRACT_VERSION, validateUiDocument, type UiQuestion } from "../ui.js";

export const QUIZ_BOOSTING_TARGET = "quiz-correct-without-inapp-hint/v1" as const;
export const QUIZ_BOOSTING_FEATURE_SCHEMA = "cli-objective-quiz-performance/v1" as const;
export const QUIZ_BOOSTING_FEATURES = Object.freeze([
  "jevProbability", "choiceCount", "questionLength", "kind_choice",
  "kind_multiple_choice", "kind_multi_select", "kind_true_false", "kind_dropdown",
] as const);

/** Fixed pre-answer features for the objective kinds supported by CLI estimates.
 * The canonical answer key establishes eligibility only; it is never a feature.
 * Question length is UTF-16 code units, matching the UI contract's text bounds.
 * No learner response, hint exposure, timing, or observed outcome is accepted.
 */
export function extractQuizBoostingFeatures(question: UiQuestion, probability: number): Readonly<Record<string, number>> | null {
  try {
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1
      || !question || question.mathProblem !== undefined || !question.kind
      || !["choice", "multiple_choice", "multi_select", "true_false", "dropdown"].includes(question.kind)
      || !Array.isArray(question.choices) || !question.choices.length
      || (question.multiSelect && question.kind !== "multi_select")) return null;
    // Use the existing canonical nested-question validator without exporting or
    // duplicating its schema. The wrapper adds no learner state or measurements.
    if (!validateUiDocument({
      schemaVersion: UI_CONTRACT_VERSION, id: "quiz-boosting-validation", revision: 0,
      lifecycle: "ready", supportedSurfaces: ["terminal"],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [{ type: "quiz", id: question.id === "quiz-boosting-node" ? "quiz-boosting-node-other" : "quiz-boosting-node", title: "Feature validation", questions: [question] }],
    })) return null;
    const expected = question.kind === "multi_select" ? question.correctAnswers ?? [] : [question.correctAnswer ?? question.correctAnswers?.[0] ?? ""];
    if (!expected.length || !expected.every(answer => question.choices!.some(choice => choice.id === answer))
      || objectiveCredit(question, expected.join(",")) !== 1) return null;
    return Object.freeze({
      jevProbability: probability,
      choiceCount: question.choices.length,
      questionLength: question.prompt.length,
      kind_choice: Number(question.kind === "choice"),
      kind_multiple_choice: Number(question.kind === "multiple_choice"),
      kind_multi_select: Number(question.kind === "multi_select"),
      kind_true_false: Number(question.kind === "true_false"),
      kind_dropdown: Number(question.kind === "dropdown"),
    });
  } catch { return null; }
}
