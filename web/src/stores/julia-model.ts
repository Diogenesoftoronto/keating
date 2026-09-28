import { JULIA_ARTIFACTS, JULIA_BROWSER_MODEL_ID, JULIA_MODEL, JULIA_TOTAL_BYTES } from "../../../shared/julia/manifest.js";
import type { JuliaDecisionRequest, JuliaEncoder } from "../../../shared/julia/encoder.js";
import { juliaWeights } from "../../../shared/julia/scorer.js";
import type { InferenceSession } from "onnxruntime-web";

export interface JuliaBrowserStatus {
  available: boolean; installed: boolean; downloading: boolean; loaded: boolean;
  downloadedBytes: number; totalBytes: number; error?: string;
}
const CHUNK_BYTES = 32 * 1024 * 1024;
const RUNTIME_CACHE = "keating-julia-runtime-v1";
const CACHE = `keating-julia-${JULIA_MODEL.revision}`;
const available = () => typeof caches !== "undefined" && typeof WebAssembly !== "undefined" && Boolean(globalThis.crypto?.subtle);
const key = (file: string) => new URL(`/__local-models/julia/${JULIA_MODEL.revision}/${file}`, globalThis.location?.origin ?? "https://keating.invalid").href;

/** Explicit installation; the model and WASM runtime remain local after download. */
export class JuliaBrowserModel {
  readonly modelId = JULIA_BROWSER_MODEL_ID;
  private state: JuliaBrowserStatus = { available: available(), installed: false, downloading: false, loaded: false, downloadedBytes: 0, totalBytes: JULIA_TOTAL_BYTES };
  private listeners = new Set<(value: JuliaBrowserStatus) => void>();
  private controller?: AbortController;
  private session?: InferenceSession;
  private encoder?: JuliaEncoder;
  private loading?: Promise<void>;
  private running?: Promise<unknown>;
  private busy = false;
  private epoch = 0;
  status() { return this.state; }
  subscribe(listener: (value: JuliaBrowserStatus) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<JuliaBrowserStatus>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(this.state); }
  private markerKey(file: string) { return key(`${file}.verified`); }
  private chunkKey(file: string, index: number) { return key(`${file}.chunk.${index}`); }
  private chunkCount(artifact: typeof JULIA_ARTIFACTS[number]) { return Math.ceil(artifact.bytes / CHUNK_BYTES); }
  private chunkLength(artifact: typeof JULIA_ARTIFACTS[number], index: number) { return Math.min(CHUNK_BYTES, artifact.bytes - index * CHUNK_BYTES); }
  private async runtimeAssets() {
    const [{ default: wasm }, { default: module }] = await Promise.all([
      import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url"), import("onnxruntime-web/ort-wasm-simd-threaded.mjs?url"),
    ]);
    return { wasm, module };
  }
  private async runtimeInstalled() {
    const cache = await caches.open(RUNTIME_CACHE), assets = await this.runtimeAssets();
    for (const url of [assets.wasm, assets.module]) {
      const saved = await cache.match(url);
      if (!saved || saved.headers.get("x-keating-runtime") !== "onnxruntime-web-1.29.0"
        || Number(saved.headers.get("content-length")) <= 0) return false;
    }
    return true;
  }
  private async installRuntime(signal: AbortSignal) {
    const cache = await caches.open(RUNTIME_CACHE), assets = await this.runtimeAssets();
    for (const url of [assets.wasm, assets.module]) {
      signal.throwIfAborted();
      const saved = await cache.match(url);
      if (saved?.headers.get("x-keating-runtime") === "onnxruntime-web-1.29.0" && Number(saved.headers.get("content-length")) > 0) continue;
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("Julia's bundled inference runtime could not be installed.");
      const data = await response.arrayBuffer();
      if (!data.byteLength || data.byteLength > CHUNK_BYTES) throw new Error("Julia's bundled inference runtime has an invalid size.");
      signal.throwIfAborted();
      await cache.put(url, new Response(data, { headers: { "content-length": String(data.byteLength), "x-keating-runtime": "onnxruntime-web-1.29.0",
        "content-type": url === assets.module ? "text/javascript" : "application/wasm" } }));
    }
  }
  private async marked(cache: Cache, artifact: typeof JULIA_ARTIFACTS[number]): Promise<boolean> {
    try {
      const saved = await cache.match(this.markerKey(artifact.file));
      if (!saved) return false;
      const marker = await saved.json() as Record<string, unknown>;
      return marker.schemaVersion === 1 && marker.bytes === artifact.bytes && marker.sha256 === artifact.sha256
        && marker.chunkBytes === CHUNK_BYTES && marker.chunks === this.chunkCount(artifact);
    } catch { return false; }
  }
  private async completeArtifact(cache: Cache, artifact: typeof JULIA_ARTIFACTS[number]): Promise<boolean> {
    if (!await this.marked(cache, artifact)) return false;
    for (let index = 0; index < this.chunkCount(artifact); index++) {
      const chunk = await cache.match(this.chunkKey(artifact.file, index));
      const expected = this.chunkLength(artifact, index);
      if (!chunk || Number(chunk.headers.get("content-length")) !== expected
        || (await chunk.arrayBuffer()).byteLength !== expected) return false;
    }
    return true;
  }
  private async readArtifact(cache: Cache, artifact: typeof JULIA_ARTIFACTS[number]): Promise<Uint8Array<ArrayBuffer>> {
    if (!await this.marked(cache, artifact)) throw new Error("Julia files are missing or unverified. Download the model again.");
    const data = new Uint8Array(artifact.bytes);
    for (let index = 0; index < this.chunkCount(artifact); index++) {
      const chunk = await cache.match(this.chunkKey(artifact.file, index));
      if (!chunk) throw new Error("Julia chunks are missing. Download the model again.");
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      const expected = this.chunkLength(artifact, index);
      if (bytes.length !== expected || Number(chunk.headers.get("content-length")) !== expected) throw new Error("Julia chunk has the wrong size. Download the model again.");
      data.set(bytes, index * CHUNK_BYTES);
    }
    return data;
  }
  async check() {
    if (!available()) { this.update({ available: false }); return this.state; }
    const cache = await caches.open(CACHE);
    let bytes = 0;
    for (const artifact of JULIA_ARTIFACTS) if (await this.completeArtifact(cache, artifact)) bytes += artifact.bytes;
    this.update({ available: true, installed: bytes === JULIA_TOTAL_BYTES && await this.runtimeInstalled(), downloadedBytes: bytes });
    return this.state;
  }
  private async storeChunks(cache: Cache, artifact: typeof JULIA_ARTIFACTS[number], response: Response, signal: AbortSignal, complete: number) {
    if (!response.body) throw new Error("Julia download has no data.");
    await cache.delete(this.markerKey(artifact.file));
    const reader = response.body.getReader();
    let received = 0, index = 0, filled = 0;
    let buffer = new Uint8Array(Math.min(CHUNK_BYTES, artifact.bytes));
    try {
      while (true) {
        signal.throwIfAborted();
        const result = await reader.read();
        if (result.done) break;
        if (received + result.value.byteLength > artifact.bytes) throw new Error("Julia download exceeds its pinned size.");
        let offset = 0;
        while (offset < result.value.length) {
          signal.throwIfAborted();
          const amount = Math.min(buffer.length - filled, result.value.length - offset);
          buffer.set(result.value.subarray(offset, offset + amount), filled);
          offset += amount; filled += amount; received += amount;
          this.update({ downloadedBytes: complete + received });
          if (filled === buffer.length) {
            await cache.put(this.chunkKey(artifact.file, index++), new Response(buffer, { headers: { "content-length": String(buffer.length) } }));
            filled = 0;
            buffer = new Uint8Array(Math.min(CHUNK_BYTES, artifact.bytes - received));
          }
        }
      }
      if (received !== artifact.bytes || filled !== 0 || index !== this.chunkCount(artifact)) throw new Error("Julia download size does not match its pinned artifact.");
    } finally { await reader.cancel().catch(() => {}); }
    signal.throwIfAborted();
    // Assemble once for the full SHA-256. Never put the giant reconstructed body into CacheStorage.
    const data = new Uint8Array(artifact.bytes);
    for (let chunkIndex = 0; chunkIndex < index; chunkIndex++) {
      signal.throwIfAborted();
      const chunk = await cache.match(this.chunkKey(artifact.file, chunkIndex));
      if (!chunk) throw new Error("Julia storage lost a downloaded chunk.");
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      if (bytes.length !== this.chunkLength(artifact, chunkIndex)) throw new Error("Julia downloaded chunk has the wrong size.");
      data.set(bytes, chunkIndex * CHUNK_BYTES);
    }
    await this.verify(data, artifact);
    signal.throwIfAborted();
    await cache.put(this.markerKey(artifact.file), new Response(JSON.stringify({ schemaVersion: 1, bytes: artifact.bytes, sha256: artifact.sha256,
      chunkBytes: CHUNK_BYTES, chunks: index }), { headers: { "content-type": "application/json" } }));
    if (signal.aborted) { await cache.delete(this.markerKey(artifact.file)); signal.throwIfAborted(); }
    // Old single-entry installs are migrated only after the chunks pass the complete checksum.
    await cache.delete(key(artifact.file));
  }
  async download() {
    if (this.controller) return;
    if (!available()) throw new Error("This browser does not support local Julia storage and inference.");
    const controller = this.controller = new AbortController();
    this.update({ downloading: true, installed: false, downloadedBytes: 0, error: undefined });
    try {
      const cache = await caches.open(CACHE);
      await this.installRuntime(controller.signal);
      let complete = 0;
      for (const artifact of JULIA_ARTIFACTS) {
        controller.signal.throwIfAborted();
        if (await this.completeArtifact(cache, artifact)) { complete += artifact.bytes; this.update({ downloadedBytes: complete }); continue; }
        const legacy = await cache.match(key(artifact.file));
        const verifiedLegacy = legacy?.headers.get("x-keating-sha256") === artifact.sha256 && Number(legacy.headers.get("content-length")) === artifact.bytes;
        // Reuse completed legacy files; an incomplete file restarts rather than claiming byte resume.
        const response = verifiedLegacy ? legacy! : await fetch(artifact.url, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Julia download failed (${response.status}).`);
        await this.storeChunks(cache, artifact, response, controller.signal, complete);
        complete += artifact.bytes;
      }
      controller.signal.throwIfAborted();
      this.update({ installed: true, downloadedBytes: JULIA_TOTAL_BYTES });
    } catch (error) {
      this.update({ error: controller.signal.aborted ? "Julia download paused. Completed files are kept; the current file restarts when you choose Download." : error instanceof Error ? error.message : "Julia could not be installed." });
      throw error;
    } finally { this.controller = undefined; this.update({ downloading: false }); }
  }
  cancelDownload() { this.controller?.abort(); }
  private async verify(data: Uint8Array<ArrayBuffer>, artifact: typeof JULIA_ARTIFACTS[number]) {
    if (data.length !== artifact.bytes) throw new Error("Julia artifact has the wrong size. Download it again.");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== artifact.sha256) throw new Error("Julia artifact failed its checksum. Download it again.");
  }
  async load() {
    if (this.session) return;
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    this.loading = (async () => {
      if (!(await this.check()).installed) throw new Error("Download Julia in Judgement settings first.");
      const cache = await caches.open(CACHE), data = new Map<string, Uint8Array<ArrayBuffer>>();
      for (const artifact of JULIA_ARTIFACTS) {
        const bytes = await this.readArtifact(cache, artifact);
        try { await this.verify(bytes, artifact); }
        catch (error) { await cache.delete(this.markerKey(artifact.file)); this.update({ installed: false }); throw error; }
        data.set(artifact.file, bytes);
      }
      const [{ createJuliaEncoder }, ort, { default: wasm }, { default: module }] = await Promise.all([
        import("../../../shared/julia/encoder.js"), import("onnxruntime-web/wasm"),
        import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url"), import("onnxruntime-web/ort-wasm-simd-threaded.mjs?url"),
      ]);
      ort.env.wasm.wasmPaths = { wasm, mjs: module };
      ort.env.wasm.numThreads = 1;
      // Keep encoder inference off the UI thread. No remote runtime CDN is used.
      ort.env.wasm.proxy = true;
      const decode = (file: string) => JSON.parse(new TextDecoder().decode(data.get(file)!));
      const encoder = createJuliaEncoder(decode("tokenizer.json"), decode("tokenizer_config.json"));
      const session = await ort.InferenceSession.create(data.get("model.onnx")!, { executionProviders: ["wasm"], externalData: [{ path: "model.onnx.data", data: data.get("model.onnx.data")! }] });
      if (this.epoch !== epoch) { await session.release(); throw new Error("Julia loading was cancelled."); }
      this.encoder = encoder; this.session = session; this.update({ loaded: true, error: undefined });
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  async weights(rows: readonly JuliaDecisionRequest[], signal?: AbortSignal): Promise<number[][]> {
    if (signal?.aborted) throw new Error("Julia request cancelled.");
    if (rows.length !== 1 || this.busy) throw new Error("Julia handles one local decision at a time.");
    this.busy = true;
    try {
    await this.load();
    if (signal?.aborted) throw new Error("Julia request cancelled.");
    const row = this.encoder!.encode(rows[0], { maxLength: JULIA_MODEL.contextTokens, headLength: 512 });
    const ort = await import("onnxruntime-web/wasm");
    const length = Math.ceil(row.ids.length / 8) * 8, count = row.markers.length;
    const ids = new BigInt64Array(length), attention = new BigInt64Array(length);
    row.ids.forEach((value, index) => { ids[index] = BigInt(value); attention[index] = 1n; });
    const feeds = { input_ids: new ort.Tensor("int64", ids, [1, length]), attention_mask: new ort.Tensor("int64", attention, [1, length]),
      marker_pos: new ort.Tensor("int64", BigInt64Array.from(row.markers, BigInt), [1, count]),
      marker_mask: new ort.Tensor("bool", new Uint8Array(count).fill(1), [1, count]), qtype: new ort.Tensor("int64", new BigInt64Array([BigInt(row.qtype)]), [1]) };
    const epoch = this.epoch;
    const run = this.running = this.session!.run(feeds);
    try { const result = await run; if (signal?.aborted || epoch !== this.epoch) throw new Error("Julia request cancelled."); return [juliaWeights(Array.from(result.logits.data as Float32Array).slice(0, count))]; }
    finally { if (this.running === run) this.running = undefined; }
    } finally { this.busy = false; }
  }
  async unload() {
    this.epoch++;
    await this.loading?.catch(() => {}); await this.running?.catch(() => {});
    const session = this.session; this.session = undefined; this.encoder = undefined;
    await session?.release(); this.update({ loaded: false });
  }
  async remove() {
    this.cancelDownload();
    if (this.controller) throw new Error("Wait for the paused Julia download before removing it.");
    await this.unload(); await caches.delete(CACHE); this.update({ installed: false, downloadedBytes: 0 });
  }
}
export const juliaBrowserModel = new JuliaBrowserModel();
