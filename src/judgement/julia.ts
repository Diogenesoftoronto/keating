import { JuliaNativeRuntime } from "../../shared/julia/native.js";
import { createJuliaLabelScorer } from "../../shared/julia/scorer.js";
import { createLocalJudgementCaller } from "../../packages/learner-contracts/src/judgement/local-backend.js";
import type { JudgementTier } from "../../packages/learner-contracts/src/judgement/router.js";
import type { CalibrationTable } from "../../packages/learner-contracts/src/judgement/projections.js";
import { loadJudgementCalibrationArtifact, readBoundedCalibrationJson } from "./calibration-artifact.js";

/** Explicit CPU local tier. Downloading never grants a calibrated decision policy. */
export async function createJuliaJudgementBackend(options: {
  directory: string; maxLength?: number; headLength?: number; threads?: number;
  calibrationFile?: string; calibrationFileSha256?: string;
}): Promise<{ tier: JudgementTier; calibration: CalibrationTable; runtime: JuliaNativeRuntime }> {
  const runtime = new JuliaNativeRuntime(options);
  let calibration: CalibrationTable = { entries: {} };
  let calibrationSha256: string | null = null;
  if (options.calibrationFile || options.calibrationFileSha256) {
    if (!options.calibrationFile || !options.calibrationFileSha256) throw new Error("Julia calibration requires an artifact and its exact file SHA256.");
    const loaded = await loadJudgementCalibrationArtifact(options.calibrationFile, options.calibrationFileSha256);
    const { value } = await readBoundedCalibrationJson(options.calibrationFile);
    const artifact = value as { calibrationSha256: string; groups: Array<{ backend: { backend: string; model: string }; status: string }> };
    if (!artifact.groups.some(group => group.status === "validated" && group.backend.backend === "local" && group.backend.model === runtime.modelId)) throw new Error("Julia calibration does not validate this exact native model.");
    calibration = loaded.table; calibrationSha256 = artifact.calibrationSha256;
  }
  const key = { backend: "local" as const, model: runtime.modelId, calibrationSha256 };
  const installed = (await runtime.status()).installed;
  return { runtime, calibration, tier: { key, isAvailable: () => installed,
    call: createLocalJudgementCaller({ model: key.model, calibrationSha256, scoreLabels: createJuliaLabelScorer(runtime) }) } };
}
