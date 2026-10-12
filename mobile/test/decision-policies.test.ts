import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { applyReview, initialSrsState, validatePortableLearnerData, validateFlashcardDeck, validateCardReviewRecord, type PortableLearnerData } from "@keating/learner-contracts";
import { DECISION_POLICY_RECONSTRUCTION_LIMITS, verifyDecisionPolicySourceArtifact, type DecisionPolicySourceArtifact } from "../../packages/learner-contracts/src/judgement/decision-policy-data";
import { fitDecisionPolicy, serializeDecisionPolicyFit, type VerifiedDecisionPolicy } from "../../packages/learner-contracts/src/judgement/decision-policy-fit";
import { MobileDecisionPolicyStore, importMobileDecisionPolicy, mobileDecisionEstimate, mobileDecisionPolicyEvidenceLabel, chunkedDecisionPolicyStorage, privateFileDecisionPolicyStorage } from "../src/lib/judgement/decision-policies";
import { buildLearnerProgress } from "../src/lib/learner-progress";
import { buildComingUp } from "../src/lib/learner-study";

const hash = async (text: string) => createHash("sha256").update(text).digest("hex");
const iso = (day: number, hour = 0) => new Date(Date.UTC(2026, 0, day, hour)).toISOString();
function data(group = 0): PortableLearnerData {
  const value: PortableLearnerData = { generatedAt: "2039-01-01T00:00:00.000Z", sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
  for (let day = 2; day <= 12; day++) value.questionChecks.push({ id: `q${group}-${day}`, topic: "Math", createdAt: iso(day),
    question: `Task ${group} ${day}?`, answer: "Saved answer", grading: "auto", score: group % 2 });
  for (const [id, rating] of [["a-good", 1], ["b-risk", 0], ["c-recall", 2]] as const) {
    const card = { id: `${id}-card`, front: "Question", back: "Answer", tags: [], srs: initialSrsState(iso(1)) };
    const deck = { id, title: id, topic: "Math", createdAt: iso(1), updatedAt: iso(1), cards: [card] };
    value.decks.push(deck);
    for (let day = 2; day <= 12; day++) {
      // Recent lapses keep the risky deck's due date newer than the good deck's.
      // Both schedule incumbents must then use prior recall evidence to improve.
      if (id === "b-risk") {
        const before = card.srs, at = new Date(Date.UTC(2026 + day, 0, 1, 12)).toISOString(), applied = applyReview(before, rating, at);
        card.srs = applied.next;
        value.cardReviews.push({ id: `${id}-${group}-${day}-prior`, deckId: id, cardId: card.id, rating, createdAt: at,
          appliedIntervalDays: applied.next.intervalDays, easeAfter: applied.next.ease, previousIntervalDays: before.intervalDays,
          nextDueAt: applied.next.dueAt, repetitionsAfter: applied.next.repetitions, lapsesAfter: applied.next.lapses, isLapse: applied.isLapse });
      }
      const before = card.srs, at = new Date(Date.UTC(2026 + day, 0, 2, 12)).toISOString(), applied = applyReview(before, rating, at);
      card.srs = applied.next; deck.updatedAt = at;
      value.cardReviews.push({ id: `${id}-${group}-${day}`, deckId: id, cardId: card.id, rating, createdAt: at,
        appliedIntervalDays: applied.next.intervalDays, easeAfter: applied.next.ease, previousIntervalDays: before.intervalDays,
        nextDueAt: applied.next.dueAt, repetitionsAfter: applied.next.repetitions, lapsesAfter: applied.next.lapses, isLapse: applied.isLapse });
    }
  }
  return value;
}
const storage = () => { const values = new Map<string, string>(); return { values, getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } }; };
let fixtures: Promise<Record<"mastery" | "retention" | "urgency", string>> | undefined;
function reports() {
  return fixtures ??= (async () => {
    const source: DecisionPolicySourceArtifact = { schemaVersion: 1, format: "portable-decision-policy-sources-v1",
      reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS], sources: [] };
    for (let group = 0; group < 14; group++) {
      const original = data(group);
      expect(original.decks.filter(row => !validateFlashcardDeck(row))).toEqual([]);
      expect(original.cardReviews.filter(row => !validateCardReviewRecord(row))).toEqual([]);
      expect(validatePortableLearnerData(original)).toBe(true);
      const text = JSON.stringify(original), pin = await hash(text);
      source.sources.push({ sourceId: pin, fileSha256: pin, text, learnerId: `learner-${group}`, groupId: `group-${group}`,
        split: group < 8 ? "fit" : "validation", provenance: { origin: "local-export", dataset: "Synthetic boundary fixture",
          revision: "fixture-v1", schedule: "observed", notes: "Deterministic test rows, not learning efficacy evidence." } });
    }
    await verifyDecisionPolicySourceArtifact(source, hash);
    const pairs = await Promise.all((["mastery", "retention", "urgency"] as const).map(async target => {
      const artifact = await fitDecisionPolicy(source, target, hash);
      expect({ target, selected: artifact.selected, reasons: artifact.shallow.reasons }).toEqual({ target, selected: "shallow-tree", reasons: [] });
      return [target, serializeDecisionPolicyFit(artifact)] as const;
    }));
    return Object.fromEntries(pairs) as Record<"mastery" | "retention" | "urgency", string>;
  })();
}

