import type { CalibrationTable, JudgementBackendKey } from "@keating/learner-contracts";
import { thresholdKey } from "@keating/learner-contracts";
import { MAX_CALIBRATION_BYTES, verifyJudgementCalibrationText } from "../../../../packages/learner-contracts/src/judgement/calibration-artifact";
import { MOBILE_LOCAL_JUDGEMENT_MODEL } from "./local-scorer";

const STORAGE_KEY = "keating.mobile.judgement-calibration.v1";
const FAILURE = "Calibration could not be verified or saved.";
interface CalibrationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface InstalledMobileCalibration {
  readonly backend: JudgementBackendKey;
  readonly table: CalibrationTable;
  readonly fileSha256: string;
  readonly questionCount: number;
}
export interface MobileCalibrationPickedFile { sizeBytes: number; readText(): Promise<string> }
type Digest = (text: string) => Promise<string>;

/** Bounded exact UTF-8 read: replacement decoding must not change the pinned file bytes. */
export function readMobileCalibrationFile(handle: { readBytes(length: number): Uint8Array; close(): void }): string {
  try {
    const bytes = new Uint8Array(MAX_CALIBRATION_BYTES + 1); let offset = 0;
    while (offset < bytes.length) {
      const limit = Math.min(65_536, bytes.length - offset), chunk = handle.readBytes(limit);
      if (chunk.length > limit) throw new Error(FAILURE);
      if (!chunk.length) break;
      bytes.set(chunk, offset); offset += chunk.length;
    }
    if (!offset || offset > MAX_CALIBRATION_BYTES) throw new Error(FAILURE);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
  } catch { throw new Error(FAILURE); } finally { handle.close(); }
}

async function nativeDigest(text: string): Promise<string> {
  const crypto = await import("expo-crypto");
  return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: crypto.CryptoEncoding.HEX });
}
const nativeStorage: CalibrationStorage = {
  getItem: async key => (await import("@react-native-async-storage/async-storage")).default.getItem(key),
  setItem: async (key, value) => (await import("@react-native-async-storage/async-storage")).default.setItem(key, value),
  removeItem: async key => (await import("@react-native-async-storage/async-storage")).default.removeItem(key),
};

