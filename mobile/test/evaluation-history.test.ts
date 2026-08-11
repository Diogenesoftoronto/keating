import { describe, expect, test } from "bun:test";
import { buildEvaluationTrend, evaluationPath } from "../src/lib/evaluation-history";

describe("mobile evaluation history projection", () => {
  test("projects only actual benchmark and evolution records onto a stable 0-100 chart", () => {
    const trend = buildEvaluationTrend([{
      id: "benchmark-1", createdAt: "2026-08-10T00:00:00.000Z", score: 25, report: "run",
      provenance: "benchmark-run",
    }, {
      id: "benchmark-2", createdAt: "2026-08-12T00:00:00.000Z", score: 75, report: "run",
      provenance: "benchmark-run",
    }], [{
      id: "evolution-1", createdAt: "2026-08-11T00:00:00.000Z", bestScore: 50, policy: "policy", report: "run",
      provenance: "evolution-run",
    }]);
    expect(trend.points.map((point) => [point.kind, point.score])).toEqual([
      ["benchmark", 25], ["evolution", 50], ["benchmark", 75],
    ]);
    expect(trend.points[0]!.x).toBe(28);
    expect(trend.points[2]!.x).toBe(310);
    expect(trend.points[1]!.y).toBe(66);
    expect(trend.latestBenchmark?.id).toBe("benchmark-2");
    expect(trend.latestEvolution?.id).toBe("evolution-1");
    expect(evaluationPath(trend.benchmarkPoints)).toStartWith("M 28.00");
  });

  test("distinguishes absent and recorded-zero histories without fabricating a trend", () => {
    expect(buildEvaluationTrend([], [])).toMatchObject({ points: [], hasMeaningfulScores: false });
    expect(buildEvaluationTrend([{
      id: "benchmark-zero", createdAt: "2026-08-10T00:00:00.000Z", score: 0, report: "run",
      provenance: "benchmark-run",
    }], []).hasMeaningfulScores).toBe(false);
  });
});
