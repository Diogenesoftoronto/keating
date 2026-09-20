import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { MAX_BOOSTING_BYTES, prepareBoostingArtifact, serializeBoostingArtifact, validateBoostingArtifact, type BoostingArtifact } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";
export { MAX_BOOSTING_BYTES, serializeBoostingArtifact };
export type { BoostingArtifact, BoostingDataset } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";

const INVALID = "Invalid boosting artifact";
function fail(): never { throw new Error(INVALID); }
function hash(text: string): string { return createHash("sha256").update(text).digest("hex"); }

/** Adopt a CatBoost export and pin the fitted identity over its exact rows. */
export function fitBoostingArtifact(value: unknown): BoostingArtifact {
  const prepared = prepareBoostingArtifact(value);
  return prepared.complete(hash(prepared.identityInput));
}

export async function readBoundedBoostingJson(path: string): Promise<{ value: unknown; sha256: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BOOSTING_BYTES) fail();
    const buffer = Buffer.alloc(MAX_BOOSTING_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (!offset || offset > MAX_BOOSTING_BYTES) fail();
    const bytes = buffer.subarray(0, offset);
    // Fatal UTF-8 decoding with BOM preservation round-trips the exact accepted bytes.
    const contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { value: JSON.parse(contents), sha256: hash(contents) };
  } catch { return fail(); } finally { await handle?.close(); }
}

/**
 * Load a pinned artifact and rebuild its evidence before exposing the model.
 *
 * The file digest is a caller-supplied pin, never one read from the artifact, and
 * the rebuilt artifact must serialize to exactly the accepted bytes. A repinned
 * file whose metrics or status disagree with its own rows is still rejected.
 */
export async function loadBoostingArtifact(path: string, expectedSha256: string): Promise<{ artifact: BoostingArtifact; sha256: string }> {
  try {
    if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) fail();
    const { value, sha256 } = await readBoundedBoostingJson(path);
    if (sha256 !== expectedSha256 || value === null || typeof value !== "object" || Array.isArray(value)) fail();
    const prepared = validateBoostingArtifact(value);
    const artifact = prepared.complete(hash(prepared.identityInput));
    if (serializeBoostingArtifact(value as BoostingArtifact) !== serializeBoostingArtifact(artifact)) fail();
    return { artifact, sha256 };
  } catch { fail(); }
}