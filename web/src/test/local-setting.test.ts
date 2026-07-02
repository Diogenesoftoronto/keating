import { beforeEach, describe, expect, it } from "bun:test";
import { createLocalSetting } from "../keating/local-setting";

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

describe("createLocalSetting", () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	it("loads defaults when storage is missing or corrupt", () => {
		const setting = createLocalSetting({
			key: "test-setting",
			event: "test-setting-changed",
			normalize: (raw) => {
				if (typeof raw !== "string") return { enabled: false };
				try {
					return JSON.parse(raw) as { enabled: boolean };
				} catch {
					return { enabled: false };
				}
			},
		});
		expect(setting.load()).toEqual({ enabled: false });
		localStorage.setItem("test-setting", "not json");
		expect(setting.load()).toEqual({ enabled: false });
	});

	it("saves and notifies subscribers", () => {
		const setting = createLocalSetting({
			key: "test-setting",
			event: "test-setting-changed",
			normalize: (raw) => {
				if (typeof raw === "string") {
					try {
						return JSON.parse(raw) as { enabled: boolean };
					} catch {
						return { enabled: false };
					}
				}
				return (raw as { enabled: boolean } | undefined) ?? { enabled: false };
			},
		});
		const seen: Array<{ enabled: boolean }> = [];
		const unsubscribe = setting.subscribe((value) => {
			seen.push(value);
		});
		setting.save({ enabled: true });
		unsubscribe();
		expect(seen.at(-1)).toEqual({ enabled: true });
	});

	it("stops notifying after unsubscribe", () => {
		const setting = createLocalSetting({
			key: "test-string",
			event: "test-string-changed",
			normalize: (raw) => (typeof raw === "string" && raw.length > 0 ? raw : "default"),
		});
		let count = 0;
		const unsubscribe = setting.subscribe(() => {
			count += 1;
		});
		unsubscribe();
		setting.save("next");
		expect(count).toBe(0);
	});
});
