import { describe, expect, test } from "bun:test";
import { objectiveCredit, type UiQuestion } from "@keating/learner-contracts";
import { answerForQuizResponse, questionResponse, quizResponseForAnswer } from "../src/lib/quiz-responses";

describe("mobile quiz response submission and restoration", () => {
  const ordering: UiQuestion = { id: "order", kind: "ordering", prompt: "Order the steps", items: ["check", "plan", "do"], correctAnswers: ["plan", "do", "check"] };
  test("the moved order is submitted, graded, and restored unchanged", () => {
    const response = questionResponse(ordering, "", [], [], [], [], ["plan", "do", "check"]);
    expect(response.type).toBe("order");
    const answer = answerForQuizResponse(response);
    expect(answer).toBe("plan,do,check");
    expect(objectiveCredit(ordering, answer)).toBe(1);
    expect(quizResponseForAnswer(ordering, answer)).toEqual(response);
    expect(objectiveCredit(ordering, answerForQuizResponse(questionResponse(ordering, "", [], [], [], [], ordering.items!)))).toBe(0);
  });
  test("text, multiple choice, and blank responses preserve their answer shape", () => {
    const cases: Array<{ question: UiQuestion; response: ReturnType<typeof questionResponse> }> = [
      { question: { id: "text", kind: "short_answer", prompt: "Explain" }, response: { questionId: "text", type: "text", answer: "Because it follows" } },
      { question: { id: "choice", kind: "multi_select", prompt: "Choose", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }, response: { questionId: "choice", type: "choice", optionIds: ["a", "b"] } },
      { question: { id: "blank", kind: "fill_in", prompt: "Fill ___", blanks: [{ id: "one" }] }, response: { questionId: "blank", type: "blanks", answers: ["answer"] } },
    ];
    for (const { question, response } of cases) expect(quizResponseForAnswer(question, answerForQuizResponse(response))).toEqual(response);
  });
});
