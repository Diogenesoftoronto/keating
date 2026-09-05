import type {
  BenchmarkResult,
  MapElitesGrid,
  MapElitesRun,
  SimulationWeights,
  TeacherPolicy,
} from "./types.js";

function descriptorValues(policy: TeacherPolicy, descriptors: readonly string[]): number[] {
  return descriptors.map((descriptor) => {
    const value = policy[descriptor as keyof TeacherPolicy];
    return typeof value === "number" ? value : 0;
  });
}

function cellKey(descriptors: readonly number[], resolution: number): string {
  return descriptors
    .map((descriptor) => Math.min(Math.floor(descriptor * resolution), resolution - 1))
    .join(",");
}

export function placeInMapElitesGrid(
  grid: MapElitesGrid,
  policy: TeacherPolicy,
  weights: SimulationWeights,
  score: number,
  benchmark: BenchmarkResult,
  iteration: number,
): boolean {
  const key = cellKey(descriptorValues(policy, grid.descriptors), grid.resolution);
  const existing = grid.cells.get(key);
  if (!existing || score > existing.score) {
    grid.cells.set(key, { policy, weights, score, benchmark, iteration });
    return !existing;
  }
  return false;
}

export function formatMapElitesRun(
  run: MapElitesRun,
  benchmarkToMarkdown: (benchmark: BenchmarkResult) => string,
): string {
  const lines = [
    "# MAP-Elites Evolution Report",
    "",
    `- Descriptors: ${run.grid.descriptors.join(" × ")}`,
    `- Grid: ${run.grid.resolution}^${run.grid.descriptors.length} = ${run.totalCells} cells`,
    `- Filled cells: ${run.filledCellCount} / ${run.totalCells} (${((run.filledCellCount / run.totalCells) * 100).toFixed(1)}%)`,
    `- Baseline score: ${run.baseline.overallScore.toFixed(2)}`,
    `- Best score: ${run.best.overallScore.toFixed(2)}`,
    `- Explored candidates: ${run.exploredCandidates.length}`,
    "- Judgement: PROSPER-style pairwise preference over real feedback, counterfactual robustness, mastery, transfer, low confusion, and evidence readiness.",
    "",
    "## Elite Archive",
    "",
  ];

  const sorted = Array.from(run.grid.cells.entries()).sort(([left], [right]) => left.localeCompare(right));
  const header = run.grid.descriptors.map((descriptor, index) => `${descriptor}[${index}]`).join(" | ");
  lines.push(`| ${header} | Policy | Score | Weights (m/r/e/t/c) |`);
  lines.push(`| ${run.grid.descriptors.map(() => "---").join(" | ")} | --- | ---: | --- |`);

  for (const [key, cell] of sorted) {
    if (!cell) continue;
    const labels = key
      .split(",")
      .map(Number)
      .map((index) => {
        const low = (index / run.grid.resolution).toFixed(2);
        const high = ((index + 1) / run.grid.resolution).toFixed(2);
        return `${low}–${high}`;
      })
      .join(" | ");
    const weights = cell.weights;
    lines.push(
      `| ${labels} | ${cell.policy.name} | ${cell.score.toFixed(2)} | ${weights.masteryGain.toFixed(2)}/${weights.retention.toFixed(2)}/${weights.engagement.toFixed(2)}/${weights.transfer.toFixed(2)}/${weights.confusion.toFixed(2)} |`,
    );
  }

  lines.push("");
  lines.push("## PROSPER Candidate Judgement");
  lines.push("");
  lines.push("| Candidate | Real Score | Counterfactual Score | Preference | Accepted |");
  lines.push("| --- | ---: | ---: | ---: | :---: |");
  for (const candidate of run.exploredCandidates
    .slice()
    .sort((left, right) => (right.preferenceScore ?? 0) - (left.preferenceScore ?? 0))
    .slice(0, 12)) {
    lines.push(
      `| ${candidate.policy.name} | ${candidate.benchmark.overallScore.toFixed(2)} | ${candidate.counterfactualBenchmark?.overallScore.toFixed(2) ?? "n/a"} | ${(candidate.preferenceScore ?? 0).toFixed(2)} | ${candidate.accepted ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push("## Best Benchmark Snapshot");
  lines.push("");
  lines.push(benchmarkToMarkdown(run.best).trim());
  lines.push("");
  return `${lines.join("\n")}\n`;
}
