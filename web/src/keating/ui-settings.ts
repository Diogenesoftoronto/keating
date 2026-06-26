import { DEFAULT_IMAGE_GENERATOR_ID, isImageGeneratorId, type ImageGeneratorId } from "../lib/image-generators";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AnimationRenderer = "manim" | "hyperframes";
export type UiFontFamily = "roboto" | "space-mono" | "jetbrains-mono";
export type ShareLinkMode = "portable-short" | "compressed-hash" | "local-short";

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
	animationRenderer: AnimationRenderer;
	fontFamily: UiFontFamily;
	shareLinkMode: ShareLinkMode;
	alternativeResponseChance: number;
	userProfileImage: string | null;
	hiddenProviders: string[];
	recentModels: Array<{ key: string; timestamp: number }>;
	customModels: SavedModel[];
	imageGenerator: ImageGeneratorId;
	imageModel: string;
	imageSize: string;
	imageQuality: string;
	localImageBaseUrl: string;
}

export const DEFAULT_UI_SETTINGS: KeatingUiSettings = {
	showToolUi: false,
	autoOpenArtifacts: true,
	showRawErrors: false,
	googleGrounding: "auto",
	reasoningLevel: "medium",
	animationRenderer: "hyperframes",
	fontFamily: "jetbrains-mono",
	shareLinkMode: "portable-short",
	alternativeResponseChance: 0.05,
	userProfileImage: null,
	hiddenProviders: [],
	recentModels: [],
	customModels: [],
	imageGenerator: DEFAULT_IMAGE_GENERATOR_ID,
	imageModel: "",
	imageSize: "",
	imageQuality: "",
	localImageBaseUrl: "",
};

type FontStack = {
	sans: string;
	serif: string;
	mono: string;
};

const FONT_STACKS: Record<UiFontFamily, FontStack> = {
	roboto: {
		sans: '"Roboto", "Segoe UI", Arial, sans-serif',
		serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
		mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
	},
	"space-mono": {
		sans: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		serif: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		mono: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
	},
	"jetbrains-mono": {
		sans: '"JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		serif: '"JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		mono: '"JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
	},
};

const STORAGE_KEY = "keating_ui_settings";
const SETTINGS_CHANGED_EVENT = "keating:ui-settings-changed";

export const FONT_FAMILY_OPTIONS: Array<{
	value: UiFontFamily;
	label: string;
	description: string;
}> = [
	{
		value: "roboto",
		label: "Roboto",
		description: "Clean sans serif default for the app UI.",
	},
	{
		value: "space-mono",
		label: "Space Mono",
		description: "Retro monospace styling for the entire app.",
	},
	{
		value: "jetbrains-mono",
		label: "JetBrains Mono",
		description: "Terminal monospace matching the Keating brand reference.",
	},
];

export const SHARE_LINK_MODE_OPTIONS: Array<{
	value: ShareLinkMode;
	label: string;
	description: string;
}> = [
	{
		value: "portable-short",
		label: "Portable short",
		description: "Short links that work across browsers when share storage is available.",
	},
	{
		value: "compressed-hash",
		label: "Compressed snapshot",
		description: "Embeds the session snapshot in the URL for server-free sharing.",
	},
	{
		value: "local-short",
		label: "Local short",
		description: "Shortest links, available from this browser's cache only.",
	},
];

function normalizeShareLinkMode(value: unknown): ShareLinkMode {
	return value === "compressed-hash" || value === "local-short" || value === "portable-short"
		? value
		: DEFAULT_UI_SETTINGS.shareLinkMode;
}

function normalizeAlternativeResponseChance(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return DEFAULT_UI_SETTINGS.alternativeResponseChance;
	return Math.max(0, Math.min(1, numeric));
}

function normalizeSettings(value: Partial<KeatingUiSettings> | null): KeatingUiSettings {
	return {
		showToolUi: value?.showToolUi ?? DEFAULT_UI_SETTINGS.showToolUi,
		autoOpenArtifacts: value?.autoOpenArtifacts ?? DEFAULT_UI_SETTINGS.autoOpenArtifacts,
		showRawErrors: value?.showRawErrors ?? DEFAULT_UI_SETTINGS.showRawErrors,
		googleGrounding: value?.googleGrounding === "off" ? "off" : DEFAULT_UI_SETTINGS.googleGrounding,
		reasoningLevel: value?.reasoningLevel ?? DEFAULT_UI_SETTINGS.reasoningLevel,
		animationRenderer: value?.animationRenderer === "hyperframes" ? "hyperframes" : DEFAULT_UI_SETTINGS.animationRenderer,
		fontFamily:
			value?.fontFamily === "space-mono" || value?.fontFamily === "roboto" || value?.fontFamily === "jetbrains-mono"
				? value.fontFamily
				: DEFAULT_UI_SETTINGS.fontFamily,
		shareLinkMode: normalizeShareLinkMode(value?.shareLinkMode),
		alternativeResponseChance: normalizeAlternativeResponseChance(value?.alternativeResponseChance),
		userProfileImage: typeof value?.userProfileImage === "string" && value.userProfileImage.startsWith("data:image/") ? value.userProfileImage : DEFAULT_UI_SETTINGS.userProfileImage,
		hiddenProviders: Array.isArray(value?.hiddenProviders) ? value.hiddenProviders : DEFAULT_UI_SETTINGS.hiddenProviders,
		recentModels: Array.isArray(value?.recentModels) ? value.recentModels : DEFAULT_UI_SETTINGS.recentModels,
		customModels: Array.isArray(value?.customModels) ? value.customModels : DEFAULT_UI_SETTINGS.customModels,
		imageGenerator: isImageGeneratorId(value?.imageGenerator) ? value.imageGenerator : DEFAULT_UI_SETTINGS.imageGenerator,
		imageModel: typeof value?.imageModel === "string" ? value.imageModel : DEFAULT_UI_SETTINGS.imageModel,
		imageSize: typeof value?.imageSize === "string" ? value.imageSize : DEFAULT_UI_SETTINGS.imageSize,
		imageQuality: typeof value?.imageQuality === "string" ? value.imageQuality : DEFAULT_UI_SETTINGS.imageQuality,
		localImageBaseUrl: typeof value?.localImageBaseUrl === "string" ? value.localImageBaseUrl : DEFAULT_UI_SETTINGS.localImageBaseUrl,
	};
}

export function applyKeatingUiTypography(fontFamily: UiFontFamily) {
	if (typeof document === "undefined") return;
	const stacks = FONT_STACKS[fontFamily] ?? FONT_STACKS.roboto;
	const root = document.documentElement;
	root.style.setProperty("--font-sans", stacks.sans);
	root.style.setProperty("--font-serif", stacks.serif);
	root.style.setProperty("--font-mono", stacks.mono);
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
