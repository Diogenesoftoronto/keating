import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createHash } from "node:crypto";
import { DECISION_POLICY_RECONSTRUCTION_LIMITS, DECISION_POLICY_SYNTHETIC_RUBRICS, type DecisionPolicySnapshot, type DecisionPolicyTarget } from "../../../packages/learner-contracts/src/judgement/decision-policy-data";
import { fitDecisionPolicy, serializeDecisionPolicyFit } from "../../../packages/learner-contracts/src/judgement/decision-policy-fit";
import { indexedDbDecisionPolicyStorage, projectWebDecisionPolicies, webDecisionDigest, webDecisionExploration, webDecisionSnapshot, WebDecisionPolicyStore, type WebDecisionEvidence, type WebDecisionPolicies } from "../keating/judgement/decision-policies";
import { buildComingUpQueue } from "../keating/coming-up";
import type { LearnerState } from "../keating/storage";
const DAY = 86400000, NOW = Date.UTC(2026, 8, 1), sha = (text: string) => createHash("sha256").update(text).digest("hex");

function source(target: DecisionPolicyTarget) {
  return { schemaVersion: 1, format: "portable-decision-policy-sources-v1", reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS], sources: Array.from({ length: 14 }, (_, group) => {
    const family = `fixture-${group}`, original = JSON.stringify({ id: family, family, actor: { task: "unit fixture only" }, source: { fixture: true } });
    const records = Array.from({ length: 6 }, (_, index) => {
      const positive = index % 2 === 0, deckId = `deck-${index}`, cardId = "card", mean = positive ? .6 : .2;
      const history = { priorReviewCount: 4, recallRate: positive ? .75 : .25, lapseRate: positive ? .25 : .75, lastRating: 2 / 3,
        reviewAgeDays: 2, intervalDays: 1, lastReviewedAt: NOW - 2 * DAY, evidenceIds: ["r1", "r2", "r3", "r4"] };
      const snapshot: DecisionPolicySnapshot = { topic: "Math", asOf: NOW, objective: { count: 5, mean, last: 1, ageDays: 1, evidenceIds: ["q1", "q2", "q3", "q4", "q5"] },
        progress: { mastery: mean, retention: null, confidence: .8, status: positive ? "developing" : "needs-review" },
        cards: [{ ...history, deckId, cardId, nextDueAt: NOW - DAY }], decks: [{ ...history, deckId, title: `${positive ? "A safe" : "Z lapse"}${index}`,
          cardCount: 1, knownCardCount: 1, scheduleComplete: true, dueCount: 1, overdueCount: 0, oldestDueDays: 1, nextDueAt: null }], reconstruction: "explicit-simulated-harness-state" };
      const state = { kind: "simulated-harness", seed: `fixture-${index}`, assumptions: ["Unit-test simulation, never production evidence."], evidenceRefs: [family] };
      const selection = { deckId, cardId }, model = "test-judge", rubric = DECISION_POLICY_SYNTHETIC_RUBRICS[target], probability = (target === "urgency" ? !positive : positive) ? .85 : .15;
      return { id: String(index), target, snapshot, selection, state, judgement: { model, rubric, probability, receivedAt: new Date(NOW).toISOString(),
        responsePath: ["answers", target, "noul"], rawResponse: { model, answers: { [target]: { type: "noul", noul: probability } } },
        requestText: JSON.stringify({ model, state: { original, snapshot: JSON.stringify(snapshot), simulation: JSON.stringify(state), selection }, questions: { [target]: { type: "noul", instructions: rubric } } }) } };
    });
    const text = JSON.stringify({ schemaVersion: 1, format: "synthetic-decision-policy-source-v1", familyId: family, originals: [{ ref: family, text: original, sha256: sha(original) }], records });
    return { sourceId: sha(text), fileSha256: sha(text), text, learnerId: family, groupId: family, split: group < 8 ? "fit" : "validation",
      provenance: { origin: "synthetic-judgement", dataset: "unit-fixture", revision: "v1", schedule: "simulated-harness", notes: "Unit fixture only." } };
  }) };
}
async function policyText(target: DecisionPolicyTarget) {
  return serializeDecisionPolicyFit(await fitDecisionPolicy(source(target), target, async text => sha(text)));
}
function evidence(): WebDecisionEvidence {
  return { checks: [{ id: "q", topic: "Math", question: "What is two plus two?", answer: "4", score: .6, grading: "auto", createdAt: NOW - DAY }],
    reviews: [{ id: "r", topic: "Math", slug: "math", deckId: "a", cardId: "card", rating: 2, appliedIntervalDays: 1, easeAfter: 2.5, createdAt: NOW - 2 * DAY }],
    decks: [{ id: "a", topic: "Math", slug: "math", title: "A", createdAt: NOW - 3 * DAY, updatedAt: NOW - 2 * DAY, cards: [{ id: "card", front: "Question", back: "Answer", createdAt: NOW - 3 * DAY, updatedAt: NOW - 2 * DAY,
      srs: { ease: 2.5, intervalDays: 1, reps: 1, lapses: 0, lastReviewedAt: NOW - 2 * DAY, lastRating: 2, dueAt: NOW - DAY } }] }] };
}
const learner: LearnerState = { schemaVersion: 3, topicsExplored: [], feedbackHistory: [], strengths: [], weaknesses: [], topicProfiles: [], sessionsCount: 0, sessions: [], profileBeliefs: [], studyPriorities: [] };

