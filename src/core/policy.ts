import { readFile, writeFile } from "node:fs/promises";

import { SimulationWeights, TeacherPolicy } from "./types.js";
import { clamp } from "./util.js";

export const DEFAULT_POLICY: TeacherPolicy = {
  name: "keating-default",
  analogyDensity: 0.72,
  socraticRatio: 0.66,
  formalism: 0.64,
  retrievalPractice: 0.74,
  exerciseCount: 3,
  diagramBias: 0.7,
  reflectionBias: 0.68,
  interdisciplinaryBias: 0.62,
  challengeRate: 0.58
};

export const DEFAULT_WEIGHTS: SimulationWeights = {
  masteryGain: 0.34,
  retention: 0.20,
  engagement: 0.16,
  transfer: 0.16,
  confusion: 0.14
};

export function clampWeights(weights: SimulationWeights): SimulationWeights {
  if (weightsAreBounded(weights) && weightsAreNormalized(weights)) return { ...weights };
  const sum = weights.masteryGain + weights.retention + weights.engagement + weights.transfer + weights.confusion;
  if (sum === 0) return DEFAULT_WEIGHTS;
  const normalized: SimulationWeights = {
    masteryGain: weights.masteryGain / sum,
    retention: weights.retention / sum,
    engagement: weights.engagement / sum,
    transfer: weights.transfer / sum,
    confusion: weights.confusion / sum
  };
  const needsClamp = Object.values(normalized).some(v => v < 0.01 || v > 1);
  if (!needsClamp) return normalized;
  const clamped: SimulationWeights = {
    masteryGain: clamp(normalized.masteryGain, 0.01, 1),
    retention: clamp(normalized.retention, 0.01, 1),
    engagement: clamp(normalized.engagement, 0.01, 1),
    transfer: clamp(normalized.transfer, 0.01, 1),
    confusion: clamp(normalized.confusion, 0.01, 1)
  };
  const clampedSum = clamped.masteryGain + clamped.retention + clamped.engagement + clamped.transfer + clamped.confusion;
  if (clampedSum === 0) return DEFAULT_WEIGHTS;
  return {
    masteryGain: clamped.masteryGain / clampedSum,
    retention: clamped.retention / clampedSum,
    engagement: clamped.engagement / clampedSum,
    transfer: clamped.transfer / clampedSum,
    confusion: clamped.confusion / clampedSum
  };
}

function weightsAreBounded(weights: SimulationWeights): boolean {
  for (const v of Object.values(weights)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

function weightsAreNormalized(weights: SimulationWeights): boolean {
  const sum = weights.masteryGain + weights.retention + weights.engagement + weights.transfer + weights.confusion;
  return Math.abs(sum - 1) < 0.001;
}

export function clampPolicy(policy: TeacherPolicy): TeacherPolicy {
  return {
    ...policy,
    analogyDensity: clamp(policy.analogyDensity),
    socraticRatio: clamp(policy.socraticRatio),
    formalism: clamp(policy.formalism),
    retrievalPractice: clamp(policy.retrievalPractice),
    exerciseCount: Math.min(5, Math.max(1, Math.round(policy.exerciseCount))),
    diagramBias: clamp(policy.diagramBias),
    reflectionBias: clamp(policy.reflectionBias),
    interdisciplinaryBias: clamp(policy.interdisciplinaryBias),
    challengeRate: clamp(policy.challengeRate)
  };
}

export function policySignature(policy: TeacherPolicy): string {
  return [
    policy.analogyDensity.toFixed(2),
    policy.socraticRatio.toFixed(2),
    policy.formalism.toFixed(2),
    policy.retrievalPractice.toFixed(2),
    String(policy.exerciseCount),
    policy.diagramBias.toFixed(2),
    policy.reflectionBias.toFixed(2),
    policy.interdisciplinaryBias.toFixed(2),
    policy.challengeRate.toFixed(2)
  ].join("|");
}

export async function loadPolicy(filePath: string): Promise<TeacherPolicy> {
  try {
    const content = await readFile(filePath, "utf8");
    return clampPolicy(JSON.parse(content) as TeacherPolicy);
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function savePolicy(filePath: string, policy: TeacherPolicy): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(clampPolicy(policy), null, 2)}\n`, "utf8");
}
