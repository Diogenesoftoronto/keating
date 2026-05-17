import { SimulationWeights, TeacherPolicy } from "./types.js";
import { Prng } from "./random.js";
import { clamp } from "./util.js";
import { clampPolicy, clampWeights } from "./policy.js";

export function mutateScalar(prng: Prng, value: number, amplitude = 0.18): number {
  return clamp(value + (prng.next() * 2 - 1) * amplitude);
}

export function mutatePolicy(parent: TeacherPolicy, prng: Prng, iteration: number, namePrefix = "candidate"): TeacherPolicy {
  return clampPolicy({
    ...parent,
    name: `${namePrefix}-${iteration}`,
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

export function mutateWeights(parent: SimulationWeights, prng: Prng, amplitude = 0.12): SimulationWeights {
  return clampWeights({
    masteryGain: mutateScalar(prng, parent.masteryGain, amplitude),
    retention: mutateScalar(prng, parent.retention, amplitude),
    engagement: mutateScalar(prng, parent.engagement, amplitude),
    transfer: mutateScalar(prng, parent.transfer, amplitude),
    confusion: mutateScalar(prng, parent.confusion, amplitude)
  });
}
