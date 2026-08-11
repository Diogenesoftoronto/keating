import { describe, expect, test } from "bun:test";
import {
  initialSrsState,
  validatePortableLearnerData,
  type FlashcardDeck,
  type PortableLearnerData,
} from "@keating/learner-contracts";
import { buildLearnerProgress } from "../src/lib/learner-progress";
import {
  applyPortableCardReview,
  buildComingUp,
  buildReviewQueue,
  createStudyPriority,
} from "../src/lib/learner-study";

const CREATED = "2026-08-01T00:00:00.000Z";
const NOW = "2026-08-10T12:00:00.000Z";

function deck(id: string, topic: string, cards: FlashcardDeck["cards"]): FlashcardDeck {
  return { id, title: `${topic} deck`, topic, createdAt: CREATED, updatedAt: CREATED, cards };
}

function card(id: string, dueAt = CREATED) {
  return { id, front: `${id} front`, back: `${id} back`, tags: [], srs: { ...initialSrsState(CREATED), dueAt } };
}

function data(overrides: Partial<PortableLearnerData> = {}): PortableLearnerData {
  return {
    generatedAt: NOW,
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

describe("native learner study logic", () => {
  test("wraps all four shared scheduler outcomes and emits complete v2 review records", () => {
    for (const rating of [0, 1, 2, 3] as const) {
      const untouched = card("card-b");
      const result = applyPortableCardReview(deck("deck-bio", "Biology", [card("card-a"), untouched]), "card-a", rating, {
        reviewId: `review-${rating}`,
        createdAt: NOW,
      });
      const state = result.deck.cards[0]!.srs;
      expect(result.review).toMatchObject({
        rating,
        appliedIntervalDays: rating === 0 ? 0 : 1,
        previousIntervalDays: 0,
        nextDueAt: state.dueAt,
        repetitionsAfter: rating === 0 ? 0 : 1,
        lapsesAfter: rating === 0 ? 1 : 0,
        isLapse: rating === 0,
      });
      expect(state.dueAt).toBe(rating === 0 ? "2026-08-10T12:10:00.000Z" : "2026-08-11T12:00:00.000Z");
      expect(state.ease).toBe(rating === 0 ? 2.3 : rating === 1 ? 2.35 : rating === 2 ? 2.5 : 2.65);
      expect(result.deck.cards[1]).toEqual(untouched);
      const complete = data({ decks: [result.deck], cardReviews: [result.review] });
      expect(validatePortableLearnerData(complete)).toBe(true);
    }
  });

  test("calculates due, overdue, future next due and deterministic review order", () => {
    const source = data({
      decks: [deck("deck-bio", "Biology", [
        card("card-z", "2026-08-08T12:00:00.000Z"),
        card("card-a", "2026-08-10T11:00:00.000Z"),
        card("card-future", "2026-08-12T12:00:00.000Z"),
      ])],
    });
    const progress = buildLearnerProgress(source, Date.parse(NOW));
    const comingUp = buildComingUp(source, progress, NOW);
    const item = comingUp.items[0]!;
    expect(item).toMatchObject({ dueCount: 2, overdueCount: 1, nextDueAt: "2026-08-12T12:00:00.000Z" });
    expect(comingUp.dueCardCount).toBe(2);
    expect(comingUp.overdueCardCount).toBe(1);
    expect(buildReviewQueue(source, NOW).map((entry) => entry.card.id)).toEqual(["card-z", "card-a"]);
    expect(buildReviewQueue(source, NOW, ["missing"]).length).toBe(0);
  });

  test("lets learner priority change lanes without changing schedules or due totals", () => {
    const source = data({ decks: [deck("deck-bio", "Biology", [card("card-a")])] });
    const progress = buildLearnerProgress(source, Date.parse(NOW));
    const baseline = buildComingUp(source, progress, NOW);
    const priority = createStudyPriority({ id: "priority-bio", targetType: "deck", targetId: "deck-bio", priority: "low", updatedAt: NOW });
    const prioritized = buildComingUp({ ...source, studyPriorities: [priority] }, progress, NOW);
    expect(baseline.items[0]!.priority).toBe("focus");
    expect(prioritized.items[0]!.priority).toBe("low");
    expect(prioritized.items[0]!.nextDueAt).toBe(baseline.items[0]!.nextDueAt);
    expect(prioritized.dueCardCount).toBe(baseline.dueCardCount);
    expect(validatePortableLearnerData({ ...source, studyPriorities: [priority] })).toBe(true);
  });

  test("covers deck, goal, verification and assessed needs-review topics without duplicate topic tasks", () => {
    const source = data({
      decks: [deck("deck-bio", "Biology", [card("card-bio")])],
      goals: [{
        id: "goal-algebra", title: "Algebra", description: "Practice", updatedAt: NOW,
        steps: [{ id: "step-1", title: "Solve one equation", status: "in_progress", successCriteria: ["Show each step"] }],
      }],
      artifacts: [{ id: "verification-physics", kind: "verification", format: "markdown", title: "Physics", content: "Recall the law.", createdAt: CREATED, updatedAt: CREATED }],
      quizResults: [
        { id: "quiz-bio", topic: "Biology", score: 0, totalQuestions: 1, answers: {}, createdAt: NOW },
        { id: "quiz-algebra", topic: "Algebra", score: 0, totalQuestions: 1, answers: {}, createdAt: NOW },
        { id: "quiz-physics", topic: "Physics", score: 0, totalQuestions: 1, answers: {}, createdAt: NOW },
        { id: "quiz-chemistry", topic: "Chemistry", score: 0, totalQuestions: 1, answers: {}, createdAt: NOW },
      ],
    });
    const progress = buildLearnerProgress(source, Date.parse(NOW));
    const output = buildComingUp(source, progress, NOW);
    expect(output.items.map((item) => item.id)).toEqual([
      "deck:deck-bio", "goal:goal-algebra", "topic:Chemistry", "verification:verification-physics",
    ]);
    expect(output.items.filter((item) => item.targetType === "topic").map((item) => item.topic)).toEqual(["Chemistry"]);
  });

  test("treats legacy-migrated cards as honestly due rather than inventing a historical schedule", () => {
    const source = data({ decks: [deck("deck-legacy", "History", [card("card-legacy", CREATED)])] });
    const progress = buildLearnerProgress(source, Date.parse(NOW));
    expect(buildComingUp(source, progress, NOW).items[0]).toMatchObject({ dueCount: 1, overdueCount: 1, nextDueAt: null });
    expect(buildReviewQueue(source, NOW).map((entry) => entry.card.id)).toEqual(["card-legacy"]);
  });
});
