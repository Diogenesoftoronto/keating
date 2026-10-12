import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { webOnlineEvidence, type WebOnlineEvidence } from "../keating/judgement/online-evidence";
import { onlineDecisionControl, projectOnlineLearningQueue } from "../keating/judgement/online-projection";
import { decisionPolicySnapshot } from "../../../packages/learner-contracts/src/judgement/decision-policy-data";
import { buildOnlineDecisionBatch, type OnlineDecisionResult } from "../../../packages/learner-contracts/src/judgement/online-decision-policy";
import { buildComingUpQueue } from "../keating/coming-up";
import { KeatingStorage, type LearnerState } from "../keating/storage";
const NOW = Date.UTC(2026, 9, 1), DAY = 86400000;
beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });
function evidence(): WebOnlineEvidence {
  return { checks: [], reviews: [{ id: "r", topic: "Math", slug: "math", deckId: "a", cardId: "card", rating: 2,
    appliedIntervalDays: 1, previousIntervalDays: 0, easeAfter: 2.5, createdAt: NOW - 2 * DAY,
    nextDueAt: NOW - DAY, repetitionsAfter: 1, lapsesAfter: 0, isLapse: false }],
    decks: [{ id: "a", topic: "Math", slug: "math", title: "A", createdAt: NOW - 3 * DAY, updatedAt: NOW - 2 * DAY,
      cards: [{ id: "card", front: "Private question", back: "Private answer", createdAt: NOW - 3 * DAY, updatedAt: NOW - 2 * DAY,
        srs: { ease: 2.5, intervalDays: 1, reps: 1, lapses: 0, lastReviewedAt: NOW - 2 * DAY, lastRating: 2, dueAt: NOW - DAY } }] }] };
}
const learner: LearnerState = { schemaVersion: 3, topicsExplored: [], feedbackHistory: [], strengths: [], weaknesses: [], topicProfiles: [], sessionsCount: 0, sessions: [], profileBeliefs: [], studyPriorities: [] };
test("new web reviews retain exact canonical history through storage and numerical projection", async () => {
  const data = evidence(), store = new KeatingStorage();
  await store.recordCardReview(data.reviews[0]!);
  const [saved] = await store.getCardReviews();
  expect(saved).toMatchObject({ nextDueAt: NOW - DAY, repetitionsAfter: 1, lapsesAfter: 0, previousIntervalDays: 0, isLapse: false });
  data.reviews = [saved!];
  const projected = webOnlineEvidence(data, NOW);
  expect(projected.cardReviews[0]?.nextDueAt).toBe(new Date(NOW - DAY).toISOString());
  expect(decisionPolicySnapshot(projected, "Math", NOW).cards).toHaveLength(1);
});
test("legacy reviews stay unknown instead of fabricating the missing schedule", () => {
  const data = evidence(); delete data.reviews[0]!.nextDueAt;
  const projected = webOnlineEvidence(data, NOW);
  expect(projected.cardReviews[0]?.legacyScheduleUnknown).toBe(true);
  expect(decisionPolicySnapshot(projected, "Math", NOW).cards).toHaveLength(0);
});
test("inconsistent saved schedules cannot become tabular evidence", () => {
  const data = evidence(); data.decks[0]!.cards[0]!.srs.lapses = 3;
  expect(() => webOnlineEvidence(data, NOW)).toThrow("cannot yet be verified");
});
test("accepted urgency changes only eligible due-deck positions inside each lane", () => {
  const data = evidence();
  data.decks = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(data.decks[0]!), id: `d${i}`, title: `${i}`.padStart(2, "0") }));
  const state = { ...learner, studyPriorities: [{ targetId: "d0", targetType: "deck" as const, priority: "low" as const, updatedAt: NOW }] };
  const queue = buildComingUpQueue({ decks: data.decks, verifications: [], learnerState: state, now: NOW });
  const empty = buildOnlineDecisionBatch(webOnlineEvidence(evidence(), NOW), "urgency", NOW);
  const urgency: OnlineDecisionResult = { receipt: { ...empty.receipt, status: "active" },
    predictions: data.decks.map((deck, i) => ({ key: deck.id, deckId: deck.id, topic: deck.topic, value: i / 30 })) };
  const before = JSON.stringify(queue), projected = projectOnlineLearningQueue(queue, { urgency });
  expect(projected.lanes.low.map(item => item.targetId)).toEqual(["d0"]);
  expect(projected.dueDeckIds).not.toEqual(queue.dueDeckIds);
  for (const [index, item] of queue.lanes.focus.entries()) if (onlineDecisionControl(item.id)) expect(projected.lanes.focus[index]?.id).toBe(item.id);
  expect(projected.dueCardCount).toBe(queue.dueCardCount); expect(JSON.stringify(queue)).toBe(before);
  expect(projectOnlineLearningQueue(queue, { urgency: { ...urgency, receipt: { ...urgency.receipt, status: "baseline-retained" } } })).toBe(queue);
});
