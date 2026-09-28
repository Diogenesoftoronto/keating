import { BonsaiRuntime, BONSAI_MODEL_ID } from "./bonsai-runtime.js";
import { JuliaRuntime, JULIA_MODEL_ID } from "./julia-runtime.js";
import { join } from "node:path";
import { OfflineRuntime } from "./offline-runtime.js";
import { GEMMA_OFFLINE_MODEL, GEMMA_OFFLINE_MODEL_ID, OFFLINE_JUDGEMENT_MODEL_ID, type OfflineRequest } from "./offline-contract.js";

/** Download choice never changes the independent MiniCPM judgement backend. */
export class OfflineModels {
  private readonly mini: OfflineRuntime;
  private readonly gemma: OfflineRuntime;
  private readonly bonsai: BonsaiRuntime;
  private readonly julia: JuliaRuntime;
  private generating = false;
  private scoring = false;
  constructor(options: ConstructorParameters<typeof OfflineRuntime>[0] & { bundledJuliaDirectory?: string }) {
    this.mini = new OfflineRuntime(options);
    this.bonsai = new BonsaiRuntime({ directory: join(options.directory, "bonsai-2-27b") });
    this.julia = new JuliaRuntime({ directory: join(options.directory, "julia-1"), bundledDirectory: options.bundledJuliaDirectory });
    this.gemma = new OfflineRuntime({ ...options, bundledModel: undefined, model: GEMMA_OFFLINE_MODEL, multimodal: true });
  }
  private runtime(id = OFFLINE_JUDGEMENT_MODEL_ID) {
    if (id === OFFLINE_JUDGEMENT_MODEL_ID) return this.mini;
    if (id === GEMMA_OFFLINE_MODEL_ID) return this.gemma;
    if (id === BONSAI_MODEL_ID) return this.bonsai;
    if (id === JULIA_MODEL_ID) return this.julia;
    throw new Error("Unknown offline model.");
  }
  status(id?: string) { return this.runtime(id).status(); }
  download(id?: string) { return this.runtime(id).download(); }
  cancelDownload(id?: string) { return this.runtime(id).cancelDownload(); }
  remove(id?: string) { return this.runtime(id).remove(); }
  async generate(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid offline tutor request.");
    const { modelId, ...request } = value as OfflineRequest;
    if (this.generating || this.scoring) throw new Error("Offline tutor is busy.");
    if (modelId === JULIA_MODEL_ID) throw new Error("Julia answers typed decisions; choose a tutor model for chat.");
    const runtime = this.runtime(modelId);
    this.generating = true;
    try {
      if (runtime !== this.bonsai) await this.bonsai.unload();
      await this.julia.unload();
      return await (runtime as OfflineRuntime | BonsaiRuntime).generate(request);
    }
    finally { this.generating = false; }
  }
  async cancelGeneration() { await Promise.all([this.mini.cancelGeneration(), this.gemma.cancelGeneration(), this.bonsai.cancelGeneration()]); }
  async scoreLabels(value: unknown) {
    if (this.generating || this.scoring) return null;
    this.scoring = true;
    try {
      await this.bonsai.unload();
      if (value && typeof value === "object" && "modelId" in value && value.modelId === JULIA_MODEL_ID) return await this.julia.scoreLabels(value);
      await this.julia.unload();
      return await this.mini.scoreLabels(value);
    } finally { this.scoring = false; }
  }
  cancelScoring(id: string) { this.julia.cancelRequest(id); return this.mini.cancelScoring(id); }
  unloadJudgement() { return this.julia.unload(); }
  async stop() { await Promise.all([this.mini.stop(), this.gemma.stop(), this.bonsai.stop(), this.julia.stop()]); }
}
