import { describe, expect, test } from "bun:test";
import type { PortableLearnerData } from "@keating/learner-contracts";
import {
  MOBILE_FEEDBACK_WINDOW_MS,
  MOBILE_REWARDED_TURN_EVIDENCE_SOURCE,
  computeMobileRewardedTurns,
} from "../src/lib/session-reward";

const T0 = "2026-08-10T12:00:00.000Z";
const T1 = "2026-08-10T12:01:00.000Z";
const T2 = "2026-08-10T12:02:00.000Z";
const T3 = "2026-08-10T12:03:00.000Z";

function baseData(): PortableLearnerData {
  return {
    generatedAt: T3,
    sessions: [{
      id: "session-mobile",
      title: "Linear algebra",
      createdAt: T0,
      updatedAt: T3,
      activeBranchId: "branch-main",
      branches: [{ id: "branch-main", sessionId: "session-mobile", createdAt: T0, updatedAt: T3 }],
      messages: [
        { id: "message-user-1", role: "user", content: "Explain eigenvectors", createdAt: T0 },
        { id: "message-assistant-1", role: "assistant", content: "An eigenvector keeps its direction.", createdAt: T1 },
      ],
    }],
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
    learnerProfile: { topicsExplored: ["Linear algebra"], strengths: [], weaknesses: [], sessionsCount: 1, lastSessionAt: T3 },
  };
}

