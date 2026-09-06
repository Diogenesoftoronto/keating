import { afterEach, describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeRealOutcomeScore, type ScoreableLearnerOutcome } from "../shared/pedagogy/benchmark-real.js";
import { benchmarkToMarkdown, extractHarnessOutcomes, runBenchmarkSuite } from "../src/core/benchmark.js";
import { loadLearnerState, recordFeedback, recordQuizResult } from "../src/core/learner-state.js";
import { learnerStatePath } from "../src/core/paths.js";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS } from "../src/core/policy.js";
import { resolveTopic } from "../src/core/topics.js";
import { arbPolicy, arbWeights } from "./helpers.js";

const topic = resolveTopic("derivative");
const feedback = (overrides: Partial<ScoreableLearnerOutcome> = {}): ScoreableLearnerOutcome => ({
  topic: topic.slug,
  feedbackSignal: "thumbs-up",
  masteryEstimate: 1,
  outcomeScore: 0.85,
  evidenceKind: "explicit-feedback",
  ...overrides,
});
const score = (outcomes: ScoreableLearnerOutcome[]) => computeRealOutcomeScore(outcomes, DEFAULT_POLICY, topic, DEFAULT_WEIGHTS);
const directories: string[] = [];
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-observed-benchmark-"));
  directories.push(cwd);
  return { cwd, state: await loadLearnerState(learnerStatePath(cwd)) };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

describe("retrospective benchmark measurement integrity", () => {
  test("fixed evidence is invariant under arbitrary policy and scoring-weight changes", () => {
    const corpora = [
      Array.from({ length: 5 }, () => feedback()),
      [feedback(), feedback({ quizScore: 0.7, evidenceKind: "graded-assessment" })],
      [],
    ];
    fc.assert(fc.property(arbPolicy, arbWeights, (policy, weights) => {
      for (const corpus of corpora) {
        expect(computeRealOutcomeScore(corpus, policy, topic, weights)).toEqual(score(corpus));
      }
    }), { numRuns: 100 });
  });

  test("positive feedback and mastery estimates do not manufacture learning measurements", () => {
    const result = score(Array.from({ length: 50 }, () => feedback()));
    expect(result.evidence?.score.source).toBe("proxy");
    expect(result.evidence?.assessmentPerformance.value).toBeNull();
    for (const metric of ["masteryGain", "retention", "transfer"] as const) {
      expect(result.evidence?.metrics[metric]).toMatchObject({ value: null, source: "unavailable", sampleSize: 0 });
    }
    expect(result.evidence?.eligibleForPromotion).toBe(false);
  });

  test("recorded quiz performance stays separate from feedback proxies and learning gain", () => {
    const assessment = feedback({ quizScore: 0.6, outcomeScore: 0.6, evidenceKind: "graded-assessment" });
    const result = score([assessment, feedback()]);
    expect(result.score).toBe(0.6);
    expect(result.evidence?.score).toMatchObject({ value: 0.6, source: "observed", sampleSize: 1 });
    expect(result.evidence?.metrics.masteryGain.value).toBeNull();
    expect(result.evidence?.metrics.engagement.source).toBe("proxy");
    expect(result.evidence?.feedbackCounts.explicit).toBe(1);
    expect(score([assessment, feedback({ feedbackSignal: "thumbs-down", outcomeScore: 0.15 })]).score).toBe(0.6);
    expect(score([assessment]).evidence?.metrics.confusion.value).toBeNull();
  });

  test("missing and invalid scores remain unavailable while a measured zero is observed", () => {
    for (const corpus of [[], ...[NaN, Infinity, -1, 2].map((quizScore) => [feedback({ quizScore, evidenceKind: "graded-assessment" })])]) {
      const result = score(corpus);
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.evidence?.score).toMatchObject({ value: null, source: "unavailable", sampleSize: 0 });
      expect(JSON.parse(JSON.stringify(result)).evidence.score.value).toBeNull();
    }
    expect(score([feedback({ quizScore: 0, evidenceKind: "graded-assessment" })]).evidence?.score)
      .toMatchObject({ value: 0, source: "observed", sampleSize: 1 });
  });

  test("stored explicit, inferred, and assessment records preserve distinct provenance", async () => {
    const { cwd, state } = await workspace();
    recordFeedback(state, topic.slug, "thumbs-up");
    recordQuizResult(state, topic.slug, 4, 5);
    await mkdir(join(cwd, ".keating", "sessions"), { recursive: true });
    await writeFile(join(cwd, ".keating", "sessions", "example.json"), JSON.stringify({
      messages: [{ role: "user", content: "I am confused about the derivative." }],
    }));
    const outcomes = await extractHarnessOutcomes(cwd, state);
    expect(outcomes.map((outcome) => outcome.evidenceKind)).toEqual(["explicit-feedback", "graded-assessment", "inferred-feedback"]);
    expect(score(outcomes).evidence?.feedbackCounts).toEqual({ explicit: 1, inferred: 1, unclassified: 0 });
  });

  test("reports render unknown metrics and never turn five feedback events into validation", async () => {
    const { cwd, state } = await workspace();
    for (let i = 0; i < 5; i += 1) recordFeedback(state, topic.slug, "thumbs-up");
    const result = await runBenchmarkSuite(cwd, DEFAULT_POLICY, topic.slug, 1, 3, DEFAULT_WEIGHTS, state);
    const report = benchmarkToMarkdown(result);
    expect(result.trace.evaluationMode).toBe("retrospective");
    expect(result.trace.eligibleForPromotion).toBe(false);
    expect(result.topicBenchmarks[0]?.evidence).toEqual(result.trace.topicTraces[0]?.evidence);
    expect(report).toContain("(proxy) | unknown | unknown");
    expect(report).toContain("Validates a candidate policy: no");
    expect(report).not.toContain("ready for policy evolution");
  });

  test("feedback on another topic does not masquerade as evidence for the focus topic", async () => {
    const { cwd, state } = await workspace();
    for (let i = 0; i < 5; i += 1) recordFeedback(state, "entropy", "thumbs-up");
    const result = await runBenchmarkSuite(cwd, DEFAULT_POLICY, topic.slug, 1, 3, DEFAULT_WEIGHTS, state);
    expect(result.trace.realOutcomeCount).toBe(0);
    expect(result.trace.dataSource).toBe("no-learner-feedback");
    expect(result.weakestTopic).toBe("n/a");
    expect(benchmarkToMarkdown(result)).toContain("Overall descriptive score: unknown");
  });

  test("internal synthetic simulation remains explicitly separate", async () => {
    const { cwd } = await workspace();
    const result = await runBenchmarkSuite(cwd, DEFAULT_POLICY, topic.slug);
    expect(result.trace.evaluationMode).toBe("synthetic");
    expect(result.trace.syntheticFallback).toBe(true);
    expect(result.trace.eligibleForPromotion).toBe(false);
    expect(result.topicBenchmarks[0]?.evidence).toBeUndefined();
    expect(benchmarkToMarkdown(result)).toContain("Synthetic scores test model assumptions");
  });
});
