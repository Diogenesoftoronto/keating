import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform, totalmem } from "node:os";
import { basename, dirname, join } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { offlineMessages, offlineRequest, type OfflineStatus } from "./offline-contract.js";

export const BONSAI_MODEL_ID = "prism-ml/Ternary-Bonsai-2-27B-gguf";
export const BONSAI_RUNTIME_VERSION = "prism-b10743-adfffbe";
export const BONSAI_ENDPOINT = "http://127.0.0.1:8433/v1";
const MODEL_REVISION = "b072e1d3b35a0a630cece372c2127528e0994386";
const MODEL_BASE = `https://huggingface.co/${BONSAI_MODEL_ID}/resolve/${MODEL_REVISION}/`;
const RUNTIME_BASE = `https://github.com/PrismML-Eng/llama.cpp/releases/download/${BONSAI_RUNTIME_VERSION}/`;
export interface BonsaiAsset { file: string; url: string; bytes: number; sha256: string }
export const BONSAI_MODEL: BonsaiAsset = { file: "Ternary-Bonsai-2-27B-PTQ1_0.gguf", url: MODEL_BASE + "Ternary-Bonsai-2-27B-PTQ1_0.gguf", bytes: 5946648928, sha256: "53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3" };
export const BONSAI_PROJECTOR: BonsaiAsset = { file: "Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf", url: MODEL_BASE + "Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf", bytes: 629246976, sha256: "6807ede61d570bb86ba34b756a0fa109edc33668604de867c6ea6d8f1d631903" };
type Backend = "cpu" | "metal" | "cuda";
const binary = (suffix: string, bytes: number, sha256: string): BonsaiAsset => {
  const file = `llama-${BONSAI_RUNTIME_VERSION}-bin-${suffix}`;
  return { file, url: RUNTIME_BASE + file, bytes, sha256 };
};
const BINARIES: Record<string, BonsaiAsset> = {
  "linux:x64:cpu": binary("ubuntu-x64.tar.gz", 17779725, "1bb340929fddae8667c97ec6d4064a5768fe1dd08eeee0074b8d5e08f07dfc31"),
  "linux:arm64:cpu": binary("ubuntu-arm64.tar.gz", 13800344, "ee4cb83a2985572459a5686ef175503d4e526b46b97c7fcc7152e868169b3060"),
  "darwin:x64:cpu": binary("macos-x64.tar.gz", 11559738, "3527598651d783b66d525afbcdd0cbbba12a8d59c388bb0e13fa85715381969d"),
  "darwin:arm64:metal": binary("macos-arm64.tar.gz", 11517506, "596d257973080ca5011a4be50477c5f93ed1d231fcccfc2afb44bb573bb9629a"),
  "win32:x64:cpu": binary("win-cpu-x64.zip", 19441568, "d0b3016c9cc4bc1385de68be034adee570277ba952dd94292ba3888b7f18cc44"),
  "win32:arm64:cpu": binary("win-cpu-arm64.zip", 12358985, "b834a13a9ee655bb25e07fd08dc7b2e8c6854fb8c32c6f92b56afb6e548acd6a"),
  "linux:x64:cuda": binary("linux-cuda-12.4-x64.tar.gz", 268256336, "fef4c7e8d83ff261d89809c1b302fe5f826adc1a74e13654b67ec056fbc1c639"),
};
export function bonsaiRuntimeAsset(backend?: Backend, os = platform(), cpu = arch()): BonsaiAsset | undefined {
  return BINARIES[`${os}:${cpu}:${backend ?? (os === "darwin" && cpu === "arm64" ? "metal" : "cpu")}`];
}
async function size(path: string): Promise<number> {
  try { return (await stat(path)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}
async function hash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
async function verified(path: string, asset: BonsaiAsset): Promise<boolean> {
  return await size(path) === asset.bytes && await hash(path) === asset.sha256;
}
const execute = promisify(execFile);
async function findServer(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && ["llama-server", "llama-server.exe"].includes(entry.name)) return path;
    if (entry.isDirectory()) { const found = await findServer(path); if (found) return found; }
  }
  return undefined;
}

