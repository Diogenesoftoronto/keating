import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { applyReview, initialSrsState } from "../src/srs.js";
import { validatePortableLearnerData, type PortableLearnerData } from "../src/portable.js";
import { buildDecisionPolicyDatasets, compareDecisionPolicyUrgency, DECISION_POLICY_RECONSTRUCTION_LIMITS,
  DECISION_POLICY_SYNTHETIC_RUBRICS, DECISION_POLICY_TARGETS, decisionPolicyBaseline, decisionPolicyFeatures, decisionPolicySnapshot, verifyDecisionPolicySourceArtifact } from "../src/judgement/decision-policy-data.js";

const iso = (day: number, hour = 0) => `2026-01-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
function fixture(): PortableLearnerData {
  return { generatedAt: iso(10), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
}
function check(data: PortableLearnerData, id: string, day: number, score: number, grading: "auto" | "model" | "pending" = "auto", question = `Question ${id}?`) {
  data.questionChecks.push({ id, topic: "Math", createdAt: iso(day), score, grading, question, answer: "Recorded answer" });
}
function review(data: PortableLearnerData, deckId: string, id: string, day: number, rating: 0 | 1 | 2 | 3) {
  let deck = data.decks.find(row => row.id === deckId);
  if (!deck) { deck = { id: deckId, title: deckId, topic: "Math", createdAt: iso(1), updatedAt: iso(1), cards: [
    { id: `${deckId}-card`, front: "Prompt", back: "Answer", tags: [], srs: initialSrsState(iso(1)) },
  ] }; data.decks.push(deck); }
  const card = deck.cards[0]!, createdAt = iso(day, 12), before = card.srs;
  const applied = applyReview(before, rating, createdAt); card.srs = applied.next; deck.updatedAt = createdAt;
  data.cardReviews.push({ id, deckId, cardId: card.id, rating, createdAt, appliedIntervalDays: applied.next.intervalDays,
    easeAfter: applied.next.ease, previousIntervalDays: before.intervalDays, nextDueAt: applied.next.dueAt,
    repetitionsAfter: applied.next.repetitions, lapsesAfter: applied.next.lapses, isLapse: applied.isLapse });
}
const source = (data: PortableLearnerData) => ({ sourceId: "source", learnerId: "learner", groupId: "group", split: "fit" as const, data });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function syntheticFixture() {
  const data = fixture(); check(data, "q", 2, 1); review(data, "deck", "r", 2, 0);
  const snapshot = { ...decisionPolicySnapshot(data, "Math", Date.parse(iso(6))), reconstruction: "explicit-simulated-harness-state" };
  const originalText = JSON.stringify({ id: "scenario", family: "family", actor: { opening_message: "I am unsure how to add fractions." }, learner: { assumptions: [] }, source: { dataset: "source", revision: "v1" } });
  const original = { ref: "scenarios.json#scenario:pre-action", sha256: sha(originalText), text: originalText };
  const state = { kind: "simulated-harness", seed: "test:1", assumptions: ["All practice history is explicitly simulated, not observed."], evidenceRefs: [original.ref] };
  const selection = { deckId: "deck", cardId: "deck-card" }, probabilities = { mastery: .81, retention: .42, urgency: .71 };
  const requestText = JSON.stringify({ model: "test-judge-v1", state: { original: original.text, snapshot: JSON.stringify(snapshot), simulation: JSON.stringify(state), selection },
    questions: Object.fromEntries(DECISION_POLICY_TARGETS.map(target => [target, { type: "noul", instructions: DECISION_POLICY_SYNTHETIC_RUBRICS[target] }])) });
  const rawResponse = { model: "test-judge-v1", answers: Object.fromEntries(DECISION_POLICY_TARGETS.map(target => [target, { type: "noul", noul: probabilities[target] }])) };
  return { schemaVersion: 1, format: "synthetic-decision-policy-source-v1", familyId: "family", originals: [original],
    records: DECISION_POLICY_TARGETS.map(target => ({ id: `test:${target}`, target, snapshot, selection, state, judgement: { model: "test-judge-v1", rubric: DECISION_POLICY_SYNTHETIC_RUBRICS[target], requestText, rawResponse,
      responsePath: ["answers", target, "noul"], probability: probabilities[target], receivedAt: iso(10) } })) };
}
function syntheticBinding(payload: ReturnType<typeof syntheticFixture>) {
  const text = JSON.stringify(payload), hash = sha(text);
  return { schemaVersion: 1, format: "portable-decision-policy-sources-v1", reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS],
    sources: [{ sourceId: hash, fileSha256: hash, learnerId: "synthetic:family", groupId: "family", split: "fit", text,
      provenance: { origin: "synthetic-judgement", dataset: "source", revision: "v1", schedule: "simulated-harness", notes: "Explicit source-grounded hypothetical practice; teacher agreement only." } }] };
}

test("synthetic receipts retain exact soft labels, shared features and distinct evidence domains", async () => {
  const payload = syntheticFixture(), { datasets } = await verifyDecisionPolicySourceArtifact(syntheticBinding(payload), async text => sha(text));
  for (const target of DECISION_POLICY_TARGETS) {
    expect(datasets[target].labelKind).toBe("judgement-probability");
    expect(datasets[target].domain.startsWith("synthetic-judgement-")).toBe(true);
    expect(datasets[target].rows[0]!.label).toBe(payload.records.find(row => row.target === target)!.judgement.probability);
    expect(datasets[target].rows[0]!.evidence.outcomeKind).toBe("synthetic-judgement");
  }
});

test("synthetic verification rejects detached probabilities, changed judge context, future packets and inconsistent schedules", async () => {
  for (const mutate of [
    (p: ReturnType<typeof syntheticFixture>) => { p.records[0]!.judgement.probability = .99; },
    (p: ReturnType<typeof syntheticFixture>) => { p.records[0]!.judgement.requestText = p.records[0]!.judgement.requestText.replace("unsure", "certain"); },
    (p: ReturnType<typeof syntheticFixture>) => { p.records[0]!.snapshot.cards[0]!.nextDueAt += 1_000; },
    (p: ReturnType<typeof syntheticFixture>) => { p.records[0]!.state.evidenceRefs = ["unseen-source"]; },
    (p: ReturnType<typeof syntheticFixture>) => { const original = p.originals[0]!; original.text = JSON.stringify({ ...JSON.parse(original.text), evaluation_only: { future: "answer" } }); original.sha256 = sha(original.text); },
  ]) {
    const payload = syntheticFixture(); mutate(payload);
    await expect(verifyDecisionPolicySourceArtifact(syntheticBinding(payload), async text => sha(text))).rejects.toThrow("decision_policy_source_invalid");
  }
});

test("strict-prior features exclude future scores, current schedules, model grades and duplicate tasks", () => {
  const data = fixture(); check(data, "first", 2, 1); check(data, "proxy", 3, 0, "model"); check(data, "repeat", 3, 0, "auto", " Question FIRST? ");
  check(data, "future", 6, 0); review(data, "deck", "prior", 2, 2); review(data, "deck", "later", 6, 0);
  expect(validatePortableLearnerData(data)).toBe(true);
  const prior = decisionPolicySnapshot(data, " math ", Date.parse(iso(4)));
  expect(prior.objective).toMatchObject({ count: 1, mean: 1, last: 1, ageDays: 2 });
  expect(prior.cards[0]!.nextDueAt).toBe(Date.parse(data.cardReviews[0]!.nextDueAt!));
  const changed = fixture(); check(changed, "first", 2, 1); check(changed, "proxy", 3, 0, "model"); check(changed, "repeat", 3, 0, "auto", " Question FIRST? ");
  check(changed, "future", 6, 1); review(changed, "deck", "prior", 2, 2); review(changed, "deck", "later", 6, 3);
  expect(decisionPolicySnapshot(changed, "Math", Date.parse(iso(4)))).toEqual(prior);
});

test("mastery baseline preserves existing status thresholds without calling status a probability", () => {
  for (const [score, status] of [[0.44, "needs-review"], [0.74, "developing"], [0.75, "strong"]] as const) {
    const data = fixture(); for (let i = 0; i < 3; i++) check(data, String(i), i + 2, score);
    const baseline = decisionPolicyBaseline(decisionPolicySnapshot(data, "Math", Date.parse(iso(5))), "mastery");
    expect(baseline).toMatchObject({ kind: "classification", status, predicted: status === "strong" ? 1 : 0 });
  }
  expect(decisionPolicyFeatures(decisionPolicySnapshot(fixture(), "Math", Date.parse(iso(5))), "mastery")).toBeNull();
});

test("delayed self-reported recall omits unknown objective features and tags reconstructed baseline inputs", () => {
  const data = fixture(); review(data, "deck", "prior", 2, 2);
  const snapshot = decisionPolicySnapshot(data, "Math", Date.parse(iso(4))), selection = { deckId: "deck", cardId: "deck-card" };
  const features = decisionPolicyFeatures(snapshot, "retention", selection)!;
  expect(features.objectiveMean).toBeUndefined(); expect(features.objectiveCount).toBeUndefined(); expect(features.recallRate).toBe(1);
  const baseline = decisionPolicyBaseline(snapshot, "retention", selection)!;
  expect(baseline).toMatchObject({ kind: "probability", input: "prior-card-recall-rate", mastery: 1, days: 1.5 });
  if (baseline.kind === "probability") expect(baseline.value).toBeCloseTo(Math.exp(-1.5 * Math.LN2 / 14));
  expect(decisionPolicyFeatures(decisionPolicySnapshot(data, "Math", Date.parse(iso(3))), "retention", selection)).toBeNull();
});

test("all three source-derived targets preserve distinct labels and censor unobserved due decks", () => {
  const data = fixture(); check(data, "first", 2, 0); check(data, "next", 3, 1); check(data, "proxy", 4, 1, "model");
  check(data, "copy", 5, 1, "auto", "Question next?");
  for (const id of ["a", "b", "c"]) review(data, id, `${id}-prior`, 2, 2);
  review(data, "a", "a-next", 5, 0); review(data, "b", "b-next", 5, 2);
  const datasets = buildDecisionPolicyDatasets([source(data)]);
  expect(datasets.mastery.rows.map(row => row.label)).toEqual([1]);
  expect(datasets.mastery.omissions["not-objective-observed-answer"]).toBe(1);
  expect(datasets.mastery.omissions["repeated-task"]).toBe(1);
  expect(datasets.retention.rows.map(row => row.label)).toEqual([0, 1]);
  expect(datasets.urgency.rows.map(row => row.label)).toEqual([1, 0]);
  expect(datasets.urgency.rows[0]!.asOf).toBe(Date.parse(iso(5)));
  expect(datasets.urgency.rows[0]!.baseline.kind).toBe("ordering");
  expect(datasets.urgency.rankingCohorts.at(-1)!.censoredDeckIds).toEqual(["c"]);
  expect(Object.values(datasets).every(dataset => dataset.audit.status === "insufficient")).toBe(true);
  expect(datasets.retention.rows[0]!.evidence.historyIds).not.toContain("a-next");
});

test("unknown current cards prevent reconstructing historical deck ranking; comparator matches lexicographic policy", () => {
  const data = fixture(); review(data, "a", "a-prior", 2, 2);
  data.decks[0]!.cards.push({ id: "unknown", front: "New", back: "Card", tags: [], srs: initialSrsState(iso(1)) });
  expect(decisionPolicyFeatures(decisionPolicySnapshot(data, "Math", Date.parse(iso(5))), "urgency", { deckId: "a" })).toBeNull();
  const common = { kind: "ordering" as const, overdueCount: 1, dueCount: 1, nextDueAt: null, webNextDueAt: null, title: "A", id: "a", policy: "coming-up-lexicographic-v1" as const };
  expect(compareDecisionPolicyUrgency(common, { ...common, overdueCount: 2 })).toBeGreaterThan(0);
  expect(compareDecisionPolicyUrgency(common, { ...common, nextDueAt: Date.parse(iso(6)) })).toBeGreaterThan(0);
  expect(compareDecisionPolicyUrgency(common, { ...common, title: "B" })).toBeLessThan(0);
});

test("source verifier pins exact bytes, carries public provenance and forbids learner/group split leakage", async () => {
  const data = fixture(); check(data, "first", 2, 0); check(data, "next", 3, 1);
  const text = JSON.stringify(data), digest = async (value: string) => createHash("sha256").update(value).digest("hex"), sha = await digest(text);
  const artifact = { schemaVersion: 1, format: "portable-decision-policy-sources-v1", reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS],
    sources: [{ sourceId: sha, fileSha256: sha, text, learnerId: "learner", groupId: "group", split: "fit", provenance: {
      origin: "public-human", dataset: "Recorded public source", revision: "pinned-revision", schedule: "replayed-keating-srs", notes: "Actual ratings, replayed scheduling." } }] };
  const verified = await verifyDecisionPolicySourceArtifact(artifact, digest);
  expect(verified.datasets.mastery.rows).toHaveLength(1); expect(verified.artifact.sources[0]!.provenance.schedule).toBe("replayed-keating-srs");
  await expect(verifyDecisionPolicySourceArtifact({ ...artifact, sources: [{ ...artifact.sources[0], text: `${text}\n` }] }, digest)).rejects.toThrow();
  await expect(verifyDecisionPolicySourceArtifact({ ...artifact, sources: [...artifact.sources, { ...artifact.sources[0], split: "validation" }] }, digest)).rejects.toThrow();
  expect(() => buildDecisionPolicyDatasets([source(data), { ...source(data), sourceId: "other", learnerId: "second", split: "validation" }])).toThrow("group_leakage");
});