test("pinned measured installation rejects tampering/target mismatch and survives exact reload/removal", async () => {
  const files = await reports(), disk = storage(), store = new MobileDecisionPolicyStore("mastery", disk, hash);
  const installed = await importMobileDecisionPolicy(store, await hash(files.mastery), async () => ({ sizeBytes: Buffer.byteLength(files.mastery), readText: async () => files.mastery }));
  expect(installed?.artifact.selected).toBe("shallow-tree"); expect((await store.load())?.sha256).toBe(installed?.sha256);
  await expect(store.install(files.mastery + " ", await hash(files.mastery))).rejects.toThrow();
  const tampered = JSON.parse(files.mastery); tampered.shallow.tree = { kind: "leaf", probability: 0.99 };
  const text = JSON.stringify(tampered); await expect(store.install(text, await hash(text))).rejects.toThrow();
  await expect(store.install(files.retention, await hash(files.retention))).rejects.toThrow();
  const before = store.getRevision(), removal = store.remove(); expect(store.isCurrent(before)).toBe(false); await removal;
  expect(await store.load()).toBeNull();
});

test("archived verified policies remain usable as benchmark references without changing live projections", async () => {
  const files = await reports(), policies: Partial<Record<"mastery" | "retention" | "urgency", VerifiedDecisionPolicy>> = {};
  for (const target of ["mastery", "retention", "urgency"] as const) policies[target] = await new MobileDecisionPolicyStore(target, storage(), hash).install(files[target], await hash(files[target]));
  const source = data(1), nowIso = source.generatedAt, now = Date.parse(nowIso), original = JSON.stringify(source);
  source.questionChecks = source.questionChecks.slice(0, 1);
  const baseline = buildLearnerProgress(source, now);
  const mastery = mobileDecisionEstimate(policies.mastery, "mastery", source, "Math", now);
  expect(mastery).toMatchObject({ value: 1, method: "shallow-tree", labelKind: "observed-binary", evidenceLabel: "Recorded-outcome fit; personal calibration unverified", datasets: ["Synthetic boundary fixture"] });
  const recall = source.decks.flatMap(deck => deck.cards.flatMap(card => {
    const estimate = mobileDecisionEstimate(policies.retention, "retention", source, "Math", now, { deckId: deck.id, cardId: card.id });
    return estimate ? [estimate.value] : [];
  }));
  expect(recall).toHaveLength(3); expect(recall.reduce((sum, value) => sum + value, 0) / recall.length).toBeCloseTo(1 / 3);
  expect(buildLearnerProgress(source, now)).toEqual(baseline);
  const fake = { ...policies.mastery!, predict: () => 1 };
  expect(mobileDecisionEstimate(fake, "mastery", source, "Math", now)).toBeNull();
  expect(mobileDecisionEstimate(policies.mastery, "retention", source, "Math", now)).toBeNull();
  const noHistory = { ...source, questionChecks: [], cardReviews: [] };
  expect(mobileDecisionEstimate(policies.mastery, "mastery", noHistory, "Math", now)).toBeNull();
  expect(mobileDecisionEstimate(policies.retention, "retention", noHistory, "Math", now, { deckId: "a-good", cardId: "a-good-card" })).toBeNull();
  source.questionChecks = JSON.parse(original).questionChecks;
  expect(JSON.stringify(source)).toBe(original);

  const existing = buildComingUp(source, buildLearnerProgress(source, now), nowIso);
  const good = mobileDecisionEstimate(policies.urgency, "urgency", source, "Math", now, { deckId: "a-good" });
  const risky = mobileDecisionEstimate(policies.urgency, "urgency", source, "Math", now, { deckId: "b-risk" });
  expect(risky!.value).toBeGreaterThan(good!.value);
  expect(existing.lanes.focus.map(row => row.targetId)).toEqual(["a-good", "b-risk"]);
  expect(buildComingUp(source, buildLearnerProgress(source, now), nowIso)).toEqual(existing);
  expect(JSON.stringify(source)).toBe(original);
  const chosen = structuredClone(source);
  chosen.studyPriorities.push({ id: "chosen", targetType: "deck", targetId: "b-risk", priority: "low", updatedAt: nowIso });
  const chosenPlan = buildComingUp(chosen, buildLearnerProgress(chosen, now), nowIso);
  expect(chosenPlan.lanes.low.map(row => row.targetId)).toEqual(["b-risk"]);
  expect(chosenPlan.lanes.focus.map(row => row.targetId)).toEqual(["a-good"]);
});

