import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const originalFetch = globalThis.fetch;
const originalEnabled = process.env.VITE_NOTORGANIC_ENABLED;

describe("Not Organic access prompt behavior", () => {
	beforeEach(() => {
		process.env.VITE_NOTORGANIC_ENABLED = "true";
		if (typeof (globalThis as { window?: unknown }).window === "undefined") {
			(globalThis as { window?: unknown }).window = globalThis;
		}
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		if (originalEnabled === undefined) {
			delete process.env.VITE_NOTORGANIC_ENABLED;
		} else {
			process.env.VITE_NOTORGANIC_ENABLED = originalEnabled;
		}
		const { closeNotOrganicPrompt, getActiveNotOrganicPrompt } = await import(
			"../components/NotOrganicAccessPromptDialog"
		);
		if (getActiveNotOrganicPrompt()) closeNotOrganicPrompt(false);
	});

	it("accepts an already validated product session without opening a dialog", async () => {
		globalThis.fetch = (async () => Response.json({ id: "account_1" })) as unknown as typeof fetch;
		const { getActiveNotOrganicPrompt, promptNotOrganicAccess } = await import(
			"../components/NotOrganicAccessPromptDialog"
		);

		expect(await promptNotOrganicAccess()).toBe(true);
		expect(getActiveNotOrganicPrompt()).toBeNull();
	});

	it("opens the hosted-access dialog when the product session is unavailable", async () => {
		globalThis.fetch = (async () => Response.json(
			{ error: { message: "Sign in required" } },
			{ status: 503 },
		)) as unknown as typeof fetch;
		const {
			closeNotOrganicPrompt,
			getActiveNotOrganicPrompt,
			promptNotOrganicAccess,
		} = await import("../components/NotOrganicAccessPromptDialog");

		const result = promptNotOrganicAccess();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(getActiveNotOrganicPrompt()).not.toBeNull();
		closeNotOrganicPrompt(false);
		expect(await result).toBe(false);
	});

	it("routes the generic provider prompt to Not Organic", async () => {
		const { promptKeatingApiKey } = await import("../components/KeatingApiKeyPromptDialog");
		const { closeNotOrganicPrompt, getActiveNotOrganicPrompt } = await import(
			"../components/NotOrganicAccessPromptDialog"
		);

		const result = promptKeatingApiKey("notorganic", { force: true });
		await Promise.resolve();
		expect(getActiveNotOrganicPrompt()).not.toBeNull();
		closeNotOrganicPrompt(false);
		expect(await result).toBe(false);
	});
});
