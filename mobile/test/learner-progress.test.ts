import { describe, expect, test } from "bun:test";
import { validateCardReviewRecord, validateFlashcardDeck, validatePortableLearnerData, type PortableLearnerData } from "@keating/learner-contracts";
import { buildLearnerProgress } from "../src/lib/learner-progress";

const T0 = "2026-08-10T00:00:00.000Z";
const T1 = "2026-08-10T01:00:00.000Z";
const T2 = "2026-08-10T02:00:00.000Z";
const NOW = Date.parse("2026-08-11T00:00:00.000Z");

function baseData(overrides: Partial<PortableLearnerData> = {}): PortableLearnerData {
  return {
    generatedAt: T2,
    sessions: [],
    artifacts: [],
    goals: [],
    questionChecks: [],
    quizResults: [],
    decks: [],
    cardReviews: [],
    studyPriorities: [],
    feedbackEvents: [],
    usageEvents: [],
    topicEvidence: [],
    benchmarks: [],
    evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
    ...overrides,
  };
}

function session(id: string, title: string) {
  return {
    id,
    title,
    createdAt: T0,
    updatedAt: T1,
    activeBranchId: `branch.${id}`,
    branches: [{ id: `branch.${id}`, sessionId: id, createdAt: T0, updatedAt: T1 }],
    messages: [{ id: `message.${id}`, role: "assistant" as const, content: "A tutor reply", createdAt: T1 }],
  };
}