/** App-private installation only. Raw observations never enter synced learner records. */
export class MobileJudgementCalibrationStore {
  private revision = 0;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();
  private lastStored: string | null | undefined;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: CalibrationStorage = nativeStorage, private readonly digest: Digest = nativeDigest,
    private readonly backendKind: "system-one" | "local" = "system-one") {}
  private get storageKey() { return this.backendKind === "local" ? `${STORAGE_KEY}.local` : STORAGE_KEY; }
  getRevision = (): number => this.revision;
  isCurrent = (revision: number): boolean => this.pending === 0 && revision === this.revision;
  subscribe = (callback: () => void): (() => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private invalidate() { this.revision++; for (const listener of this.listeners) { try { listener(); } catch { /* A UI observer cannot change installation authority. */ } } }
  private remember(raw: string | null) {
    if (this.lastStored !== undefined && this.lastStored !== raw) this.invalidate();
    this.lastStored = raw;
  }
  private async verify(contents: string, fileSha256: string): Promise<InstalledMobileCalibration> {
    const { artifact, sha256 } = await verifyJudgementCalibrationText(contents, fileSha256, this.digest);
    const hosted = artifact.groups.filter(group => group.backend.backend === this.backendKind);
    const models = new Set(hosted.map(group => group.backend.model));
    if (models.size !== 1) throw new Error(FAILURE);
    const backend = { ...hosted[0]!.backend };
    if (this.backendKind === "local" && backend.model !== MOBILE_LOCAL_JUDGEMENT_MODEL) throw new Error(FAILURE);
    const prefix = thresholdKey(backend, "");
    const entries = Object.fromEntries(Object.entries(artifact.table.entries).filter(([key]) => key.startsWith(prefix))
      .map(([key, thresholds]) => [key, Object.freeze({ ...thresholds })]));
    if (!Object.keys(entries).length) throw new Error(FAILURE);
    return Object.freeze({ backend: Object.freeze(backend), table: Object.freeze({ entries: Object.freeze(entries) }), fileSha256: sha256, questionCount: Object.keys(entries).length });
  }
  async load(): Promise<InstalledMobileCalibration | null> {
    const start = this.revision;
    try {
      if (this.pending) throw new Error(FAILURE);
      const raw = await this.storage.getItem(this.storageKey);
      if (!this.isCurrent(start)) throw new Error(FAILURE);
      this.remember(raw);
      const current = this.revision;
      if (raw === null) return null;
      // An envelope can escape every source byte; bound it before parsing too.
      if (raw.length > MAX_CALIBRATION_BYTES * 6 + 256) throw new Error(FAILURE);
      const stored: unknown = JSON.parse(raw);
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error(FAILURE);
      const entry = stored as Record<string, unknown>;
      if (Object.keys(entry).sort().join(",") !== "contents,fileSha256,schemaVersion" || entry.schemaVersion !== 1 || typeof entry.contents !== "string" || typeof entry.fileSha256 !== "string") throw new Error(FAILURE);
      const installed = await this.verify(entry.contents, entry.fileSha256);
      const reread = await this.storage.getItem(this.storageKey);
      if (reread !== raw) { this.remember(reread); throw new Error(FAILURE); }
      if (!this.isCurrent(current)) throw new Error(FAILURE);
      return installed;
    } catch { throw new Error(FAILURE); }
  }
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    this.pending++; this.invalidate();
    const result = this.queue.then(work);
    this.queue = result.then(() => {}, () => {});
    return result.catch(() => { throw new Error(FAILURE); }).finally(() => { this.pending--; this.invalidate(); });
  }
  install(contents: string, expectedSha256: string): Promise<InstalledMobileCalibration> {
    return this.mutate(async () => {
      const installed = await this.verify(contents, expectedSha256);
      const raw = JSON.stringify({ schemaVersion: 1, contents, fileSha256: installed.fileSha256 });
      await this.storage.setItem(this.storageKey, raw);
      if (await this.storage.getItem(this.storageKey) !== raw) throw new Error(FAILURE);
      this.lastStored = raw;
      return installed;
    });
  }
  remove(): Promise<void> {
    return this.mutate(async () => {
      await this.storage.removeItem(this.storageKey);
      if (await this.storage.getItem(this.storageKey) !== null) throw new Error(FAILURE);
      this.lastStored = null;
    });
  }
}

export const mobileJudgementCalibrationStore = new MobileJudgementCalibrationStore();
export const mobileLocalJudgementCalibrationStore = new MobileJudgementCalibrationStore(nativeStorage, nativeDigest, "local");

/** Native selection is injected so import limits and persistence are code-testable. */
export async function importMobileJudgementCalibration(expectedSha256: string, options: {
  store?: MobileJudgementCalibrationStore;
  pick?: () => Promise<MobileCalibrationPickedFile | null>;
} = {}): Promise<InstalledMobileCalibration | null> {
  try {
    if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new Error(FAILURE);
    const pick = options.pick ?? (async () => {
      const { File, FileMode } = await import("expo-file-system");
      const picked = await File.pickFileAsync({ mimeTypes: ["application/json", "text/json"], multipleFiles: false });
      if (picked.canceled) return null;
      return { sizeBytes: picked.result.size, readText: async () => readMobileCalibrationFile(picked.result.open(FileMode.ReadOnly)) };
    });
    const file = await pick();
    if (!file) return null;
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > MAX_CALIBRATION_BYTES) throw new Error(FAILURE);
    return (options.store ?? mobileJudgementCalibrationStore).install(await file.readText(), expectedSha256);
  } catch { throw new Error(FAILURE); }
}
