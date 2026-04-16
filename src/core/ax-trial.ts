/**
 * ax-trial.ts — Hyperparameter trial abstraction for Keating
 *
 * Maps TeacherPolicy fields into an Optuna-style suggest API that
 * GEPA's multi-objective optimizer can explore. Provides the
 * `KeatingTrial` / `optimize()` surface that mirrors the
 * `hyperparameter` package API from the design spec.
 */

import { SimulationWeights, TeacherPolicy } from "./types.js";
import { mean } from "./util.js";
import { clampPolicy, clampWeights, DEFAULT_POLICY, DEFAULT_WEIGHTS } from "./policy.js";

// ---------------------------------------------------------------------------
// Trial interface — the `hyperparameter`-style suggest API
// ---------------------------------------------------------------------------

export interface KeatingTrial {
  /** Suggest a float hyperparameter within [low, high]. */
  suggestFloat(name: string, low: number, high: number): number;
  /** Suggest an integer hyperparameter within [low, high]. */
  suggestInt(name: string, low: number, high: number): number;
  /** The raw configuration dict produced by this trial. */
  readonly params: Record<string, number>;
}

/** A multi-objective return: each key is an objective name, value 0–1. */
export type ObjectiveVector = Record<string, number>;

/** The user-supplied objective function receives a trial and returns scores. */
export type KeatingObjective = (trial: KeatingTrial) => Promise<ObjectiveVector>;

// ---------------------------------------------------------------------------
// Parameter space definition for TeacherPolicy
// ---------------------------------------------------------------------------

export interface ParamRange {
  name: string;
  type: "float" | "int";
  low: number;
  high: number;
}

/** The full search space for Keating's TeacherPolicy hyperparameters. */
export const POLICY_PARAM_SPACE: ParamRange[] = [
  { name: "analogyDensity",        type: "float", low: 0.0, high: 1.0 },
  { name: "socraticRatio",         type: "float", low: 0.0, high: 1.0 },
  { name: "formalism",             type: "float", low: 0.0, high: 1.0 },
  { name: "retrievalPractice",     type: "float", low: 0.0, high: 1.0 },
  { name: "exerciseCount",         type: "int",   low: 1,   high: 5   },
  { name: "diagramBias",           type: "float", low: 0.0, high: 1.0 },
  { name: "reflectionBias",        type: "float", low: 0.0, high: 1.0 },
  { name: "interdisciplinaryBias", type: "float", low: 0.0, high: 1.0 },
  { name: "challengeRate",         type: "float", low: 0.0, high: 1.0 }
];

/** The search space for SimulationWeights (learned scoring weights). */
export const WEIGHT_PARAM_SPACE: ParamRange[] = [
  { name: "masteryGain",  type: "float", low: 0.05, high: 1.0 },
  { name: "retention",   type: "float", low: 0.05, high: 1.0 },
  { name: "engagement",  type: "float", low: 0.05, high: 1.0 },
  { name: "transfer",    type: "float", low: 0.05, high: 1.0 },
  { name: "confusion",   type: "float", low: 0.05, high: 1.0 }
];

// ---------------------------------------------------------------------------
// Trial implementation — used internally by the optimizer
// ---------------------------------------------------------------------------

export class PolicyTrial implements KeatingTrial {
  private _params: Record<string, number> = {};

  constructor(private values: Record<string, number>) {}

  get params(): Record<string, number> {
    return { ...this._params };
  }

  suggestFloat(name: string, low: number, high: number): number {
    const value = this.values[name] ?? (low + high) / 2;
    const clamped = Math.max(low, Math.min(high, value));
    this._params[name] = clamped;
    return clamped;
  }

