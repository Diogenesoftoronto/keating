import { expect, test } from "bun:test";
import { applyReview, initialSrsState, type SrsRating } from "../src/srs.js";
import { validatePortableLearnerData, type PortableLearnerData } from "../src/portable.js";
import {
  buildOnlineDecisionBatch, evaluateOnlineDecisionBatch, onlineDecisionEvidenceId, ONLINE_DECISION_POLICY,
  runOnlineDecisionBatch, type OnlineDecisionBatch,
} from "../src/judgement/online-decision-policy.js";

const DAY = 86_400_000, epoch = Date.UTC(2026, 0, 1);
const at = (day: number, hour = 0) => epoch + day * DAY + hour * 3_600_000;
const iso = (day: number, hour = 0) => new Date(at(day, hour)).toISOString();
function empty(): PortableLearnerData {
  return { generatedAt: iso(1000), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
}
function question(data: PortableLearnerData, id: string, day: number, score: number, topic = "Math") {
  data.questionChecks.push({ id, topic, createdAt: iso(day, 12), score, grading: "auto", question: `Private question ${id}`, answer: "Private answer" });
}
function objectives(count = 41): PortableLearnerData {
  const data = empty();
  for (let index = 1; index <= count; index++) question(data, `private-id-${index}`, index, index % 2);
  return data;
}
function review(data: PortableLearnerData, deckId: string, day: number, rating: SrsRating) {
  let deck = data.decks.find(row => row.id === deckId);
  if (!deck) {
    deck = { id: deckId, title: `Private deck ${deckId}`, topic: "Math", createdAt: iso(0), updatedAt: iso(0),
      cards: [{ id: `card-${deckId}`, front: "Private prompt", back: "Private answer", tags: [], srs: initialSrsState(iso(0)) }] };
    data.decks.push(deck);
  }
  const card = deck.cards[0]!, before = card.srs, createdAt = iso(day, 12), applied = applyReview(before, rating, createdAt);
  card.srs = applied.next; deck.updatedAt = createdAt;
  data.cardReviews.push({ id: `${deckId}-${day}`, deckId, cardId: card.id, rating, createdAt,
    appliedIntervalDays: applied.next.intervalDays, previousIntervalDays: before.intervalDays, easeAfter: applied.next.ease,
    nextDueAt: applied.next.dueAt, repetitionsAfter: applied.next.repetitions, lapsesAfter: applied.next.lapses, isLapse: applied.isLapse });
}
function reviews(): PortableLearnerData {
  const data = empty();
  for (let index = 1; index <= 36; index++) {
    review(data, "a", index * 10, index % 2 ? 0 : 2);
    review(data, "b", index * 10, index % 2 ? 2 : 0);
  }
  return data;
}
function perfect(batch: OnlineDecisionBatch, current = .72) {
  return { model: "v3.5_default" as const, predictions: [...batch.validation.map(row => row.label), ...batch.candidates.map(() => current)] };
}

test("observed outcomes form one numerical-only batch with strict chronological validation", () => {
  const data = objectives(), before = JSON.stringify(data), batch = buildOnlineDecisionBatch(data, "mastery", at(50));
  expect(batch.receipt.status).toBe("ready");
  expect(batch.receipt.counts).toMatchObject({ observedRows: 40, trainRows: 32, validationRows: 8, candidateCount: 1 });
  expect(Math.max(...batch.fitAsOf)).toBeLessThan(Math.min(...batch.validation.map(row => row.asOf)));
  expect(batch.request!.trainTargets).toEqual(Array.from({ length: 32 }, (_, index) => index % 2));
  expect(batch.request!.trainFeatures[0]![0]).toBe(1);
  expect(batch.request!.trainFeatures[0]![1]).toBe(1); // prior first answer, not the next outcome's zero
  expect(batch.request!.testFeatures).toHaveLength(9);
  expect(JSON.stringify(batch.request)).not.toMatch(/Private|private-id|Math|local-learner|questionChecks|validationTargets/);
  expect(batch.request!.trainFeatures.flat().every(Number.isFinite)).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
});

test("identity is deterministic across exports and ordering while changed evidence and clock invalidate it", () => {
  const data = objectives(), first = buildOnlineDecisionBatch(data, "mastery", at(50));
  const reexport = structuredClone(data); reexport.generatedAt = iso(1001); reexport.questionChecks.reverse();
  const same = buildOnlineDecisionBatch(reexport, "mastery", at(50));
  expect(same.evidenceId).toBe(first.evidenceId); expect(same.requestId).toBe(first.requestId);
  question(reexport, "future", 60, 1);
  expect(buildOnlineDecisionBatch(reexport, "mastery", at(50)).requestId).toBe(first.requestId);
  reexport.questionChecks.find(row => row.id === "private-id-30")!.score = 1;
  expect(onlineDecisionEvidenceId(reexport, "mastery", at(50))).not.toBe(first.evidenceId);
  expect(onlineDecisionEvidenceId(data, "mastery", at(50, 1))).not.toBe(first.evidenceId);
});

test("later outcomes are absent and equal-time observations never straddle the split", () => {
  const data = objectives(41), original = buildOnlineDecisionBatch(data, "mastery", at(35));
  for (const row of data.questionChecks) if (Date.parse(row.createdAt) >= at(35)) row.score = 1 - row.score!;
  expect(buildOnlineDecisionBatch(data, "mastery", at(35)).request).toEqual(original.request);
  for (let day = 1; day <= 41; day++) question(data, `science-${day}`, day, (day + 1) % 2, "Science");
  const tied = buildOnlineDecisionBatch(data, "mastery", at(50));
  expect(Math.max(...tied.fitAsOf)).toBeLessThan(Math.min(...tied.validation.map(row => row.asOf)));
});

test("future-dated outcomes beyond the source export do not leak into candidates or cache identity", () => {
  const data = objectives(41); data.generatedAt = iso(35);
  const batch = buildOnlineDecisionBatch(data, "mastery", at(50));
  for (const row of data.questionChecks) if (Date.parse(row.createdAt) > Date.parse(data.generatedAt)) row.score = 1 - row.score!;
  const same = buildOnlineDecisionBatch(data, "mastery", at(50));
  expect(same.requestId).toBe(batch.requestId); expect(same.request).toEqual(batch.request);
  data.generatedAt = iso(40);
  expect(buildOnlineDecisionBatch(data, "mastery", at(50)).evidenceId).not.toBe(batch.evidenceId);
});

test("scope and validation bind accepted mastery predictions to the local topic", () => {
  const batch = buildOnlineDecisionBatch(objectives(), "mastery", at(50));
  const result = evaluateOnlineDecisionBatch(batch, perfect(batch));
  expect(result.receipt.status).toBe("active");
  expect(result.receipt.validation).toMatchObject({ kind: "classification-error", modelLoss: 0, passed: true, scope: "chronological-within-learner" });
  expect(result.predictions).toEqual([{ key: '["mastery","math"]', topic: "math", value: .72 }]);
  expect(result.receipt.evidence).toBe("observed-local-outcomes");
  const bad = { ...perfect(batch), predictions: [...batch.validation.map(row => 1 - row.label), .9] };
  expect(evaluateOnlineDecisionBatch(batch, bad).receipt.status).toBe("baseline-retained");
  expect(evaluateOnlineDecisionBatch(batch, bad).predictions).toEqual([]);
});

test("retention keeps missing objective history explicit and measures Brier error", () => {
  const data = reviews(); expect(validatePortableLearnerData(data)).toBe(true);
  const batch = buildOnlineDecisionBatch(data, "retention", at(370));
  expect(batch.receipt.status).toBe("ready");
  const index = batch.request!.featureNames.indexOf("objectiveMeanKnown");
  expect(index).toBeGreaterThan(0);
  expect(batch.request!.trainFeatures.every(row => row[index] === 0)).toBe(true);
  const result = evaluateOnlineDecisionBatch(batch, perfect(batch));
  expect(result.receipt.validation).toMatchObject({ kind: "brier", modelLoss: 0, passed: true });
  expect(result.predictions.map(row => [row.deckId, row.cardId])).toEqual([["a", "card-a"], ["b", "card-b"]]);
});

test("urgency validates comparable cohorts against both web and mobile ordering and excludes unknown or future decks", () => {
  const data = reviews();
  review(data, "not-due", 369, 2); // due tomorrow
  review(data, "unknown", 1, 0);
  data.decks.find(deck => deck.id === "unknown")!.cards.push({ id: "unreviewed", front: "new", back: "new", tags: [], srs: initialSrsState(iso(0)) });
  const batch = buildOnlineDecisionBatch(data, "urgency", at(370));
  expect(batch.receipt.status).toBe("ready");
  expect(batch.candidates.map(row => row.deckId)).toEqual(["a", "b"]);
  const result = evaluateOnlineDecisionBatch(batch, perfect(batch));
  expect(result.receipt.status).toBe("active");
  expect(result.receipt.validation).toMatchObject({ kind: "paired-ranking-error", modelLoss: 0, passed: true });
  expect(result.receipt.validation!.webBaselineLoss).toBeGreaterThan(0);
  expect(result.receipt.validation!.mobileBaselineLoss).toBeGreaterThan(0);
  expect(result.receipt.validation!.rankingCohorts).toBeGreaterThanOrEqual(2);
  expect(result.receipt.validation!.pairedComparisons).toBeGreaterThanOrEqual(3);
});

test("a single reviewed deck cannot demonstrate improved urgency ordering", () => {
  const data = reviews(); data.decks = data.decks.filter(row => row.id === "a"); data.cardReviews = data.cardReviews.filter(row => row.deckId === "a");
  const batch = buildOnlineDecisionBatch(data, "urgency", at(370));
  expect(batch.request).toBeNull(); expect(batch.receipt.status).toBe("insufficient-validation");
  expect(batch.receipt.reasons).toContain("validation-needs-comparable-observed-deck-cohorts");
});

test("cold starts never call inference or invent learner estimates", async () => {
  for (const target of ["mastery", "retention", "urgency"] as const) {
    const batch = buildOnlineDecisionBatch(empty(), target, at(50)); let calls = 0;
    const result = await runOnlineDecisionBatch(batch, async () => { calls++; return {}; });
    expect(calls).toBe(0); expect(result.predictions).toEqual([]); expect(result.receipt.status).toBe("insufficient-history");
  }
});

test("malformed, wrong-model, stale and superseded responses cannot publish predictions", () => {
  const batch = buildOnlineDecisionBatch(objectives(), "mastery", at(50)), good = perfect(batch);
  for (const malformed of [null, [], {}, { ...good, model: "v2" }, { ...good, predictions: [1] },
    ...[NaN, Infinity, -1, 1.01, "0.4"].map(value => ({ ...good, predictions: good.predictions.map((row, index) => index ? row : value) }))]) {
    expect(evaluateOnlineDecisionBatch(batch, malformed).receipt.status).toBe("invalid-response");
    expect(evaluateOnlineDecisionBatch(batch, malformed).predictions).toEqual([]);
  }
  expect(evaluateOnlineDecisionBatch(batch, good, batch.receipt.expiresAt).receipt.status).toBe("stale");
  expect(evaluateOnlineDecisionBatch(batch, good, batch.asOf, "changed").receipt.status).toBe("stale");
});

test("transport failures and cancellation preserve baseline without exposing provider errors", async () => {
  const batch = buildOnlineDecisionBatch(objectives(), "mastery", at(50));
  const failed = await runOnlineDecisionBatch(batch, async () => { throw new Error("secret key and private input"); }, { now: () => batch.asOf });
  expect(failed.receipt.status).toBe("failed"); expect(JSON.stringify(failed)).not.toContain("secret"); expect(failed.predictions).toEqual([]);
  const controller = new AbortController(); controller.abort(); let called = false;
  await runOnlineDecisionBatch(batch, async () => { called = true; return perfect(batch); }, { signal: controller.signal, now: () => batch.asOf });
  expect(called).toBe(false);
  const result = await runOnlineDecisionBatch(batch, async () => perfect(batch), { now: () => batch.asOf, currentEvidenceId: () => "new" });
  expect(result.receipt.status).toBe("stale");
});

test("request size is bounded and discarded candidates remain explicit", () => {
  const data = objectives(560), batch = buildOnlineDecisionBatch(data, "mastery", at(600));
  expect(batch.receipt.status).toBe("ready"); expect(batch.request!.trainFeatures).toHaveLength(ONLINE_DECISION_POLICY.maxTrainRows);
  expect(batch.validation).toHaveLength(ONLINE_DECISION_POLICY.maxValidationRows);
  for (let index = 0; index < 80; index++) question(data, `new-topic-${index}`, 570, 1, `Other ${index}`);
  const many = buildOnlineDecisionBatch(data, "mastery", at(600));
  expect(many.request!.testFeatures).toHaveLength(ONLINE_DECISION_POLICY.maxTestRows);
  expect(many.receipt.counts.omittedCandidates).toBeGreaterThan(0);
});
