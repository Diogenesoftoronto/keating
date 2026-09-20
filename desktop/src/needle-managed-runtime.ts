/** Explicit desktop model installation. Renderer input never chooses URLs, paths or executable code. */
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { Worker } from "node:worker_threads";

const revision = "b274efcb211a9eef48c9a88da4b43bd569696a39";
const origin = `https://huggingface.co/Cactus-Compute/needle3/resolve/${revision}`;
export const MANAGED_NEEDLE_ASSETS = Object.freeze([
  Object.freeze({ name: "js", file: "needle.cjs", url: `${origin}/wasm/needle.js`, bytes: 62502, sha256: "d00ec67ec7e03e4720dfc6c3dad95a0540afd00169a983ce3fabcd7aeaa0fa93" }),
  Object.freeze({ name: "wasm", file: "needle.wasm", url: `${origin}/wasm/needle.wasm`, bytes: 688521, sha256: "77c6a38cacb8efbeebfd5202082ba9a0850a7c3066db40d4d0e80509cd137d9b" }),
  Object.freeze({ name: "weights", file: "needle3.cact", url: `${origin}/needle3.cact`, bytes: 35335380, sha256: "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38" }),
] as const);
export const MANAGED_NEEDLE_MODEL = `needle3/wasm/${revision}/engine:${MANAGED_NEEDLE_ASSETS[1].sha256}/weights:${MANAGED_NEEDLE_ASSETS[2].sha256}/js:${MANAGED_NEEDLE_ASSETS[0].sha256}`;
const totalBytes = MANAGED_NEEDLE_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
export interface ManagedNeedleEmbedding { model: string; dimensions: number; vectors: number[][] }
export interface ManagedNeedleStatus {
  available: boolean; model: string | null; installed: boolean; downloading: boolean;
  downloadedBytes: number; totalBytes: number; error?: string; managed: true;
}
export interface ManagedNeedleWorker {
  postMessage(message: unknown): void;
  on(event: "message" | "error" | "exit", listener: (value: any) => void): unknown;
  terminate(): unknown;
}
export interface ManagedNeedleOptions {
  fetch?: typeof globalThis.fetch;
  worker?: (directory: string) => ManagedNeedleWorker;
  timeoutMs?: number;
  downloadTimeoutMs?: number;
}
function invalid(): never { throw new Error("needle_request_invalid"); }
function requestTexts(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || !("texts" in payload)
    || !Array.isArray(payload.texts) || payload.texts.length < 1 || payload.texts.length > 16) return invalid();
  let total = 0;
  for (const text of payload.texts) {
    if (typeof text !== "string" || !text.trim() || text.includes("\0") || text.length > 4096
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) return invalid();
    const bytes = Buffer.byteLength(text); total += bytes;
    if (bytes > 4096 || total > 16384) return invalid();
  }
  return [...payload.texts];
}
function aborted(signal: AbortSignal): void { if (signal.aborted) throw new Error("needle_download_cancelled"); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("needle_download_cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("needle_download_cancelled")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("needle_directory_invalid");
}
async function fingerprint(directory: string): Promise<string> {
  const folder = await lstat(directory, { bigint: true });
  if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error("needle_assets_invalid");
  const parts = [`${folder.dev}:${folder.ino}`];
  for (const asset of MANAGED_NEEDLE_ASSETS) {
    const info = await lstat(join(directory, asset.file), { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.size !== BigInt(asset.bytes)) throw new Error("needle_assets_invalid");
    parts.push(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`);
  }
  return parts.join("|");
}
/** Independently reused by the worker before any downloaded JS is evaluated. Exact-size regular files only. */
export async function readManagedNeedleAssets(directory: string): Promise<Record<"js" | "wasm" | "weights", Uint8Array>> {
  const before = await fingerprint(directory), result = {} as Record<"js" | "wasm" | "weights", Uint8Array>;
  for (const asset of MANAGED_NEEDLE_ASSETS) {
    const handle = await open(join(directory, asset.file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== asset.bytes) throw new Error("needle_assets_invalid");
      const buffer = Buffer.alloc(asset.bytes + 1); let offset = 0;
      while (offset < buffer.length) { const read = await handle.read(buffer, offset, buffer.length - offset, null); if (!read.bytesRead) break; offset += read.bytesRead; }
      const bytes = buffer.subarray(0, offset);
      if (offset !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("needle_assets_invalid");
      result[asset.name] = bytes;
    } finally { await handle.close(); }
  }
  if (before !== await fingerprint(directory)) throw new Error("needle_assets_changed");
  return result;
}

export class ManagedDesktopNeedleRuntime {
  private stopped = false;
  private epoch = 0;
  private cachedFingerprint: string | null = null;
  private checking: Promise<boolean> | null = null;
  private installing: Promise<void> | null = null;
  private removing: Promise<void> | null = null;
  private downloadController: AbortController | null = null;
  private downloadedBytes = 0;
  private error: string | undefined;
  private worker: ManagedNeedleWorker | null = null;
  private workerReady = false;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private readonly installedDirectory: string;
  constructor(private readonly directory: string, private readonly options: ManagedNeedleOptions = {}) {
    if (!isAbsolute(directory)) invalid();
    this.installedDirectory = join(directory, "installed");
  }
  async status(): Promise<ManagedNeedleStatus> {
    const installed = !this.stopped && !this.removing && await this.local();
    return { available: !!installed, model: installed ? MANAGED_NEEDLE_MODEL : null, installed: !!installed,
      downloading: !!this.downloadController && !this.downloadController.signal.aborted,
      downloadedBytes: installed ? totalBytes : this.downloadedBytes, totalBytes, ...(this.error ? { error: this.error } : {}), managed: true };
  }
  download(): Promise<void> {
    if (this.stopped || this.removing) return Promise.reject(new Error("needle_runtime_stopped"));
    if (this.installing) return this.installing;
    this.invalidate();
    const controller = new AbortController(), generation = this.epoch;
    this.downloadController = controller; this.error = undefined; this.downloadedBytes = 0;
    const deadline = setTimeout(() => controller.abort(), Math.max(1, Math.min(300_000, this.options.downloadTimeoutMs ?? 300_000)));
    const work = (async () => {
      let temporary: string | null = null;
      try {
        if (await this.local()) return;
        await privateDirectory(this.directory); aborted(controller.signal);
        temporary = await mkdtemp(join(this.directory, "download-"));
        for (const asset of MANAGED_NEEDLE_ASSETS) {
          aborted(controller.signal);
          const request = (this.options.fetch ?? globalThis.fetch)(asset.url, { signal: controller.signal, credentials: "omit" });
          void request.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
          const response = await abortable(request, controller.signal);
          if (!response.ok || !response.body) throw new Error("needle_download_failed");
          const length = response.headers.get("content-length");
          if (length !== null && Number(length) !== asset.bytes) { void response.body.cancel().catch(() => {}); throw new Error("needle_download_invalid"); }
          const reader = response.body.getReader(), bytes = Buffer.alloc(asset.bytes); let offset = 0;
          try {
            for (;;) {
              const chunk = await abortable(reader.read(), controller.signal);
              if (chunk.done) break;
              if (offset + chunk.value.byteLength > asset.bytes) throw new Error("needle_download_invalid");
              bytes.set(chunk.value, offset); offset += chunk.value.byteLength; this.downloadedBytes += chunk.value.byteLength;
            }
          } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* pending abort settles separately */ } }
          if (offset !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("needle_download_invalid");
          aborted(controller.signal);
          const file = await open(join(temporary, asset.file), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
          try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        }
        await readManagedNeedleAssets(temporary);
        aborted(controller.signal);
        if (this.epoch !== generation || this.stopped) throw new Error("needle_download_cancelled");
        // Repair is explicit. The final path is published only after all three byte pins pass.
        await rm(this.installedDirectory, { recursive: true, force: true });
        aborted(controller.signal);
        await rename(temporary, this.installedDirectory); temporary = null;
        if (controller.signal.aborted || this.epoch !== generation || this.stopped) {
          await rm(this.installedDirectory, { recursive: true, force: true }); throw new Error("needle_download_cancelled");
        }
        this.cachedFingerprint = await fingerprint(this.installedDirectory);
      } catch {
        this.error = controller.signal.aborted ? undefined : "needle_download_failed";
        throw new Error(controller.signal.aborted ? "needle_download_cancelled" : "needle_download_failed");
      } finally {
        clearTimeout(deadline);
        if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
        if (this.downloadController === controller) this.downloadController = null;
      }
    })();
    this.installing = work;
    void work.finally(() => { if (this.installing === work) this.installing = null; }).catch(() => {});
    return work;
  }
  cancelDownload(): void { this.downloadController?.abort(); }
  remove(): Promise<void> {
    if (this.removing) return this.removing;
    this.invalidate(); this.cancelDownload();
    const work = (async () => {
      await this.installing?.catch(() => {});
      await rm(this.installedDirectory, { recursive: true, force: true });
      this.downloadedBytes = 0; this.error = undefined;
    })();
    this.removing = work;
    void work.finally(() => { if (this.removing === work) this.removing = null; }).catch(() => {});
    return work;
  }
  embed(payload: unknown): Promise<ManagedNeedleEmbedding | null> {
    let texts: string[];
    try { texts = requestTexts(payload); } catch { return Promise.reject(new Error("needle_request_invalid")); }
    if (this.stopped || this.removing || this.queued >= 4) return Promise.resolve(null);
    const generation = this.epoch; this.queued++;
    const work = this.queue.then(async () => {
      if (this.stopped || this.removing || generation !== this.epoch || !await this.local()) return null;
      if (generation !== this.epoch || this.stopped) return null;
      if (!this.worker) this.startWorker();
      if (!this.workerReady) this.workerReady = await this.request({ kind: "init" }) === MANAGED_NEEDLE_MODEL;
      if (!this.workerReady || generation !== this.epoch || this.stopped) { this.stopWorker(); return null; }
      const value = await this.request({ kind: "embed", texts });
      if (generation !== this.epoch || this.stopped || !value || typeof value !== "object") return null;
      const result = value as ManagedNeedleEmbedding;
      if (result.model !== MANAGED_NEEDLE_MODEL || result.dimensions !== 3072 || !Array.isArray(result.vectors) || result.vectors.length !== texts.length
        || result.vectors.some(vector => !Array.isArray(vector) || vector.length !== 3072 || !vector.some(value => value !== 0)
          || vector.some(value => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e6))) { this.stopWorker(); return null; }
      return { model: result.model, dimensions: result.dimensions, vectors: result.vectors.map(vector => [...vector]) };
    }).catch(() => { this.stopWorker(); return null; });
    this.queue = work; void work.finally(() => { this.queued--; });
    return work;
  }
  stop(): void { this.stopped = true; this.invalidate(); this.cancelDownload(); }
  private invalidate() { this.epoch++; this.cachedFingerprint = null; this.checking = null; this.stopWorker(); }
  private stopWorker() {
    const worker = this.worker; this.worker = null; this.workerReady = false;
    if (worker) { try { void Promise.resolve(worker.terminate()).catch(() => {}); } catch { /* already terminated */ } }
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.resolve(null); }
    this.pending.clear();
  }
  private startWorker() {
    const worker = this.options.worker?.(this.installedDirectory)
      ?? new Worker(new URL("./needle-managed-worker.js", import.meta.url), { workerData: { directory: this.installedDirectory }, execArgv: [] });
    this.worker = worker;
    worker.on("message", message => {
      if (this.worker !== worker || !message || !Number.isSafeInteger(message.id)) return;
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer); pending.resolve(message.ok === true ? message.value : null);
    });
    const failed = () => { if (this.worker === worker) this.stopWorker(); };
    worker.on("error", failed); worker.on("exit", failed);
  }
  private request(message: Record<string, unknown>): Promise<unknown> {
    if (!this.worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.error = "needle_inference_timeout"; this.stopWorker(); }, Math.max(1, Math.min(30_000, this.options.timeoutMs ?? 15_000)));
      this.pending.set(id, { resolve, timer });
      try { this.worker!.postMessage({ ...message, id }); } catch { this.stopWorker(); }
    });
  }
  private local(): Promise<boolean> {
    if (this.stopped || this.removing) return Promise.resolve(false);
    if (this.checking) return this.checking;
    const generation = this.epoch;
    const work = (async () => {
      try {
        const current = await fingerprint(this.installedDirectory);
        if (current !== this.cachedFingerprint) { await readManagedNeedleAssets(this.installedDirectory); if (generation === this.epoch) this.stopWorker(); }
        if (generation !== this.epoch || this.stopped) return false;
        this.cachedFingerprint = current; return true;
      } catch { if (generation === this.epoch) { this.cachedFingerprint = null; this.stopWorker(); } return false; }
    })();
    this.checking = work;
    void work.finally(() => { if (this.checking === work) this.checking = null; });
    return work;
  }
}
