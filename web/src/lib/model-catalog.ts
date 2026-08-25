import { getProviders, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { BROWSER_MODELS, checkWebGpuAvailable } from "../stores/local-model";
import { loadModelPrefs } from "../keating/model-prefs";
import { buildSavedModel, getSelectableModels } from "./provider-models";

/**
 * The one model catalog. Chat and the review model pools both read from here so
 * a provider hidden in settings, or a custom model added there, means the same
 * thing on both surfaces.
 */

export type BrowserModelAvailability = Record<string, { available: boolean; reason?: string }>;

export type SelectableModelGroup = "recent" | "browser" | "cloud" | "custom";

export type SelectableModel = {
	key: string;
	model: Model<Api>;
	group: SelectableModelGroup;
};

export function modelKey(model: Model<any>): string {
	return `${model.provider}::${model.api}::${model.id}`;
}

export function makeBrowserModels(availableIds?: ReadonlySet<string>): Model<Api>[] {
	return BROWSER_MODELS.filter((spec) => !availableIds || availableIds.has(spec.id)).map((spec) => ({
		id: spec.id,
		name: spec.name,
		api: "browser" as Api,
		provider: "browser",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 0,
		maxTokens: 0,
	}));
}

export async function checkBrowserModelAvailability(): Promise<BrowserModelAvailability> {
	const entries = await Promise.all(
		BROWSER_MODELS.map(async (spec) => [spec.id, await checkWebGpuAvailable(spec)] as const),
	);
	return Object.fromEntries(entries);
}

export async function discoverModels(browserAvailability: BrowserModelAvailability): Promise<SelectableModel[]> {
	const modelPrefs = loadModelPrefs();
	const hidden = new Set(modelPrefs.hiddenProviders);
	const all = await getSelectableModels((provider) => !hidden.has(provider));

	for (const saved of modelPrefs.customModels) {
		all.push(buildSavedModel(saved));
	}

	const knownProviders = new Set<string>(getProviders());
	const selectable: SelectableModel[] = all.map((model) => ({
		key: modelKey(model),
		model,
		group:
			model.provider === "browser"
				? "browser"
				: knownProviders.has(model.provider)
					? "cloud"
					: "custom",
	}));

	const compatibleBrowserModelIds = new Set(
		Object.entries(browserAvailability)
			.filter(([, result]) => result.available)
			.map(([id]) => id),
	);
	if (compatibleBrowserModelIds.size > 0) {
		selectable.unshift(
			...makeBrowserModels(compatibleBrowserModelIds).map((model) => ({
				key: modelKey(model),
				model,
				group: "browser" as const,
			})),
		);
	}

	return Array.from(new Map(selectable.map((entry) => [entry.key, entry])).values());
}
