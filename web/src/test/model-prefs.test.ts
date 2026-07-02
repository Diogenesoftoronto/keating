import { beforeEach, describe, expect, it } from "bun:test";
import {
	addCustomModel,
	addRecentModel,
	DEFAULT_MODEL_PREFS,
	getRecentModels,
	loadModelPrefs,
	removeCustomModel,
	saveModelPrefs,
	subscribeModelPrefs,
	toggleProviderVisibility,
} from "../keating/model-prefs";

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

describe("model prefs", () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	it("returns defaults when storage is empty", () => {
		expect(loadModelPrefs()).toEqual(DEFAULT_MODEL_PREFS);
	});

	it("migrates legacy arrays from keating_ui_settings when keating_model_prefs is missing", () => {
		localStorage.setItem("keating_ui_settings", JSON.stringify({
			hiddenProviders: ["openai"],
			recentModels: [{ key: "a", timestamp: 1 }],
			customModels: [{ key: "k", id: "id", name: "Name", provider: "p", api: "a", reasoning: true, vision: false }],
		}));
		expect(loadModelPrefs()).toEqual({
			hiddenProviders: ["openai"],
			recentModels: [{ key: "a", timestamp: 1 }],
			customModels: [{ key: "k", id: "id", name: "Name", provider: "p", api: "a", reasoning: true, vision: false, baseUrl: undefined }],
		});
	});

	it("notifies subscribers when prefs change", () => {
		const seen: ReturnType<typeof loadModelPrefs>[] = [];
		const unsubscribe = subscribeModelPrefs((prefs) => {
			seen.push(prefs);
		});
		saveModelPrefs({ ...DEFAULT_MODEL_PREFS, hiddenProviders: ["google"] });
		unsubscribe();
		expect(seen.at(-1)?.hiddenProviders).toEqual(["google"]);
	});

	it("round-trips hidden providers", () => {
		toggleProviderVisibility("openai", true);
		toggleProviderVisibility("openai", false);
		expect(loadModelPrefs().hiddenProviders).toEqual([]);
	});

	it("round-trips recent models", () => {
		addRecentModel("openai::openai-completions::gpt-4");
		expect(getRecentModels()[0]?.key).toBe("openai::openai-completions::gpt-4");
	});

	it("round-trips custom models", () => {
		addCustomModel({
			key: "test::api::model",
			id: "model",
			name: "Test Model",
			provider: "test",
			api: "api",
			reasoning: false,
			vision: true,
		});
		expect(loadModelPrefs().customModels).toHaveLength(1);
		removeCustomModel("test::api::model");
		expect(loadModelPrefs().customModels).toHaveLength(0);
	});
});
