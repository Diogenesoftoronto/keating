const STORAGE_KEY = "keating_model_prefs";
const PREFS_CHANGED_EVENT = "keating:model-prefs-changed";
const LEGACY_UI_SETTINGS_KEY = "keating_ui_settings";

export type SavedModel = {
	key: string;
	id: string;
	name: string;
	provider: string;
	api: string;
	baseUrl?: string;
	reasoning: boolean;
	vision: boolean;
};

export interface ModelPrefs {
	hiddenProviders: string[];
	recentModels: Array<{ key: string; timestamp: number }>;
	customModels: SavedModel[];
}

export const DEFAULT_MODEL_PREFS: ModelPrefs = {
	hiddenProviders: [],
	recentModels: [],
	customModels: [],
};

type LegacyModelPrefsInput = Partial<ModelPrefs>;

function normalizeRecentModel(value: unknown): { key: string; timestamp: number } | null {
	if (!value || typeof value !== "object") return null;
	const item = value as { key?: unknown; timestamp?: unknown };
	if (typeof item.key !== "string" || item.key.trim() === "") return null;
	const timestamp = typeof item.timestamp === "number" ? item.timestamp : Number(item.timestamp);
	return {
		key: item.key,
		timestamp: Number.isFinite(timestamp) ? timestamp : 0,
	};
}

function normalizeSavedModel(value: unknown): SavedModel | null {
	if (!value || typeof value !== "object") return null;
	const model = value as Partial<SavedModel>;
	if (
		typeof model.key !== "string"
		|| typeof model.id !== "string"
		|| typeof model.name !== "string"
		|| typeof model.provider !== "string"
		|| typeof model.api !== "string"
	) {
		return null;
	}
	return {
		key: model.key,
		id: model.id,
		name: model.name,
		provider: model.provider,
		api: model.api,
		baseUrl: typeof model.baseUrl === "string" && model.baseUrl.trim() ? model.baseUrl : undefined,
		reasoning: model.reasoning === true,
		vision: model.vision === true,
	};
}

function normalizeModelPrefs(value: LegacyModelPrefsInput | null | undefined): ModelPrefs {
	return {
		hiddenProviders: Array.isArray(value?.hiddenProviders)
			? value.hiddenProviders.filter((provider): provider is string => typeof provider === "string" && provider.trim().length > 0)
			: DEFAULT_MODEL_PREFS.hiddenProviders,
		recentModels: Array.isArray(value?.recentModels)
			? value.recentModels.map(normalizeRecentModel).filter((item): item is { key: string; timestamp: number } => item !== null)
			: DEFAULT_MODEL_PREFS.recentModels,
		customModels: Array.isArray(value?.customModels)
			? value.customModels.map(normalizeSavedModel).filter((item): item is SavedModel => item !== null)
			: DEFAULT_MODEL_PREFS.customModels,
	};
}

function loadLegacyUiSettingsPrefs(): ModelPrefs {
	if (typeof localStorage === "undefined") return DEFAULT_MODEL_PREFS;
	try {
		const raw = localStorage.getItem(LEGACY_UI_SETTINGS_KEY);
		if (!raw) return DEFAULT_MODEL_PREFS;
		return normalizeModelPrefs(JSON.parse(raw) as LegacyModelPrefsInput);
	} catch (error) {
		console.warn("Failed to load legacy Keating model prefs migration:", error);
		return DEFAULT_MODEL_PREFS;
	}
}

export function loadModelPrefs(): ModelPrefs {
	if (typeof localStorage === "undefined") return DEFAULT_MODEL_PREFS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return loadLegacyUiSettingsPrefs();
		return normalizeModelPrefs(JSON.parse(raw) as LegacyModelPrefsInput);
	} catch (error) {
		console.warn("Failed to load Keating model prefs:", error);
		return DEFAULT_MODEL_PREFS;
	}
}

export function saveModelPrefs(next: ModelPrefs): void {
	const normalized = normalizeModelPrefs(next);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
	} catch (error) {
		console.warn("Failed to save Keating model prefs:", error);
	}
	window.dispatchEvent(new CustomEvent<ModelPrefs>(PREFS_CHANGED_EVENT, { detail: normalized }));
}

export function subscribeModelPrefs(callback: (value: ModelPrefs) => void): () => void {
	const notify = () => callback(loadModelPrefs());
	const onCustom = (event: Event) => {
		callback((event as CustomEvent<ModelPrefs>).detail ?? loadModelPrefs());
	};
	window.addEventListener(PREFS_CHANGED_EVENT, onCustom);
	window.addEventListener("storage", notify);
	return () => {
		window.removeEventListener(PREFS_CHANGED_EVENT, onCustom);
		window.removeEventListener("storage", notify);
	};
}

export function addRecentModel(key: string) {
	const prefs = loadModelPrefs();
	const filtered = prefs.recentModels.filter((model) => model.key !== key);
	const next: ModelPrefs = {
		...prefs,
		recentModels: [{ key, timestamp: Date.now() }, ...filtered].slice(0, 7),
	};
	saveModelPrefs(next);
	return next;
}

export function getRecentModels(): Array<{ key: string; timestamp: number }> {
	const prefs = loadModelPrefs();
	return [...prefs.recentModels].sort((a, b) => b.timestamp - a.timestamp);
}

export function addCustomModel(model: SavedModel) {
	const prefs = loadModelPrefs();
	const filtered = prefs.customModels.filter((item) => item.key !== model.key);
	const next: ModelPrefs = {
		...prefs,
		customModels: [...filtered, model],
	};
	saveModelPrefs(next);
	return next;
}

export function removeCustomModel(key: string) {
	const prefs = loadModelPrefs();
	const next: ModelPrefs = {
		...prefs,
		customModels: prefs.customModels.filter((item) => item.key !== key),
	};
	saveModelPrefs(next);
	return next;
}

export function toggleProviderVisibility(provider: string, hidden: boolean) {
	const prefs = loadModelPrefs();
	const nextHiddenProviders = new Set(prefs.hiddenProviders);
	if (hidden) nextHiddenProviders.add(provider);
	else nextHiddenProviders.delete(provider);
	const next: ModelPrefs = {
		...prefs,
		hiddenProviders: Array.from(nextHiddenProviders),
	};
	saveModelPrefs(next);
	return next;
}
