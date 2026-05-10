export interface KeatingUiSettings {
	showToolUi: boolean;
	autoOpenArtifacts: boolean;
	showRawErrors: boolean;
}

export const DEFAULT_UI_SETTINGS: KeatingUiSettings = {
	showToolUi: false,
	autoOpenArtifacts: true,
	showRawErrors: false,
};

const STORAGE_KEY = "keating_ui_settings";
const SETTINGS_CHANGED_EVENT = "keating:ui-settings-changed";

function normalizeSettings(value: Partial<KeatingUiSettings> | null): KeatingUiSettings {
	return {
		showToolUi: value?.showToolUi ?? DEFAULT_UI_SETTINGS.showToolUi,
		autoOpenArtifacts: value?.autoOpenArtifacts ?? DEFAULT_UI_SETTINGS.autoOpenArtifacts,
		showRawErrors: value?.showRawErrors ?? DEFAULT_UI_SETTINGS.showRawErrors,
	};
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
