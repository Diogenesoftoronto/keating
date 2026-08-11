import type { BenchmarkHistoryRecord, EvolutionHistoryRecord } from "@keating/learner-contracts";

export interface EvaluationTrendPoint {
  id: string;
  kind: "benchmark" | "evolution";
  score: number;
  createdAt: string;
  x: number;
  y: number;
}

export interface EvaluationTrend {
  points: EvaluationTrendPoint[];
  benchmarkPoints: EvaluationTrendPoint[];
  evolutionPoints: EvaluationTrendPoint[];
  latestBenchmark?: BenchmarkHistoryRecord;
  latestEvolution?: EvolutionHistoryRecord;
  hasMeaningfulScores: boolean;
}

const LEFT = 28;
const RIGHT = 310;
const TOP = 10;
const BOTTOM = 122;

/** Pure projection of actual run history; it never derives a score from learner activity. */
export function buildEvaluationTrend(
  benchmarks: readonly BenchmarkHistoryRecord[],
  evolutions: readonly EvolutionHistoryRecord[],
): EvaluationTrend {
  const ordered = [
    ...benchmarks.map((record) => ({ id: record.id, kind: "benchmark" as const, score: record.score, createdAt: record.createdAt })),
    ...evolutions.map((record) => ({ id: record.id, kind: "evolution" as const, score: record.bestScore, createdAt: record.createdAt })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const timestamps = ordered.map((record) => Date.parse(record.createdAt));
  const minimum = timestamps.length ? Math.min(...timestamps) : 0;
  const maximum = timestamps.length ? Math.max(...timestamps) : minimum;
  const span = Math.max(maximum - minimum, 1);
  const points = ordered.map((record) => ({
    ...record,
    x: LEFT + ((Date.parse(record.createdAt) - minimum) / span) * (RIGHT - LEFT),
    y: BOTTOM - (record.score / 100) * (BOTTOM - TOP),
  }));
  const byDate = <T extends { createdAt: string; id: string }>(records: readonly T[]) =>
    [...records].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const orderedBenchmarks = byDate(benchmarks);
  const orderedEvolutions = byDate(evolutions);
  return {
    points,
    benchmarkPoints: points.filter((point) => point.kind === "benchmark"),
    evolutionPoints: points.filter((point) => point.kind === "evolution"),
    latestBenchmark: orderedBenchmarks.at(-1),
    latestEvolution: orderedEvolutions.at(-1),
    hasMeaningfulScores: points.some((point) => point.score !== 0),
  };
}

export function evaluationPath(points: readonly EvaluationTrendPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}
