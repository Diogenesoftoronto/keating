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
	status(): Promise<DesktopOfflineStatus>;
	download(): Promise<void>;
	cancelDownload(): Promise<void>;
	remove(): Promise<void>;
	generate(input: { prompt: string; maxTokens?: number; temperature?: number }): Promise<string>;
	cancelGeneration(): Promise<void>;
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

export async function installedDesktopOfflineModel(): Promise<Model<Api> | undefined> {
	const status = await desktopOfflineBridge()?.status().catch(() => undefined);
	return status?.available && status.installed ? DESKTOP_OFFLINE_MODEL : undefined;
}