// Both label families can be valid fits, but describe different evidence.
test("policy display distinguishes judge probabilities from recorded outcomes", () => {
  expect(mobileDecisionPolicyEvidenceLabel("judgement-probability")).toBe("Synthetic judge-probability fit; no observed learning outcome");
  expect(mobileDecisionPolicyEvidenceLabel("observed-binary")).toBe("Recorded-outcome fit; personal calibration unverified");
});

test("large native policies publish bounded chunks atomically, reload and remove exact chunks", async () => {
  const disk = storage(); let sequence = 0;
  const adapter = chunkedDecisionPolicyStorage(disk, async () => `test-policy-nonce-${++sequence}`);
  const text = "😀source\\\"".repeat(400_000);
  expect(Buffer.byteLength(text)).toBeGreaterThan(2 * 1024 * 1024);
  await adapter.setItem("policy", text);
  expect([...disk.values.values()].every(value => Buffer.byteLength(value) <= 512 * 1024)).toBe(true);
  expect(disk.values.get("policy")!.length).toBeLessThan(1024);
  const reopened = chunkedDecisionPolicyStorage(disk, async () => `test-policy-nonce-${++sequence}`);
  expect(await reopened.getItem("policy")).toBe(text);
  await adapter.setItem("policy", "replacement");
  expect(await adapter.getItem("policy")).toBe("replacement");
  expect(disk.values.size).toBe(2);
  await adapter.removeItem("policy"); expect(disk.values.size).toBe(0);
});

test("failed chunk publication preserves installed policy and missing chunks abstain", async () => {
  const disk = storage(); let fail = false, sequence = 0;
  const adapter = chunkedDecisionPolicyStorage({ ...disk, setItem: async (key, value) => {
    if (fail && key === "policy") throw Error("disk full");
    await disk.setItem(key, value);
  } }, async () => `test-policy-nonce-${++sequence}`);
  await adapter.setItem("policy", "previous"); fail = true;
  await expect(adapter.setItem("policy", "x".repeat(3 * 1024 * 1024))).rejects.toThrow("disk full");
  expect(await adapter.getItem("policy")).toBe("previous"); expect(disk.values.size).toBe(2);
  const key = [...disk.values.keys()].find(key => key !== "policy")!; disk.values.delete(key);
  await expect(adapter.getItem("policy")).rejects.toThrow("decision_policy_chunk_missing");
});

test("private file storage keeps actual-size fits out of the Android SQLite budget", async () => {
  const manifests = storage(), files = storage();
  const adapter = privateFileDecisionPolicyStorage(manifests, files, async () => "private-file-policy-0001");
  const payload = "fit".repeat(5 * 1024 * 1024);
  await adapter.setItem("policy", payload);
  expect([...manifests.values.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0)).toBeLessThan(1024);
  expect(await adapter.getItem("policy")).toBe(payload);
  expect(files.values.size).toBeGreaterThan(100);
  await adapter.removeItem("policy");
  expect(manifests.values.size).toBe(0); expect(files.values.size).toBe(0);
});
