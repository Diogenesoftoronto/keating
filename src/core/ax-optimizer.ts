import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ai, ax, AxGEPA, flow, AxOptimizedProgramImpl } from "@ax-llm/ax";
import { runBenchmarkSuite } from "./benchmark.js";
import {
  KeatingTrial,
  POLICY_PARAM_SPACE,
  WEIGHT_PARAM_SPACE,
  PolicyTrial,
  trialToPolicy,
  trialToWeights,
  policyToParams,
  weightsToParams,
  KeatingObjective,
  optimize
} from "./ax-trial.js";
import { mean } from "./util.js";
import { TeacherPolicy, BenchmarkResult } from "./types.js";
import { stateDir, currentPolicyPath } from "./paths.js";
import { DEFAULT_POLICY, loadPolicy } from "./policy.js";
import { EvolutionRun, evolvePolicy as fallbackEvolvePolicy } from "./evolution.js";
import { mapElitesEvolve, mapElitesToEvolutionRun } from "./map-elites.js";

function gepaResultPath(cwd: string): string {
  return join(stateDir(cwd), "gepa-optimized.json");
}

export interface OptimizePolicyOptions {
  nTrials?: number;
  objectives?: string[]; // e.g. ["voice", "diagnosis", "engagement", "transfer", "cost"]
  focusTopic?: string;
  seed?: number;
}

/**
 * Optimizes the TeacherPolicy using GEPA multi-objective tuning.
 */
export async function optimizePolicy(
  cwd: string,
  basePolicy: TeacherPolicy,
  options: OptimizePolicyOptions = {}
): Promise<EvolutionRun> {
  const { nTrials = 24, objectives = ["score", "transfer", "engagement"], focusTopic, seed = 20260401 } = options;

  console.log(`Starting GEPA Policy Optimization (${nTrials} trials, objectives: ${objectives.join(", ")})`);

  const objective: KeatingObjective = async (trial) => {
    const policy = trialToPolicy(trial, `gepa-candidate-${trial.params.iteration ?? 0}`);
    const weights = trialToWeights(trial);
    const benchmark = await runBenchmarkSuite(cwd, policy, focusTopic, seed, 3, weights);
    
    const result: Record<string, number> = {};
    for (const obj of objectives) {
      if (obj === "score") result[obj] = benchmark.overallScore / 100;
      else if (obj === "transfer") result[obj] = mean(benchmark.topicBenchmarks.map(b => b.meanTransfer));
      else if (obj === "engagement") result[obj] = mean(benchmark.topicBenchmarks.map(b => b.meanEngagement));
      else if (obj === "retention") result[obj] = mean(benchmark.topicBenchmarks.map(b => b.meanRetention));
      else if (obj === "confusion") result[obj] = 1 - mean(benchmark.topicBenchmarks.map(b => b.meanConfusion));
    }
    return result;
  };

  try {
    const study = await optimize(objective, {
      nTrials,
      direction: "maximize",
      seed
    });

    const bestPolicy = trialToPolicy(
      new PolicyTrial(study.bestParams),
      `gepa-best-${Date.now().toString(36)}`
    );

    const archiveContent = await readFile(join(stateDir(cwd), "policy-archive.json"), "utf8").catch(() => "[]");
    const archive = JSON.parse(archiveContent);

    const baseline = await runBenchmarkSuite(cwd, basePolicy, focusTopic, seed);
    const best = await runBenchmarkSuite(cwd, bestPolicy, focusTopic, seed);

    const run: EvolutionRun = {
      baseline,
      best,
      acceptedCandidates: [], // Not using candidate-by-candidate acceptance here
      exploredCandidates: study.paretoFront.map((p, i) => ({
        policy: trialToPolicy(new PolicyTrial(p.params), `gepa-pareto-${i}`),
        benchmark: baseline, // Placeholder
        parentName: basePolicy.name,
        iteration: i,
        novelty: 1.0,
        accepted: true,
        parameterDelta: [],
        decision: { improves: true, safe: true, novelEnough: true, scoreDelta: 0, weakestTopicDelta: 0, reasons: [] }
      })),
      archive: {
        currentPolicy: bestPolicy,
        bestScore: best.overallScore,
        candidates: study.paretoFront.map(p => ({
          policy: trialToPolicy(new PolicyTrial(p.params), "gepa"),
          score: mean(Object.values(p.scores)) * 100,
          novelty: 1.0,
          accepted: true,
          iteration: 0
        }))
      }
    };

    await writeFile(gepaResultPath(cwd), JSON.stringify(study, null, 2), "utf8");

    return run;
  } catch (error) {
    console.warn("GEPA Optimization failed, falling back to MAP-Elites.", error);
    const meRun = await mapElitesEvolve(cwd, basePolicy, { iterations: nTrials, focusTopic, seed });
    return mapElitesToEvolutionRun(meRun);
  }
}
