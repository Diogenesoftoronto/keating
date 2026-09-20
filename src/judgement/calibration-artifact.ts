import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { CalibrationTable } from "../../packages/learner-contracts/src/judgement/projections.js";
import { MAX_CALIBRATION_BYTES, prepareJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact, type JudgementCalibrationArtifact } from "../../packages/learner-contracts/src/judgement/calibration-artifact.js";
export { MAX_CALIBRATION_BYTES, serializeJudgementCalibrationArtifact };
export type { CalibrationInput, CalibrationObservation, JudgementCalibrationArtifact } from "../../packages/learner-contracts/src/judgement/calibration-artifact.js";
const INVALID = "Invalid judgement calibration artifact";
function fail(): never { throw new Error(INVALID); }
export function fitJudgementCalibrationArtifact(value: unknown): JudgementCalibrationArtifact {
  const prepared = prepareJudgementCalibrationArtifact(value);
  return prepared.complete(createHash("sha256").update(prepared.identityInput).digest("hex"));
}

export async function readBoundedCalibrationJson(path: string): Promise<{ value: unknown; sha256: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CALIBRATION_BYTES) fail();
    const buffer = Buffer.alloc(MAX_CALIBRATION_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (!offset || offset > MAX_CALIBRATION_BYTES) fail();
    const bytes = buffer.subarray(0, offset);
    // Fatal UTF-8 decoding with BOM preservation round-trips the exact accepted bytes.
    const contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { value: JSON.parse(contents), sha256: createHash("sha256").update(contents).digest("hex") };
  } catch { return fail(); } finally { await handle?.close(); }
}
export async function loadJudgementCalibrationArtifact(path: string, expectedSha256: string): Promise<{ table: CalibrationTable; sha256: string }> {
  try {
    if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) fail();
    const { value, sha256 } = await readBoundedCalibrationJson(path);
    if (sha256 !== expectedSha256 || (value === null || typeof value !== "object" || Array.isArray(value))) fail();
    const rebuilt = fitJudgementCalibrationArtifact((value as { input: unknown }).input);
    if (serializeJudgementCalibrationArtifact(value as JudgementCalibrationArtifact) !== serializeJudgementCalibrationArtifact(rebuilt)) fail();
    return { table: rebuilt.table, sha256 };
  } catch { fail(); }
}
