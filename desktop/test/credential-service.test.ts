import { describe, expect, test } from "bun:test";
import {
	DesktopCredentialService,
	PROVIDER_KEYS_STORE,
	type CredentialVaultLike,
	type LegacyProviderKeyBackend,
} from "../src/credential-service.js";

function harness(options: { failSecureSet?: boolean; invalidLegacy?: boolean } = {}) {
	const secured = new Map<string, string>();
	const legacy = new Map<string, unknown>();
	const events: string[] = [];
	const vault: CredentialVaultLike = {
		async get(id) { return secured.get(id) ?? null; },
		async set(id, value) {
			events.push(`secure:${id}`);
			if (options.failSecureSet) throw new Error("secure unavailable");
			secured.set(id, value);
		},
		async delete(id) { return secured.delete(id); },
		async keys() { return [...secured.keys()].sort(); },
		async has(id) { return secured.has(id); },
		async clear() { secured.clear(); },
	};
	const backend: LegacyProviderKeyBackend = {
		async get(storeName, key) {
			expect(storeName).toBe(PROVIDER_KEYS_STORE);
			return legacy.get(key) ?? null;
		},
		async delete(storeName, key) {
			expect(storeName).toBe(PROVIDER_KEYS_STORE);
			events.push(`delete-legacy:${key}`);
			legacy.delete(key);
		},
		async keys(storeName) {
			expect(storeName).toBe(PROVIDER_KEYS_STORE);
			return [...legacy.keys()];
		},
		async clear(storeName) {
			expect(storeName).toBe(PROVIDER_KEYS_STORE);
			legacy.clear();
		},
	};
	if (options.invalidLegacy) legacy.set("openai", { exposed: true });
	return { service: new DesktopCredentialService(vault, backend), secured, legacy, events };
}

describe("DesktopCredentialService", () => {
	test("keeps new credentials exclusively in the secure vault", async () => {
		const h = harness();
		await h.service.set("openai", "sk-secret");
		expect(h.secured.get("openai")).toBe("sk-secret");
		expect(h.legacy.has("openai")).toBe(false);
		expect(await h.service.get("openai")).toBe("sk-secret");
	});

	test("migrates legacy credentials only after secure persistence succeeds", async () => {
		const h = harness();
		h.legacy.set("oauth:anthropic", "legacy-token");
		expect(await h.service.get("oauth:anthropic")).toBe("legacy-token");
		expect(h.events).toEqual([
			"secure:oauth:anthropic",
			"delete-legacy:oauth:anthropic",
		]);
		expect(h.secured.get("oauth:anthropic")).toBe("legacy-token");
		expect(h.legacy.has("oauth:anthropic")).toBe(false);
	});

	test("preserves legacy work when secure storage is unavailable", async () => {
		const h = harness({ failSecureSet: true });
		h.legacy.set("openai", "legacy-secret");
		await expect(h.service.get("openai")).rejects.toThrow("secure unavailable");
		expect(h.legacy.get("openai")).toBe("legacy-secret");
		expect(h.events).toEqual(["secure:openai"]);
	});

	test("migrates listing and applies delete, has, and clear to both stores", async () => {
		const h = harness();
		h.legacy.set("openai", "one");
		h.legacy.set("oauth:anthropic", "two");
		expect(await h.service.keys()).toEqual(["oauth:anthropic", "openai"]);
		expect(await h.service.has("openai")).toBe(true);
		await h.service.delete("openai");
		expect(await h.service.has("openai")).toBe(false);
		await h.service.clear();
		expect(await h.service.keys()).toEqual([]);
	});

	test("refuses malformed legacy credential values without deleting them", async () => {
		const h = harness({ invalidLegacy: true });
		await expect(h.service.get("openai")).rejects.toThrow("invalid value");
		expect(h.legacy.get("openai")).toEqual({ exposed: true });
	});
});