describe("mobile rewarded-turn join (§7)", () => {
  test("joins only the next user reaction in the same session with exact source identity", () => {
    const data = baseData();
    data.sessions[0].messages.push({ id: "reaction", role: "user", content: "got it, makes sense", createdAt: T2 });
    const sibling = structuredClone(data.sessions[0]); sibling.id = "other-session";
    sibling.messages[2].content = "That is wrong";
    data.sessions.push(sibling);
    const [positive, negative] = computeMobileRewardedTurns(data, { includeContext: false });
    expect(positive).toMatchObject({ sessionId: "session-mobile", messageId: "message-assistant-1", context: [],
      signals: { inferred: { signal: "thumbs-up", score: .85, sourceMessageId: "reaction", joinedBy: "nextTurn" } }, evidenceSource: "proxy" });
    expect(negative).toMatchObject({ sessionId: "other-session", signals: { inferred: { signal: "thumbs-down" } } });
    expect(positive.reward).toBeCloseTo(.85); expect(negative.reward).toBeCloseTo(.15);
  });

  test("explicit feedback suppresses inferred reactions, and inferred+quiz uses web channel weights", () => {
    const data = baseData();
    data.sessions[0].messages.push({ id: "reaction", role: "user", content: "I am confused", createdAt: T2 });
    data.quizResults.push({ id: "outcome", topic: "Linear algebra", sessionId: "session-mobile", createdAt: T2, score: 1, totalQuestions: 2, answers: {} });
    expect(computeMobileRewardedTurns(data)[0].reward).toBeCloseTo((.35 * .15 + .5 * .25) / .4);
    data.feedbackEvents.push({ id: "explicit", sessionId: "session-mobile", messageId: "message-assistant-1", rating: "helpful", createdAt: T3 });
    const turn = computeMobileRewardedTurns(data)[0];
    expect(turn.signals.inferred).toBeUndefined(); expect(turn.signals.explicit?.feedbackId).toBe("explicit");
    expect(turn.reward).toBeCloseTo((.85 * .6 + .5 * .25) / .85);
  });

  test("unclassified next turns and missing timing remain unknown; later reactions are not searched", () => {
    const data = baseData();
    data.sessions[0].messages.push({ id: "unclassified", role: "user", content: "Tell me another fact", createdAt: T2 },
      { id: "later-reaction", role: "user", content: "got it", createdAt: T3 });
    expect(computeMobileRewardedTurns(data)[0]).toMatchObject({ scored: false, reward: null, signals: {} });
    data.sessions[0].messages[1].createdAt = "missing";
    data.sessions[0].messages[2].content = "got it";
    expect(computeMobileRewardedTurns(data)[0]).toMatchObject({ scored: false, reward: null, signals: {} });
  });

  test("abstains from ambiguous legacy topic-only outcomes across overlapping sessions", () => {
    const data = baseData();
    const sibling = structuredClone(data.sessions[0]); sibling.id = "overlapping-session";
    data.sessions.push(sibling);
    data.quizResults.push({ id: "unbound-quiz", topic: "Linear algebra", createdAt: T2, score: 1, totalQuestions: 1, answers: {} });
    const turns = computeMobileRewardedTurns(data, { includeContext: false });
    expect(turns).toHaveLength(2);
    for (const turn of turns) expect(turn).toMatchObject({ scored: false, reward: null, context: [] });
  });

  test("does not steal a later turn's explicit feedback or reuse its quiz outcome", () => {
    const data = baseData();
    data.sessions[0].messages.push({ id: "next-user", role: "user", content: "Try again", createdAt: T2 },
      { id: "next-assistant", role: "assistant", content: "A second explanation.", createdAt: T3 });
    data.feedbackEvents.push({ id: "later-feedback", sessionId: "session-mobile", messageId: "next-assistant", rating: "helpful", createdAt: T3 });
    data.quizResults.push({ id: "later-quiz", sessionId: "session-mobile", topic: "Linear algebra", createdAt: T3, score: 1, totalQuestions: 1, answers: {} });
    const [first, second] = computeMobileRewardedTurns(data);
    expect(first).toMatchObject({ messageId: "message-assistant-1", scored: false, reward: null, signals: {} });
    expect(second.signals).toMatchObject({ explicit: { feedbackId: "later-feedback", joinedBy: "messageId" }, quiz: { quizResultId: "later-quiz" } });
  });

  test("uses the latest explicit rating even when persisted rows arrive in another order", () => {
    const data = baseData();
    data.feedbackEvents.push({ id: "older", sessionId: "session-mobile", messageId: "message-assistant-1", rating: "helpful", createdAt: T2 },
      { id: "newer", sessionId: "session-mobile", messageId: "message-assistant-1", rating: "missed", createdAt: T3 });
    expect(computeMobileRewardedTurns(data)[0].signals.explicit).toMatchObject({ feedbackId: "newer", score: 0.15 });
    data.feedbackEvents.reverse();
    expect(computeMobileRewardedTurns(data)[0].signals.explicit).toMatchObject({ feedbackId: "newer", score: 0.15 });
  });

  test("feedback joins by message id", () => {
    const data = baseData();
    data.feedbackEvents.push(
      { id: "feedback-helpful", sessionId: "session-mobile", messageId: "message-assistant-1", rating: "helpful", createdAt: T2 },
    );
    const turns = computeMobileRewardedTurns(data);
    expect(turns).toHaveLength(1);
    expect(turns[0].signals.explicit).toMatchObject({ score: 0.85, joinedBy: "messageId", feedbackId: "feedback-helpful" });
    expect(turns[0].reward).toBeCloseTo(0.85, 5);
    expect(turns[0].scored).toBe(true);
  });

  test("feedback without a message id joins by timestamp window", () => {
    const data = baseData();
    data.sessions[0].messages[1].id = "message-assistant-other";
    data.feedbackEvents.push(
      { id: "feedback-window", sessionId: "session-mobile", messageId: "message-unknown", rating: "missed", createdAt: T2 },
    );
    const turns = computeMobileRewardedTurns(data);
    expect(turns[0].signals.explicit).toMatchObject({ score: 0.15, joinedBy: "timestampWindow" });
  });

  test("quiz results join by session with numeric timing", () => {
    expect(MOBILE_FEEDBACK_WINDOW_MS).toBe(10 * 60_000);
    const data = baseData();
    data.quizResults.push({
      id: "quiz-result-1",
      topic: "Linear algebra",
      createdAt: T2,
      score: 3,
      totalQuestions: 4,
      answers: {},
      timing: { totalMs: 12_000, perQuestionMs: { "q-1": 4_000, "q-2": 8_000 } },
      sessionId: "session-mobile",
    });
    const turns = computeMobileRewardedTurns(data);
    expect(turns[0].signals.quiz).toMatchObject({
      score: 0.75,
      joinedBy: "sessionId",
      quizResultId: "quiz-result-1",
    });
    expect(turns[0].signals.quiz?.timing).toMatchObject({ answeredCount: 2, totalMs: 12_000, meanMs: 6_000 });
    expect(turns[0].reward).toBeCloseTo(0.75, 5);
  });

  test("a card review fills the quiz slot when no quiz result exists", () => {
    const data = baseData();
    data.decks.push({
      id: "deck-algebra",
      title: "Eigenvectors",
      topic: "Linear algebra",
      createdAt: T0,
      updatedAt: T0,
      cards: [],
    });
    data.cardReviews.push({
      id: "review-1",
      deckId: "deck-algebra",
      cardId: "card-1",
      rating: 2,
      appliedIntervalDays: 3,
      easeAfter: 2.5,
      createdAt: T2,
      previousIntervalDays: 1,
      nextDueAt: T3,
      repetitionsAfter: 2,
      lapsesAfter: 0,
      isLapse: false,
    });
    const turns = computeMobileRewardedTurns(data);
    expect(turns[0].signals.quiz).toMatchObject({
      score: 2 / 3,
      joinedBy: "topicWindow",
      cardReviewId: "review-1",
    });
  });

  test("a scored question check fills the quiz slot when nothing stronger exists", () => {
    const data = baseData();
    data.questionChecks.push({
      id: "check-1",
      topic: "Linear algebra",
      question: "What is an eigenvector?",
      answer: "A direction-preserving vector.",
      createdAt: T2,
      score: 0.5,
      grading: "auto",
    });
    data.questionChecks.push({
      id: "check-pending",
      topic: "Linear algebra",
      question: "Prove it.",
      answer: "Later.",
      createdAt: T2,
      grading: "pending",
    });
    const turns = computeMobileRewardedTurns(data);
    expect(turns[0].signals.quiz).toMatchObject({ score: 0.5, questionCheckId: "check-1" });
  });

  test("topic evidence retopics the turn without scoring it", () => {
    const data = baseData();
    data.quizResults.push({
      id: "quiz-result-1",
      topic: "General",
      createdAt: T2,
      score: 1,
      totalQuestions: 1,
      answers: {},
      sessionId: "session-mobile",
    });
    data.topicEvidence.push({
      id: "evidence-1",
      topic: "Linear algebra",
      createdAt: T2,
      provenance: "assessment",
      reference: { kind: "quiz-result", id: "quiz-result-1" },
    });
    const turns = computeMobileRewardedTurns(data);
    expect(turns[0].topic).toBe("Linear algebra");
    expect(turns[0].signals.quiz?.score).toBe(1);
  });

  test("every row is proxy evidence, never observed (§0.1)", () => {
    const data = baseData();
    data.feedbackEvents.push(
      { id: "feedback-helpful", sessionId: "session-mobile", messageId: "message-assistant-1", rating: "helpful", createdAt: T2 },
    );
    const turns = computeMobileRewardedTurns(data);
    expect(MOBILE_REWARDED_TURN_EVIDENCE_SOURCE).toBe("proxy");
    for (const turn of turns) expect(turn.evidenceSource).toBe("proxy");
    const serialized = JSON.stringify(turns);
    expect(serialized).not.toContain("observed");
    expect(serialized).not.toContain("eligibleForPromotion");
  });
});
