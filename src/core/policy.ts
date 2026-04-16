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
  transfer: 0.18,
  confusion: 0.18
};

export function clampWeights(weights: SimulationWeights): SimulationWeights {
  const clamped: SimulationWeights = {
    masteryGain: clamp(weights.masteryGain, 0.01, 1),
    retention: clamp(weights.retention, 0.01, 1),
    engagement: clamp(weights.engagement, 0.01, 1),
    transfer: clamp(weights.transfer, 0.01, 1),
    confusion: clamp(weights.confusion, 0.01, 1)
  };
  const sum = clamped.masteryGain + clamped.retention + clamped.engagement + clamped.transfer + clamped.confusion;
  if (sum === 0) return DEFAULT_WEIGHTS;
  return {
    masteryGain: clamped.masteryGain / sum,
    retention: clamped.retention / sum,
    engagement: clamped.engagement / sum,
    transfer: clamped.transfer / sum,
    confusion: clamped.confusion / sum
  };
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
