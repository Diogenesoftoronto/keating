import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BenchmarkResult,
  EvolutionCandidate,
  MapElitesCell,
  MapElitesGrid,
  MapElitesRun,
  LearnerState,
  SimulationWeights,
  TeacherPolicy
} from "./types.js";
import { Prng } from "./random.js";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, clampPolicy, clampWeights } from "./policy.js";
import { benchmarkToMarkdown, extractHarnessOutcomes, runBenchmarkSuite } from "./benchmark.js";
import { evolvePolicy as fallbackEvolvePolicy, EvolutionRun } from "./evolution.js";
import { mutateScalar, mutatePolicy, mutateWeights } from "./mutation.js";
import { evolutionDir } from "./paths.js";
import { slugify } from "./util.js";
import { counterfactualBenchmark, prosperPolicyWinner, type PolicyJudgementCandidate } from "./policy-judgement.js";

export interface MapElitesOptions {
  iterations?: number;
  seed?: number;
  descriptors?: string[];
  resolution?: number;
  focusTopic?: string;
  initRandom?: number;
  gridPath?: string;
  learnerState?: LearnerState;
}

export const DEFAULT_DESCRIPTORS: string[] = ["formalism", "socraticRatio"];
export const DEFAULT_RESOLUTION = 10;

function getDescriptorValues(policy: TeacherPolicy, descriptors: string[]): number[] {
  return descriptors.map((d) => {
    const val = policy[d as keyof TeacherPolicy];
    return typeof val === "number" ? val : 0;
  });
}

function cellKey(descriptors: number[], resolution: number): string {
  return descriptors
    .map((d) => Math.min(Math.floor(d * resolution), resolution - 1))
    .join(",");
}

export function createGrid(descriptors: string[], resolution: number): MapElitesGrid {
  return {
    descriptors,
    resolution,
    cells: new Map()
  };
}

export function placeInGrid(
  grid: MapElitesGrid,
  policy: TeacherPolicy,
  weights: SimulationWeights,
  score: number,
  benchmark: BenchmarkResult,
  iteration: number
): boolean {
  const descVals = getDescriptorValues(policy, grid.descriptors);
  const key = cellKey(descVals, grid.resolution);
  const existing = grid.cells.get(key);
  if (!existing || score > existing.score) {
    grid.cells.set(key, { policy, weights, score, benchmark, iteration });
    return !existing;
  }
  return false;
}

function selectParent(grid: MapElitesGrid, prng: Prng): { policy: TeacherPolicy; weights: SimulationWeights } {
  const filled = Array.from(grid.cells.values()).filter((c): c is MapElitesCell => c !== null);
  if (filled.length === 0) {
    return { policy: DEFAULT_POLICY, weights: DEFAULT_WEIGHTS };
  }
  const idx = Math.floor(prng.next() * filled.length);
  return { policy: filled[idx].policy, weights: filled[idx].weights };
}

function randomPolicy(prng: Prng, iteration: number, namePrefix = "me-random"): TeacherPolicy {
  return clampPolicy({
    name: `${namePrefix}-${iteration}`,
    analogyDensity: prng.next(),
    socraticRatio: prng.next(),
    formalism: prng.next(),
    retrievalPractice: prng.next(),
    exerciseCount: Math.round(1 + prng.next() * 4),
    diagramBias: prng.next(),
    reflectionBias: prng.next(),
    interdisciplinaryBias: prng.next(),
    challengeRate: prng.next()
  });
}

function defaultGridPath(cwd: string, focusTopic?: string): string {
  return join(evolutionDir(cwd), `${focusTopic ? slugify(focusTopic) : "latest"}-map-elites-grid.json`);
}

function randomWeights(prng: Prng): SimulationWeights {
  return clampWeights({
    masteryGain: 0.1 + prng.next() * 0.9,
    retention: 0.1 + prng.next() * 0.9,
    engagement: 0.1 + prng.next() * 0.9,
    transfer: 0.1 + prng.next() * 0.9,
    confusion: 0.1 + prng.next() * 0.9
  });
}

