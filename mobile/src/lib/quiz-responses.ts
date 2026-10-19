import type { UiQuestion, UiQuestionGroupResponse } from "@keating/learner-contracts";
export { questionResponse } from "@keating/learner-contracts";

export function answerForQuizResponse(response: UiQuestionGroupResponse): string {
  if (response.type === "text") return response.answer;
  if (response.type === "choice") return response.optionIds.join(",") || (response.text ?? "");
  if (response.type === "blanks") return response.answers.join(",");
  if (response.type === "order") return response.items.join(",");
  return response.rows.map((row) => `${row.item}:${row.optionId}${row.reason ? ` (${row.reason})` : ""}`).join("; ");
}

export function quizResponseForAnswer(question: UiQuestion, answer: string): UiQuestionGroupResponse {
  if (question.kind === "ordering") return { questionId: question.id, type: "order", items: answer ? answer.split(",") : [] };
  if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: answer ? answer.split(",") : [] };
  if (question.choices) return { questionId: question.id, type: "choice", optionIds: answer ? answer.split(",") : [] };
  return { questionId: question.id, type: "text", answer };
}

