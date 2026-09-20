import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portableLearnerFixture } from "./fixtures.js";
import { dueAtAfterReview } from "../src/srs.js";
import { validatePortableLearnerData, type PortableLearnerData } from "../src/portable.js";
import { DECISION_POLICY_RECONSTRUCTION_LIMITS, DECISION_POLICY_SYNTHETIC_RUBRICS,
  type DecisionPolicySnapshot, type DecisionPolicyTarget, type SyntheticDecisionPolicySource, type DecisionPolicySourceArtifact } from "../src/judgement/decision-policy-data.js";
import { fitDecisionPolicy, verifyDecisionPolicyText, serializeDecisionPolicyFit, isVerifiedDecisionPolicy,
  MAX_DECISION_POLICY_FIT_BYTES } from "../src/judgement/decision-policy-fit.js";
import { exportDecisionPolicyFit } from "../../../scripts/training/fit-decision-policy.js";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const digest = async (text: string) => sha(text);

/** Deliberately synthetic unit fixtures exercising the observed export shape, never production evidence. */
function learner(index: number, invert = false): PortableLearnerData {
  const data = portableLearnerFixture();
  for (const key of Object.keys(data) as (keyof PortableLearnerData)[]) if (Array.isArray(data[key])) (data as unknown as Record<string, unknown>)[key] = [];
  data.generatedAt = "2026-08-11T00:00:00.000Z";
  for (let task = 0; task < 6; task++) {
    const positive = task % 2 === 0, label = invert ? !positive : positive, topic = `fixture-${index}-${task}`;
    data.questionChecks.push({ id: `prior-${task}`, topic, question: `${topic} prior`, answer: "fixture answer", score: positive ? .6 : .2,
      grading: "auto", createdAt: "2026-07-30T00:00:00.000Z" },
    { id: `outcome-${task}`, topic, question: `${topic} new question`, answer: "fixture answer", score: label ? 1 : 0,
      grading: "auto", createdAt: "2026-08-07T00:00:00.000Z" });
    const deckId = `deck-${task}`, cardId = `card-${task}`;
    const review = (id: string, rating: 0 | 3, createdAt: string) => ({ id, deckId, cardId, rating,
      previousIntervalDays: 1, appliedIntervalDays: rating === 0 ? 0 : 1, easeAfter: 2.5, createdAt,
      nextDueAt: dueAtAfterReview(createdAt, rating, rating === 0 ? 0 : 1), repetitionsAfter: rating === 0 ? 0 : 2,
      lapsesAfter: rating === 0 ? 1 : 0, isLapse: rating === 0 });
    const prior = review(`prior-review-${task}`, positive ? 3 : 0, positive ? "2026-08-01T12:00:00.000Z" : "2026-08-03T12:00:00.000Z");
    const outcome = review(`review-outcome-${task}`, label ? 3 : 0, "2026-08-10T12:00:00.000Z");
    data.cardReviews.push(prior, outcome);
    data.decks.push({ id: deckId, title: `${positive ? "A safe" : "Z lapse"} ${task}`, topic,
      createdAt: "2026-07-29T00:00:00.000Z", updatedAt: outcome.createdAt,
      cards: [{ id: cardId, front: topic, back: "fixture answer", tags: [], srs: { ease: outcome.easeAfter, intervalDays: outcome.appliedIntervalDays,
        repetitions: outcome.repetitionsAfter, lapses: outcome.lapsesAfter, dueAt: outcome.nextDueAt, lastReviewedAt: outcome.createdAt, lastRating: outcome.rating } }] });
  }
  if (!validatePortableLearnerData(data)) throw new Error("invalid fixture");
  return data;
}
function source(options: { invertValidation?: boolean; count?: number; noObjective?: boolean } = {}): DecisionPolicySourceArtifact {
  return { schemaVersion: 1, format: "portable-decision-policy-sources-v1", reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS],
    sources: Array.from({ length: options.count ?? 14 }, (_, index) => {
      const data = learner(index, index >= 8 && options.invertValidation);
      if (options.noObjective) data.questionChecks = [];
      const text = JSON.stringify(data), fileSha256 = sha(text);
      return { sourceId: fileSha256, fileSha256, text, learnerId: `fixture-${index}`, groupId: `fixture-group-${index}`,
        split: index < 8 ? "fit" as const : "validation" as const,
        provenance: { origin: "local-export" as const, dataset: "unit-test-fixture-only", revision: "fixture-v1", schedule: "observed" as const,
          notes: "Synthetic fixture only; these records are not authentic learner evidence." } };
    }) };
}
function softSource(target: DecisionPolicyTarget): DecisionPolicySourceArtifact {
  const sources = source().sources.map((bound, family) => {
    const familyId = bound.groupId, ref = `fixture-original-${family}`;
    const original = JSON.stringify({ id: ref, family: familyId, actor: { task: "unit fixture" }, source: { fixture: true } });
    const originals = [{ ref, text: original, sha256: sha(original) }];
    const records: SyntheticDecisionPolicySource["records"] = Array.from({ length: 6 }, (_, index) => {
      const positive = index % 2 === 0, asOf = Date.parse("2026-08-10T00:00:00.000Z");
      const history = { priorReviewCount: 4, recallRate: positive ? .9 : .1, lapseRate: positive ? .1 : .9,
        lastRating: positive ? 1 : 0, reviewAgeDays: 2, intervalDays: 1, lastReviewedAt: asOf - 2 * 86_400_000,
        evidenceIds: ["h1", "h2", "h3", "h4"] };
      const deckId = `d${index}`, cardId = `c${index}`;
      const snapshot: DecisionPolicySnapshot = { topic: `fixture-${index}`, asOf,
        objective: { count: 4, mean: positive ? .6 : .2, last: positive ? .6 : .2, ageDays: 1, evidenceIds: ["q1", "q2", "q3", "q4"] },
        progress: { mastery: positive ? .6 : .2, retention: null, confidence: .3, status: positive ? "developing" : "needs-review" },
        cards: [{ ...history, deckId, cardId, nextDueAt: asOf - 86_400_000 }],
        decks: [{ ...history, deckId, title: `${positive ? "A safe" : "Z lapse"}${index}`, cardCount: 1, knownCardCount: 1,
          scheduleComplete: true, dueCount: 1, overdueCount: 0, oldestDueDays: 1, nextDueAt: null }],
        reconstruction: "explicit-simulated-harness-state" };
      const state = { kind: "simulated-harness" as const, seed: "unit-test-seed", assumptions: ["Synthetic test fixture only."], evidenceRefs: [ref] };
      const selection = target === "mastery" ? {} : target === "retention" ? { deckId, cardId } : { deckId };
      const probability = (target === "urgency" ? !positive : positive) ? .85 : .15, model = "jev-unit-test-pinned";
      const rubric = DECISION_POLICY_SYNTHETIC_RUBRICS[target];
      const requestText = JSON.stringify({ model, state: { snapshot: JSON.stringify(snapshot), simulation: JSON.stringify(state), selection, original },
        questions: { [target]: { type: "noul", instructions: rubric } } });
      return { id: `fixture-${index}`, target, snapshot, selection, state,
        judgement: { model, rubric, requestText, rawResponse: { model, answers: { [target]: { type: "noul", noul: probability } } },
          responsePath: ["answers", target, "noul"], probability, receivedAt: "2026-08-10T00:01:00.000Z" } };
    });
    const payload: SyntheticDecisionPolicySource = { schemaVersion: 1, format: "synthetic-decision-policy-source-v1", familyId, originals, records };
    const text = JSON.stringify(payload), fileSha256 = sha(text);
    return { ...bound, sourceId: fileSha256, fileSha256, text,
      provenance: { ...bound.provenance, origin: "synthetic-judgement" as const, schedule: "simulated-harness" as const } };
  });
  return { schemaVersion: 1, format: "portable-decision-policy-sources-v1", reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS], sources };
}
const verify = async (artifact: Awaited<ReturnType<typeof fitDecisionPolicy>>) => {
  const text = serializeDecisionPolicyFit(artifact);
  return verifyDecisionPolicyText(text, sha(text), digest);
};

