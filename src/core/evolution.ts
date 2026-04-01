import { readFile, writeFile } from "node:fs/promises";

import { BenchmarkResult, EvolutionCandidate, TeacherPolicy } from "./types.js";
import { Prng } from "./random.js";
import { clamp } from "./util.js";
import { DEFAULT_POLICY, clampPolicy, policySignature } from "./policy.js";
import { benchmarkToMarkdown, runBenchmarkSuite } from "./benchmark.js";

interface EvolutionArchive {
  currentPolicy: TeacherPolicy;
  bestScore: number;
  candidates: Array<{
    policy: TeacherPolicy;
    score: number;
    novelty: number;
    accepted: boolean;
    iteration: number;
  }>;
}

export interface EvolutionRun {
  baseline: BenchmarkResult;
  best: BenchmarkResult;
  acceptedCandidates: EvolutionCandidate[];
  exploredCandidates: EvolutionCandidate[];
  archive: EvolutionArchive;
}

function diffPolicy(before: TeacherPolicy, after: TeacherPolicy) {
  const keys: Array<keyof TeacherPolicy> = [
    "analogyDensity",
    "socraticRatio",
    "formalism",
    "retrievalPractice",
    "exerciseCount",
    "diagramBias",
    "reflectionBias",
    "interdisciplinaryBias",
    "challengeRate"
  ];
  return keys
    .map((field) => {
      const previous = before[field];
      const next = after[field];
      const delta = typeof previous === "number" && typeof next === "number" ? next - previous : 0;
      return { field, before: previous, after: next, delta };
    })
    .filter((entry) => entry.delta !== 0);
}

function mutateScalar(prng: Prng, value: number, amplitude = 0.18): number {
  return clamp(value + (prng.next() * 2 - 1) * amplitude);
}

function mutatePolicy(parent: TeacherPolicy, prng: Prng, iteration: number): TeacherPolicy {
  const mutated = clampPolicy({
    ...parent,
    name: `keating-candidate-${iteration}`,
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
  return mutated;
}

function ngrams(text: string, width = 2): Set<string> {
  if (text.length <= width) return new Set([text]);
  const values = new Set<string>();
  for (let index = 0; index <= text.length - width; index += 1) {
    values.add(text.slice(index, index + width));
  }
  return values;
}

function noveltyScore(existing: string[], policy: TeacherPolicy): number {
  if (existing.length === 0) return 1;
  const candidate = ngrams(policySignature(policy));
  let bestDistance = 1;
  for (const signature of existing) {
    const other = ngrams(signature);
    const union = new Set([...candidate, ...other]).size;
    const intersection = [...candidate].filter((item) => other.has(item)).length;
    const jaccardDistance = union === 0 ? 0 : 1 - intersection / union;
    bestDistance = Math.min(bestDistance, jaccardDistance);
  }
  return bestDistance;
}

async function loadArchive(filePath: string): Promise<EvolutionArchive> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as EvolutionArchive;
  } catch {
    return {
      currentPolicy: DEFAULT_POLICY,
      bestScore: 0,
      candidates: []
    };
  }
}

async function saveArchive(filePath: string, archive: EvolutionArchive): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
}

