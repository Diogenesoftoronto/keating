import { expect, test } from "bun:test";
import type { JudgementRequest, JudgementResponse } from "@keating/learner-contracts";
import type { FlashcardDeck, CardReviewRecord, QuestionCheckRecord } from "../keating/storage";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import { estimateStudyDeck, loadStudySnapshot, projectStudyEstimate, type StudyEstimateSource } from "../keating/judgement/study-estimates";
import { StudyEstimateStore } from "../keating/judgement/study-estimate-store";

const NOW = Date.UTC(2026, 8, 19, 12);
const backend = { backend: "system-one" as const, model: "jev-test-version", calibrationSha256: null };
function fixture(count = 2) {
  const deck: FlashcardDeck = { id: "fractions", title: "Fractions", topic: "Fractions", slug: "fractions", createdAt: NOW - 1000, updatedAt: NOW - 1000,
    cards: Array.from({ length: count }, (_, i) => ({ id: `card-${i}`, front: `Name the fraction in example ${i}.`, back: "One half", createdAt: NOW - 1000, updatedAt: NOW - 1000,
      srs: { ease: 2.5, intervalDays: 1, reps: 1, lapses: 0, dueAt: NOW - 1, lastReviewedAt: NOW - 1000, lastRating: 2 } })) };
  const reviews: CardReviewRecord[] = [{ id: "prior", deckId: deck.id, cardId: "card-0", topic: deck.topic, slug: deck.slug,
    rating: 2, appliedIntervalDays: 1, easeAfter: 2.5, createdAt: NOW - 1000 }];
  const checks: QuestionCheckRecord[] = [{ id: "assessed", topic: "Fractions", question: "What is one half?", answer: "One of two equal parts", grading: "auto", score: 1, createdAt: NOW - 500 }];
  const source: StudyEstimateSource = { getDeck: async id => id === deck.id ? structuredClone(deck) : null,
    getCardReviews: async () => structuredClone(reviews), getQuestionChecks: async () => structuredClone(checks), getQuizResults: async () => [] };
  return { deck, reviews, checks, source };
}
function response(request: JudgementRequest): JudgementResponse {
  return { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "noul") return [key, { type: "noul", noul: key === "ready" ? 0.7 : 0.8 }];
    const labels = question.type === "score" ? question.criteria.map((_, i) => String(i)) : Object.keys(question.criteria);
    const chosen = question.type === "score" ? "1" : "two-step";
    const probabilities = Object.fromEntries(labels.map(label => [label, label === chosen ? 1 : 0]));
    return [key, question.type === "score" ? { type: "score", score: 1, confidence: 1, probabilities,
      legend: Object.fromEntries(question.criteria.map((label, i) => [i, label])) } : { type: "choice", choice: chosen, confidence: 1, probabilities }];
  })) };
}
function runtime(call: (request: JudgementRequest) => Promise<JudgementResponse>, preference: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend: preference, localModelId: "local-test", gatewayPath: "/api/judgement" }, policy: { calibration: { entries: {} },
    tiers: [{ key: backend, call: async request => ({ ok: true, response: await call(request) }) }] } };
}

test("explicit estimate batches atomic questions over exact due cards and relevant assessed work, with arithmetic in code", async () => {
  const { source, deck, reviews, checks } = fixture(); let calls = 0;
  checks.push({ ...checks[0], id: "unrelated", topic: "Chemistry", answer: "Unrelated private answer" });
  const before = JSON.stringify({ deck, reviews, checks });
  const result = await estimateStudyDeck({ source, deckId: deck.id, now: () => NOW, runtime: runtime(async request => {
    calls++; expect(Object.keys(request.questions)).toHaveLength(7);
    expect(request.questions.success_0.type).toBe("noul"); expect(request.questions.difficulty_0.type).toBe("score"); expect(request.questions.effort_0.type).toBe("choice");
    expect(JSON.stringify(request.state)).toContain(deck.cards[0].front); expect(JSON.stringify(request.state)).toContain(checks[0].answer);
    expect(JSON.stringify(request.state)).not.toContain("Unrelated private answer");
    return response(request);
  }) });
  expect(calls).toBe(1); expect(result.ok).toBe(true);
  if (result.ok) expect(result.receipt).toMatchObject({ expectedCorrect: 1.6, estimatedSeconds: 150, readinessProbability: 0.7, calibration: "unvalidated", evidenceSource: "proxy", backend });
  expect(JSON.stringify({ deck, reviews, checks })).toBe(before);
});

