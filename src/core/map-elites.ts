import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BenchmarkResult,
  EvolutionCandidate,
  MapElitesCell,
  MapElitesGrid,
  MapElitesRun,
  SimulationWeights,
  TeacherPolicy
} from "./types.js";
import { Prng } from "./random.js";
import { clamp } from "./util.js";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, clampPolicy, clampWeights } from "./policy.js";
import { benchmarkToMarkdown, runBenchmarkSuite } from "./benchmark.js";
import { evolvePolicy as fallbackEvolvePolicy, EvolutionRun } from "./evolution.js";

export interface MapElitesOptions {
  iterations?: number;
  seed?: number;
  descriptors?: string[];
  resolution?: number;
  focusTopic?: string;
  initRandom?: number;
}

export const DEFAULT_DESCRIPTORS: string[] = ["formalism", "socraticRatio"];
export const DEFAULT_RESOLUTION = 10;

function mutateScalar(prng: Prng, value: number, amplitude = 0.18): number {
  return clamp(value + (prng.next() * 2 - 1) * amplitude);
}

function mutatePolicy(parent: TeacherPolicy, prng: Prng, iteration: number): TeacherPolicy {
  return clampPolicy({
    ...parent,
    name: `me-candidate-${iteration}`,
    analogyDensity: mutateScalar(prng, parent.analogyDensity),
    socraticRatio: mutateScalar(prng, parent.socraticRatio),
    formalism: mutateScalar(prng, parent.formalism),
    retrievalPractice: mutateScalar(prng, parent.retrievalPractice),
    exerciseCount: parent.exerciseCount + prng.int(-1, 1),
    diagramBias: mutateScalar(prng, parent.diagramBias),
    reflectionBias: mutateScalar(prng, parent.reflectionBias),
    interdisciplinaryBias: mutateScalar(prng, parent.interdisciplinaryBias),
    challengeRate: mutateScalar(prng, parent.challengeRate)
  });
}

function mutateWeights(parent: SimulationWeights, prng: Prng, amplitude = 0.12): SimulationWeights {
  return clampWeights({
    masteryGain: mutateScalar(prng, parent.masteryGain, amplitude),
    retention: mutateScalar(prng, parent.retention, amplitude),
    engagement: mutateScalar(prng, parent.engagement, amplitude),
    transfer: mutateScalar(prng, parent.transfer, amplitude),
    confusion: mutateScalar(prng, parent.confusion, amplitude)
  });
}

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

function randomPolicy(prng: Prng, iteration: number): TeacherPolicy {
  return clampPolicy({
    name: `me-random-${iteration}`,
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
    initRandom = Math.floor(iterations * 0.25)
  } = options;

  const prng = new Prng(seed);
  const grid = createGrid(descriptors, resolution);
  const totalCells = resolution ** descriptors.length;

  const baseline = await runBenchmarkSuite(cwd, basePolicy, focusTopic, seed, 3, DEFAULT_WEIGHTS);
  placeInGrid(grid, basePolicy, DEFAULT_WEIGHTS, baseline.overallScore, baseline, 0);

  const exploredCandidates: EvolutionCandidate[] = [];

  for (let i = 1; i <= iterations; i++) {
    let candidatePolicy: TeacherPolicy;
    let candidateWeights: SimulationWeights;

    if (i <= initRandom) {
      candidatePolicy = randomPolicy(prng, i);
      candidateWeights = randomWeights(prng);
    } else {
      const parent = selectParent(grid, prng);
      candidatePolicy = mutatePolicy(parent.policy, prng, i);
      candidateWeights = mutateWeights(parent.weights, prng);
    }

    const candidateBenchmark = await runBenchmarkSuite(
      cwd, candidatePolicy, focusTopic, seed + i * 11, 3, candidateWeights
    );

    const isNewCell = placeInGrid(
      grid, candidatePolicy, candidateWeights,
      candidateBenchmark.overallScore, candidateBenchmark, i
    );

    exploredCandidates.push({
      policy: candidatePolicy,
      benchmark: candidateBenchmark,
      parentName: null,
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
    });
  }

  let best: BenchmarkResult = baseline;
  for (const cell of grid.cells.values()) {
    if (cell && cell.benchmark.overallScore > best.overallScore) {
      best = cell.benchmark;
    }
  }

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
