import { getModels, getProviders, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { SERVICE_ENDPOINTS } from "@keating/runtime-config";

const CACHE_KEY = "keating.models-dev.v1";
export const MODEL_CATALOG_TTL = 60 * 60 * 1000;
const RETRY_DELAY = 60 * 1000;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const NPM_APIS: Record<string, string> = {
	"@ai-sdk/anthropic": "anthropic-messages",
	"@ai-sdk/openai": "openai-responses",
	"@ai-sdk/openai-compatible": "openai-completions",
	"@ai-sdk/google": "google-generative-ai",
};
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const finite = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
const positive = (value: unknown, fallback: number): number => finite(value, 0) > 0 ? value as number : fallback;

/** Only inherit flags/headers shared by every bundled model on this exact route. */
function routeDefaults(models: Model<Api>[], field: "compat" | "headers"): JsonObject {
	const first = object(models[0]?.[field]);
	return Object.fromEntries(Object.entries(first).filter(([key, value]) => models.every(model =>
		JSON.stringify(object(model[field])[key]) === JSON.stringify(value))));
}

/** The catalog supplies metadata, never credentials, executable code, or request destinations. */
export function parseModelsDevCatalog(payload: unknown, baseline: readonly Model<Api>[]): Model<Api>[] {
	const catalog = object(payload);
	const providers = new Map<string, Model<Api>[]>();
	for (const model of baseline) {
		const models = providers.get(model.provider) ?? [];
		models.push(model);
		providers.set(model.provider, models);
	}
	const result: Model<Api>[] = [];
	for (const [provider, known] of providers) {
		const entry = object(catalog[provider]);
		for (const [key, value] of Object.entries(object(entry.models))) {
			const data = object(value);
			const id = typeof data.id === "string" && data.id.trim() ? data.id : key;
			const modalities = object(data.modalities);
			// Chat/agent execution cannot use embeddings, image generators, or realtime endpoints.
			if (data.type !== undefined && data.type !== "chat" && data.type !== "language") continue;
			if (!Array.isArray(modalities.output) || modalities.output.length !== 1 || modalities.output[0] !== "text") continue;
			if (!Array.isArray(modalities.input) || !modalities.input.includes("text")) continue;
			const existing = known.find(model => model.id === id);
			if (!existing && data.status === "deprecated") continue;
			const modelNpm = object(data.provider).npm;
			const npm = modelNpm ?? entry.npm;
			const api = typeof npm === "string" ? NPM_APIS[npm] : undefined;
			// Alternate SDKs can use a different protocol (e.g. Claude on Vertex).
			if (!existing && modelNpm && modelNpm !== entry.npm && !api) continue;
			// models.dev uses provider-prefixed IDs here, but Pi's gateway routes expect
			// provider-native IDs. Keep its curated mappings rather than inventing routes.
			if (!existing && provider === "cloudflare-ai-gateway") continue;
			const routes = known.filter(model => !api || model.api === api);
			// A single trusted route is unambiguous; mixed providers need an SDK match.
			// Do not guess regional/account-specific endpoints or subscription entitlements.
			const route = existing ?? (new Set(routes.map(model => `${model.api}::${model.baseUrl}`)).size === 1 ? routes[0] : undefined);
			if (!route) continue;
			const limit = object(data.limit);
			const contextWindow = positive(limit.context, existing?.contextWindow ?? 0);
			const maxTokens = positive(limit.output, existing?.maxTokens ?? 0);
			if (!contextWindow || !maxTokens) continue;
			const cost = object(data.cost);
			const rates = (input: JsonObject, fallback = existing?.cost) => ({
				input: finite(input.input, fallback?.input ?? 0), output: finite(input.output, fallback?.output ?? 0),
				cacheRead: finite(input.cache_read, fallback?.cacheRead ?? 0), cacheWrite: finite(input.cache_write, fallback?.cacheWrite ?? 0),
			});
			const tiers = Array.isArray(cost.tiers) ? cost.tiers.flatMap(value => {
				const item = object(value), tier = object(item.tier);
				return tier.type === "context" && positive(tier.size, 0) ? [{ ...rates(item), inputTokensAbove: tier.size as number }] : [];
			}) : existing?.cost.tiers;
			const reasoning = typeof data.reasoning === "boolean" ? data.reasoning : existing?.reasoning ?? false;
			const reasoningOptions = Array.isArray(data.reasoning_options) ? data.reasoning_options.map(object) : [];
			const effort = reasoningOptions.find(option => option.type === "effort");
			const toggle = reasoningOptions.some(option => option.type === "toggle");
			const budget = reasoningOptions.some(option => option.type === "budget_tokens");
			const values = effort && Array.isArray(effort.values) ? effort.values.filter((value): value is string => typeof value === "string") : [];
			const thinkingLevelMap = existing?.thinkingLevelMap ?? (!existing && values.length && !budget ? Object.fromEntries(THINKING_LEVELS.map(level => {
				if (level === "off" && toggle) return [level, "off"];
				const native = level === "off" && values.includes("none") ? "none" : level;
				return [level, values.includes(native) ? native : null];
			})) as Model<Api>["thinkingLevelMap"] : undefined);
			const input = modalities.input.filter((mode): mode is "text" | "image" => mode === "text" || mode === "image");
			const sameRoute = known.filter(model => model.api === route.api && model.baseUrl === route.baseUrl);
			const compat = existing?.compat ?? {
				...routeDefaults(sameRoute, "compat"),
				...(data.temperature === false ? { supportsTemperature: false } : {}),
				// New Claude 5-family models use adaptive effort; budget-based Claude
				// entries and existing SDK compatibility profiles are never rewritten.
				...(route.api === "anthropic-messages" && /^claude-(?:fable|opus|sonnet|haiku)-[5-9](?:[.-]|$)/.test(id) && values.length && !budget
					? { forceAdaptiveThinking: true } : {}),
				...(provider === "github-copilot" && route.api === "anthropic-messages" ? { supportsEagerToolInputStreaming: false } : {}),
			};
			const headers = existing?.headers ?? routeDefaults(sameRoute, "headers");
			result.push({
				...existing,
				id, name: typeof data.name === "string" && data.name.trim() ? data.name : id,
				provider, api: route.api, baseUrl: route.baseUrl,
				reasoning, input, contextWindow, maxTokens,
				cost: { ...rates(cost), ...(tiers?.length ? { tiers } : {}) },
				...(thinkingLevelMap ? { thinkingLevelMap } : {}),
				...(Object.keys(compat).length ? { compat } : {}),
				...(Object.keys(headers).length ? { headers: headers as Model<Api>["headers"] } : {}),
			});
		}
	}
	return result;
}

type CatalogStorage = Pick<Storage, "getItem" | "setItem">;
export interface ModelCatalogStatus { updatedAt: number | null; error: string | null }

/** Isolated state makes cache expiry, concurrent refresh and offline fallback testable. */
export function createModelsDevCatalog(options: {
	baseline: () => Model<Api>[];
	fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	storage?: () => CatalogStorage | undefined;
	now?: () => number;
	timeoutMs?: number;
}) {
	const now = options.now ?? Date.now;
	let overlay: Model<Api>[] = [];
	let updatedAt: number | null = null;
	let error: string | null = null;
	let retryAt = 0;
	let restored = false;
	let pending: Promise<void> | undefined;
	const restore = () => {
		if (restored) return;
		restored = true;
		try {
			const raw = options.storage?.()?.getItem(CACHE_KEY);
			if (!raw) return;
			const cached = object(JSON.parse(raw));
			const parsed = parseModelsDevCatalog(cached.catalog, options.baseline());
			if (parsed.length && typeof cached.updatedAt === "number" && Number.isFinite(cached.updatedAt)) {
				overlay = parsed;
				updatedAt = cached.updatedAt <= now() ? cached.updatedAt : null;
			}
		} catch { /* Blocked or malformed storage must not prevent model selection. */ }
	};
	const models = (): Model<Api>[] => {
		restore();
		const merged = new Map(options.baseline().map(model => [`${model.provider}::${model.id}`, model]));
		for (const model of overlay) merged.set(`${model.provider}::${model.id}`, model);
		return [...merged.values()];
	};
	const refresh = (force = false): Promise<void> => {
		restore();
		if (pending) return pending;
		if (!force && (now() < retryAt || (updatedAt !== null && now() - updatedAt < MODEL_CATALOG_TTL))) return Promise.resolve();
		pending = (async () => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
			try {
				const response = await options.fetch(SERVICE_ENDPOINTS.modelsDev, {
					headers: { Accept: "application/json" }, credentials: "omit", signal: controller.signal,
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const catalog = await response.json();
				const parsed = parseModelsDevCatalog(catalog, options.baseline());
				if (!parsed.length) throw new Error("No compatible chat models in the catalog");
				overlay = parsed; updatedAt = now(); error = null; retryAt = 0;
				try {
					// Keep only supported providers. Parse again on restore, so persisted URLs are never trusted.
					const supported = new Set(options.baseline().map(model => model.provider));
					const selected = Object.fromEntries(Object.entries(object(catalog)).filter(([provider]) => supported.has(provider)));
					options.storage?.()?.setItem(CACHE_KEY, JSON.stringify({ updatedAt, catalog: selected }));
				} catch { /* In-memory results still work when storage is unavailable or full. */ }
			} catch {
				error = "Could not refresh models.dev. Showing the last available catalog.";
				retryAt = now() + RETRY_DELAY;
			} finally { clearTimeout(timeout); }
		})().finally(() => { pending = undefined; });
		return pending;
	};
	return { models, refresh, status: (): ModelCatalogStatus => { restore(); return { updatedAt, error }; } };
}

const catalog = createModelsDevCatalog({
	baseline: () => getProviders().flatMap(provider => getModels(provider) as Model<Api>[]),
	fetch: (input, init) => globalThis.fetch(input, init),
	storage: () => typeof localStorage === "undefined" ? undefined : localStorage,
});
export function getCloudProviderModels(provider: string): Model<Api>[] {
	return catalog.models().filter(model => model.provider === provider);
}
export function getModelCatalogStatus(): ModelCatalogStatus { return catalog.status(); }
export async function refreshCloudModelCatalog(force = false): Promise<void> {
	// Node/SSR uses the bundled snapshot. Browser consumers share a cached refresh.
	if (typeof window !== "undefined") await catalog.refresh(force);
}
