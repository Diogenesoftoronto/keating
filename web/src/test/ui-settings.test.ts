import { describe, expect, it, beforeEach } from "bun:test";
import {
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	subscribeKeatingUiSettings,
	DEFAULT_UI_SETTINGS,
	type KeatingUiSettings,
} from "../keating/ui-settings";

const LEGACY_GOOGLE_GROUNDING_KEY = "google" + "Grounding";

function createMockStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
	} as unknown as Storage;
}

const mockStorage = createMockStorage();
(globalThis as any).localStorage = mockStorage;

// Minimal window mock for dispatchEvent and addEventListener used by ui-settings
const eventListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
(globalThis as any).window = {
	dispatchEvent: (event: Event) => {
		const listeners = eventListeners.get(event.type);
		if (listeners) {
			for (const listener of listeners) {
				if (typeof listener === "function") listener(event);
				else listener.handleEvent(event);
			}
		}
		return true;
	},
	addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
		if (!eventListeners.has(type)) eventListeners.set(type, new Set());
		eventListeners.get(type)!.add(listener);
	},
	removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
		eventListeners.get(type)?.delete(listener);
	},
};

describe("Keating UI Settings", () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	describe("loadKeatingUiSettings", () => {
		it("returns defaults when localStorage is empty", () => {
			const settings = loadKeatingUiSettings();
			expect(settings.showToolUi).toBe(DEFAULT_UI_SETTINGS.showToolUi);
			expect(settings.fontFamily).toBe(DEFAULT_UI_SETTINGS.fontFamily);
			expect(settings.shareLinkMode).toBe("portable-short");
			expect(settings.animationRenderer).toBe("hyperframes");
			expect(settings.alternativeResponseChance).toBe(0.05);
			expect(settings.webSearch).toBe("auto");
		});

		it("returns defaults when localStorage has invalid JSON", () => {
			localStorage.setItem("keating_ui_settings", "not json");
			const settings = loadKeatingUiSettings();
			expect(settings.reasoningLevel).toBe(DEFAULT_UI_SETTINGS.reasoningLevel);
		});

		it("merges partial stored settings with defaults", () => {
			localStorage.setItem(
				"keating_ui_settings",
				JSON.stringify({ reasoningLevel: "high", fontFamily: "space-mono", shareLinkMode: "compressed-hash" }),
			);
			const settings = loadKeatingUiSettings();
			expect(settings.reasoningLevel).toBe("high");
			expect(settings.fontFamily).toBe("space-mono");
			expect(settings.shareLinkMode).toBe("compressed-hash");
			expect(settings.showToolUi).toBe(DEFAULT_UI_SETTINGS.showToolUi);
		});

		it("disables provider web search only when explicitly off", () => {
			localStorage.setItem("keating_ui_settings", JSON.stringify({ webSearch: "off" }));
			expect(loadKeatingUiSettings().webSearch).toBe("off");
			localStorage.setItem("keating_ui_settings", JSON.stringify({ webSearch: "garbage" }));
			expect(loadKeatingUiSettings().webSearch).toBe("auto");
		});

		it("migrates the legacy grounding key to webSearch off when webSearch is missing", () => {
			localStorage.setItem("keating_ui_settings", JSON.stringify({ [LEGACY_GOOGLE_GROUNDING_KEY]: "off" }));
			expect(loadKeatingUiSettings().webSearch).toBe("off");
		});

		it("keeps explicit webSearch when the legacy grounding key disagrees", () => {
			localStorage.setItem("keating_ui_settings", JSON.stringify({ [LEGACY_GOOGLE_GROUNDING_KEY]: "off", webSearch: "auto" }));
			expect(loadKeatingUiSettings().webSearch).toBe("auto");
		});

		it("clamps alternative response chance to a probability", () => {
			localStorage.setItem("keating_ui_settings", JSON.stringify({ alternativeResponseChance: 2 }));
			expect(loadKeatingUiSettings().alternativeResponseChance).toBe(1);
			localStorage.setItem("keating_ui_settings", JSON.stringify({ alternativeResponseChance: -1 }));
			expect(loadKeatingUiSettings().alternativeResponseChance).toBe(0);
		});

		it("loads Hyperframes as an optional animation renderer", () => {
			localStorage.setItem("keating_ui_settings", JSON.stringify({ animationRenderer: "hyperframes" }));
			const settings = loadKeatingUiSettings();
			expect(settings.animationRenderer).toBe("hyperframes");
		});

		it("rejects invalid share link modes", () => {
			localStorage.setItem("keating_ui_settings", JSON.stringify({ shareLinkMode: "tiny-magic" }));
			const settings = loadKeatingUiSettings();
			expect(settings.shareLinkMode).toBe("portable-short");
		});
	});

	describe("saveKeatingUiSettings", () => {
		it("persists settings to localStorage", () => {
			const settings = { ...DEFAULT_UI_SETTINGS, showToolUi: true, fontFamily: "space-mono" as const, shareLinkMode: "local-short" as const };
			saveKeatingUiSettings(settings);
			const stored = JSON.parse(localStorage.getItem("keating_ui_settings")!);
			expect(stored.showToolUi).toBe(true);
			expect(stored.fontFamily).toBe("space-mono");
			expect(stored.shareLinkMode).toBe("local-short");
			expect(LEGACY_GOOGLE_GROUNDING_KEY in stored).toBe(false);
		});

		it("notifies subscribers when settings change", () => {
			const seen: KeatingUiSettings[] = [];
			const unsubscribe = subscribeKeatingUiSettings((settings) => {
				seen.push(settings);
			});
			saveKeatingUiSettings({ ...DEFAULT_UI_SETTINGS, fontFamily: "space-mono" });
			unsubscribe();
			expect(seen.at(-1)?.fontFamily).toBe("space-mono");
		});
	});
});
