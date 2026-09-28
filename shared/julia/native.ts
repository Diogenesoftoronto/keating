import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type * as ort from "onnxruntime-node";
import { createJuliaEncoder, type JuliaDecisionRequest } from "./encoder.js";
import { JULIA_ARTIFACTS, JULIA_ARTIFACT_ID, JULIA_TOTAL_BYTES, juliaModelId } from "./manifest.js";
import { juliaWeights } from "./scorer.js";
import { juliaTensorData } from "./tensors.js";

async function fileBytes(path: string): Promise<number> { try { return (await stat(path)).size; } catch { return 0; } }
async function verify(path: string, artifact: (typeof JULIA_ARTIFACTS)[number]) {
  if (await fileBytes(path) !== artifact.bytes) return false;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.update("").digest("hex") === artifact.sha256;
}

/** No network inference: a resident CPU encoder/head with explicitly installed weights. */
export class JuliaNativeRuntime {
  readonly modelId: string;
  readonly maxLength: number;
  readonly headLength: number;
  private readonly threads: number;
  private readonly directory: string;
  private readonly fetcher: typeof fetch;
  private readonly bundledDirectory?: string;
  private activeDirectory: string;
  private downloadController?: AbortController;
  private encoder?: ReturnType<typeof createJuliaEncoder>;
  private session?: ort.InferenceSession;
  private ortModule?: typeof ort;
  private loading?: Promise<void>;
  private running?: Promise<unknown>;
  private downloadPromise?: Promise<void>;
  private epoch = 0;
  private closed = false;
  private error?: string;
  private runtimeUnavailable = false;
  constructor(options: { directory: string; bundledDirectory?: string; maxLength?: number; headLength?: number; threads?: number; fetch?: typeof fetch }) {
    this.directory = options.directory;
    this.activeDirectory = options.directory;
    this.bundledDirectory = options.bundledDirectory;
    this.maxLength = options.maxLength ?? 2048;
    this.headLength = options.headLength ?? 512;
    this.threads = options.threads ?? 4;
    this.modelId = juliaModelId("native", this.maxLength, this.headLength, this.threads);
    this.fetcher = options.fetch ?? fetch;
    if (!Number.isInteger(this.maxLength) || this.maxLength < 128 || this.maxLength > 8192
      || !Number.isInteger(this.headLength) || this.headLength < 64 || this.headLength >= this.maxLength
      || !Number.isInteger(this.threads) || this.threads < 1 || this.threads > 16) throw new Error("Invalid Julia runtime bounds.");
  }
  async status() {
    const bundled = !!this.bundledDirectory && (await Promise.all(JULIA_ARTIFACTS.map(artifact => fileBytes(join(this.bundledDirectory!, artifact.file))))).every((size, index) => size === JULIA_ARTIFACTS[index]!.bytes);
    const sizes = await Promise.all(JULIA_ARTIFACTS.map(async artifact => {
      const complete = await fileBytes(join(this.directory, artifact.file));
      return complete || await fileBytes(join(this.directory, artifact.file + ".part"));
    }));
    let receipt: unknown;
    try { receipt = JSON.parse(await readFile(join(this.directory, "verified.json"), "utf8")); } catch { /* Not installed. */ }
    const finalSizes = await Promise.all(JULIA_ARTIFACTS.map(artifact => fileBytes(join(this.directory, artifact.file))));
    const installed = bundled || !!receipt && (receipt as { artifactId?: unknown }).artifactId === JULIA_ARTIFACT_ID
      && finalSizes.every((size, index) => size === JULIA_ARTIFACTS[index]!.bytes);
    const supported = ["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64", "win32-arm64"].includes(`${process.platform}-${process.arch}`);
    return { available: supported && !this.closed && !this.runtimeUnavailable, installed, downloading: !!this.downloadPromise, bundled,
      generating: !!this.running, downloadedBytes: bundled ? JULIA_TOTAL_BYTES : sizes.reduce((sum, size) => sum + size, 0), totalBytes: JULIA_TOTAL_BYTES,
      ...(this.error ? { error: this.error } : {}) };
  }
  download(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Julia runtime is closed."));
    if (this.downloadPromise) return this.downloadPromise;
    const controller = new AbortController(); this.downloadController = controller;
    this.error = undefined;
    this.downloadPromise = this.install(controller.signal).catch(error => {
      if (!controller.signal.aborted) this.error = "Julia installation failed. Retry to resume the verified download.";
      throw error;
    }).finally(() => { this.downloadPromise = undefined; this.downloadController = undefined; });
    return this.downloadPromise;
  }
  private async install(signal: AbortSignal) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const artifact of JULIA_ARTIFACTS) {
      signal.throwIfAborted();
      const final = join(this.directory, artifact.file), partial = final + ".part";
      if (await verify(final, artifact)) continue;
      let offset = await fileBytes(partial);
      if (offset > artifact.bytes) { await rm(partial); offset = 0; }
      if (offset < artifact.bytes) {
        const response = await this.fetcher(artifact.url, { signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
        if (!response.ok || !response.body) throw new Error("Julia download failed.");
        if (offset && response.status === 206) {
          if (!response.headers.get("content-range")?.startsWith(`bytes ${offset}-`)) throw new Error("Julia download range mismatch.");
        } else if (response.status === 200) offset = 0;
        else if (offset) throw new Error("Julia download cannot resume.");
        const file = await open(partial, offset ? "a" : "w", 0o600);
        try {
          const reader = response.body.getReader();
          try {
            while (true) {
              signal.throwIfAborted();
              const { value, done } = await reader.read(); if (done) break;
              offset += value.byteLength;
              if (offset > artifact.bytes) throw new Error("Julia download exceeds pinned size.");
              await file.writeFile(value);
            }
          } finally { await reader.cancel().catch(() => {}); }
          await file.sync();
        } finally { await file.close(); }
      }
      if (!await verify(partial, artifact)) { await rm(partial, { force: true }); throw new Error("Julia artifact integrity mismatch."); }
      await rename(partial, final);
    }
    const receipt = await open(join(this.directory, "verified.json"), "w", 0o600);
    try { await receipt.writeFile(JSON.stringify({ artifactId: JULIA_ARTIFACT_ID })); } finally { await receipt.close(); }
  }
  cancelDownload() { this.downloadController?.abort(); }
  private async load() {
    if (this.closed) throw new Error("Julia runtime is closed.");
    if (this.session && this.encoder) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.activeDirectory = this.directory;
      if (this.bundledDirectory && !await Promise.all(JULIA_ARTIFACTS.map(artifact => fileBytes(join(this.directory, artifact.file)))).then(sizes => sizes.every((size, index) => size === JULIA_ARTIFACTS[index]!.bytes))) this.activeDirectory = this.bundledDirectory;
      for (const artifact of JULIA_ARTIFACTS) if (!await verify(join(this.activeDirectory, artifact.file), artifact)) throw new Error("Install verified Julia weights first.");
      this.encoder = createJuliaEncoder(JSON.parse(await readFile(join(this.activeDirectory, "tokenizer.json"), "utf8")), JSON.parse(await readFile(join(this.activeDirectory, "tokenizer_config.json"), "utf8")));
      try {
        this.ortModule = await import("onnxruntime-node");
        if (this.ortModule.env.versions.node !== "1.29.0") throw new Error("Julia runtime version mismatch.");
      }
      catch { this.runtimeUnavailable = true; this.error = "Julia CPU runtime is unavailable on this system."; throw new Error(this.error); }
      this.session = await this.ortModule.InferenceSession.create(join(this.activeDirectory, "model.onnx"), { executionProviders: ["cpu"], intraOpNumThreads: this.threads, interOpNumThreads: 1, graphOptimizationLevel: "all" });
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  async encode(rows: readonly JuliaDecisionRequest[]) {
    await this.load();
    if (!rows.length || rows.length > 32) throw new Error("Julia batches require 1 to 32 decisions.");
    return rows.map(row => this.encoder!.encode(row, { maxLength: this.maxLength, headLength: this.headLength }));
  }
  async weights(rows: readonly JuliaDecisionRequest[], signal?: AbortSignal): Promise<number[][]> {
    if (this.running) throw new Error("Julia is busy.");
    const epoch = this.epoch;
    const operation = this.infer(rows, signal, epoch);
    this.running = operation;
    try { return await operation; } finally { if (this.running === operation) this.running = undefined; }
  }
  private async infer(rows: readonly JuliaDecisionRequest[], signal: AbortSignal | undefined, epoch: number) {
    signal?.throwIfAborted();
    const encoded = await this.encode(rows);
    const { batch, length, count, ids, attention, markers, mask, qtype } = juliaTensorData(encoded);
    const ort = this.ortModule!;
    signal?.throwIfAborted();
    const output = await this.session!.run({ input_ids: new ort.Tensor("int64", ids, [batch, length]), attention_mask: new ort.Tensor("int64", attention, [batch, length]),
      marker_pos: new ort.Tensor("int64", markers, [batch, count]), marker_mask: new ort.Tensor("bool", mask, [batch, count]), qtype: new ort.Tensor("int64", qtype, [batch]) });
    signal?.throwIfAborted();
    if (epoch !== this.epoch || this.closed) throw new Error("Julia scoring cancelled.");
    const logits = output.logits;
    if (!logits || logits.type !== "float32" || logits.dims[0] !== batch || logits.dims[1] !== count) throw new Error("Invalid Julia output shape.");
    const values = logits.data as Float32Array;
    return encoded.map((row, index) => juliaWeights(values.subarray(index * count, index * count + row.markers.length)));
  }
  cancelScoring() { this.epoch++; }
  async unload() {
    this.cancelScoring();
    await this.running?.catch(() => {}); await this.loading?.catch(() => {});
    const session = this.session; this.session = undefined; this.encoder = undefined;
    await session?.release();
  }
  async remove() {
    this.cancelDownload(); await this.downloadPromise?.catch(() => {}); await this.unload();
    for (const artifact of JULIA_ARTIFACTS) for (const suffix of ["", ".part"]) await rm(join(this.directory, artifact.file + suffix), { force: true });
    await rm(join(this.directory, "verified.json"), { force: true });
  }
  async stop() { this.closed = true; this.cancelDownload(); await this.downloadPromise?.catch(() => {}); await this.unload(); }
}
