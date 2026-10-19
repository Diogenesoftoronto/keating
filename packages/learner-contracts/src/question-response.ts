/** Serialize learner answer state without applying platform readiness policy. */
import type { UiQuestion, UiQuestionGroupResponse } from "./ui.js";

export function questionResponse(
  question: UiQuestion,
  answer: string,
  selected: string[],
  blankAnswers: string[],
  rowSelections: string[],
  rowReasons: string[],
  order: string[] = [],
): UiQuestionGroupResponse {
  if (question.kind === "ordering") return { questionId: question.id, type: "order", items: order };
  if (question.kind === "classification" || question.kind === "matching") return {
    questionId: question.id,
    type: "rows",
    rows: (question.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(question.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) })),
  };
  if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: blankAnswers };
  if (question.choices) return { questionId: question.id, type: "choice", optionIds: selected, ...(question.allowText ? { text: answer } : {}) };
  return { questionId: question.id, type: "text", answer };
}