describe("source-bound target comparisons", () => {
  test("teacher probabilities stay soft through all three fit metrics and portable reload", async () => {
    for (const target of ["mastery", "retention", "urgency"] as const) {
      let calls = 0;
      const artifact = await fitDecisionPolicy(softSource(target), target, digest, { train: async dataset => {
        calls++;
        expect(new Set(dataset.observations.map(row => row.label))).toEqual(new Set([.85, .15]));
        return { framework: { name: "catboost", version: "1.2.10", parameters: { depth: 3, iterations: 300, loss_function: "CrossEntropy", boosting_type: "Plain", thread_count: 1 } },
          model: { features_info: { float_features: dataset.features.map((_, index) => ({ feature_index: index })) },
            scale_and_bias: [1, [0]], oblivious_trees: [{ splits: [{ split_type: "FloatFeature", float_feature_index: 0, border: 1 }], leaf_values: [0, 0] }] } };
      } });
      expect(calls).toBe(1);
      expect(artifact.selected).toBe("shallow-tree");
      expect(artifact.domain.startsWith("synthetic-judgement-")).toBe(true);
      expect(artifact.shallow.method).toBe("cart-soft-squared-error-v1");
      expect(artifact.shallow.metrics.metric.startsWith("teacher-")).toBe(true);
      expect(artifact.shallow.metrics.brier).toBeNull();
      expect(artifact.shallow.metrics.ece).toBeNull();
      const installed = await verify(artifact), row = artifact.dataset.rows[0];
      expect(installed.predict(row.features)).toBeCloseTo(row.label, 12);
      expect(artifact.shallow.metrics.candidateLoss).toBeCloseTo(target === "mastery" ? .15 : 0, 12);
      const corrupted = structuredClone(artifact);
      corrupted.boosting!.artifact.framework = { ...corrupted.boosting!.artifact.framework,
        parameters: { ...corrupted.boosting!.artifact.framework.parameters, loss_function: "Logloss" } };
      await expect(verify(corrupted)).rejects.toThrow("decision_policy_fit_invalid");
    }
  });
  test("all three targets beat their exact incumbent in independent fixture groups", async () => {
    for (const target of ["mastery", "retention", "urgency"] as const) {
      const artifact = await fitDecisionPolicy(source(), target, digest);
      expect(artifact.selected).toBe("shallow-tree");
      expect(artifact.shallow.metrics.candidateLoss).toBe(0);
      expect(artifact.shallow.metrics.baselineLoss).toBeGreaterThan(0);
      expect(artifact.shallow.counts.fitGroups).toBe(8);
      expect(artifact.shallow.counts.validationGroups).toBe(6);
      const installed = await verify(artifact);
      expect(isVerifiedDecisionPolicy(installed)).toBe(true);
      expect(isVerifiedDecisionPolicy({ ...installed })).toBe(false);
      expect(installed.predict(artifact.dataset.rows[0].features)).not.toBeNull();
      expect(installed.predict({ invented: 1 })).toBeNull();
      expect(installed.predict({ [artifact.dataset.features[0]]: 1 })).toBeNull();
      expect(installed.predict({ ...artifact.dataset.rows[0].features, [artifact.dataset.features[0]]: -1 })).toBeNull();
      if (target === "urgency") {
        expect(artifact.shallow.metrics.metric).toBe("discordant-cohort-ranking-error");
        expect(artifact.shallow.metrics.comparableGroups).toBe(6);
        expect(artifact.shallow.metrics.comparablePairs).toBe(54);
        expect(artifact.shallow.metrics.webBaselineLoss).toBeGreaterThan(0);
      }
    }
  });
  test("holdout labels cannot change the fitted tree or trigger an ensemble after failure", async () => {
    const good = await fitDecisionPolicy(source(), "mastery", digest);
    let calls = 0;
    const failed = await fitDecisionPolicy(source({ invertValidation: true }), "mastery", digest, { train: async () => { calls++; return {}; } });
    expect(failed.shallow.tree).toEqual(good.shallow.tree);
    expect(failed.status).toBe("failed-validation");
    expect(failed.selected).toBeNull();
    expect(calls).toBe(0);
    expect((await verify(failed)).predict(failed.dataset.rows[0].features)).toBeNull();
  });
  test("insufficient independent groups abstain despite repeated rows", async () => {
    const input = source();
    for (const row of input.sources) row.groupId = row.split;
    const artifact = await fitDecisionPolicy(input, "retention", digest);
    expect(artifact.status).toBe("insufficient");
    expect(artifact.selected).toBeNull();
    expect(artifact.shallow.reasons).toContain("insufficient-independent-validation-groups");
    const leaked = source(); leaked.sources[8].groupId = leaked.sources[0].groupId;
    await expect(fitDecisionPolicy(leaked, "mastery", digest)).rejects.toThrow("decision_policy_fit_invalid");
  });
  test("missing objective retention features remain absent and baseline provenance stays explicit", async () => {
    const artifact = await fitDecisionPolicy(source({ noObjective: true }), "retention", digest);
    expect(artifact.selected).toBe("shallow-tree");
    expect(artifact.dataset.rows[0].features.objectiveMean).toBeUndefined();
    expect(artifact.dataset.rows[0].baseline).toMatchObject({ input: "prior-card-recall-rate" });
    expect((await verify(artifact)).predict(artifact.dataset.rows[0].features)).not.toBeNull();
  });
  test("urgency needs discordant outcomes inside independent matched cohorts, not across unrelated learners", async () => {
    const input = source();
    for (const [index, row] of input.sources.entries()) {
      if (row.split !== "validation") continue;
      const data: PortableLearnerData = JSON.parse(row.text);
      for (const review of data.cardReviews.filter(value => value.id.startsWith("review-outcome"))) {
        review.rating = index % 2 === 0 ? 3 : 0;
        review.appliedIntervalDays = review.rating === 0 ? 0 : 1;
        review.nextDueAt = dueAtAfterReview(review.createdAt, review.rating, review.appliedIntervalDays);
        review.repetitionsAfter = review.rating === 0 ? 0 : 2;
        review.lapsesAfter = review.rating === 0 ? 1 : 0;
        review.isLapse = review.rating === 0;
        const card = data.decks.find(deck => deck.id === review.deckId)!.cards[0];
        Object.assign(card.srs, { intervalDays: review.appliedIntervalDays, dueAt: review.nextDueAt, lastRating: review.rating,
          repetitions: review.repetitionsAfter, lapses: review.lapsesAfter });
      }
      expect(validatePortableLearnerData(data)).toBe(true);
      row.text = JSON.stringify(data); row.fileSha256 = row.sourceId = sha(row.text);
    }
    const artifact = await fitDecisionPolicy(input, "urgency", digest);
    expect(artifact.shallow.counts.validationGroups).toBe(6);
    expect(artifact.shallow.metrics.comparableGroups).toBe(0);
    expect(artifact.shallow.metrics.comparablePairs).toBe(0);
    expect(artifact.status).toBe("insufficient");
    expect(artifact.selected).toBeNull();
  });
  test("urgency cannot activate when it beats mobile ordering but only ties the different web ordering", async () => {
    const input = source();
    for (const row of input.sources) {
      const data: PortableLearnerData = JSON.parse(row.text);
      for (const review of data.cardReviews.filter(value => value.id.startsWith("prior-review") && value.rating === 0)) {
        review.createdAt = "2026-08-01T12:00:00.000Z";
        review.nextDueAt = dueAtAfterReview(review.createdAt, review.rating, review.appliedIntervalDays);
      }
      row.text = JSON.stringify(data); row.fileSha256 = row.sourceId = sha(row.text);
    }
    const artifact = await fitDecisionPolicy(input, "urgency", digest);
    expect(artifact.shallow.metrics.baselineLoss).toBeGreaterThan(0);
    expect(artifact.shallow.metrics.webBaselineLoss).toBe(0);
    expect(artifact.shallow.metrics.candidateLoss).toBe(0);
    expect(artifact.shallow.metrics.beatsBaseline).toBe(false);
    expect(artifact.selected).toBeNull();
  });
  test("a worse pinned ensemble is reported but never replaces the passing tree", async () => {
    let calls = 0;
    const artifact = await fitDecisionPolicy(source(), "mastery", digest, { train: async dataset => {
      calls++;
      expect(dataset.observations.every(row => row.baseline === undefined)).toBe(true);
      return { framework: { name: "catboost", version: "1.2.10", parameters: { depth: 3, iterations: 300, loss_function: "Logloss", boosting_type: "Plain", thread_count: 1 } },
        model: { features_info: { float_features: dataset.features.map((_, index) => ({ feature_index: index })) },
          scale_and_bias: [1, [0]], oblivious_trees: [{ splits: [{ split_type: "FloatFeature", float_feature_index: 0, border: 1 }], leaf_values: [0, 0] }] } };
    } });
    expect(calls).toBe(1);
    expect(artifact.boosting?.evaluation.status).toBe("failed-validation");
    expect(artifact.selected).toBe("shallow-tree");
    expect((await verify(artifact)).artifact.selected).toBe("shallow-tree");
  });
  test("repinning edited metrics, tree, source, selection, domain or rows never bypasses rederivation", async () => {
    const original = await fitDecisionPolicy(source(), "mastery", digest);
    for (const mutate of [
      (a: typeof original) => { a.shallow.metrics.candidateLoss = .1; },
      (a: typeof original) => { a.shallow.tree = { kind: "leaf", probability: 1, sampleSize: 48 }; },
      (a: typeof original) => { a.source.sources[0].text += " "; },
      (a: typeof original) => { a.selected = "boosting"; },
      (a: typeof original) => { a.domain = "human-learning-gains"; },
      (a: typeof original) => { a.dataset.rows[0].label = 1 - a.dataset.rows[0].label as 0 | 1; },
    ]) {
      const altered = structuredClone(original); mutate(altered);
      await expect(verify(altered)).rejects.toThrow("decision_policy_fit_invalid");
    }
    const text = serializeDecisionPolicyFit(original);
    await expect(verifyDecisionPolicyText(text, "0".repeat(64), digest)).rejects.toThrow();
    await expect(verifyDecisionPolicyText(" ".repeat(MAX_DECISION_POLICY_FIT_BYTES + 1), sha(""), digest)).rejects.toThrow();
  });
  test("verified thresholds, source records and model identity cannot be mutated by consumers", async () => {
    const installed = await verify(await fitDecisionPolicy(source(), "mastery", digest));
    expect(Object.isFrozen(installed.artifact.shallow.tree)).toBe(true);
    expect(Object.isFrozen(installed.artifact.dataset.rows[0].features)).toBe(true);
    expect(() => { installed.artifact.selected = null; }).toThrow();
    expect(installed.artifact.selected).toBe("shallow-tree");
  });
  test("CLI writes private pinned artifacts and refuses an existing output directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keating-decision-fixture-"));
    try {
      const input = source(), manifest = { schemaVersion: 1, sources: [] as { path: string; sha256: string; learnerId: string; groupId: string; split: string }[] };
      for (const [index, row] of input.sources.entries()) {
        const path = join(directory, `${index}.json`); await writeFile(path, row.text, { mode: 0o600 });
        manifest.sources.push({ path, sha256: row.fileSha256, learnerId: row.learnerId, groupId: row.groupId, split: row.split });
      }
      const output = join(directory, "fit");
      const result = await exportDecisionPolicyFit(directory, manifest, "mastery", output, { shallowOnly: true });
      const text = await readFile(join(output, "decision-policy.json"), "utf8");
      expect(result.fileSha256).toBe(sha(text));
      expect((await verifyDecisionPolicyText(text, result.fileSha256, digest)).artifact.selected).toBe("shallow-tree");
      expect((await stat(output)).mode & 0o777).toBe(0o700);
      expect((await stat(join(output, "decision-policy.json"))).mode & 0o777).toBe(0o600);
      await expect(exportDecisionPolicyFit(directory, manifest, "mastery", output, { shallowOnly: true })).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
