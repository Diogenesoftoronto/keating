import { getProviders, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { BROWSER_MODELS, checkWebGpuAvailable } from "../stores/local-model";
import { loadModelPrefs, shouldShowModelProvider } from "../keating/model-prefs";
import { isNotOrganicFeatureEnabled, NOTORGANIC_PROVIDER_ID } from "../notorganic-provider";
import { buildSavedModel, getCustomProviders, getSelectableModels, hasProviderCredential } from "./provider-models";

export { hasProviderCredential } from "./provider-models";

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

export type ModelProviderAvailability = {
	id: string;
	configured: boolean;
	cloud: boolean;
	manuallyHidden: boolean;
};

const MODEL_PROVIDER_PRIORITY = [
	"openai-codex",
	"anthropic",
	"openai",
	"google",
	"mistral",
	"groq",
	"xai",
	"openrouter",
	"amazon-bedrock",
	"vertex",
];

export function compareModelProviders(left: string, right: string): number {
	const leftRank = MODEL_PROVIDER_PRIORITY.indexOf(left.toLowerCase());
	const rightRank = MODEL_PROVIDER_PRIORITY.indexOf(right.toLowerCase());
	const normalizedLeftRank = leftRank === -1 ? MODEL_PROVIDER_PRIORITY.length : leftRank;
	const normalizedRightRank = rightRank === -1 ? MODEL_PROVIDER_PRIORITY.length : rightRank;
	if (normalizedLeftRank !== normalizedRightRank) return normalizedLeftRank - normalizedRightRank;
	return left.localeCompare(right);
}

export function displayModelProvider(provider: string): string {
	const labels: Record<string, string> = {
		"desktop-offline": "On this device",
		"amazon-bedrock": "Amazon Bedrock",
		"openai-codex": "OpenAI Codex",
		openai: "OpenAI",
		anthropic: "Anthropic",
		google: "Google",
		mistral: "Mistral",
		groq: "Groq",
		xai: "xAI",
		openrouter: "OpenRouter",
		vertex: "Google Vertex",
	};
	return labels[provider.toLowerCase()] ?? provider;
}

function cloudProviderIds(): Set<string> {
	return new Set([
		...getProviders(),
		...(isNotOrganicFeatureEnabled() ? [NOTORGANIC_PROVIDER_ID] : []),
	]);
}

export function requiresProviderCredential(provider: string): boolean {
	return cloudProviderIds().has(provider);
}

export async function getModelProviderAvailability(): Promise<ModelProviderAvailability[]> {
	const modelPrefs = loadModelPrefs();
	const cloudProviders = cloudProviderIds();
	const customProviders = await getCustomProviders();
	const providerIds = Array.from(new Set([
		...cloudProviders,
		...customProviders.map((provider) => provider.name),
	]));
	const availability = await Promise.all(providerIds.map(async (id) => ({
		id,
		cloud: cloudProviders.has(id),
		configured: await hasProviderCredential(id),
		manuallyHidden: modelPrefs.hiddenProviders.includes(id),
	})));
	return availability.sort((left, right) => compareModelProviders(left.id, right.id));
}

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
		input: spec.kind === "multimodal" ? ["text", "image", "audio"] as Model<Api>["input"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: spec.kind === "multimodal" ? 4096 : 0,
		maxTokens: spec.kind === "multimodal" ? 512 : 0,
	}));
}

export async function checkBrowserModelAvailability(): Promise<BrowserModelAvailability> {
	const entries = await Promise.all(
		BROWSER_MODELS.map(async (spec) => [spec.id, await checkWebGpuAvailable(spec)] as const),
	);
	return Object.fromEntries(entries);
}

export async function discoverModels(
	browserAvailability: BrowserModelAvailability,
	options: { revealProviders?: ReadonlySet<string> } = {},
): Promise<SelectableModel[]> {
	const modelPrefs = loadModelPrefs();
	const hidden = new Set(modelPrefs.hiddenProviders);
	const cloudProviders = cloudProviderIds();
	const revealed = options.revealProviders ?? new Set<string>();
	const configured = new Set<string>();
	await Promise.all(Array.from(cloudProviders).map(async (provider) => {
		if (await hasProviderCredential(provider)) configured.add(provider);
	}));
	const all = await getSelectableModels((provider) => shouldShowModelProvider({
		cloud: cloudProviders.has(provider),
		configured: configured.has(provider),
		manuallyHidden: hidden.has(provider),
		revealed: revealed.has(provider),
	}));

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
	selectable.sort((left, right) => {
		const providerOrder = compareModelProviders(left.model.provider, right.model.provider);
		if (providerOrder !== 0) return providerOrder;
		const nameOrder = left.model.name.localeCompare(right.model.name);
		return nameOrder !== 0 ? nameOrder : left.model.id.localeCompare(right.model.id);
	});

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
