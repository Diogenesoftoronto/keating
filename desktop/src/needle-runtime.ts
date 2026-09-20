/** Main-process Needle bridge. Local paths and process configuration never come from the renderer. */
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ManagedDesktopNeedleRuntime } from "./needle-managed-runtime.js";

export interface DesktopNeedleConfig {
  python: string;
  engine: string;
  weights: string;
  engineSha256: string;
  weightsSha256: string;
}
export interface DesktopNeedleEmbedding {
  model: string;
  dimensions: number;
  vectors: number[][];
}
export interface DesktopNeedleModule {
  loadNeedleConfig(workspace: string): Promise<DesktopNeedleConfig | null>;
  needleModelIdentity(config: DesktopNeedleConfig): string;
  createNeedleCaller(config: DesktopNeedleConfig, timeoutMs?: number):
    (input: { texts: readonly string[] }) => Promise<{ model: string; vectors: number[][] } | null>;
}
export interface DesktopNeedleOptions {
  loadModule?: () => Promise<DesktopNeedleModule | null>;
  assetsAvailable?: (config: DesktopNeedleConfig) => Promise<boolean>;
  timeoutMs?: number;
  managed?: Pick<ManagedDesktopNeedleRuntime, "status" | "download" | "cancelDownload" | "remove" | "embed" | "stop">;
}
const unavailable = () => ({ available: false, model: null });

/** Import a Node-targeted bundle placed beside the compiled Electron modules by the desktop build. */
async function loadModule(): Promise<DesktopNeedleModule | null> {
  try {
    const runtime = await import(new URL("./needle-node-runtime.js", import.meta.url).href);
    return typeof runtime.loadNeedleConfig === "function" && typeof runtime.needleModelIdentity === "function"
      && typeof runtime.createNeedleCaller === "function" ? runtime as DesktopNeedleModule : null;
  } catch { return null; }
}
async function assetsAvailable(config: DesktopNeedleConfig): Promise<boolean> {
  try {
    for (const path of [config.python, config.engine, config.weights]) {
      if (!isAbsolute(path) || !(await stat(path)).isFile()) return false;
      await access(path, path === config.python ? constants.R_OK | constants.X_OK : constants.R_OK);
    }
    return true;
  } catch { return false; }
}
function requestTexts(value: unknown): string[] {
  const invalid = () => { throw new Error("needle_request_invalid"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as { texts?: unknown };
  if (Object.keys(input).length !== 1 || !Array.isArray(input.texts) || input.texts.length < 1 || input.texts.length > 160) return invalid();
  for (const text of input.texts) if (typeof text !== "string" || text.length > 8192) return invalid();
  if (Buffer.byteLength(JSON.stringify(input)) > 262144) return invalid();
  return [...input.texts] as string[];
}
function validConfig(config: DesktopNeedleConfig): boolean {
  return [config.python, config.engine, config.weights].every(path => typeof path === "string" && isAbsolute(path))
    && [config.engineSha256, config.weightsSha256].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
}

export class DesktopNeedleRuntime {
  private stopped = false;
  private busy = false;
  private invalidate: (() => void) | undefined;
  private readonly managed: NonNullable<DesktopNeedleOptions["managed"]>;
  constructor(private readonly workspace: string, private readonly options: DesktopNeedleOptions = {}) {
    this.managed = options.managed ?? new ManagedDesktopNeedleRuntime(join(workspace, ".keating", "needle-managed"));
  }

  /** Managed assets persist under the app workspace, independent of the renderer's loopback origin. */
  async status(payload: unknown = {}) {
    this.emptyPayload(payload);
    if (this.stopped) return unavailable();
    const managed = await this.managed.status();
    if (this.stopped) return unavailable();
    if (managed.available) return managed;
    const legacy = await this.run(async () => {
      const configured = await this.configuration();
      return configured ? { available: true, model: configured.model } : unavailable();
    }, unavailable());
    return { ...managed, ...legacy, managed: false };
  }

  private emptyPayload(payload: unknown): void {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length) {
      throw new Error("needle_request_invalid");
    }
  }
  async install(payload: unknown = {}): Promise<void> {
    this.emptyPayload(payload);
    if (this.stopped) throw new Error("needle_stopped");
    await this.managed.download();
  }
  cancelDownload(payload: unknown = {}): void {
    this.emptyPayload(payload);
    this.managed.cancelDownload();
  }
  async remove(payload: unknown = {}): Promise<void> {
    this.emptyPayload(payload);
    await this.managed.remove();
  }

  embed(payload: unknown): Promise<DesktopNeedleEmbedding | null> {
    let texts: string[];
    try { texts = requestTexts(payload); } catch { return Promise.reject(new Error("needle_request_invalid")); }
    return this.run(async live => {
      const managed = await this.managed.status();
      if (!live()) return null;
      if (managed.available) return this.managed.embed({ texts });
      const configured = await this.configuration();
      if (!configured || !live()) return null;
      const { runtime, config, model } = configured;
      const result = await runtime.createNeedleCaller(config, Math.min(12_000, this.timeoutMs()))({ texts });
      if (!result || result.model !== model || !Array.isArray(result.vectors) || result.vectors.length !== texts.length) return null;
      const dimensions = result.vectors[0]?.length;
      if (!Number.isInteger(dimensions) || !dimensions || dimensions > 8192
        || [...result.vectors].some(vector => !Array.isArray(vector) || vector.length !== dimensions
          || [...vector].some(value => typeof value !== "number" || !Number.isFinite(value)))) return null;
      // A changed workspace config cannot return vectors under a stale advertised model.
      const current = await runtime.loadNeedleConfig(this.workspace);
      if (JSON.stringify(current) !== JSON.stringify(config)) return null;
      return { model, dimensions, vectors: result.vectors.map(vector => [...vector]) };
    }, null);
  }

  stop(): void { this.stopped = true; this.invalidate?.(); this.managed.stop(); }
  private timeoutMs(): number { return Math.max(1, Math.min(30_000, this.options.timeoutMs ?? 15_000)); }
  private async configuration() {
    const runtime = await (this.options.loadModule ?? loadModule)();
    if (!runtime || this.stopped) return null;
    const config = await runtime.loadNeedleConfig(this.workspace);
    if (!config || !validConfig(config) || this.stopped || !await (this.options.assetsAvailable ?? assetsAvailable)(config)) return null;
    const model = runtime.needleModelIdentity(config);
    if (model !== `needle3/cactus-needle@3.0.1/sha256:${config.weightsSha256}/engine:${config.engineSha256}`) return null;
    return { runtime, config: structuredClone(config), model };
  }
  private async run<T>(operation: (live: () => boolean) => Promise<T>, fallback: T): Promise<T> {
    if (this.stopped || this.busy) return fallback;
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let invalidated = false;
    const cancelled = new Promise<T>(resolve => {
      this.invalidate = () => { invalidated = true; resolve(fallback); };
      timer = setTimeout(this.invalidate, this.timeoutMs());
    });
    // Retain the busy lease until underlying work settles, even after a noncooperative timeout.
    const work = Promise.resolve().then(() => operation(() => !this.stopped && !invalidated)).catch(() => fallback).then(result => this.stopped || invalidated ? fallback : result)
      .finally(() => { this.busy = false; });
    try { return await Promise.race([work, cancelled]); }
    finally { clearTimeout(timer); this.invalidate = undefined; }
  }
}
