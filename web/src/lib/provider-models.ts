import { getModels, getProviders, type Api, type Model } from "@mariozechner/pi-ai";
import { getAppStorage, type CustomProvider } from "@mariozechner/pi-web-ui";
import { Ollama } from "ollama/browser";

export type KeatingCustomProviderType =
	| "ollama"
	| "llama.cpp"
	| "vllm"
	| "lmstudio"
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages"
	| "synthetic";

export type KeatingCustomProvider = Omit<CustomProvider, "type"> & {
	type: KeatingCustomProviderType;
};

const AUTO_DISCOVERY_TYPES = new Set<KeatingCustomProviderType>(["ollama", "llama.cpp", "vllm", "lmstudio"]);
const OPENAI_COMPATIBLE_TYPES = new Set<KeatingCustomProviderType>([
	"openai-completions",
	"openai-responses",
	"synthetic",
]);

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function modelCost() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	};
}

function toContextWindow(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function inferInputModes(model: any): Array<"text" | "image"> {
	const supported = new Set<string>();

	if (Array.isArray(model?.input)) {
		for (const entry of model.input) {
			if (entry === "image" || entry === "text") supported.add(entry);
		}
	}

	if (Array.isArray(model?.input_modalities)) {
		for (const entry of model.input_modalities) {
			if (entry === "image" || entry === "text") supported.add(entry);
		}
	}

	if (Array.isArray(model?.modalities)) {
		for (const entry of model.modalities) {
			if (entry === "image" || entry === "text") supported.add(entry);
		}
	}

	if (model?.vision === true) supported.add("image");
	if (supported.size === 0) supported.add("text");

	return Array.from(supported) as Array<"text" | "image">;
}

function inferReasoning(model: any): boolean {
	if (typeof model?.reasoning === "boolean") return model.reasoning;
	if (typeof model?.supports_reasoning === "boolean") return model.supports_reasoning;
	if (Array.isArray(model?.capabilities)) return model.capabilities.includes("thinking");
	const name = String(model?.id ?? model?.name ?? "").toLowerCase();
	return name.includes("thinking") || name.includes("reasoning");
}

function manualProviderApi(type: KeatingCustomProviderType): Api {
	switch (type) {
		case "openai-responses":
			return "openai-responses" as Api;
		case "anthropic-messages":
			return "anthropic-messages" as Api;
		case "synthetic":
		case "openai-completions":
		default:
			return "openai-completions" as Api;
	}
}

async function fetchJson(url: string, apiKey?: string): Promise<any> {
	const headers: HeadersInit = {
		"Content-Type": "application/json",
	};

	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await fetch(url, { method: "GET", headers });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	return await response.json();
}

async function discoverOpenAiCompatibleModels(
	provider: KeatingCustomProvider,
): Promise<{ apiBaseUrl: string; models: Model<Api>[] }> {
	const baseUrl = trimTrailingSlash(provider.baseUrl);
	const candidateBaseUrls = baseUrl.endsWith("/v1") ? [baseUrl] : [baseUrl, `${baseUrl}/v1`];

	let lastError: unknown;
	for (const apiBaseUrl of candidateBaseUrls) {
		try {
			const payload = await fetchJson(`${apiBaseUrl}/models`, provider.apiKey);
			const records = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
				const models = records
					.map((record: any): Model<Api> | null => {
					const id = String(record?.id ?? record?.name ?? "").trim();
					if (!id) return null;

					const contextWindow = toContextWindow(
						record?.context_window ?? record?.context_length ?? record?.max_context_length ?? record?.max_model_len,
					);
					const maxTokens = toContextWindow(record?.max_tokens ?? record?.max_output_tokens, contextWindow || 4096);

					return {
						id,
						name: String(record?.name ?? id),
						api: manualProviderApi(provider.type),
						provider: provider.name,
						baseUrl: apiBaseUrl,
						reasoning: inferReasoning(record),
						input: inferInputModes(record),
						cost: modelCost(),
						contextWindow,
						maxTokens,
					};
					})
					.filter((model: Model<Api> | null): model is Model<Api> => model !== null);

			return { apiBaseUrl, models };
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError instanceof Error ? lastError : new Error(`Failed to discover models for ${provider.name}`);
}

async function discoverOllamaModels(baseUrl: string): Promise<Model<Api>[]> {
	const ollama = new Ollama({ host: baseUrl });
	const { models } = await ollama.list();

	const discovered = await Promise.all(
		models.map(async (model: any): Promise<Model<Api> | null> => {
			const details = await ollama.show({ model: model.name });
			const capabilities: string[] = (details as any).capabilities || [];
			if (!capabilities.includes("tools")) return null;

			const modelInfo: any = details.model_info || {};
			const architecture = modelInfo["general.architecture"] || "";
			const contextWindow = toContextWindow(modelInfo[`${architecture}.context_length`], 8192);

			return {
				id: model.name,
				name: model.name,
				api: "openai-completions" as Api,
				provider: "",
				baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
				reasoning: capabilities.includes("thinking"),
				input: ["text"],
				cost: modelCost(),
				contextWindow,
				maxTokens: contextWindow,
			};
		}),
	);

	return discovered.filter((model): model is Model<Api> => model !== null);
}

async function discoverLlamaCppModels(baseUrl: string, apiKey?: string): Promise<Model<Api>[]> {
	const payload = await fetchJson(`${trimTrailingSlash(baseUrl)}/v1/models`, apiKey);
	const records = Array.isArray(payload?.data) ? payload.data : [];

	return records.map((model: any) => {
		const contextWindow = toContextWindow(model?.context_length, 8192);
		return {
			id: String(model.id),
			name: String(model.id),
			api: "openai-completions" as Api,
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: false,
			input: ["text"],
			cost: modelCost(),
			contextWindow,
			maxTokens: toContextWindow(model?.max_tokens, 4096),
		};
	});
}

async function discoverVllmModels(baseUrl: string, apiKey?: string): Promise<Model<Api>[]> {
	const payload = await fetchJson(`${trimTrailingSlash(baseUrl)}/v1/models`, apiKey);
	const records = Array.isArray(payload?.data) ? payload.data : [];

	return records.map((model: any) => {
		const contextWindow = toContextWindow(model?.max_model_len, 8192);
		return {
			id: String(model.id),
			name: String(model.id),
			api: "openai-completions" as Api,
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: false,
			input: ["text"],
			cost: modelCost(),
			contextWindow,
			maxTokens: Math.min(contextWindow, 4096),
		};
	});
}

async function discoverLmStudioModels(baseUrl: string): Promise<Model<Api>[]> {
	const payload = await fetchJson(`${trimTrailingSlash(baseUrl)}/v1/models`);
	const records = Array.isArray(payload?.data) ? payload.data : [];

	return records.map((model: any) => {
		const contextWindow = toContextWindow(model?.context_length ?? model?.max_context_length, 8192);
		return {
			id: String(model?.id),
			name: String(model?.name ?? model?.id),
			api: "openai-completions" as Api,
			provider: "",
			baseUrl: `${trimTrailingSlash(baseUrl)}/v1`,
			reasoning: inferReasoning(model),
			input: inferInputModes(model),
			cost: modelCost(),
			contextWindow,
			maxTokens: toContextWindow(model?.max_tokens, contextWindow),
		};
	});
}

async function discoverCustomProviderModels(provider: KeatingCustomProvider): Promise<Model<Api>[]> {
	if (AUTO_DISCOVERY_TYPES.has(provider.type)) {
		let models: Model<Api>[];
		switch (provider.type) {
			case "ollama":
				models = await discoverOllamaModels(provider.baseUrl);
				break;
			case "llama.cpp":
				models = await discoverLlamaCppModels(provider.baseUrl, provider.apiKey);
				break;
			case "vllm":
				models = await discoverVllmModels(provider.baseUrl, provider.apiKey);
				break;
			case "lmstudio":
				models = await discoverLmStudioModels(provider.baseUrl);
				break;
			default:
				models = [];
		}

		return models.map((model) => ({ ...model, provider: provider.name }));
	}

	if (OPENAI_COMPATIBLE_TYPES.has(provider.type)) {
		const discovered = await discoverOpenAiCompatibleModels(provider);
		return discovered.models;
	}

	return (provider.models || []).map((model) => ({
		...model,
		provider: provider.name,
		baseUrl: model.baseUrl || provider.baseUrl,
		api: model.api || manualProviderApi(provider.type),
	}));
}

export async function getCustomProviders(): Promise<KeatingCustomProvider[]> {
	return (await getAppStorage().customProviders.getAll()) as KeatingCustomProvider[];
}

export async function syncCustomProviderKeys(): Promise<void> {
	const storage = getAppStorage();
	const providers = await getCustomProviders();

	await Promise.all(
		providers.map(async (provider) => {
			if (provider.apiKey) {
				await storage.providerKeys.set(provider.name, provider.apiKey);
			}
		}),
	);
}

export async function getProviderApiKey(providerName: string): Promise<string | undefined> {
	const storage = getAppStorage();
	const storedKey = await storage.providerKeys.get(providerName);
	if (storedKey) return storedKey;

	const customProviders = await getCustomProviders();
	return customProviders.find((provider) => provider.name === providerName)?.apiKey;
}

export async function getSelectableModels(): Promise<Array<Model<Api>>> {
	const models: Array<Model<Api>> = [];

	for (const provider of getProviders()) {
		models.push(...(getModels(provider as any) as Array<Model<Api>>));
	}

	const customProviders = await getCustomProviders();
	const customModels = await Promise.all(
		customProviders.map(async (provider) => {
			try {
				return await discoverCustomProviderModels(provider);
			} catch (error) {
				console.warn(`Skipping unavailable provider ${provider.name}:`, error);
				return [];
			}
		}),
	);

	models.push(...customModels.flat());

	return models;
}
