import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { OFFLINE_MODEL, offlineRequest, offlineMessages, type OfflineStatus, type KeatingOfflineBridge } from "./offline-contract.js";

export async function verifyModel(path: string, model = OFFLINE_MODEL): Promise<boolean> {
  try {
    if ((await stat(path)).size !== model.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === model.sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function size(path: string): Promise<number> {
  try { return (await stat(path)).size; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

export function responseText(raw: string): string {
  const response = JSON.parse(raw) as { content?: unknown };
  if (typeof response.content === "string" && response.content.trim()) return response.content;
  if (Array.isArray(response.content)) {
    const text = response.content.filter(part => part.type === "text" && !part.channel && typeof part.text === "string").map(part => part.text).join("");
    if (text.trim()) return text;
  }
  throw new Error("The offline tutor returned no answer. Try a shorter prompt.");
}

export class OfflineRuntime implements KeatingOfflineBridge {
  private readonly path: string;
  private readonly partial: string;
  private bundled = false;
  private initialization?: Promise<void>;
  private installed = false;
  private available = false;
  private error?: string;
  private controller?: AbortController;
  private downloading?: Promise<void>;
  private generation?: Promise<string>;
  private child?: ChildProcess;
  private cancelled = false;
  private removing = false;
  private closed = false;
  constructor(private readonly options: {
    directory: string;
    executable: string;
    bundledModel?: string;
    model?: typeof OFFLINE_MODEL;
    fetch?: typeof fetch;
    /** Deterministic availability boundary for lifecycle tests. Production probes the bundled executable. */
    probe?: () => Promise<void>;
  }) {
    this.path = join(options.directory, this.model.file);
    this.partial = this.path + ".partial";
  }
  private get model() { return this.options.model ?? OFFLINE_MODEL; }
  private init(): Promise<void> {
    return this.initialization ??= (async () => {
      await mkdir(this.options.directory, { recursive: true });
      try {
        if (this.options.probe) await this.options.probe();
        else if ((await this.run(["--probe"], "", 15000, false)).trim() !== "keating-litert-0.16.0") throw new Error("Unexpected LiteRT runtime.");
        this.available = true;
      } catch { this.error = "The bundled offline runtime could not start on this device. Reinstall a supported desktop build."; }
      this.installed = await verifyModel(this.path, this.model);
      if (!this.installed && this.options.bundledModel) {
        if (await verifyModel(this.options.bundledModel, this.model)) {
          this.bundled = true;
          this.installed = true;
        }
      }
    })();
  }
  async status(): Promise<OfflineStatus> {
    await this.init();
    return { available: this.available, installed: this.installed, downloading: !!this.downloading, bundled: this.bundled, generating: !!this.generation,
      downloadedBytes: this.installed ? this.model.bytes : await size(this.partial), totalBytes: this.model.bytes,
      ...(this.error ? { error: this.error } : {}) };
  }
  download(): Promise<void> {
    if (this.closed || this.removing) return Promise.reject(new Error("Offline tutor is stopping."));
    if (this.downloading) return this.downloading;
    const controller = this.controller = new AbortController();
    this.downloading = this.performDownload(controller.signal).catch(error => {
      if (controller.signal.aborted) throw new Error("Offline model download cancelled. Download again to resume.");
      this.error = error instanceof Error ? error.message : "Offline model download failed.";
      throw error;
    }).finally(() => { this.downloading = undefined; this.controller = undefined; });
    return this.downloading;
  }
  private async performDownload(signal: AbortSignal): Promise<void> {
    await this.init();
    signal.throwIfAborted();
    if (!this.available) throw new Error(this.error);
    if (this.installed) return;
    this.error = undefined;
    let offset = await size(this.partial);
    if (offset > this.model.bytes) { await rm(this.partial, { force: true }); offset = 0; }
    if (offset < this.model.bytes) {
      const response = await (this.options.fetch ?? fetch)(this.model.url, {
        headers: offset ? { Range: `bytes=${offset}-`, "Accept-Encoding": "identity" } : { "Accept-Encoding": "identity" }, signal,
      });
      if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status}). Try again to resume.`);
      if (response.status === 206) {
        const expected = `bytes ${offset}-${this.model.bytes - 1}/${this.model.bytes}`;
        if (response.headers.get("content-range") !== expected) { await response.body.cancel(); throw new Error("Model server returned an invalid resume range."); }
      } else if (response.status === 200) offset = 0;
      else { await response.body.cancel(); throw new Error("Unexpected model download response."); }
      const file = await open(this.partial, offset ? "a" : "w", 0o600);
      const reader = response.body.getReader();
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (offset + value.length > this.model.bytes) throw new Error("Model download exceeded the expected size.");
          let written = 0;
          while (written < value.length) written += (await file.write(value.subarray(written))).bytesWritten;
          offset += value.length;
        }
        await file.sync();
      } finally { await reader.cancel().catch(() => {}); await file.close(); }
    }
    signal.throwIfAborted();
    if (offset !== this.model.bytes) throw new Error("Model download was interrupted. Download again to resume.");
    if (!await verifyModel(this.partial, this.model)) {
      await rm(this.partial, { force: true });
      throw new Error("Model verification failed. Download again to get a verified copy.");
    }
    signal.throwIfAborted();
    await rename(this.partial, this.path);
    this.installed = true;
  }
  async cancelDownload(): Promise<void> {
    this.controller?.abort();
    await this.downloading?.catch(() => {});
  }
  async remove(): Promise<void> {
    if (this.removing) throw new Error("Model removal is already in progress.");
    this.removing = true;
    try {
      await this.init();
      if (this.bundled) throw new Error("This model is bundled with the offline edition. Install the standard edition to reclaim its storage.");
      if (this.generation) throw new Error("Stop the offline tutor before removing its model.");
      await this.cancelDownload();
      await rm(this.path, { force: true });
      await rm(this.partial, { force: true });
      this.installed = false;
      this.error = undefined;
    } finally { this.removing = false; }
  }
  generate(value: unknown): Promise<string> {
    const input = offlineRequest(value);
    if (this.generation || this.removing || this.closed) return Promise.reject(new Error("Offline tutor is busy or stopping."));
    this.cancelled = false;
    this.generation = (async () => {
      await this.init();
      if (this.cancelled) throw new Error("Offline generation cancelled.");
      if (!this.available) throw new Error(this.error);
      if (!this.installed) throw new Error("Download the offline tutor in Settings before sending a message.");
      const output = await this.run([this.bundled ? this.options.bundledModel! : this.path, String(input.maxTokens), String(input.temperature)], offlineMessages(input.prompt), 600000);
      return responseText(output);
    })().finally(() => { this.generation = undefined; });
    return this.generation;
  }
  async cancelGeneration(): Promise<void> {
    this.cancelled = true;
    this.child?.kill("SIGKILL");
    await this.generation?.catch(() => {});
  }
  async stop(): Promise<void> {
    this.closed = true;
    await Promise.all([this.cancelDownload(), this.cancelGeneration()]);
  }
  private run(args: string[], input: string, timeout: number, generation = true): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      if (generation) this.child = child;
      let output = "", error = "", overflow = false;
      const timer = setTimeout(() => { overflow = true; child.kill("SIGKILL"); }, timeout);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { output += chunk; if (output.length > 1048576) { overflow = true; child.kill("SIGKILL"); } });
      child.stderr.on("data", chunk => { error = (error + chunk).slice(-4096); });
      child.stdin.on("error", () => {});
      child.once("error", reject);
      child.once("close", code => {
        clearTimeout(timer);
        if (this.child === child) this.child = undefined;
        if (generation && this.cancelled) reject(new Error("Offline generation cancelled."));
        else if (overflow) reject(new Error("Offline tutor exceeded its time or response limit."));
        else if (code !== 0) reject(new Error(`Offline tutor failed (${code}). ${error}`));
        else resolve(output);
      });
      child.stdin.end(input);
    });
  }
}