describe("learner progress projection", () => {
  test("activity, a lesson title, feedback, and learner-recorded context never fabricate mastery", () => {
    const data = baseData({
      sessions: [session("session-title", "Title that must not become a score")],
      feedbackEvents: [{
        id: "feedback-1",
        sessionId: "session-title",
        messageId: "message.session-title",
        rating: "helpful",
        createdAt: T1,
      }],
      topicEvidence: [{
        id: "activity-1",
        topic: "Activity only",
        createdAt: T1,
        provenance: "session",
        reference: { kind: "session", id: "session-title" },
      }],
      learnerProfile: {
        topicsExplored: ["Context only"],
        strengths: ["Activity only"],
        weaknesses: ["Something else"],
        sessionsCount: 1,
      },
    });

    const dashboard = buildLearnerProgress(data, NOW);
    expect(dashboard.topics.map((topic) => topic.topic).sort()).toEqual(["Activity only", "Context only"]);
    expect(dashboard.topics.some((topic) => topic.topic.includes("Title that must"))).toBe(false);
    const activity = dashboard.topics.find((topic) => topic.topic === "Activity only")!;
    expect(activity).toMatchObject({
      activityCount: 1,
      feedbackCount: 1,
      mastery: null,
      retention: null,
      confidence: 0,
      evidenceCount: 0,
      status: "insufficient",
    });
    expect(dashboard.learnerRecordedContext.strengths).toEqual(["Activity only"]);
    expect(dashboard.derivedStrengthTopics).toEqual([]);
  });

  test("keeps pending checks visible while deriving mastery only from scored checks and normalized quizzes", () => {
    const data = baseData({
      questionChecks: [{
        id: "check-pending",
        topic: "Algebra",
        question: "pending",
        answer: "work",
        createdAt: T0,
        grading: "pending",
      }, {
        id: "check-scored",
        topic: "Algebra",
        question: "scored",
        answer: "work",
        createdAt: T1,
        grading: "model",
        score: 0.25,
      }],
      quizResults: [{
        id: "quiz-scored",
        topic: "Algebra",
        createdAt: T2,
        score: 3,
        totalQuestions: 4,
        answers: {},
      }],
    });

    const algebra = buildLearnerProgress(data, NOW).topics[0]!;
    expect(algebra.mastery).toBeCloseTo(0.55, 8);
    expect(algebra).toMatchObject({
      scoredEvidenceCount: 2,
      evidenceCount: 2,
      pendingAssessmentCount: 1,
      reviewCount: 0,
      retention: null,
      status: "developing",
      recentAssessedResult: { id: "quiz-scored", kind: "quiz-result", score: 0.75, createdAt: Date.parse(T2) },
    });
  });

  test("review-only evidence derives retention without inventing mastery", () => {
    const data = baseData({
      decks: [{
        id: "deck-review",
        title: "Review deck",
        topic: "Geometry",
        createdAt: T0,
        updatedAt: T1,
        cards: [{
          id: "card-review",
          front: "Angle",
          back: "Turn",
          tags: [],
          srs: {
            ease: 2.65,
            intervalDays: 1,
            repetitions: 1,
            lapses: 0,
            dueAt: "2026-08-11T01:00:00.000Z",
            lastReviewedAt: T1,
            lastRating: 3,
          },
        }],
      }],
      cardReviews: [{
        id: "review-1",
        deckId: "deck-review",
        cardId: "card-review",
        rating: 3,
        appliedIntervalDays: 1,
        easeAfter: 2.65,
        createdAt: T1,
        previousIntervalDays: 0,
        nextDueAt: "2026-08-11T01:00:00.000Z",
        repetitionsAfter: 1,
        lapsesAfter: 0,
        isLapse: false,
      }],
    });

    expect(validateFlashcardDeck(data.decks[0])).toBe(true);
    expect(validateCardReviewRecord(data.cardReviews[0])).toBe(true);
    expect(validatePortableLearnerData(data)).toBe(true);
    const geometry = buildLearnerProgress(data, NOW).topics[0]!;
    expect(geometry).toMatchObject({
      topic: "Geometry",
      mastery: null,
      retention: 1,
      scoredEvidenceCount: 0,
      reviewCount: 1,
      evidenceCount: 1,
      status: "insufficient",
    });
  });

  test("excludes pending open-ended credit from mixed quiz mastery", () => {
    const data = baseData({
      quizResults: [{
        id: "quiz-mixed",
        topic: "Vectors",
        createdAt: T2,
        score: 1.9,
        totalQuestions: 2,
        answers: { objective: "right", open: "provisional" },
        partialCredits: { objective: 1, open: 0.9 },
        pendingGradeQuestionIds: ["open"],
      }, {
        id: "quiz-all-pending",
        topic: "Proofs",
        createdAt: T2,
        score: 0.8,
        totalQuestions: 1,
        answers: { open: "provisional" },
        partialCredits: { open: 0.8 },
        pendingGradeQuestionIds: ["open"],
      }],
    });

    const dashboard = buildLearnerProgress(data, NOW);
    expect(dashboard.topics.find((topic) => topic.topic === "Vectors")).toMatchObject({
      mastery: 1,
      scoredEvidenceCount: 1,
      pendingAssessmentCount: 1,
      recentAssessedResult: { id: "quiz-mixed", score: 1 },
    });
    expect(dashboard.topics.find((topic) => topic.topic === "Proofs")).toMatchObject({
      mastery: null,
      scoredEvidenceCount: 0,
      pendingAssessmentCount: 1,
      recentAssessedResult: null,
      status: "insufficient",
    });
  });

  test("computes exact goal progress and preserves the stored next-step order", () => {
    const data = baseData({
      goals: [{
        id: "goal-1",
        title: "Learn calculus",
        description: "A bounded plan",
        updatedAt: T2,
        steps: [{ id: "step-done", title: "Recall", status: "done", successCriteria: ["name it"] }, {
          id: "step-current", title: "Apply", status: "in_progress", successCriteria: ["solve it"] }, {
          id: "step-later", title: "Transfer", status: "not_started", successCriteria: ["use it elsewhere"] }],
      }],
    });

    const goal = buildLearnerProgress(data, NOW).goals[0]!;
    expect(goal).toEqual({
      id: "goal-1",
      title: "Learn calculus",
      description: "A bounded plan",
      updatedAt: Date.parse(T2),
      completedSteps: 1,
      totalSteps: 3,
      progress: 1 / 3,
      nextIncompleteStep: {
        id: "step-current",
        title: "Apply",
        status: "in_progress",
        successCriteria: ["solve it"],
      },
    });
  });

  test("is stable for the same validated input and supplied clock", () => {
    const data = baseData({
      questionChecks: [{ id: "check-1", topic: "Logic", question: "q", answer: "a", createdAt: T0, grading: "auto", score: 0.9 }],
      topicEvidence: [{ id: "evidence-1", topic: "Logic", createdAt: T1, provenance: "assessment", reference: { kind: "question-check", id: "check-1" } }],
    });
    expect(buildLearnerProgress(data, NOW)).toEqual(buildLearnerProgress(structuredClone(data), NOW));
  });
});