export async function evolvePolicy(
  archivePath: string,
  basePolicy: TeacherPolicy,
  focusTopic?: string,
  iterations = 24,
  seed = 20260401
): Promise<EvolutionRun> {
  const archive = await loadArchive(archivePath);
  const baseline = runBenchmarkSuite(basePolicy, focusTopic, seed);
  let best = baseline;
  const acceptedCandidates: EvolutionCandidate[] = [];
  const exploredCandidates: EvolutionCandidate[] = [];
  const prng = new Prng(seed + 17);
  const seen = new Set<string>(archive.candidates.map((entry) => policySignature(entry.policy)));
  seen.add(policySignature(basePolicy));

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const candidatePolicy = mutatePolicy(best.policy, prng, iteration);
    const novelty = noveltyScore([...seen], candidatePolicy);
    const candidateBenchmark = runBenchmarkSuite(candidatePolicy, focusTopic, seed + iteration * 11);
    const parameterDelta = diffPolicy(best.policy, candidatePolicy);
    const candidate: EvolutionCandidate = {
      policy: candidatePolicy,
      benchmark: candidateBenchmark,
      parentName: best.policy.name,
      iteration,
      novelty,
      accepted: false,
      parameterDelta,
      decision: {
        improves: false,
        safe: false,
        novelEnough: false,
        scoreDelta: 0,
        weakestTopicDelta: 0,
        reasons: []
      }
    };

    const bestWeakest = Math.min(...best.topicBenchmarks.map((entry) => entry.meanScore));
    const candidateWeakest = Math.min(...candidateBenchmark.topicBenchmarks.map((entry) => entry.meanScore));
    const improves = candidateBenchmark.overallScore > best.overallScore;
    const safe = candidateWeakest >= bestWeakest - 1.5;
    const novelEnough = novelty >= 0.08;
    candidate.decision.improves = improves;
    candidate.decision.safe = safe;
    candidate.decision.novelEnough = novelEnough;
    candidate.decision.scoreDelta = candidateBenchmark.overallScore - best.overallScore;
    candidate.decision.weakestTopicDelta = candidateWeakest - bestWeakest;
    if (improves) {
      candidate.decision.reasons.push(
        `overall score improved by ${candidate.decision.scoreDelta.toFixed(2)}`
      );
    } else {
      candidate.decision.reasons.push(
        `overall score regressed by ${Math.abs(candidate.decision.scoreDelta).toFixed(2)}`
      );
    }
    if (safe) {
      candidate.decision.reasons.push(
        `weakest-topic score stayed within tolerance (${candidate.decision.weakestTopicDelta.toFixed(2)})`
      );
    } else {
      candidate.decision.reasons.push(
        `weakest-topic score fell too far (${candidate.decision.weakestTopicDelta.toFixed(2)})`
      );
    }
    if (novelEnough) {
      candidate.decision.reasons.push(`novelty ${novelty.toFixed(3)} cleared the 0.08 threshold`);
    } else {
      candidate.decision.reasons.push(`novelty ${novelty.toFixed(3)} was too close to archived policies`);
    }

    if (improves && safe && novelEnough) {
      candidate.accepted = true;
      best = candidateBenchmark;
      acceptedCandidates.push(candidate);
    }
    exploredCandidates.push(candidate);
    seen.add(policySignature(candidatePolicy));
  }

  const nextArchive: EvolutionArchive = {
    currentPolicy: best.policy,
    bestScore: best.overallScore,
    candidates: [
      ...archive.candidates,
      ...exploredCandidates.map((entry) => ({
        policy: entry.policy,
        score: entry.benchmark.overallScore,
        novelty: entry.novelty,
        accepted: entry.accepted,
        iteration: entry.iteration
      }))
    ]
  };

  await saveArchive(archivePath, nextArchive);
  return {
    baseline,
    best,
    acceptedCandidates,
    exploredCandidates,
    archive: nextArchive
  };
}

export function evolutionToMarkdown(run: EvolutionRun): string {
  const lines = [
    `# Evolution Report: ${run.best.policy.name}`,
    "",
    `- Baseline score: ${run.baseline.overallScore.toFixed(2)}`,
    `- Best score: ${run.best.overallScore.toFixed(2)}`,
    `- Accepted candidates: ${run.acceptedCandidates.length}`,
    `- Explored candidates: ${run.exploredCandidates.length}`,
    ""
  ];

  lines.push("## Accepted Candidates");
  lines.push("");
  if (run.acceptedCandidates.length === 0) {
    lines.push("- No candidate cleared both the novelty and safety gates in this run.");
  } else {
    for (const candidate of run.acceptedCandidates) {
      lines.push(
        `- Iteration ${candidate.iteration}: ${candidate.policy.name} scored ${candidate.benchmark.overallScore.toFixed(2)} with novelty ${candidate.novelty.toFixed(3)}.`
      );
    }
  }

  lines.push("");
  lines.push("## Decision Ledger");
  lines.push("");
  for (const candidate of run.exploredCandidates) {
    lines.push(
      `- Iteration ${candidate.iteration} ${candidate.policy.name}: ${candidate.accepted ? "accepted" : "rejected"}`
    );
    lines.push(`  - score delta: ${candidate.decision.scoreDelta.toFixed(2)}`);
    lines.push(`  - weakest-topic delta: ${candidate.decision.weakestTopicDelta.toFixed(2)}`);
    lines.push(`  - novelty: ${candidate.novelty.toFixed(3)}`);
    lines.push(`  - gates: improves=${candidate.decision.improves}, safe=${candidate.decision.safe}, novelEnough=${candidate.decision.novelEnough}`);
    lines.push(`  - reasons: ${candidate.decision.reasons.join("; ")}`);
    if (candidate.parameterDelta.length > 0) {
      lines.push(
        `  - parameter delta: ${candidate.parameterDelta
          .map((entry) => `${entry.field}:${entry.delta >= 0 ? "+" : ""}${entry.delta.toFixed(2)}`)
          .join(", ")}`
      );
    }
  }

  lines.push("");
  lines.push("## Best Benchmark Snapshot");
  lines.push("");
  lines.push(benchmarkToMarkdown(run.best).trim());
  lines.push("");
  return `${lines.join("\n")}\n`;
}
