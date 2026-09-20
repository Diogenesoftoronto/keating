import type { PortableLearnerData } from "@keating/learner-contracts";
import { decisionPolicyFeatures, decisionPolicySnapshot, type DecisionPolicySnapshot, type DecisionPolicySelection, type DecisionPolicyTarget } from "../../../../packages/learner-contracts/src/judgement/decision-policy-data";
import { isVerifiedDecisionPolicy, verifyDecisionPolicyText, MAX_DECISION_POLICY_FIT_BYTES, type VerifiedDecisionPolicy } from "../../../../packages/learner-contracts/src/judgement/decision-policy-fit";
import type { MobileCalibrationPickedFile } from "./calibration";

export type MobileDecisionPolicies = Partial<Record<DecisionPolicyTarget, VerifiedDecisionPolicy>>;
export interface MobileDecisionEstimate {
  value: number; fileSha256: string; fitSha256: string; method: "shallow-tree" | "boosting";
  target: DecisionPolicyTarget; domain: string; asOf: number; datasets: string[];
  provenance: string[];
  labelKind: "observed-binary" | "judgement-probability";
  evidenceLabel: string;
}
/** Verified handles and the training extractor are the only prediction boundary. */
export function mobileDecisionEstimate(policy: VerifiedDecisionPolicy | undefined, target: DecisionPolicyTarget,
  data: PortableLearnerData, topic: string, asOf: number, selection: DecisionPolicySelection = {}): MobileDecisionEstimate | null {
  if (!isVerifiedDecisionPolicy(policy)) return null;
  return mobileDecisionSnapshotEstimate(policy, target, decisionPolicySnapshot(data, topic, asOf), selection);
}
export function mobileDecisionSnapshotEstimate(policy: VerifiedDecisionPolicy | undefined, target: DecisionPolicyTarget,
  snapshot: DecisionPolicySnapshot, selection: DecisionPolicySelection = {}): MobileDecisionEstimate | null {
  if (!isVerifiedDecisionPolicy(policy) || policy.artifact.target !== target || !policy.artifact.selected) return null;
  const features = decisionPolicyFeatures(snapshot, target, selection);
  if (!features) return null;
  const value = policy.predict(features);
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return { value, fileSha256: policy.sha256, fitSha256: policy.artifact.fitSha256, method: policy.artifact.selected,
    target, domain: policy.artifact.domain, asOf: snapshot.asOf,
    labelKind: policy.artifact.dataset.labelKind,
    evidenceLabel: mobileDecisionPolicyEvidenceLabel(policy.artifact.dataset.labelKind),
    datasets: [...new Set(policy.artifact.source.sources.map(source => source.provenance.dataset))],
    provenance: [...new Set(policy.artifact.source.sources.map(source => `${source.provenance.origin}; ${source.provenance.revision}; schedules ${source.provenance.schedule}`))] };
}

