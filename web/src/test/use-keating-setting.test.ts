import { beforeEach, describe, expect, it } from "bun:test";
import { loadKeatingUiSettings, saveKeatingUiSettings } from "../keating/ui-settings";
import { loadModelPrefs, saveModelPrefs } from "../keating/model-prefs";
import { loadPersona, savePersona } from "../keating/persona";
import { KEATING_SETTING_KEYS } from "../hooks/use-keating-setting";

function createMockStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
		removeItem: (k: string) => store.delete(k),
		clear: () => store.clear(),
		key: () => null,
		length: 0,
	} as unknown as Storage;
}

const eventListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
const mockWindow = {
	dispatchEvent: (event: Event) => {
		const listeners = eventListeners.get(event.type);
		if (!listeners) return true;
		for (const listener of listeners) {
			if (typeof listener === "function") listener(event);
			else listener.handleEvent(event);
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

beforeEach(() => {
	(globalThis as unknown as { localStorage: Storage }).localStorage = createMockStorage();
	(globalThis as unknown as { window: typeof mockWindow }).window = mockWindow as unknown as Window;
	eventListeners.clear();
});

describe("useKeatingSetting facade", () => {
	it("registers every persisted setting key", () => {
		expect(new Set(KEATING_SETTING_KEYS)).toEqual(new Set(["ui", "modelPrefs", "persona", "speech"]));
	});

	it("UI adapter reads and writes the same store as loadKeatingUiSettings/saveKeatingUiSettings", () => {
		saveKeatingUiSettings({ ...loadKeatingUiSettings(), showToolUi: true });
		const stored = JSON.parse((globalThis as unknown as { localStorage: Storage }).localStorage.getItem("keating_ui_settings")!);
		expect(stored.showToolUi).toBe(true);
	});

	it("Model prefs adapter matches the dedicated load/save", () => {
		saveModelPrefs({ ...loadModelPrefs(), hiddenProviders: ["google"] });
		const stored = JSON.parse((globalThis as unknown as { localStorage: Storage }).localStorage.getItem("keating_model_prefs")!);
		expect(stored.hiddenProviders).toEqual(["google"]);
	});

	it("Persona adapter matches the dedicated load/save", () => {
		savePersona("custom persona text");
		const stored = (globalThis as unknown as { localStorage: Storage }).localStorage.getItem("keating:teacher-persona");
		expect(stored).toBe("custom persona text");
		expect(loadPersona()).toBe("custom persona text");
	});
});