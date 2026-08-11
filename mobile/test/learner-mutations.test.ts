import { describe, expect, test } from "bun:test";
import {
  initialSrsState,
  validatePortableLearnerData,
  type PortableLearnerData,
} from "@keating/learner-contracts";
import {
  appendQuestionChecks,
  appendQuizResult,
  ensureLearnerGoal,
  recordCardReview,
  setStudyPriority,
  updateGoalStep,
} from "../src/lib/learner-mutations";

const CREATED = "2026-08-01T00:00:00.000Z";
const NOW = "2026-08-10T12:00:00.000Z";
const RETRY_AT = "2026-08-11T12:00:00.000Z";

function source(overrides: Partial<PortableLearnerData> = {}): PortableLearnerData {
  return {
    generatedAt: CREATED,
    sessions: [],
    artifacts: [{ id: "artifact-imported", kind: "document", format: "text", title: "Imported", content: "keep", createdAt: CREATED, updatedAt: CREATED }],
    goals: [{
      id: "goal-1",
      title: "Learn biology",
      description: "A goal",
      updatedAt: CREATED,
      steps: [{ id: "step-1", title: "Recall", status: "not_started", successCriteria: ["name it"] }, {
        id: "step-2", title: "Apply", status: "in_progress", successCriteria: ["use it"] }],
    }],
    questionChecks: [{ id: "check-imported", topic: "Biology", question: "q", answer: "a", createdAt: CREATED, grading: "pending" }],
    quizResults: [],
    decks: [{
      id: "deck-1",
      title: "Biology deck",
      topic: "Biology",
      createdAt: CREATED,
      updatedAt: CREATED,
      cards: [{ id: "card-1", front: "Cell", back: "Unit", tags: [], srs: initialSrsState(CREATED) }, {
        id: "card-untouched", front: "DNA", back: "Code", tags: [], srs: initialSrsState(CREATED) }],
    }, {
      id: "deck-imported",
      title: "History deck",
      topic: "History",
      createdAt: CREATED,
      updatedAt: CREATED,
      cards: [{ id: "card-history", front: "Date", back: "Event", tags: [], srs: initialSrsState(CREATED) }],
    }],
    cardReviews: [],
    studyPriorities: [{ id: "priority-imported", targetType: "topic", targetId: "History", priority: "maintain", updatedAt: CREATED }],
    feedbackEvents: [],
    usageEvents: [],
    topicEvidence: [],
    benchmarks: [],
    evolutions: [],
    learnerProfile: { topicsExplored: ["History"], strengths: [], weaknesses: [], sessionsCount: 0 },
    ...overrides,
  };
}