const MAX_BYTES = MAX_DECISION_POLICY_FIT_BYTES;
interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
type Digest = (text: string) => Promise<string>;
// 128 Ki UTF-16 units occupy at most 512 KiB as UTF-8, including split surrogate pairs.
const CHUNK_UNITS = 128 * 1024;
const MAX_ENVELOPE_UNITS = MAX_BYTES * 6 + 256;
interface ChunkManifest { format: "decision-policy-chunks-v1"; id: string; count: number; length: number }
function chunkManifest(raw: string | null): ChunkManifest | null {
  if (!raw || raw.length > 1024) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "decision-policy-chunks-v1") return null;
  const row = value as Partial<ChunkManifest>;
  if (Object.keys(row).sort().join(",") !== "count,format,id,length" || typeof row.id !== "string"
    || !/^[a-zA-Z0-9-]{16,64}$/u.test(row.id) || !Number.isSafeInteger(row.length) || row.length! < 1
    || row.length! > MAX_ENVELOPE_UNITS || row.count !== Math.ceil(row.length! / CHUNK_UNITS)) throw Error("decision_policy_chunks_invalid");
  return row as ChunkManifest;
}
/** Atomic manifest publication keeps multi-megabyte fits below native single-row limits. */
export function chunkedDecisionPolicyStorage(storage: Storage, nonce: () => Promise<string>): Storage {
  const chunkKey = (key: string, manifest: ChunkManifest, index: number) => `${key}.chunks.${manifest.id}.${index}`;
  const cleanup = async (key: string, manifest: ChunkManifest | null) => {
    if (manifest) for (let index = 0; index < manifest.count; index++) await storage.removeItem(chunkKey(key, manifest, index));
  };
  return {
    async getItem(key) {
      const raw = await storage.getItem(key), manifest = chunkManifest(raw);
      // Existing small single-entry installs remain readable and migrate on next import.
      if (!manifest) return raw;
      const parts: string[] = [];
      for (let index = 0; index < manifest.count; index++) {
        const chunk = await storage.getItem(chunkKey(key, manifest, index));
        const expected = Math.min(CHUNK_UNITS, manifest.length - index * CHUNK_UNITS);
        if (chunk === null || chunk.length !== expected) throw Error("decision_policy_chunk_missing");
        parts.push(chunk);
      }
      if (await storage.getItem(key) !== raw) throw Error("decision_policy_changed");
      return parts.join("");
    },
    async setItem(key, value) {
      if (!value.length || value.length > MAX_ENVELOPE_UNITS) throw Error("decision_policy_file_too_large");
      const previousRaw = await storage.getItem(key), previous = chunkManifest(previousRaw);
      const manifest: ChunkManifest = { format: "decision-policy-chunks-v1", id: await nonce(),
        count: Math.ceil(value.length / CHUNK_UNITS), length: value.length };
      const raw = JSON.stringify(manifest);
      chunkManifest(raw);
      if (previous?.id === manifest.id) throw Error("decision_policy_nonce_reused");
      try {
        for (let index = 0; index < manifest.count; index++) {
          const part = value.slice(index * CHUNK_UNITS, (index + 1) * CHUNK_UNITS), path = chunkKey(key, manifest, index);
          await storage.setItem(path, part);
          if (await storage.getItem(path) !== part) throw Error("decision_policy_write_failed");
        }
        if (await storage.getItem(key) !== previousRaw) throw Error("decision_policy_changed");
        await storage.setItem(key, raw);
        if (await storage.getItem(key) !== raw) throw Error("decision_policy_write_failed");
      } catch (error) {
        // A storage implementation may throw after committing: never remove published chunks.
        if (await storage.getItem(key) !== raw) await cleanup(key, manifest).catch(() => {});
        throw error;
      }
      await cleanup(key, previous).catch(() => {});
    },
    async removeItem(key) {
      const previous = chunkManifest(await storage.getItem(key));
      await storage.removeItem(key);
      if (await storage.getItem(key) !== null) throw Error("decision_policy_remove_failed");
      await cleanup(key, previous);
    },
  };
}
/** Keep only the manifest in SQLite; Android's default total AsyncStorage budget is 6 MiB. */
export function privateFileDecisionPolicyStorage(manifests: Storage, chunks: Storage, nonce: () => Promise<string>): Storage {
  const backend = (key: string) => key.includes(".chunks.") ? chunks : manifests;
  return chunkedDecisionPolicyStorage({
    getItem: key => backend(key).getItem(key),
    setItem: (key, value) => backend(key).setItem(key, value),
    removeItem: key => backend(key).removeItem(key),
  }, nonce);
}
const MAX_CHUNK_FILE_BYTES = CHUNK_UNITS * 6 + 2; // JSON preserves split UTF-16 surrogate pairs exactly.
async function nativeChunkFile(key: string) {
  if (!/^keating\.mobile\.decision-policy\.v1\.(mastery|retention|urgency)\.chunks\.[a-zA-Z0-9-]{16,64}\.\d{1,4}$/u.test(key)) throw Error("decision_policy_chunk_key_invalid");
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, "decision-policy-chunks");
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, `${key}.json`);
}
const nativeStorage = privateFileDecisionPolicyStorage({
  getItem: async key => (await import("@react-native-async-storage/async-storage")).default.getItem(key),
  setItem: async (key, value) => (await import("@react-native-async-storage/async-storage")).default.setItem(key, value),
  removeItem: async key => (await import("@react-native-async-storage/async-storage")).default.removeItem(key),
}, {
  async getItem(key) {
    const file = await nativeChunkFile(key);
    if (!file.exists) return null;
    if (file.size > MAX_CHUNK_FILE_BYTES) throw Error("decision_policy_chunk_invalid");
    const handle = file.open();
    try {
      const bytes = new Uint8Array(MAX_CHUNK_FILE_BYTES + 1); let offset = 0;
      while (offset < bytes.length) {
        const limit = Math.min(65536, bytes.length - offset), part = handle.readBytes(limit);
        if (part.length > limit) throw Error("decision_policy_chunk_invalid");
        if (!part.length) break;
        bytes.set(part, offset); offset += part.length;
      }
      if (offset > MAX_CHUNK_FILE_BYTES) throw Error("decision_policy_chunk_invalid");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
      if (typeof value !== "string" || value.length > CHUNK_UNITS) throw Error("decision_policy_chunk_invalid");
      return value;
    } finally { handle.close(); }
  },
  async setItem(key, value) {
    if (value.length > CHUNK_UNITS) throw Error("decision_policy_chunk_invalid");
    const file = await nativeChunkFile(key);
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(value), { encoding: "utf8" });
  },
  async removeItem(key) { const file = await nativeChunkFile(key); if (file.exists) file.delete(); },
}, async () => (await import("expo-crypto")).randomUUID());
const digest: Digest = async text => { const crypto = await import("expo-crypto"); return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, text); };