export async function mapElitesEvolve(
  cwd: string,
  basePolicy: TeacherPolicy,
  options: MapElitesOptions = {}
): Promise<MapElitesRun> {
  const {
    iterations = 48,
    seed = 20260401,
    descriptors = DEFAULT_DESCRIPTORS,
    resolution = DEFAULT_RESOLUTION,
    focusTopic,
    initRandom = Math.floor(iterations * 0.25),
    gridPath = defaultGridPath(cwd, focusTopic),
    learnerState
  } = options;

  const prng = new Prng(seed);
  const runId = `me-${Date.now().toString(36)}`;
  const grid = await loadMapElitesGrid(gridPath, descriptors, resolution);
  const totalCells = resolution ** descriptors.length;
  const realOutcomes = learnerState ? await extractHarnessOutcomes(cwd, learnerState) : [];

  const baseline = await runBenchmarkSuite(cwd, basePolicy, focusTopic, seed, 3, DEFAULT_WEIGHTS, learnerState);
  const baselineCounterfactual = learnerState
    ? await counterfactualBenchmark(cwd, learnerState, realOutcomes, basePolicy, focusTopic, seed + 7, 3, DEFAULT_WEIGHTS)
    : undefined;
  placeInGrid(grid, basePolicy, DEFAULT_WEIGHTS, baseline.overallScore, baseline, 0);

  const exploredCandidates: EvolutionCandidate[] = [];
  const judgementCandidates: PolicyJudgementCandidate[] = [{
    label: basePolicy.name,
    policy: basePolicy,
    benchmark: baseline,
    counterfactualBenchmark: baselineCounterfactual,
    preferenceScore: 0
  }];

  for (let i = 1; i <= iterations; i++) {
    let candidatePolicy: TeacherPolicy;
    let candidateWeights: SimulationWeights;

    let parentName: string | null = null;

    if (i <= initRandom) {
      candidatePolicy = randomPolicy(prng, i, `${runId}-random`);
      candidateWeights = randomWeights(prng);
    } else {
      const parent = selectParent(grid, prng);
      parentName = parent.policy.name;
      candidatePolicy = mutatePolicy(parent.policy, prng, i, `${runId}-candidate`);
      candidateWeights = mutateWeights(parent.weights, prng);
    }

    const candidateBenchmark = await runBenchmarkSuite(
      cwd, candidatePolicy, focusTopic, seed + i * 11, 3, candidateWeights, learnerState
    );
    const candidateCounterfactual = learnerState
      ? await counterfactualBenchmark(cwd, learnerState, realOutcomes, candidatePolicy, focusTopic, seed + i * 11 + 7, 3, candidateWeights)
      : undefined;

    const isNewCell = placeInGrid(
      grid, candidatePolicy, candidateWeights,
      candidateBenchmark.overallScore, candidateBenchmark, i
    );

    const explored: EvolutionCandidate = {
      policy: candidatePolicy,
      benchmark: candidateBenchmark,
      counterfactualBenchmark: candidateCounterfactual,
      parentName,
      iteration: i,
      novelty: isNewCell ? 1 : 0,
      accepted: isNewCell,
      decision: {
        improves: isNewCell,
        safe: true,
        novelEnough: isNewCell,
        scoreDelta: 0,
        weakestTopicDelta: 0,
        reasons: isNewCell
          ? [`placed in new cell or improved existing cell (score ${candidateBenchmark.overallScore.toFixed(2)})`]
          : [`discarded — cell already held a better elite`]
      },
      parameterDelta: []
    };
    exploredCandidates.push(explored);
    judgementCandidates.push({
      label: candidatePolicy.name,
      policy: candidatePolicy,
      benchmark: candidateBenchmark,
      counterfactualBenchmark: candidateCounterfactual,
      preferenceScore: 0
    });
  }

  await saveMapElitesGrid(gridPath, grid);

  const prosperBest = prosperPolicyWinner(judgementCandidates);
  for (const candidate of exploredCandidates) {
    const judgement = judgementCandidates.find((entry) => entry.label === candidate.policy.name);
    candidate.preferenceScore = judgement?.preferenceScore ?? 0;
    candidate.accepted = candidate.policy.name === prosperBest.policy.name;
    candidate.decision.reasons = [
      ...candidate.decision.reasons,
      `PROSPER policy preference score ${candidate.preferenceScore.toFixed(2)}`
    ];
  }
  const best = prosperBest.benchmark;

  return {
    baseline,
    best,
    grid,
    filledCellCount: grid.cells.size,
    totalCells,
    exploredCandidates
  };
}

