/** Private, byte-pinned original exports; no invented labels or implicit independence assignments. */
import { constants, type BigIntStats } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { verifyDecisionPolicySourceArtifact, DECISION_POLICY_RECONSTRUCTION_LIMITS, type DecisionPolicyBoundSource, type DecisionPolicySourceArtifact, type DecisionPolicySourceProvenance } from "../../packages/learner-contracts/src/judgement/decision-policy-data.js";

export interface DecisionPolicyManifest {
  schemaVersion: 1;
  sources: Array<{ path: string; sha256: string; learnerId: string; groupId: string; split: "fit" | "validation"; provenance?: DecisionPolicySourceProvenance }>;
}
export const decisionPolicySha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
export function decisionPolicyCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(decisionPolicyCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${decisionPolicyCanonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
const invalid = (): never => { throw new Error("decision_policy_source_invalid"); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown, names: string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
export function validateDecisionPolicyManifest(value: unknown): DecisionPolicyManifest {
  if (!keys(value, ["schemaVersion", "sources"]) || value.schemaVersion !== 1 || !Array.isArray(value.sources) || value.sources.length > 256) return invalid();
  const sources: DecisionPolicyManifest["sources"] = [];
  const learners = new Set<string>(), paths = new Set<string>(), hashes = new Set<string>(), groups = new Map<string, string>();
  for (const row of value.sources) {
    if (!(keys(row, ["path", "sha256", "learnerId", "groupId", "split"]) || keys(row, ["path", "sha256", "learnerId", "groupId", "split", "provenance"])) || typeof row.path !== "string" || !row.path.trim() || row.path.length > 4096 || /[\u0000-\u001f]/u.test(row.path)
      || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.sha256) || !text(row.learnerId) || !text(row.groupId)
      || (row.split !== "fit" && row.split !== "validation") || learners.has(row.learnerId) || paths.has(row.path) || hashes.has(row.sha256)
      || groups.has(row.groupId) && groups.get(row.groupId) !== row.split) return invalid();
    learners.add(row.learnerId); paths.add(row.path); hashes.add(row.sha256); groups.set(row.groupId, row.split);
    sources.push({ path: row.path, sha256: row.sha256, learnerId: row.learnerId, groupId: row.groupId, split: row.split, ...(row.provenance === undefined ? {} : { provenance: structuredClone(row.provenance) as DecisionPolicySourceProvenance }) });
  }
  return { schemaVersion: 1, sources: sources.sort((a, b) => a.learnerId.localeCompare(b.learnerId)) };
}

/** The opened inode stays regular and byte-identical through the bounded read. */
export async function readDecisionPolicySource(path: string, maxBytes = 16_000_000): Promise<{ text: string; sha256: string }> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes)) return invalid();
    const bytes = Buffer.alloc(maxBytes + 1); let offset = 0;
    while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, null); if (!result.bytesRead) break; offset += result.bytesRead; }
    const after = await handle.stat({ bigint: true });
    const same = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
    if (offset > maxBytes || !same(before, after) || BigInt(offset) !== after.size) return invalid();
    const exact = bytes.subarray(0, offset);
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(exact), sha256: decisionPolicySha256(exact) };
  } finally { await handle.close(); }
}
export type DecisionPolicySourceBinding = DecisionPolicySourceArtifact;
/** Recompute from exact original texts using the same portable verifier as installed models. */
export async function rebuildDecisionPolicySources(binding: DecisionPolicySourceBinding) {
  return (await verifyDecisionPolicySourceArtifact(binding, async text => decisionPolicySha256(text))).datasets;
}
export async function buildDecisionPolicyDataset(cwd: string, input: unknown) {
  const manifest = validateDecisionPolicyManifest(input), sources: DecisionPolicyBoundSource[] = [];
  let bytes = 0;
  for (const source of manifest.sources) {
    const loaded = await readDecisionPolicySource(resolve(cwd, source.path));
    if (loaded.sha256 !== source.sha256) return invalid();
    bytes += Buffer.byteLength(loaded.text); if (bytes > 64_000_000) return invalid();
    sources.push({ sourceId: loaded.sha256, learnerId: source.learnerId, groupId: source.groupId, split: source.split, fileSha256: loaded.sha256, text: loaded.text, provenance: source.provenance ?? { origin: "local-export", dataset: "local-portable-export", revision: loaded.sha256, schedule: "observed", notes: "Local file consistency does not authenticate collection or learner identity." } });
  }
  const binding: DecisionPolicySourceBinding = { schemaVersion: 1, format: "portable-decision-policy-sources-v1", sources,
    reconstruction: [...DECISION_POLICY_RECONSTRUCTION_LIMITS] };
  const datasets = await rebuildDecisionPolicySources(binding);
  // Files changed during extraction never yield a source-current bundle.
  for (const source of manifest.sources) if ((await readDecisionPolicySource(resolve(cwd, source.path))).sha256 !== source.sha256) return invalid();
  return { schemaVersion: 1 as const, binding, bindingSha256: decisionPolicySha256(decisionPolicyCanonical(binding)), datasets,
    datasetSha256: decisionPolicySha256(decisionPolicyCanonical(datasets)), manifest };
}
