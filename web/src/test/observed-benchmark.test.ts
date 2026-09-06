import { describe, expect, test } from "bun:test";
import {
  benchmarkPerModel, benchmarkToMarkdown, DEFAULT_POLICY, DEFAULT_WEIGHTS, diagnoseBenchmark,
  extractBrowserOutcomes, extractSessionTurnOutcomes, mapElitesEvolve, quizRecordsToOutcomes,
  runBenchmarkSuite, type BrowserLearnerOutcome,
} from "../keating/core";

const feedback = () => extractBrowserOutcomes(Array.from({ length: 5 }, () => ({ topic: "derivative", signal: "thumbs-up" as const })), ["derivative"]);

describe("browser retrospective benchmark integrity", () => {
  test("policy and weight changes cannot alter fixed evidence, metrics, or evidence reports", () => {
    const corpus = [...feedback(), ...quizRecordsToOutcomes([{ topic: "derivative", score: 3, totalQuestions: 5 }])];
    const baseline = runBenchmarkSuite(DEFAULT_POLICY, "derivative", 1, 3, DEFAULT_WEIGHTS, corpus);
    const candidate = runBenchmarkSuite({ ...DEFAULT_POLICY, retrievalPractice: 1, interdisciplinaryBias: 1, formalism: 0, exerciseCount: 1 },
      "derivative", 1, 3, { masteryGain: 0, retention: 1, engagement: 0, transfer: 0, confusion: 0 }, corpus);
    expect(candidate.overallScore).toBe(baseline.overallScore);
    expect(candidate.topicBenchmarks).toEqual(baseline.topicBenchmarks);
    expect(candidate.trace).toEqual(baseline.trace);
    expect(benchmarkToMarkdown(candidate)).toBe(benchmarkToMarkdown(baseline));
    expect(baseline.topicBenchmarks[0]?.evidence).toEqual(baseline.trace.topicTraces[0]?.evidence);
    expect(baseline.trace).toMatchObject({ evaluationMode: "retrospective", eligibleForPromotion: false });
  });

  test("feedback-only reports show unmeasured values and do not authorize evolution", () => {
    const result = runBenchmarkSuite(DEFAULT_POLICY, "derivative", 1, 3, DEFAULT_WEIGHTS, feedback());
    const report = benchmarkToMarkdown(result);
    expect(report).toContain("(proxy) | unknown | unknown");
    expect(report).toContain("Validates a candidate policy: no");
    expect(report).not.toContain("ready for policy evolution");
    expect(diagnoseBenchmark(result).some((suggestion) => suggestion.metric === "meanTransfer")).toBe(false);
    expect(() => mapElitesEvolve(DEFAULT_POLICY, "derivative", 2, 1, undefined, undefined, feedback())).toThrow("fresh teaching episodes");
  });

  test("stored quizzes, explicit feedback, and inferred turns retain different provenance", () => {
    const inferred = extractSessionTurnOutcomes([{ id: "s", title: "derivative", messages: [{ role: "user", content: "I am confused about the derivative." }] }]);
    const quiz = quizRecordsToOutcomes([{ topic: "derivative", score: 3, totalQuestions: 5 }]);
    expect(inferred[0]?.evidenceKind).toBe("inferred-feedback");
    expect(quiz[0]?.evidenceKind).toBe("graded-assessment");
    expect(feedback()[0]?.evidenceKind).toBe("explicit-feedback");
    const result = runBenchmarkSuite(DEFAULT_POLICY, "derivative", 1, 3, DEFAULT_WEIGHTS, [...feedback(), ...inferred, ...quiz]);
    expect(result.topicBenchmarks[0]?.evidence?.feedbackCounts).toEqual({ explicit: 5, inferred: 1, unclassified: 0 });
    expect(result.topicBenchmarks[0]?.evidence?.assessmentPerformance).toMatchObject({ value: 0.6, source: "observed", sampleSize: 1 });
  });

  test("per-model feedback totals exclude labels mechanically derived from quiz grades", () => {
    const corpus = quizRecordsToOutcomes([{ topic: "derivative", score: 5, totalQuestions: 5 }]);
    const result = benchmarkPerModel(DEFAULT_POLICY, corpus);
    expect(result[0]).toMatchObject({ thumbsUp: 0, thumbsDown: 0, confused: 0, quizCount: 1, scoreSource: "observed" });
  });

  test("unrelated or invalid records cannot produce a measured zero or inflate corpus size", () => {
    expect(quizRecordsToOutcomes([
      { topic: "derivative", score: Infinity, totalQuestions: 5 },
      { topic: "derivative", score: 6, totalQuestions: 5 },
      { topic: "derivative", score: 1, totalQuestions: Infinity },
    ])).toEqual([]);
    const unrelated: BrowserLearnerOutcome[] = feedback().map((entry) => ({ ...entry, topic: "entropy" }));
    const result = runBenchmarkSuite(DEFAULT_POLICY, "derivative", 1, 3, DEFAULT_WEIGHTS, unrelated);
    expect(result.trace.realOutcomeCount).toBe(0);
    expect(result.weakestTopic).toBe("n/a");
    expect(benchmarkToMarkdown(result)).toContain("Overall descriptive score: unknown");
    expect(benchmarkPerModel(DEFAULT_POLICY, unrelated, "derivative")).toEqual([]);
  });

  test("synthetic runs keep their separate label and remain usable internally", () => {
    const result = runBenchmarkSuite(DEFAULT_POLICY, "derivative");
    expect(result.trace.evaluationMode).toBe("synthetic");
    expect(benchmarkToMarkdown(result)).toContain("Synthetic scores test model assumptions");
    expect(mapElitesEvolve(DEFAULT_POLICY, "derivative", 2).baseline.trace.evaluationMode).toBe("synthetic");
  });
});