export function mapElitesToMarkdown(run: MapElitesRun): string {
  const lines = [
    "# MAP-Elites Evolution Report",
    "",
    `- Descriptors: ${run.grid.descriptors.join(" × ")}`,
    `- Grid: ${run.grid.resolution}^${run.grid.descriptors.length} = ${run.totalCells} cells`,
    `- Filled cells: ${run.filledCellCount} / ${run.totalCells} (${((run.filledCellCount / run.totalCells) * 100).toFixed(1)}%)`,
    `- Baseline score: ${run.baseline.overallScore.toFixed(2)}`,
    `- Best score: ${run.best.overallScore.toFixed(2)}`,
    `- Explored candidates: ${run.exploredCandidates.length}`,
    `- Judgement: PROSPER-style pairwise preference over real feedback, counterfactual robustness, mastery, transfer, low confusion, and evidence readiness.`,
    ""
  ];

  lines.push("## Elite Archive");
  lines.push("");
  const sorted = Array.from(run.grid.cells.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  const header = run.grid.descriptors.map((d, i) => `${d}[${i}]`).join(" | ");
  lines.push(`| ${header} | Policy | Score | Weights (m/r/e/t/c) |`);
  lines.push(`| ${run.grid.descriptors.map(() => "---").join(" | ")} | --- | ---: | --- |`);

  for (const [key, cell] of sorted) {
    if (!cell) continue;
    const indices = key.split(",").map(Number);
    const labels = indices.map((idx, i) => {
      const lo = (idx / run.grid.resolution).toFixed(2);
      const hi = ((idx + 1) / run.grid.resolution).toFixed(2);
      return `${lo}–${hi}`;
    }).join(" | ");
    const w = cell.weights;
    lines.push(
      `| ${labels} | ${cell.policy.name} | ${cell.score.toFixed(2)} | ${w.masteryGain.toFixed(2)}/${w.retention.toFixed(2)}/${w.engagement.toFixed(2)}/${w.transfer.toFixed(2)}/${w.confusion.toFixed(2)} |`
    );
  }

  lines.push("");
  lines.push("## PROSPER Candidate Judgement");
  lines.push("");
  lines.push("| Candidate | Real Score | Counterfactual Score | Preference | Accepted |");
  lines.push("| --- | ---: | ---: | ---: | :---: |");
  for (const candidate of run.exploredCandidates.slice().sort((left, right) => (right.preferenceScore ?? 0) - (left.preferenceScore ?? 0)).slice(0, 12)) {
    lines.push(
      `| ${candidate.policy.name} | ${candidate.benchmark.overallScore.toFixed(2)} | ${candidate.counterfactualBenchmark?.overallScore.toFixed(2) ?? "n/a"} | ${(candidate.preferenceScore ?? 0).toFixed(2)} | ${candidate.accepted ? "yes" : "no"} |`
    );
  }
  lines.push("");
  lines.push("## Best Benchmark Snapshot");
  lines.push("");
  lines.push(benchmarkToMarkdown(run.best).trim());
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function loadMapElitesGrid(filePath: string, descriptors: string[], resolution: number): Promise<MapElitesGrid> {
  try {
    const content = await readFile(filePath, "utf8");
    const data = JSON.parse(content);
    const grid = createGrid(descriptors, resolution);
    for (const [key, cell] of Object.entries(data.cells ?? {})) {
      grid.cells.set(key, cell as MapElitesCell);
    }
    return grid;
  } catch {
    return createGrid(descriptors, resolution);
  }
}

export async function saveMapElitesGrid(filePath: string, grid: MapElitesGrid): Promise<void> {
  const serializable: Record<string, MapElitesCell | null> = {};
  for (const [key, cell] of grid.cells.entries()) {
    serializable[key] = cell;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ descriptors: grid.descriptors, resolution: grid.resolution, cells: serializable }, null, 2)}\n`, "utf8");
}

export function mapElitesToEvolutionRun(run: MapElitesRun): EvolutionRun {
  return {
    baseline: run.baseline,
    best: run.best,
    acceptedCandidates: run.exploredCandidates.filter((c) => c.accepted),
    exploredCandidates: run.exploredCandidates,
    archive: {
      currentPolicy: run.best.policy,
      bestScore: run.best.overallScore,
      candidates: run.exploredCandidates.map((c) => ({
        policy: c.policy,
        score: c.benchmark.overallScore,
        novelty: c.novelty,
        accepted: c.accepted,
        iteration: c.iteration
      }))
    }
  };
}
