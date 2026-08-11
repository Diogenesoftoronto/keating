import { describe, expect, test } from "bun:test";
import type { UiActionJournal, UiDocument } from "@keating/learner-contracts";
import {
  completedDeckAction,
  completedNodeAction,
  completedQuestionAction,
  completedQuestionGroupAction,
  completedQuestionGroupResponse,
  completedQuizAction,
  completedUiActions,
  latestUiDocument,
  reviewedDeckCardIds,
} from "../src/lib/ui-render-state";

const source: UiDocument = {
  schemaVersion: 1,
  id: "quiz-doc",
  revision: 0,
  lifecycle: "ready",
  supportedSurfaces: ["mobile"],
  nodes: [{ type: "question", id: "question-1", prompt: "Why?" }],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

function journal(state: "pending" | "completed" = "completed"): UiActionJournal {
  const action = {
    schemaVersion: 1 as const,
    type: "submit-answer" as const,
    documentId: source.id,
    documentRevision: 0,
    nodeId: "question-1",
    answer: "Because the evidence changed.",
    idempotencyKey: "answer-1",
  };
  return {
    kind: "keating-ui-action-journal",
    schemaVersion: 1,
    documentId: source.id,
    receipts: [{
      schemaVersion: 1,
      action,
      actionFingerprint: "fingerprint",
      state,
      createdAt: source.createdAt,
      updatedAt: "2026-08-10T00:01:00.000Z",
      ...(state === "completed" ? { result: {
        schemaVersion: 1 as const,
        documentId: source.id,
        sourceRevision: 0,
        actionIdempotencyKey: action.idempotencyKey,
        status: "completed" as const,
        documentLifecycle: "completed" as const,
        resultingDocument: { ...source, revision: 1, lifecycle: "completed" as const, updatedAt: "2026-08-10T00:01:00.000Z" },
      } } : {}),
    }],
  };
}

describe("OpenUI durable render state", () => {
  test("restores the newest completed document and submitted answer", () => {
    const stored = journal();
    expect(latestUiDocument(stored, source).revision).toBe(1);
    const actions = completedUiActions(stored);
    expect(actions).toHaveLength(1);
    expect(completedQuestionAction(actions, "question-1")).toMatchObject({ answer: "Because the evidence changed." });
  });

  test("does not expose pending action state as completed UI", () => {
    const stored = journal("pending");
    expect(latestUiDocument(stored, source)).toEqual(source);
    expect(completedUiActions(stored)).toEqual([]);
  });

  test("projects saved resources and reviewed deck cards from durable actions", () => {
    const actions = [
      { schemaVersion: 1 as const, type: "save-artifact" as const, documentId: source.id, documentRevision: 1, nodeId: "artifact-1", idempotencyKey: "save-1" },
      { schemaVersion: 1 as const, type: "rate-card" as const, documentId: source.id, documentRevision: 2, nodeId: "deck-1", cardId: "card-1", rating: 2 as const, idempotencyKey: "rate-1" },
      {
        schemaVersion: 1 as const,
        type: "complete-deck" as const,
        documentId: source.id,
        documentRevision: 3,
        nodeId: "deck-1",
        ratings: [{ cardId: "card-2", rating: 0 as const, appliedIntervalDays: 0, easeAfter: 2.3 }],
        summary: { reviewed: 1, lapses: 1 },
        idempotencyKey: "deck-complete-1",
      },
    ];
    expect(completedNodeAction(actions, "artifact-1", "save-artifact")).toBe(true);
    expect(completedNodeAction(actions, "artifact-2", "save-artifact")).toBe(false);
    expect(completedDeckAction(actions, "deck-1")).toMatchObject({ idempotencyKey: "deck-complete-1" });
    expect([...reviewedDeckCardIds(actions, "deck-1")]).toEqual(["card-1", "card-2"]);
  });

  test("discovers question-group and quiz completions from aggregate receipts", () => {
    const actions = [
      {
        schemaVersion: 1 as const,
        type: "submit-question-group" as const,
        documentId: source.id,
        documentRevision: 0,
        nodeId: "group-1",
        responses: [{ questionId: "group-question", type: "text" as const, answer: "All-or-nothing." }],
        idempotencyKey: "group-submit-1",
      },
      {
        schemaVersion: 1 as const,
        type: "complete-quiz" as const,
        documentId: source.id,
        documentRevision: 1,
        nodeId: "quiz-1",
        resultId: "result-1",
        answers: [{ questionId: "quiz-question", answer: "Committed together." }],
        score: 1,
        partialCreditPoints: 1,
        partialCredits: { "quiz-question": 1 },
        timing: { totalMs: 500, perQuestionMs: { "quiz-question": 500 } },
        flaggedQuestionIds: [],
        pendingGradeQuestionIds: [],
        skippedQuestionIds: [],
        idempotencyKey: "quiz-complete-1",
      },
    ];
    expect(completedQuestionGroupAction(actions, "group-1")).toMatchObject({ idempotencyKey: "group-submit-1" });
    expect(completedQuestionGroupResponse(actions, "group-1", "group-question")).toEqual({ questionId: "group-question", type: "text", answer: "All-or-nothing." });
    expect(completedQuestionGroupResponse(actions, "group-1", "missing-question")).toBeUndefined();
    expect(completedQuizAction(actions, "quiz-1")).toMatchObject({ resultId: "result-1" });
    expect(completedNodeAction(actions, "quiz-1", "complete-quiz")).toBe(true);
  });
});