  suggestInt(name: string, low: number, high: number): number {
    const value = this.values[name] ?? Math.round((low + high) / 2);
    const clamped = Math.max(low, Math.min(high, Math.round(value)));
    this._params[name] = clamped;
    return clamped;
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Build a TeacherPolicy from a trial's suggested parameters.
 * Missing fields fall back to DEFAULT_POLICY.
 */
export function trialToPolicy(trial: KeatingTrial, label: string): TeacherPolicy {
  const params = trial.params;
  return clampPolicy({
    name: label,
    analogyDensity:        params.analogyDensity        ?? DEFAULT_POLICY.analogyDensity,
    socraticRatio:         params.socraticRatio         ?? DEFAULT_POLICY.socraticRatio,
    formalism:             params.formalism             ?? DEFAULT_POLICY.formalism,
    retrievalPractice:     params.retrievalPractice     ?? DEFAULT_POLICY.retrievalPractice,
    exerciseCount:         params.exerciseCount         ?? DEFAULT_POLICY.exerciseCount,
    diagramBias:           params.diagramBias           ?? DEFAULT_POLICY.diagramBias,
    reflectionBias:        params.reflectionBias        ?? DEFAULT_POLICY.reflectionBias,
    interdisciplinaryBias: params.interdisciplinaryBias ?? DEFAULT_POLICY.interdisciplinaryBias,
    challengeRate:         params.challengeRate         ?? DEFAULT_POLICY.challengeRate
  });
}

/**
 * Build SimulationWeights from a trial's suggested parameters.
 * Missing fields fall back to DEFAULT_WEIGHTS.
 */
export function trialToWeights(trial: KeatingTrial): SimulationWeights {
  const params = trial.params;
  return clampWeights({
    masteryGain:  params.masteryGain  ?? DEFAULT_WEIGHTS.masteryGain,
    retention:    params.retention    ?? DEFAULT_WEIGHTS.retention,
    engagement:   params.engagement   ?? DEFAULT_WEIGHTS.engagement,
    transfer:     params.transfer     ?? DEFAULT_WEIGHTS.transfer,
    confusion:    params.confusion    ?? DEFAULT_WEIGHTS.confusion
  });
}

/**
 * Convert an existing TeacherPolicy into a parameter dict suitable for PolicyTrial.
 */
export function policyToParams(policy: TeacherPolicy): Record<string, number> {
  return {
    analogyDensity:        policy.analogyDensity,
    socraticRatio:         policy.socraticRatio,
    formalism:             policy.formalism,
    retrievalPractice:     policy.retrievalPractice,
    exerciseCount:         policy.exerciseCount,
    diagramBias:           policy.diagramBias,
    reflectionBias:        policy.reflectionBias,
    interdisciplinaryBias: policy.interdisciplinaryBias,
    challengeRate:         policy.challengeRate
  };
}

export function weightsToParams(weights: SimulationWeights): Record<string, number> {
  return {
    masteryGain: weights.masteryGain,
    retention: weights.retention,
    engagement: weights.engagement,
    transfer: weights.transfer,
    confusion: weights.confusion
  };
}

// ---------------------------------------------------------------------------
// Optimization — The core Pareto search
// ---------------------------------------------------------------------------

export interface OptimizeOptions {
  nTrials: number;
  direction: "maximize" | "minimize";
  seed?: number;
}

export interface StudyResult {
  bestParams: Record<string, number>;
  paretoFront: Array<{ params: Record<string, number>; scores: ObjectiveVector }>;
}

/**
 * A basic multi-objective optimizer that returns the Pareto frontier.
 */
export async function optimize(
  objective: KeatingObjective,
  options: OptimizeOptions
): Promise<StudyResult> {
  const { nTrials, seed = Date.now() } = options;
  const prng = new (await import("./random.js")).Prng(seed);
  const trials: Array<{ params: Record<string, number>; scores: ObjectiveVector }> = [];

  for (let i = 0; i < nTrials; i++) {
    const values: Record<string, number> = {};
    for (const range of POLICY_PARAM_SPACE) {
      values[range.name] = range.type === "float" 
        ? range.low + prng.next() * (range.high - range.low)
        : Math.round(range.low + prng.next() * (range.high - range.low));
    }
    for (const range of WEIGHT_PARAM_SPACE) {
      values[range.name] = range.type === "float"
        ? range.low + prng.next() * (range.high - range.low)
        : Math.round(range.low + prng.next() * (range.high - range.low));
    }

    const trial = new PolicyTrial(values);
    const scores = await objective(trial);
    trials.push({ params: trial.params, scores });
  }

  // Compute Pareto frontier
  const paretoFront = trials.filter((t1) => {
    // A trial is Pareto-optimal if no other trial dominates it
    return !trials.some((t2) => {
      if (t1 === t2) return false;
      const objectives = Object.keys(t1.scores);
      
      // t2 dominates t1 if:
      // 1. t2 is better than or equal to t1 in all objectives
      // 2. t2 is strictly better than t1 in at least one objective
      let betterOrEqual = true;
      let strictlyBetter = false;
      
      for (const obj of objectives) {
        const v1 = t1.scores[obj];
        const v2 = t2.scores[obj];
        if (options.direction === "maximize") {
          if (v2 < v1) betterOrEqual = false;
          if (v2 > v1) strictlyBetter = true;
        } else {
          if (v2 > v1) betterOrEqual = false;
          if (v2 < v1) strictlyBetter = true;
        }
      }
      return betterOrEqual && strictlyBetter;
    });
  });

  // Pick "best" by simple mean of scores
  const best = paretoFront.sort((a, b) => {
    const meanA = mean(Object.values(a.scores));
    const meanB = mean(Object.values(b.scores));
    return meanB - meanA;
  })[0] || trials[0];

  return {
    bestParams: best.params,
    paretoFront
  };
}
