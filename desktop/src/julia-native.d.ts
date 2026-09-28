export const JULIA_MODEL_ID: string;
export interface JuliaLabelRequest { requestId: string; modelId: string; state: unknown; question: string; options: readonly string[]; type: "noul" | "choice" | "score" }
export interface JuliaLabelScores { modelId: string; weights: readonly number[] }
export class JuliaRuntime {
  constructor(options: { directory: string; bundledDirectory?: string; maxLength?: number; headLength?: number; threads?: number; fetch?: typeof fetch });
  status(): Promise<import("./offline-contract.js").OfflineStatus>;
  download(): Promise<void>;
  cancelDownload(): void;
  remove(): Promise<void>;
  unload(): Promise<void>;
  stop(): Promise<void>;
  scoreLabels(value: unknown): Promise<JuliaLabelScores | null>;
  cancelRequest(id: string): void;
}