/** A fitted proxy must describe its labels, never imply observed personal mastery. */
export function mobileDecisionPolicyEvidenceLabel(labelKind: MobileDecisionEstimate["labelKind"]): string {
  return labelKind === "judgement-probability"
    ? "Synthetic judge-probability fit; no observed learning outcome"
    : "Recorded-outcome fit; personal calibration unverified";
}

/** Device-private fitted policies. Installation never writes learner scores or synced profile fields. */
export class MobileDecisionPolicyStore {
  private revision = 0;
  private pending = 0;
  private tail = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  constructor(readonly target: DecisionPolicyTarget, private storage: Storage = nativeStorage, private hash: Digest = digest) {}
  private get key() { return `keating.mobile.decision-policy.v1.${this.target}`; }
  getRevision = () => this.revision;
  isCurrent = (revision: number) => !this.pending && revision === this.revision;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private invalidate() { this.revision++; for (const listener of this.listeners) { try { listener(); } catch {} } }
  private async verify(text: string, pin: string) {
    if (!text.length || text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Error("decision_policy_file_too_large");
    const verified = await verifyDecisionPolicyText(text, pin, this.hash);
    if (verified.artifact.target !== this.target || !verified.artifact.selected) throw Error("decision_policy_not_selected");
    return verified;
  }
  async load(): Promise<VerifiedDecisionPolicy | null> {
    const revision = this.revision;
    if (!this.isCurrent(revision)) throw Error("decision_policy_changing");
    const raw = await this.storage.getItem(this.key);
    if (!this.isCurrent(revision)) throw Error("decision_policy_changing");
    if (raw === null) return null;
    if (raw.length > MAX_BYTES * 6 + 256) throw Error("decision_policy_invalid");
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object" || Object.keys(entry).sort().join(",") !== "contents,fileSha256,schemaVersion"
      || entry.schemaVersion !== 1 || typeof entry.contents !== "string" || typeof entry.fileSha256 !== "string") throw Error("decision_policy_invalid");
    const verified = await this.verify(entry.contents, entry.fileSha256);
    if (!this.isCurrent(revision) || await this.storage.getItem(this.key) !== raw) throw Error("decision_policy_changed");
    return verified;
  }
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    this.pending++; this.invalidate();
    const result = this.tail.then(work);
    this.tail = result.then(() => {}, () => {});
    return result.finally(() => { this.pending--; this.invalidate(); });
  }
  install(text: string, pin: string): Promise<VerifiedDecisionPolicy> {
    return this.mutate(async () => {
      const verified = await this.verify(text, pin), raw = JSON.stringify({ schemaVersion: 1, contents: text, fileSha256: verified.sha256 });
      await this.storage.setItem(this.key, raw);
      if (await this.storage.getItem(this.key) !== raw) throw Error("decision_policy_write_failed");
      return verified;
    });
  }
  remove(): Promise<void> {
    return this.mutate(async () => { await this.storage.removeItem(this.key); if (await this.storage.getItem(this.key) !== null) throw Error("decision_policy_remove_failed"); });
  }
}
export const mobileDecisionPolicyStores = {
  mastery: new MobileDecisionPolicyStore("mastery"), retention: new MobileDecisionPolicyStore("retention"), urgency: new MobileDecisionPolicyStore("urgency"),
};
export function readMobileDecisionPolicyFile(handle: { readBytes(length: number): Uint8Array; close(): void }): string {
  try {
    const bytes = new Uint8Array(MAX_BYTES + 1); let offset = 0;
    while (offset < bytes.length) {
      const limit = Math.min(65536, bytes.length - offset), chunk = handle.readBytes(limit);
      if (chunk.length > limit) throw Error("decision_policy_invalid");
      if (!chunk.length) break;
      bytes.set(chunk, offset); offset += chunk.length;
    }
    if (!offset || offset > MAX_BYTES) throw Error("decision_policy_file_too_large");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
  } finally { handle.close(); }
}
export async function importMobileDecisionPolicy(store: MobileDecisionPolicyStore, expectedSha256: string,
  pick?: () => Promise<MobileCalibrationPickedFile | null>) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) throw Error("decision_policy_pin_invalid");
  const file = await (pick ?? (async () => {
    const { File, FileMode } = await import("expo-file-system");
    const picked = await File.pickFileAsync({ mimeTypes: ["application/json", "text/json"], multipleFiles: false });
    return picked.canceled ? null : { sizeBytes: picked.result.size, readText: async () => readMobileDecisionPolicyFile(picked.result.open(FileMode.ReadOnly)) };
  }))();
  if (!file) return null;
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > MAX_BYTES) throw Error("decision_policy_file_too_large");
  return store.install(await file.readText(), expectedSha256);
}