describe("portable learner semantic mutations", () => {
  test("updates exactly one goal step and leaves imported records in place", () => {
    const data = source();
    const next = updateGoalStep(data, "goal-1", "step-1", "done", NOW);
    expect(next.generatedAt).toBe(NOW);
    expect(next.goals[0]).toMatchObject({ updatedAt: NOW, steps: [{ id: "step-1", status: "done" }, { id: "step-2", status: "in_progress" }] });
    expect(next.artifacts).toEqual(data.artifacts);
    expect(next.decks).toEqual(data.decks);
    expect(validatePortableLearnerData(next)).toBe(true);
  });

  test("fails closed for missing or stale targets without mutating its input", () => {
    const data = source();
    const before = structuredClone(data);
    expect(() => updateGoalStep(data, "missing-goal", "step-1", "done", NOW)).toThrow("does not exist");
    expect(() => updateGoalStep(data, "goal-1", "missing-step", "done", NOW)).toThrow("does not exist");
    expect(() => recordCardReview(data, "deck-1", "missing-card", 3, "review-1", NOW)).toThrow("does not exist");
    expect(() => setStudyPriority(data, "deck", "missing-deck", "focus", "priority-new", NOW)).toThrow("invalid");
    expect(data).toEqual(before);
  });

  test("updates one deck/card, appends one canonical review, and preserves all other records", () => {
    const data = source();
    const result = recordCardReview(data, "deck-1", "card-1", 3, "review-1", NOW);
    expect(result.data.generatedAt).toBe(NOW);
    expect(result.data.cardReviews).toHaveLength(1);
    expect(result.review).toMatchObject({
      id: "review-1",
      deckId: "deck-1",
      cardId: "card-1",
      rating: 3,
      createdAt: NOW,
      appliedIntervalDays: 1,
      repetitionsAfter: 1,
      lapsesAfter: 0,
    });
    expect(result.data.decks[0]?.cards[0]?.srs).toMatchObject({ lastReviewedAt: NOW, lastRating: 3, repetitions: 1 });
    expect(result.data.decks[0]?.cards[1]).toEqual(data.decks[0]?.cards[1]);
    expect(result.data.decks[1]).toEqual(data.decks[1]);
    expect(result.data.goals).toEqual(data.goals);
    expect(result.data.questionChecks).toEqual(data.questionChecks);
    expect(result.data.artifacts).toEqual(data.artifacts);
    expect(validatePortableLearnerData(result.data)).toBe(true);
    expect(() => recordCardReview(result.data, "deck-1", "card-1", 2, "review-1", NOW)).toThrow("already exists");
  });

  test("reuses an existing semantic priority id and changes no other priority", () => {
    const data = source({
      studyPriorities: [{ id: "priority-deck", targetType: "deck", targetId: "deck-1", priority: "low", updatedAt: CREATED }, {
        id: "priority-imported", targetType: "topic", targetId: "History", priority: "maintain", updatedAt: CREATED,
      }],
    });
    const result = setStudyPriority(data, "deck", "deck-1", "focus", "caller-id-ignored", NOW);
    expect(result.record).toEqual({ id: "priority-deck", targetType: "deck", targetId: "deck-1", priority: "focus", updatedAt: NOW });
    expect(result.data.studyPriorities).toEqual([result.record, data.studyPriorities[1]]);
    expect(result.data.generatedAt).toBe(NOW);
    expect(validatePortableLearnerData(result.data)).toBe(true);
  });

  test("creates a priority for an exact valid target while retaining imported choices", () => {
    const data = source();
    const result = setStudyPriority(data, "goal", "goal-1", "focus", "priority-goal", NOW);
    expect(result.data.studyPriorities.map((record) => record.id)).toEqual(["priority-imported", "priority-goal"]);
    expect(result.record.targetType).toBe("goal");
    expect(result.data.decks).toEqual(data.decks);
    expect(validatePortableLearnerData(result.data)).toBe(true);
  });

  test("inserts a completed goal card once and never overwrites learner progress on retry", () => {
    const data = source();
    const incoming = {
      id: "goal-card",
      title: "Learn history",
      description: "Imported card",
      updatedAt: NOW,
      steps: [{ id: "history-step", title: "Read", status: "not_started" as const, successCriteria: ["summarize"] }],
    };
    const inserted = ensureLearnerGoal(data, incoming, NOW);
    const retried = ensureLearnerGoal(inserted, {
      ...incoming,
      updatedAt: RETRY_AT,
      steps: [{ ...incoming.steps[0]!, status: "done" }],
    }, RETRY_AT);
    expect(retried).toBe(inserted);
    expect(retried.goals.find((goal) => goal.id === "goal-card")?.steps[0]?.status).toBe("not_started");
    expect(inserted.goals.map((goal) => goal.id)).toEqual(["goal-1", "goal-card"]);
    const divergent = {
      ...incoming,
      title: "A materially different goal",
    };
    const beforeConflict = structuredClone(inserted);
    expect(() => ensureLearnerGoal(inserted, divergent, RETRY_AT)).toThrow("identity conflict");
    expect(inserted).toEqual(beforeConflict);
    expect(inserted.artifacts).toEqual(data.artifacts);
    expect(validatePortableLearnerData(inserted)).toBe(true);
  });

  test("appends quiz evidence exactly once and rejects same-id divergence", () => {
    const data = source();
    const quiz = {
      id: "quiz-card",
      topic: "Biology",
      createdAt: NOW,
      score: 3,
      totalQuestions: 4,
      answers: {},
    };
    const appended = appendQuizResult(data, quiz, NOW);
    expect(appendQuizResult(appended, { ...quiz, createdAt: RETRY_AT }, RETRY_AT)).toBe(appended);
    expect(appended.quizResults).toEqual([quiz]);
    expect(() => appendQuizResult(appended, { ...quiz, score: 2, createdAt: RETRY_AT }, RETRY_AT)).toThrow("identity conflict");
    expect(() => appendQuizResult(appended, {
      ...quiz,
      partialCreditPoints: (quiz.partialCreditPoints ?? quiz.score) + 0.25,
      createdAt: RETRY_AT,
    }, RETRY_AT)).toThrow("identity conflict");
    expect(appended.studyPriorities).toEqual(data.studyPriorities);
    expect(validatePortableLearnerData(appended)).toBe(true);
  });

  test("appends question-check batches atomically, in input order, and tolerates exact retries", () => {
    const data = source();
    const first = { id: "check-a", topic: "Biology", question: "a", answer: "a", createdAt: NOW, grading: "auto" as const, score: 1 };
    const second = { id: "check-b", topic: "Biology", question: "b", answer: "b", createdAt: NOW, grading: "pending" as const };
    const conflict = { ...data.questionChecks[0]!, answer: "different" };
    const beforeFailure = structuredClone(data);
    expect(() => appendQuestionChecks(data, [first, conflict], NOW)).toThrow("identity conflict");
    expect(data).toEqual(beforeFailure);

    const appended = appendQuestionChecks(data, [first, second], NOW);
    expect(appended.questionChecks.map((check) => check.id)).toEqual(["check-imported", "check-a", "check-b"]);
    expect(appendQuestionChecks(appended, [{ ...first, createdAt: RETRY_AT }, { ...second, createdAt: RETRY_AT }], RETRY_AT)).toBe(appended);
    expect(() => appendQuestionChecks(appended, [{ ...first, answer: "changed", createdAt: RETRY_AT }], RETRY_AT)).toThrow("identity conflict");
    expect(appended.decks).toEqual(data.decks);
    expect(appended.goals).toEqual(data.goals);
    expect(validatePortableLearnerData(appended)).toBe(true);
  });
});
