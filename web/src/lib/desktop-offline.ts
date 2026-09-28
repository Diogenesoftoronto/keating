import type { Api, Model } from "@earendil-works/pi-ai/compat";

export const DESKTOP_OFFLINE_PROVIDER = "desktop-offline";
export interface DesktopOfflineStatus {
	available: boolean;
	installed: boolean;
	downloading: boolean;
	downloadedBytes: number;
	totalBytes: number;
	error?: string;
	bundled?: boolean;
	generating?: boolean;
}
export interface DesktopOfflineBridge {
  supportedModels?: readonly string[];
  supportedJudgementModels?: readonly string[];
	status(modelId?: string): Promise<DesktopOfflineStatus>;
	download(modelId?: string): Promise<void>;
	cancelDownload(modelId?: string): Promise<void>;
	remove(modelId?: string): Promise<void>;
	generate(input: { prompt: string; maxTokens?: number; temperature?: number; modelId?: string; media?: Array<{ turn: number; type: "image" | "audio"; data: string; mimeType: string }> }): Promise<string>;
	cancelGeneration(): Promise<void>;
	/** Optional for older desktop builds. Scores decimal candidate indices. */
	scoreLabels?(input: { requestId: string; modelId: string; prompt: string; labelCount: number } | (import("../../../shared/julia/encoder.js").JuliaDecisionRequest & { requestId: string; modelId: string })): Promise<{
		modelId: string; negativeLogLikelihoods?: readonly number[]; weights?: readonly number[];
	} | null>;
	cancelScoring?(requestId: string): Promise<void>;
  unloadJudgement?(): Promise<void>;
}
declare global { interface Window { keatingOffline?: DesktopOfflineBridge } }

export function desktopOfflineBridge(): DesktopOfflineBridge | undefined {
	return typeof window === "undefined" ? undefined : window.keatingOffline;
}

export const DESKTOP_OFFLINE_MODEL: Model<Api> = {
	id: "mlboydaisuke/MiniCPM5-2B-LiteRT",
	name: "MiniCPM5 2B (Offline)",
	provider: DESKTOP_OFFLINE_PROVIDER,
	api: "openai-completions",
	baseUrl: "",
	input: ["text"],
	reasoning: false,
	contextWindow: 4096,
	maxTokens: 1024,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export const DESKTOP_GEMMA_OFFLINE_MODEL: Model<Api> & { inputModalities: string[] } = {
  ...DESKTOP_OFFLINE_MODEL,
  id: "litert-community/gemma-4-E4B-it-litert-lm",
  name: "Gemma 4 E4B (Offline)",
  input: ["text", "image"],
  inputModalities: ["text", "image", "audio"],
};
export const DESKTOP_BONSAI_OFFLINE_MODEL: Model<Api> = {
  ...DESKTOP_OFFLINE_MODEL,
  id: "prism-ml/Ternary-Bonsai-2-27B-gguf",
  name: "Bonsai 2 27B (Offline)",
  input: ["text", "image"],
  maxTokens: 512,
};
export const DESKTOP_OFFLINE_MODELS = [DESKTOP_OFFLINE_MODEL, DESKTOP_GEMMA_OFFLINE_MODEL, DESKTOP_BONSAI_OFFLINE_MODEL] as const;

export async function installedDesktopOfflineModels(): Promise<Model<Api>[]> {
  const bridge = desktopOfflineBridge();
  if (!bridge) return [];
  const supported = DESKTOP_OFFLINE_MODELS.filter(model => model.id === DESKTOP_OFFLINE_MODEL.id || bridge.supportedModels?.includes(model.id));
  const result = await Promise.all(supported.map(async model => {
    const status = await bridge.status(model.id).catch(() => undefined);
    return status?.available && status.installed ? model : undefined;
  }));
  return result.filter((model): model is Model<Api> => model !== undefined);
}

export async function installedDesktopOfflineModel(): Promise<Model<Api> | undefined> {
	return (await installedDesktopOfflineModels())[0];
}
