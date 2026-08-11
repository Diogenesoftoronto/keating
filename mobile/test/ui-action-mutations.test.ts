import { describe, expect, test } from "bun:test";
import type { PortableLearnerData, UiAction, UiDocument } from "@keating/learner-contracts";
import { applyLocalUiAction, uiActionLearnerMessage } from "../src/lib/ui-action-mutations";

const AT = "2026-08-10T00:00:00.000Z";
const empty: PortableLearnerData = {
  generatedAt: AT, sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
  studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
  learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
};

function document(nodes: UiDocument["nodes"]): UiDocument {
  return { schemaVersion: 1, id: "document-1", revision: 0, lifecycle: "ready", supportedSurfaces: ["mobile"], nodes, createdAt: AT, updatedAt: AT };
}

describe("native OpenUI semantic actions", () => {
  test("persists answers and produces a learner turn", () => {
    const source = document([{ type: "question", id: "question-1", prompt: "What changed?", choices: [{ id: "evidence", label: "The evidence" }] }]);
    const action: UiAction = { schemaVersion: 1, type: "choose-option", documentId: source.id, documentRevision: 0, nodeId: "question-1", optionIds: ["evidence"], idempotencyKey: "answer-1" };
    const result = applyLocalUiAction(empty, action, source, AT);
    expect(result.data.questionChecks[0]).toMatchObject({ answer: "The evidence" });
    expect(result.resultingDocument).toMatchObject({ revision: 1, lifecycle: "ready" });
    expect(uiActionLearnerMessage(action, source)).toContain("The evidence");
  });

  test("creates a due deck and records a card rating", () => {
    const source = document([{ type: "deck", id: "deck-node", title: "Bayes", topic: "Bayes", cards: [{ id: "card-1", front: "Prior?", back: "Belief before evidence" }] }]);
    const action: UiAction = { schemaVersion: 1, type: "rate-card", documentId: source.id, documentRevision: 0, nodeId: "deck-node", cardId: "card-1", rating: 2, idempotencyKey: "rating-1" };
    const result = applyLocalUiAction(empty, action, source, AT);
    expect(result.data.decks).toHaveLength(1);
    expect(result.data.cardReviews).toHaveLength(1);
    expect(result.data.cardReviews[0]?.sessionId).toBeUndefined();
    expect(result.data.decks[0]?.cards[0]?.srs.intervalDays).toBe(1);
  });

  test("updates goal nodes and saves resources", () => {
    const goalSource = document([{ type: "goal", id: "goal-node", title: "Learn", status: "active", steps: [{ id: "step-1", title: "Explain", status: "not_started" }] }]);
    const goalAction: UiAction = { schemaVersion: 1, type: "complete-goal-step", documentId: goalSource.id, documentRevision: 0, nodeId: "goal-node", stepId: "step-1", idempotencyKey: "goal-1" };
    const goalResult = applyLocalUiAction(empty, goalAction, goalSource, AT);
    expect(goalResult.data.goals[0]?.steps[0]?.status).toBe("done");
    expect(goalResult.resultingDocument.lifecycle).toBe("ready");

    const artifactSource = document([{ type: "artifact", id: "artifact-node", resource: { id: "resource-1", title: "Notes", format: "markdown", content: "# Bayes" } }]);
    const artifactAction: UiAction = { schemaVersion: 1, type: "save-artifact", documentId: artifactSource.id, documentRevision: 0, nodeId: "artifact-node", idempotencyKey: "save-1" };
    const artifactResult = applyLocalUiAction(empty, artifactAction, artifactSource, AT);
    expect(artifactResult.data.artifacts[0]).toMatchObject({ title: "Notes", format: "markdown" });
  });

  test("persists structured study-plan progress and notes without losing sibling nodes", () => {
    const source = document([
      { type: "study-plan", id: "plan-node", title: "Bayes plan", items: [{ id: "plan-foundation", title: "Build the model", status: "not_started", children: [{ id: "plan-retrieve", title: "Retrieve it", status: "not_started" }] }] },
      { type: "notes", id: "notes-node", title: "Learner notes", value: "Initial model" },
    ]);
    const planAction: UiAction = { schemaVersion: 1, type: "complete-plan-item", documentId: source.id, documentRevision: 0, nodeId: "plan-node", itemId: "plan-retrieve", completed: true, idempotencyKey: "plan-progress-1" };
    const afterPlan = applyLocalUiAction(empty, planAction, source, AT);
    expect(afterPlan.data.artifacts[0]).toMatchObject({ kind: "study-plan", format: "json", title: "Bayes plan" });
    const plan = afterPlan.resultingDocument.nodes[0];
    expect(plan?.type === "study-plan" ? plan.items?.[0]?.children?.[0]?.status : undefined).toBe("done");

    const notesAction: UiAction = { schemaVersion: 1, type: "update-notes", documentId: source.id, documentRevision: 1, nodeId: "notes-node", value: "Evidence updates belief.", idempotencyKey: "notes-update-1" };
    const afterNotes = applyLocalUiAction(afterPlan.data, notesAction, afterPlan.resultingDocument, AT);
    expect(afterNotes.data.artifacts).toHaveLength(2);
    expect(afterNotes.data.artifacts[1]).toMatchObject({ kind: "note", format: "markdown", content: "Evidence updates belief." });
    const notes = afterNotes.resultingDocument.nodes[1];
    expect(notes?.type === "notes" ? notes.value : undefined).toBe("Evidence updates belief.");
  });

  test("persists structured answer arrays for blanks and matching", () => {
    const source = document([{ type: "question", id: "question-matching", kind: "matching", prompt: "Match the terms.", items: ["prior", "posterior"], choices: [{ id: "before", label: "Before" }, { id: "after", label: "After" }] }]);
    const action: UiAction = { schemaVersion: 1, type: "submit-answer", documentId: source.id, documentRevision: 0, nodeId: "question-matching", answer: [{ item: "prior", optionId: "before" }, { item: "posterior", optionId: "after" }], idempotencyKey: "matching-answer-1" };
    const result = applyLocalUiAction(empty, action, source, AT);
    expect(JSON.parse(result.data.questionChecks[0]?.answer ?? "null")).toEqual(action.answer);
  });

  test("materializes an ordered, lossless question-group batch exactly once", () => {
    const source = document([{
      type: "question-group",
      id: "group-1",
      title: "Bayes diagnostic",
      topic: "Bayes",
      questions: [
        { id: "group-text", kind: "short_answer", prompt: "What is a prior?", correctAnswer: "A belief before evidence." },
        { id: "group-choice", kind: "choice", prompt: "Which updates the belief?", choices: [{ id: "evidence", label: "Evidence" }], correctAnswers: ["evidence"], allowText: true },
        { id: "group-rows", kind: "matching", prompt: "Match the terms.", items: ["prior", "posterior"], choices: [{ id: "before", label: "Before" }, { id: "after", label: "After" }], correctMatches: ["before", "after"] },
      ],
    }]);
    const action: UiAction = {
      schemaVersion: 1,
      type: "submit-question-group",
      documentId: source.id,
      documentRevision: 0,
      nodeId: "group-1",
      responses: [
        { questionId: "group-text", type: "text", answer: "A belief before evidence." },
        { questionId: "group-choice", type: "choice", optionIds: ["evidence"], text: "Observed data." },
        { questionId: "group-rows", type: "rows", rows: [{ item: "prior", optionId: "before" }, { item: "posterior", optionId: "after" }] },
      ],
      idempotencyKey: "group-submit-1",
    };
    const first = applyLocalUiAction(empty, action, source, AT);
    const replay = applyLocalUiAction(first.data, action, source, "2026-08-10T00:01:00.000Z");
    expect(first.data.questionChecks.map((check) => check.question)).toEqual(["What is a prior?", "Which updates the belief?", "Match the terms."]);
    expect(first.data.questionChecks[1]).toMatchObject({ answer: "Evidence\nObserved data.", grading: "auto", score: 1 });
    expect(first.data.questionChecks[2]).toMatchObject({ answer: "prior: Before\nposterior: After", grading: "auto", score: 1 });
    expect(replay.data.questionChecks).toHaveLength(3);
    expect(uiActionLearnerMessage(action, source)).toContain("Bayes diagnostic");
  });

  test("materializes one aggregate quiz result with its supplied outcome fields", () => {
    const source = document([{ type: "quiz", id: "quiz-1", title: "Bayes quiz", questions: [
      { id: "quiz-prior", kind: "short_answer", prompt: "What is a prior?" },
      { id: "quiz-posterior", kind: "short_answer", prompt: "What changes?" },
    ] }]);
    const action: UiAction = {
      schemaVersion: 1,
      type: "complete-quiz",
      documentId: source.id,
      documentRevision: 0,
      nodeId: "quiz-1",
      resultId: "quiz-result-1",
      answers: [{ questionId: "quiz-prior", answer: "A belief." }, { questionId: "quiz-posterior", answer: "Evidence." }],
      score: 1,
      partialCreditPoints: 1.5,
      partialCredits: { "quiz-prior": 1, "quiz-posterior": 0.5 },
      timing: { totalMs: 1200, perQuestionMs: { "quiz-prior": 600, "quiz-posterior": 600 } },
      flaggedQuestionIds: ["quiz-posterior"],
      pendingGradeQuestionIds: ["quiz-posterior"],
      skippedQuestionIds: [],
      idempotencyKey: "quiz-complete-1",
    };
    const first = applyLocalUiAction(empty, action, source, AT);
    const replay = applyLocalUiAction(first.data, action, source, "2026-08-10T00:01:00.000Z");
    expect(first.data.questionChecks).toHaveLength(0);
    expect(first.data.quizResults).toHaveLength(1);
    expect(first.data.quizResults[0]).toMatchObject({
      topic: "Bayes quiz",
      score: 1,
      totalQuestions: 2,
      answers: { "quiz-prior": "A belief.", "quiz-posterior": "Evidence." },
      partialCreditPoints: 1.5,
      partialCredits: { "quiz-prior": 1, "quiz-posterior": 0.5 },
      timing: { totalMs: 1200, perQuestionMs: { "quiz-prior": 600, "quiz-posterior": 600 } },
      flaggedQuestionIds: ["quiz-posterior"],
      pendingGradeQuestionIds: ["quiz-posterior"],
      skippedQuestionIds: [],
    });
    expect(replay.data.quizResults).toHaveLength(1);
    expect(uiActionLearnerMessage(action, source)).toContain("Bayes quiz");
  });

  test("applies a declared deck completion atomically and rejects a conflicting replay", () => {
    const source = document([{ type: "deck", id: "deck-1", title: "Bayes cards", topic: "Bayes", cards: [
      { id: "card-prior", front: "Prior?", back: "Belief before evidence" },
      { id: "card-posterior", front: "Posterior?", back: "Belief after evidence" },
    ] }]);
    const action: UiAction = {
      schemaVersion: 1,
      type: "complete-deck",
      documentId: source.id,
      documentRevision: 0,
      nodeId: "deck-1",
      ratings: [
        { cardId: "card-prior", rating: 2, appliedIntervalDays: 6, easeAfter: 2.5 },
        { cardId: "card-posterior", rating: 0, appliedIntervalDays: 0, easeAfter: 2.3 },
      ],
      summary: { reviewed: 2, lapses: 1 },
      idempotencyKey: "deck-complete-1",
    };
    const first = applyLocalUiAction(empty, action, source, AT);
    const replay = applyLocalUiAction(first.data, action, source, "2026-08-10T00:01:00.000Z");
    expect(first.data.decks).toHaveLength(1);
    expect(first.data.cardReviews).toHaveLength(2);
    expect(first.data.decks[0]?.cards.map((card) => card.srs.intervalDays)).toEqual([6, 0]);
    expect(first.data.cardReviews.map((review) => review.nextDueAt)).toEqual(["2026-08-16T00:00:00.000Z", "2026-08-10T00:10:00.000Z"]);
    expect(replay.data.cardReviews).toHaveLength(2);
    expect(() => applyLocalUiAction(first.data, { ...action, ratings: [{ ...action.ratings[0]!, rating: 3 }, action.ratings[1]! ] }, source, AT)).toThrow("conflicts");
    expect(uiActionLearnerMessage(action, source)).toContain("Bayes cards");
  });

  test("keeps sibling nodes interactive after a durable action", () => {
    const source = document([
      { type: "question", id: "question-1", prompt: "First?" },
      { type: "question", id: "question-2", prompt: "Second?" },
      { type: "artifact", id: "artifact-node", resource: { id: "resource-1", title: "Notes", format: "markdown", content: "# Notes" } },
    ]);
    const answer: UiAction = { schemaVersion: 1, type: "submit-answer", documentId: source.id, documentRevision: 0, nodeId: "question-1", answer: "One", idempotencyKey: "answer-first" };
    const afterAnswer = applyLocalUiAction(empty, answer, source, AT);
    expect(afterAnswer.resultingDocument.lifecycle).toBe("ready");
    const save: UiAction = { schemaVersion: 1, type: "save-artifact", documentId: source.id, documentRevision: 1, nodeId: "artifact-node", idempotencyKey: "save-notes" };
    const afterSave = applyLocalUiAction(afterAnswer.data, save, afterAnswer.resultingDocument, AT);
    expect(afterSave.resultingDocument.lifecycle).toBe("ready");
    expect(afterSave.resultingDocument.nodes.find((node) => node.id === "question-2")).toBeDefined();
  });
});
