import { JuliaNativeRuntime } from "./native.js";
import { JULIA_MODEL_ID } from "./manifest.js";
import type { JuliaDecisionRequest } from "./encoder.js";

export interface JuliaLabelRequest extends JuliaDecisionRequest { requestId: string; modelId: string }
export interface JuliaLabelScores { modelId: string; weights: readonly number[] }

/** IPC accepts a closed typed judgement, never a model-selected action. */
export class JuliaRuntime extends JuliaNativeRuntime {
  private requestId?: string;
  async scoreLabels(value: unknown): Promise<JuliaLabelScores | null> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const request = value as JuliaLabelRequest;
    if (Object.keys(request).some(key => !["requestId", "modelId", "state", "question", "options", "type"].includes(key))
      || request.modelId !== this.modelId || typeof request.requestId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(request.requestId)
      || typeof request.question !== "string" || request.question.length > 72000
      || !Array.isArray(request.options) || request.options.length < 2 || request.options.length > 20
      || request.options.some(option => typeof option !== "string" || option.length > 16000)) return null;
    if (this.requestId) return null;
    this.requestId = request.requestId;
    try { return { modelId: this.modelId, weights: (await this.weights([request]))[0]! }; }
    catch { return null; }
    finally { this.requestId = undefined; }
  }
  cancelRequest(id: string) { if (this.requestId === id) this.cancelScoring(); }
}

export { JULIA_MODEL_ID } from "./manifest.js";
