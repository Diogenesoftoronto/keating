import type { Api, Model } from "@earendil-works/pi-ai";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

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

export interface KeatingUiSettings {
	showToolUi: boolean;
	autoOpenArtifacts: boolean;
	showRawErrors: boolean;
	googleGrounding: "auto" | "off";
	reasoningLevel: ReasoningLevel;
	hiddenProviders: string[];
	recentModels: Array<{ key: string; timestamp: number }>;
	customModels: SavedModel[];
}

export const DEFAULT_UI_SETTINGS: KeatingUiSettings = {
	showToolUi: false,
	autoOpenArtifacts: true,
	showRawErrors: false,
	googleGrounding: "auto",
	reasoningLevel: "medium",
	hiddenProviders: [],
	recentModels: [],
	customModels: [],
};

const STORAGE_KEY = "keating_ui_settings";
const SETTINGS_CHANGED_EVENT = "keating:ui-settings-changed";

function normalizeSettings(value: Partial<KeatingUiSettings> | null): KeatingUiSettings {
	return {
		showToolUi: value?.showToolUi ?? DEFAULT_UI_SETTINGS.showToolUi,
		autoOpenArtifacts: value?.autoOpenArtifacts ?? DEFAULT_UI_SETTINGS.autoOpenArtifacts,
		showRawErrors: value?.showRawErrors ?? DEFAULT_UI_SETTINGS.showRawErrors,
		googleGrounding: value?.googleGrounding === "off" ? "off" : DEFAULT_UI_SETTINGS.googleGrounding,
		reasoningLevel: value?.reasoningLevel ?? DEFAULT_UI_SETTINGS.reasoningLevel,
		hiddenProviders: Array.isArray(value?.hiddenProviders) ? value.hiddenProviders : DEFAULT_UI_SETTINGS.hiddenProviders,
		recentModels: Array.isArray(value?.recentModels) ? value.recentModels : DEFAULT_UI_SETTINGS.recentModels,
		customModels: Array.isArray(value?.customModels) ? value.customModels : DEFAULT_UI_SETTINGS.customModels,
	};
}

export function addRecentModel(key: string) {
	const settings = loadKeatingUiSettings();
	const filtered = settings.recentModels.filter((m) => m.key !== key);
	const next: KeatingUiSettings = {
		...settings,
		recentModels: [{ key, timestamp: Date.now() }, ...filtered].slice(0, 7),
	};
	saveKeatingUiSettings(next);
	return next;
}

export function getRecentModels(): Array<{ key: string; timestamp: number }> {
	const settings = loadKeatingUiSettings();
	return [...settings.recentModels].sort((a, b) => b.timestamp - a.timestamp);
}

export function addCustomModel(model: SavedModel) {
	const settings = loadKeatingUiSettings();
	const filtered = settings.customModels.filter((m) => m.key !== model.key);
	const next: KeatingUiSettings = {
		...settings,
		customModels: [...filtered, model],
	};
	saveKeatingUiSettings(next);
	return next;
}

export function removeCustomModel(key: string) {
	const settings = loadKeatingUiSettings();
	const next: KeatingUiSettings = {
		...settings,
		customModels: settings.customModels.filter((m) => m.key !== key),
	};
	saveKeatingUiSettings(next);
	return next;
}

export function toggleProviderVisibility(provider: string, hidden: boolean) {
	const settings = loadKeatingUiSettings();
	const set = new Set(settings.hiddenProviders);
	if (hidden) set.add(provider);
	else set.delete(provider);
	const next: KeatingUiSettings = {
		...settings,
		hiddenProviders: Array.from(set),
	};
	saveKeatingUiSettings(next);
	return next;
}

export function loadKeatingUiSettings(): KeatingUiSettings {
	if (typeof localStorage === "undefined") return DEFAULT_UI_SETTINGS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_UI_SETTINGS;
		return normalizeSettings(JSON.parse(raw) as Partial<KeatingUiSettings>);
	} catch (error) {
		console.warn("Failed to load Keating UI settings:", error);
		return DEFAULT_UI_SETTINGS;
	}
}

export function saveKeatingUiSettings(next: KeatingUiSettings) {
	const normalized = normalizeSettings(next);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
	} catch (error) {
		console.warn("Failed to save Keating UI settings:", error);
	}
	window.dispatchEvent(new CustomEvent<KeatingUiSettings>(SETTINGS_CHANGED_EVENT, { detail: normalized }));
}

export function subscribeKeatingUiSettings(callback: (settings: KeatingUiSettings) => void) {
	const notify = () => callback(loadKeatingUiSettings());
	const onCustom = (event: Event) => {
		callback((event as CustomEvent<KeatingUiSettings>).detail ?? loadKeatingUiSettings());
	};
	window.addEventListener(SETTINGS_CHANGED_EVENT, onCustom);
	window.addEventListener("storage", notify);
	return () => {
		window.removeEventListener(SETTINGS_CHANGED_EVENT, onCustom);
		window.removeEventListener("storage", notify);
	};
}
