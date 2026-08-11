import { describe, expect, test } from "bun:test";
import { validateUiAction } from "@keating/learner-contracts";

describe("UiDocumentRenderer aggregate actions", () => {
  test("accepts the ordered aggregate question-group payload rendered natively", () => {
    const action = {
      schemaVersion: 1 as const, type: "submit-question-group" as const, documentId: "aggregate-renderer-document", documentRevision: 4, nodeId: "group-1", idempotencyKey: "group-aggregate-1",
      responses: [
        { questionId: "question-first", type: "choice" as const, optionIds: ["option-a"] },
        { questionId: "question-second", type: "text" as const, answer: "An explanation" },
      ],
    };
    expect(validateUiAction(action)).toBe(true);
    expect(action.responses.map((response) => response.questionId)).toEqual(["question-first", "question-second"]);
  });

  test("accepts every terminal quiz field in source-question order", () => {
    const action = {
      schemaVersion: 1 as const, type: "complete-quiz" as const, documentId: "aggregate-renderer-document", documentRevision: 4, nodeId: "quiz-1", idempotencyKey: "quiz-aggregate-1",
      resultId: "quiz-1-result",
      answers: [{ questionId: "first", answer: "a" }, { questionId: "second", answer: "b" }],
      score: 1,
      partialCreditPoints: 1,
      partialCredits: { first: 1, second: 0 },
      timing: { totalMs: 2500, perQuestionMs: { first: 700, second: 1600 } },
      flaggedQuestionIds: [],
      pendingGradeQuestionIds: [],
      skippedQuestionIds: [],
    };
    expect(validateUiAction(action)).toBe(true);
    expect(action.answers.map((answer) => answer.questionId)).toEqual(["first", "second"]);
  });

  test("accepts the ordered single deck-completion payload", () => {
    const action = {
      schemaVersion: 1 as const, type: "complete-deck" as const, documentId: "aggregate-renderer-document", documentRevision: 4, nodeId: "deck-1", idempotencyKey: "deck-aggregate-1",
      ratings: [
        { cardId: "card-first", rating: 2 as const, appliedIntervalDays: 1, easeAfter: 2.5 },
        { cardId: "card-second", rating: 0 as const, appliedIntervalDays: 0, easeAfter: 2.3 },
      ],
      summary: { reviewed: 2, lapses: 1 },
    };
    expect(validateUiAction(action)).toBe(true);
    expect(action.ratings.map((rating) => rating.cardId)).toEqual(["card-first", "card-second"]);
  });
});