test("live feature projection uses strict-prior objective checks and matching saved card history, abstaining on missing or changed history", () => {
  const data = evidence(), snapshot = webDecisionSnapshot(data, "math", NOW);
  expect(snapshot.objective?.mean).toBe(.6); expect(snapshot.cards[0]?.recallRate).toBe(1); expect(snapshot.decks[0]?.dueCount).toBe(1);
  data.checks.push({ ...data.checks[0]!, id: "repeat", score: 0 }, { ...data.checks[0]!, id: "proxy", question: "Different", grading: "model", score: 0 }, { ...data.checks[0]!, id: "future", question: "Future", createdAt: NOW + DAY, score: 0 });
  expect(webDecisionSnapshot(data, "math", NOW).objective?.mean).toBe(.6);
  data.decks[0]!.cards[0]!.srs.lastReviewedAt += 1;
  expect(webDecisionSnapshot(data, "math", NOW).cards).toEqual([]); expect(webDecisionSnapshot(data, "math", NOW).decks[0]?.scheduleComplete).toBe(false);
});

test("IndexedDB policies survive reload only with exact verified target/source/model; invalid imports preserve the old policy", async () => {
  const storage = indexedDbDecisionPolicyStorage(new IDBFactory()), store = new WebDecisionPolicyStore(storage), text = await policyText("retention");
  const installed = await store.import("retention", text); expect(installed.artifact.status).toBe("validated");
  expect((await new WebDecisionPolicyStore(storage).load("retention"))?.sha256).toBe(sha(text));
  await expect(store.import("mastery", text)).rejects.toThrow();
  const tampered = JSON.parse(text); tampered.selected = null;
  await expect(store.import("retention", JSON.stringify(tampered))).rejects.toThrow();
  expect((await store.load("retention"))?.sha256).toBe(sha(text));
  await storage.put("retention", { text, sha256: "a".repeat(64) }); expect(await store.load("retention")).toBeNull();
  await store.remove("retention"); expect(await store.load("retention")).toBeNull(); expect(await webDecisionDigest(text)).toBe(sha(text));
});

test("verified estimates consume live records and urgency respects explicit lanes and fixed baseline slots", async () => {
  const store = new WebDecisionPolicyStore(indexedDbDecisionPolicyStorage(new IDBFactory())), policies: WebDecisionPolicies = {};
  for (const target of ["mastery", "retention", "urgency"] as const) policies[target] = await store.import(target, await policyText(target));
  const data = evidence();
  const ids = Array.from({ length: 30 }, (_, index) => `d${index}`);
  data.decks = ids.map((id, index) => ({ ...structuredClone(data.decks[0]!), id, title: String(index).padStart(2, "0"), cards: data.decks[0]!.cards.map(card => ({ ...structuredClone(card),
    srs: { ...card.srs, lastRating: index % 2 ? 0 : 2, intervalDays: index % 2 ? 0 : 1,
      lastReviewedAt: NOW - (index % 2 ? 2 : 4) * DAY, dueAt: index % 2 ? NOW - 2 * DAY + 600000 : NOW - 3 * DAY } })) }));
  data.reviews = ids.map((id, index) => ({ ...data.reviews[0]!, id: `r${index}`, deckId: id, rating: index % 2 ? 0 : 2,
    appliedIntervalDays: index % 2 ? 0 : 1, createdAt: NOW - (index % 2 ? 2 : 4) * DAY }));
  const state = { ...learner, studyPriorities: [{ targetId: ids[0]!, targetType: "deck" as const, priority: "low" as const, updatedAt: NOW }] };
  const queue = buildComingUpQueue({ decks: data.decks, verifications: [], learnerState: state, now: NOW }), before = JSON.stringify(data);
  const projected = projectWebDecisionPolicies(queue, data, policies, NOW);
  expect(projected.lanes.low.map(item => item.targetId)).toEqual([ids[0]!]);
  expect(projected.items[0]?.decisionEstimates?.mastery?.evidenceLabel).toContain("Synthetic");
  expect(projected.items[0]?.decisionEstimates?.retention).toBeDefined(); expect(projected.items[0]?.decisionEstimates?.urgency).toBeDefined();
  for (const [index, item] of queue.lanes.focus.entries()) if (webDecisionExploration(item.id)) expect(projected.lanes.focus[index]?.id).toBe(item.id);
  expect(projected.lanes.focus.map(item => item.id)).not.toEqual(queue.lanes.focus.map(item => item.id));
  expect(JSON.stringify(data)).toBe(before); expect(projected.dueCardCount).toBe(queue.dueCardCount);
  expect(projectWebDecisionPolicies(queue, data, {}, NOW).dueDeckIds).toEqual(queue.dueDeckIds);
});
