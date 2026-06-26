import { describe, expect, it, beforeEach } from "bun:test";
import {
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	addRecentModel,
	getRecentModels,
	addCustomModel,
	removeCustomModel,
	toggleProviderVisibility,
	DEFAULT_UI_SETTINGS,
} from "../keating/ui-settings";

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
			expect(settings.hiddenProviders).toEqual([]);
			expect(settings.recentModels).toEqual([]);
			expect(settings.customModels).toEqual([]);
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
				JSON.stringify({ reasoningLevel: "high", hiddenProviders: ["openai"], fontFamily: "space-mono", shareLinkMode: "compressed-hash" }),
			);
			const settings = loadKeatingUiSettings();
			expect(settings.reasoningLevel).toBe("high");
			expect(settings.hiddenProviders).toEqual(["openai"]);
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
		});
	});

	describe("toggleProviderVisibility", () => {
		it("adds provider to hidden list", () => {
			toggleProviderVisibility("openai", true);
			const settings = loadKeatingUiSettings();
			expect(settings.hiddenProviders).toContain("openai");
		});

		it("removes provider from hidden list", () => {
			toggleProviderVisibility("openai", true);
			toggleProviderVisibility("openai", false);
			const settings = loadKeatingUiSettings();
			expect(settings.hiddenProviders).not.toContain("openai");
		});

		it("prevents duplicate hidden providers", () => {
			toggleProviderVisibility("openai", true);
			toggleProviderVisibility("openai", true);
			const settings = loadKeatingUiSettings();
			expect(settings.hiddenProviders.filter((p) => p === "openai")).toHaveLength(1);
		});
	});

	describe("addRecentModel / getRecentModels", () => {
		it("adds a model to recent list", () => {
			addRecentModel("openai::openai-completions::gpt-4");
			const recent = getRecentModels();
			expect(recent).toHaveLength(1);
			expect(recent[0].key).toBe("openai::openai-completions::gpt-4");
		});

		it("moves existing model to front on re-add", () => {
			addRecentModel("a");
			addRecentModel("b");
			addRecentModel("a");
			const recent = getRecentModels();
			expect(recent[0].key).toBe("a");
			expect(recent).toHaveLength(2);
		});

		it("caps at 7 recent models", () => {
			for (let i = 0; i < 10; i++) {
				addRecentModel(`model-${i}`);
			}
			const recent = getRecentModels();
			expect(recent).toHaveLength(7);
		});

		it("returns models sorted by timestamp descending", () => {
			addRecentModel("a");
			addRecentModel("b");
			const recent = getRecentModels();
			expect(recent[0].key).toBe("b");
			expect(recent[1].key).toBe("a");
		});
	});

	describe("addCustomModel / removeCustomModel", () => {
		it("adds a custom model", () => {
			addCustomModel({
				key: "test::api::model",
				id: "model",
				name: "Test Model",
				provider: "test",
				api: "api",
				reasoning: false,
				vision: true,
			});
			const settings = loadKeatingUiSettings();
			expect(settings.customModels).toHaveLength(1);
			expect(settings.customModels[0].name).toBe("Test Model");
		});

		it("replaces model with same key", () => {
			addCustomModel({ key: "k", id: "a", name: "Old", provider: "p", api: "a", reasoning: false, vision: false });
			addCustomModel({ key: "k", id: "b", name: "New", provider: "p", api: "a", reasoning: false, vision: false });
			const settings = loadKeatingUiSettings();
			expect(settings.customModels).toHaveLength(1);
			expect(settings.customModels[0].name).toBe("New");
		});

		it("removes a custom model by key", () => {
			addCustomModel({ key: "k", id: "a", name: "Model", provider: "p", api: "a", reasoning: false, vision: false });
			removeCustomModel("k");
			const settings = loadKeatingUiSettings();
			expect(settings.customModels).toHaveLength(0);
		});
	});
});