/** Prism's rotated ternary model requires its matching runtime, never stock llama.cpp or LiteRT. */
export class BonsaiRuntime {
  private readonly asset: BonsaiAsset | undefined;
  private readonly assets: BonsaiAsset[];
  private initialization?: Promise<void>;
  private executable?: string;
  private installed = false;
  private error?: string;
  private downloadController?: AbortController;
  private downloading?: Promise<void>;
  private generation?: Promise<string>;
  private generationController?: AbortController;
  private server?: ChildProcess;
  private serverReady?: Promise<void>;
  private serverError = "";
  private readonly apiKey = randomBytes(32).toString("hex");
  private closed = false;
  private removing = false;
  constructor(private readonly options: { directory: string; backend?: Backend; fetch?: typeof fetch }) {
    this.asset = bonsaiRuntimeAsset(options.backend);
    this.assets = [...(this.asset ? [this.asset] : []), BONSAI_MODEL, BONSAI_PROJECTOR];
  }
  private get available() { return !!this.asset && totalmem() >= 12 * 1024 ** 3; }
  private path(asset: BonsaiAsset) { return join(this.options.directory, asset.file); }
  private init(): Promise<void> {
    return this.initialization ??= (async () => {
      await mkdir(this.options.directory, { recursive: true });
      if (!this.asset) { this.error = "No verified Bonsai runtime is available for this desktop architecture."; return; }
      if (!this.available) { this.error = "Keating enables Bonsai 27B on desktops with at least 12 GB of RAM. Choose a smaller offline model."; return; }
      try {
        const marker = JSON.parse(await readFile(join(this.options.directory, "installation.json"), "utf8")) as { runtime?: string; asset?: string; executable?: string; executableHash?: string };
        if (marker.runtime !== BONSAI_RUNTIME_VERSION || marker.asset !== this.asset.sha256 || !marker.executable || !marker.executableHash) return;
        const executable = await findServer(join(this.options.directory, "runtime"));
        if (!executable || basename(executable) !== marker.executable || await hash(executable) !== marker.executableHash) return;
        if (!await verified(this.path(BONSAI_MODEL), BONSAI_MODEL) || !await verified(this.path(BONSAI_PROJECTOR), BONSAI_PROJECTOR)) return;
        this.executable = executable;
        this.installed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = "The Bonsai installation could not be verified. Download it again.";
      }
    })();
  }
  async status(): Promise<OfflineStatus> {
    await this.init();
    let downloadedBytes = 0;
    for (const asset of this.assets) downloadedBytes += Math.min(asset.bytes, await size(this.path(asset)) || await size(this.path(asset) + ".partial"));
    return { available: this.available, installed: this.installed, downloading: !!this.downloading, bundled: false, generating: !!this.generation,
      downloadedBytes, totalBytes: this.assets.reduce((sum, asset) => sum + asset.bytes, 0), ...(this.error ? { error: this.error } : {}) };
  }
  download(): Promise<void> {
    if (this.closed || this.removing) return Promise.reject(new Error("Bonsai is stopping."));
    if (this.downloading) return this.downloading;
    const controller = this.downloadController = new AbortController();
    this.downloading = this.install(controller.signal).catch(error => {
      this.error = controller.signal.aborted ? "Bonsai download cancelled. Download again to resume." : error instanceof Error ? error.message : "Bonsai download failed.";
      throw new Error(this.error);
    }).finally(() => { this.downloading = undefined; this.downloadController = undefined; });
    return this.downloading;
  }
  private async install(signal: AbortSignal): Promise<void> {
    await this.init();
    if (!this.available || !this.asset) throw new Error(this.error);
    if (this.installed) return;
    this.error = undefined;
    for (const asset of this.assets) await this.downloadAsset(asset, signal);
    signal.throwIfAborted();
    const staging = join(this.options.directory, "runtime.partial");
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging);
    if (this.asset.file.endsWith(".zip")) {
      const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
      await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${literal(this.path(this.asset))} -DestinationPath ${literal(staging)} -Force`], { signal, windowsHide: true });
    } else await execute("tar", ["-xzf", this.path(this.asset), "-C", staging], { signal, windowsHide: true });
    const executable = await findServer(staging);
    if (!executable) throw new Error("The verified Prism archive did not contain llama-server.");
    const executableHash = await hash(executable);
    await execute(executable, ["--version"], { signal, windowsHide: true, timeout: 15000, env: { ...process.env, LD_LIBRARY_PATH: dirname(executable) + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "") } });
    await rm(join(this.options.directory, "runtime"), { recursive: true, force: true });
    await rename(staging, join(this.options.directory, "runtime"));
    this.executable = await findServer(join(this.options.directory, "runtime"));
    await writeFile(join(this.options.directory, "installation.json"), JSON.stringify({ runtime: BONSAI_RUNTIME_VERSION, asset: this.asset.sha256, executable: basename(this.executable!), executableHash }), { mode: 0o600 });
    this.installed = true;
  }
  private async downloadAsset(asset: BonsaiAsset, signal: AbortSignal): Promise<void> {
    const path = this.path(asset), partial = path + ".partial";
    if (await verified(path, asset)) return;
    let offset = await size(partial);
    if (offset > asset.bytes) { await rm(partial, { force: true }); offset = 0; }
    if (offset < asset.bytes) {
      const response = await (this.options.fetch ?? fetch)(asset.url, { headers: { "Accept-Encoding": "identity", ...(offset ? { Range: `bytes=${offset}-` } : {}) }, signal });
      if (!response.ok || !response.body) throw new Error(`Bonsai download failed (HTTP ${response.status}). Try again to resume.`);
      if (response.status === 206) {
        if (response.headers.get("content-range") !== `bytes ${offset}-${asset.bytes - 1}/${asset.bytes}`) { await response.body.cancel(); throw new Error("Bonsai download returned an invalid resume range."); }
      } else if (response.status === 200) offset = 0;
      else { await response.body.cancel(); throw new Error("Unexpected Bonsai download response."); }
      const file = await open(partial, offset ? "a" : "w", 0o600);
      const reader = response.body.getReader();
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          if (offset + value.length > asset.bytes) throw new Error("Bonsai download exceeded its verified size.");
          let written = 0;
          while (written < value.length) written += (await file.write(value.subarray(written))).bytesWritten;
          offset += value.length;
        }
        await file.sync();
      } finally { await reader.cancel().catch(() => {}); await file.close(); }
    }
    signal.throwIfAborted();
    if (offset !== asset.bytes) throw new Error("Bonsai download was interrupted. Download again to resume.");
    if (!await verified(partial, asset)) { await rm(partial, { force: true }); throw new Error("Bonsai checksum verification failed. Download again."); }
    signal.throwIfAborted();
    await rename(partial, path);
  }
  async cancelDownload(): Promise<void> { this.downloadController?.abort(); await this.downloading?.catch(() => {}); }
  async remove(): Promise<void> {
    if (this.removing || this.generation || this.closed) throw new Error("Stop Bonsai before removing its files.");
    this.removing = true;
    try {
      await this.cancelDownload(); await this.stopServer();
      for (const asset of this.assets) { await rm(this.path(asset), { force: true }); await rm(this.path(asset) + ".partial", { force: true }); }
      for (const name of ["runtime", "runtime.partial"]) await rm(join(this.options.directory, name), { recursive: true, force: true });
      await rm(join(this.options.directory, "installation.json"), { force: true });
      this.installed = false; this.executable = undefined; this.error = undefined;
    } finally { this.removing = false; }
  }
  /** Starts only our verified local process; an unrelated listener is never adopted. */
  async start(signal: AbortSignal = new AbortController().signal): Promise<void> {
    await this.init(); signal.throwIfAborted();
    if (!this.installed || !this.executable) throw new Error(this.error ?? "Download Bonsai in Settings before sending a message.");
    if (this.serverReady) return this.serverReady;
    this.serverError = "";
    const ngl = this.options.backend === "cuda" || (platform() === "darwin" && arch() === "arm64" && this.options.backend !== "cpu") ? "99" : "0";
    const child = this.server = spawn(this.executable, ["-m", this.path(BONSAI_MODEL), "--mmproj", this.path(BONSAI_PROJECTOR), "--no-mmproj-offload", "--image-min-tokens", "64", "--image-max-tokens", "256", "--host", "127.0.0.1", "--port", "8433", "--alias", "bonsai-2-27b", "--api-key", this.apiKey, "--offline", "--no-agent", "--no-webui", "--no-webui-mcp-proxy", "--jinja", "-ngl", ngl, "-fa", "on", "-c", "8192", "--parallel", "1", "--batch-size", "256", "--n-predict", "512", "--reasoning", "off", "--reasoning-budget", "0", "--reasoning-format", "deepseek", "--chat-template-kwargs", '{"enable_thinking":false}', "--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0", "--presence-penalty", "1.5"], {
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
      env: { ...process.env, LD_LIBRARY_PATH: dirname(this.executable) + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "") },
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => { this.serverError = (this.serverError + chunk).slice(-4096); });
    let childError: Error | undefined;
    child.once("error", error => { childError = error; });
    child.once("close", () => { if (this.server === child) { this.server = undefined; this.serverReady = undefined; } });
    this.serverReady = (async () => {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (childError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Prism Bonsai could not start: ${childError?.message ?? this.serverError}`);
        try {
          const health = await (this.options.fetch ?? fetch)(BONSAI_ENDPOINT + "/models", { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });
          if (health.ok) {
            const catalog = await health.json() as { data?: { id?: string }[] };
            if (catalog.data?.some(model => model.id === "bonsai-2-27b") && this.server === child && child.exitCode === null && !childError) return;
          }
        } catch { signal.throwIfAborted(); }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error("Bonsai did not finish loading within three minutes. Try a smaller offline model.");
    })().catch(async error => { await this.stopServer(); throw error; });
    return this.serverReady;
  }
  generate(value: unknown): Promise<string> {
    if (this.generation || this.closed || this.removing || this.downloading) return Promise.reject(new Error("Bonsai is busy or stopping."));
    const input = offlineRequest(value);
    if (input.media?.some(item => item.type !== "image")) return Promise.reject(new Error("Bonsai accepts text and images. Choose Gemma for WAV recordings."));
    const controller = this.generationController = new AbortController();
    this.generation = (async () => {
      await this.start(controller.signal);
      const [system, history, last] = offlineMessages(input.prompt).split("\n").map(line => JSON.parse(line));
      const turns = [...history, last] as { role: string; content: { type: string; text: string }[] }[];
      const messages = [{ role: "system", content: `${typeof system === "string" ? system : "You are a helpful teaching assistant."}\nAnswer directly and concisely. Fit the complete answer within 512 output tokens; do not include hidden reasoning.` }, ...turns.map((turn, index) => ({ role: turn.role, content: [...turn.content, ...(input.media ?? []).filter(item => item.turn === index).map(item => ({ type: "image_url", image_url: { url: `data:${item.mimeType};base64,${item.data}` } }))] }))];
      if (input.media?.some(item => item.turn >= turns.length || turns[item.turn].role !== "user")) throw new Error("Offline images must belong to a user conversation turn.");
      const response = await (this.options.fetch ?? fetch)(BONSAI_ENDPOINT + "/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]),
        body: JSON.stringify({ model: "bonsai-2-27b", messages, max_tokens: Math.min(input.maxTokens, 512), temperature: input.temperature, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, chat_template_kwargs: { enable_thinking: false }, stream: true }),
      });
      if (!response.ok || !response.body) throw new Error(`Bonsai inference failed (HTTP ${response.status}).`);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let pending = "", answer = "";
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 131072) throw new Error("Bonsai returned an oversized stream event.");
          let boundary: number;
          while ((boundary = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, boundary).trim(); pending = pending.slice(boundary + 1);
            if (!line.startsWith("data:") || line === "data: [DONE]") continue;
            const event = JSON.parse(line.slice(5)) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
            if (event.error) throw new Error(event.error.message ?? "Bonsai inference failed.");
            answer += event.choices?.[0]?.delta?.content ?? "";
            if (answer.length > 65536) throw new Error("Bonsai exceeded its response limit.");
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!answer.trim()) throw new Error("Bonsai returned no answer. Try a shorter prompt.");
      return answer;
    })().catch(error => { if (controller.signal.aborted) throw new Error("Offline generation cancelled."); throw error; }).finally(() => { this.generation = undefined; this.generationController = undefined; });
    return this.generation;
  }
  async cancelGeneration(): Promise<void> { this.generationController?.abort(); await this.generation?.catch(() => {}); }
  private async stopServer(): Promise<void> {
    const child = this.server;
    this.server = undefined; this.serverReady = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
  }
  /** Release resident weights before another native model needs the device memory. */
  async unload(): Promise<void> {
    if (this.generation) throw new Error("Stop Bonsai generation before unloading its runtime.");
    await this.stopServer();
  }
  async stop(): Promise<void> { this.closed = true; await Promise.all([this.cancelDownload(), this.cancelGeneration()]); await this.stopServer(); }
}
