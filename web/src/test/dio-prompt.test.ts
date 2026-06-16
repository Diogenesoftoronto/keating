import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

const keys = new Map<string, string>();

function createMockStorage() {
	return {
		providerKeys: {
			get: async (name: string) => keys.get(name),
			set: async (name: string, value: string) => keys.set(name, value),
			delete: async (name: string) => keys.delete(name),
		},
	};
}

mock.module("@earendil-works/pi-web-ui", () => ({
	getAppStorage: createMockStorage,
}));

describe("dio access prompt behavior", () => {
	let originalViteEnabled: string | undefined;

	beforeEach(() => {
		keys.clear();
		originalViteEnabled = process.env.VITE_DIO_ENABLED;
		process.env.VITE_DIO_ENABLED = "true";
		if (typeof (globalThis as any).window === "undefined") {
			(globalThis as any).window = globalThis;
		}
	});

	afterEach(async () => {
		process.env.VITE_DIO_ENABLED = originalViteEnabled;
		const { getActiveDioPrompt, closeDioPrompt } = await import("../components/DioAccessPromptDialog");
		const active = getActiveDioPrompt();
		if (active) closeDioPrompt(false);
	});

	it("promptDioAccess resolves true when a dio key already exists", async () => {
		keys.set("dio", "existing-key");
		const { promptDioAccess, getActiveDioPrompt } = await import("../components/DioAccessPromptDialog");
		const result = await promptDioAccess();
		expect(result).toBe(true);
		expect(getActiveDioPrompt()).toBeNull();
	});

	it("promptDioAccess opens a purchase dialog when no key exists", async () => {
		const { promptDioAccess, getActiveDioPrompt, closeDioPrompt } = await import(
			"../components/DioAccessPromptDialog"
		);
		const promise = promptDioAccess();
		await Promise.resolve();
		expect(getActiveDioPrompt()).not.toBeNull();
		closeDioPrompt(false);
		expect(await promise).toBe(false);
	});

	it("successful manual key paste saves the provider key and resolves the prompt", async () => {
		const { promptDioAccess, getActiveDioPrompt, closeDioPrompt } = await import(
			"../components/DioAccessPromptDialog"
		);
		const promise = promptDioAccess();
		await Promise.resolve();
		expect(getActiveDioPrompt()).not.toBeNull();
		await createMockStorage().providerKeys.set("dio", "manual-key");
		closeDioPrompt(true);
		expect(await promise).toBe(true);
		expect(keys.get("dio")).toBe("manual-key");
	});

	it("promptKeatingApiKey routes dio provider to the dio prompt", async () => {
		const { promptKeatingApiKey } = await import("../components/KeatingApiKeyPromptDialog");
		const { getActiveDioPrompt, closeDioPrompt } = await import("../components/DioAccessPromptDialog");
		const promise = promptKeatingApiKey("dio");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getActiveDioPrompt()).not.toBeNull();
		closeDioPrompt(false);
		expect(await promise).toBe(false);
	});
});