test("absent history, too many due cards, missing deck, off and local-only never call hosted inference", async () => {
  let calls = 0; const hosted = runtime(async request => { calls++; return response(request); });
  const empty = fixture(); empty.reviews.length = 0; empty.checks.length = 0;
  expect(await estimateStudyDeck({ source: empty.source, deckId: empty.deck.id, runtime: hosted, now: () => NOW })).toEqual({ ok: false, reason: "no-history" });
  const large = fixture(21);
  expect(await estimateStudyDeck({ source: large.source, deckId: large.deck.id, runtime: hosted, now: () => NOW })).toEqual({ ok: false, reason: "too-many-cards" });
  const { source, deck } = fixture();
  expect(await estimateStudyDeck({ source, deckId: "missing", runtime: hosted, now: () => NOW })).toEqual({ ok: false, reason: "no-due-cards" });
  for (const preference of ["off", "local"] as const) expect((await estimateStudyDeck({ source, deckId: deck.id, now: () => NOW,
    runtime: runtime(async request => { calls++; return response(request); }, preference) })).ok).toBe(false);
  expect(calls).toBe(0);
});

test("changed answers, newly due cards, and review updates reject an in-flight estimate", async () => {
  for (const change of ["answer", "card", "review"] as const) {
    const { source, deck, reviews, checks } = fixture();
    const result = await estimateStudyDeck({ source, deckId: deck.id, now: () => NOW, runtime: runtime(async request => {
      if (change === "answer") checks[0].answer = "Revised assessed answer";
      if (change === "card") deck.cards[0].srs.dueAt = NOW + 1000;
      if (change === "review") reviews[0].rating = 0;
      return response(request);
    }) });
    expect(result).toEqual({ ok: false, reason: "stale" });
  }
});

test("invalid and missing outputs stay unknown, aliases fail closed, and generic effort is never a time limit", async () => {
  const { source, deck } = fixture(); const snapshot = await loadStudySnapshot(source, deck.id, NOW);
  const result = response({ state: snapshot.state, questions: snapshot.questions });
  const answers = { ...result.answers, success_1: { type: "noul" as const, noul: 8 }, effort_1: { type: "choice" as const, choice: "invented", confidence: 1, probabilities: { invented: 1 } } };
  const projected = projectStudyEstimate(snapshot, { ...result, answers }, NOW);
  expect(projected).toMatchObject({ expectedCorrect: null, estimatedSeconds: null });
  expect(projected?.cards[1]).toMatchObject({ successProbability: null, effort: null });
  expect(projectStudyEstimate(snapshot, { ...result, backend: { ...backend, model: "jev-latest" } }, NOW)).toBeNull();
  expect(projectStudyEstimate(snapshot, { ...result, backend: { ...backend, calibrationSha256: "malformed" } }, NOW)).toBeNull();
  expect(projectStudyEstimate(snapshot, { ...result, answers: {} }, NOW)).toBeNull();
  expect(JSON.stringify(projected)).not.toContain("timeLimit");
});

test("transient receipts contain no copied learnerwork, are reprojected on read, and expire on source changes", async () => {
  const { source, deck, checks } = fixture(); const values = new Map<string, string>();
  const store = new StudyEstimateStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } });
  const snapshot = await loadStudySnapshot(source, deck.id, NOW);
  const receipt = projectStudyEstimate(snapshot, response({ state: snapshot.state, questions: snapshot.questions }), NOW)!;
  store.save({ ...receipt, expectedCorrect: 999 });
  expect(store.current(snapshot, NOW)?.expectedCorrect).toBe(1.6);
  expect([...values.values()].join()).not.toContain(checks[0].answer);
  expect([...values.values()].join()).not.toContain(deck.cards[0].front);
  checks[0].score = 0;
  expect(store.current(await loadStudySnapshot(source, deck.id, NOW), NOW)).toBeNull();
  expect(store.deckIds()).toEqual([]);
  store.save(receipt); store.clear(); expect(values.size).toBe(0);
});

test("provider failure and cancellation leave scheduling and grades untouched", async () => {
  const { source, deck, checks } = fixture(); const before = JSON.stringify({ deck, checks });
  expect((await estimateStudyDeck({ source, deckId: deck.id, now: () => NOW, runtime: runtime(async () => { throw new Error("private provider body"); }) })).ok).toBe(false);
  const controller = new AbortController(); controller.abort();
  expect(await estimateStudyDeck({ source, deckId: deck.id, now: () => NOW, signal: controller.signal })).toEqual({ ok: false, reason: "cancelled" });
  expect(JSON.stringify({ deck, checks })).toBe(before);
});

test("abort during the freshness read discards success, and UTF-8 request size is bounded before inference", async () => {
  const { source, deck } = fixture(); const controller = new AbortController(); let reads = 0;
  const aborting = { ...source, getDeck: async (id: string) => { if (++reads === 2) controller.abort(); return source.getDeck(id); } };
  expect(await estimateStudyDeck({ source: aborting, deckId: deck.id, now: () => NOW, signal: controller.signal,
    runtime: runtime(async request => response(request)) })).toEqual({ ok: false, reason: "cancelled" });
  deck.cards[0].front = "学".repeat(30_000); let calls = 0;
  expect(await estimateStudyDeck({ source, deckId: deck.id, now: () => NOW, runtime: runtime(async request => { calls++; return response(request); }) })).toEqual({ ok: false, reason: "too-much-evidence" });
  expect(calls).toBe(0);
});
