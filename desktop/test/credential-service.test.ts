import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialVault, CredentialEncryptionUnavailableError, MAX_CREDENTIAL_VALUE_BYTES } from "../src/credential-vault.js";
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

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function sessionHarness() {
	const directory = await mkdtemp(join(tmpdir(), "keating-session-credentials-"));
	directories.push(directory);
	const path = join(directory, "credentials.json");
	const state = { available: false, failDecrypt: false, failEncrypt: false, failDelete: false };
	const legacy = new Map<string, unknown>();
	const backend: LegacyProviderKeyBackend = {
		async get(_store, id) { return legacy.get(id) ?? null; },
		async delete(_store, id) { if (state.failDelete) throw new Error("legacy delete failed"); legacy.delete(id); },
		async keys() { return [...legacy.keys()]; },
		async clear() { if (state.failDelete) throw new Error("legacy clear failed"); legacy.clear(); },
	};
	const vault = new CredentialVault({ path, codec: {
		isEncryptionAvailable: () => state.available,
		encryptString(value) { if (state.failEncrypt) throw new Error("native encrypt failed"); return Buffer.from(value).map(byte => byte ^ 77); },
		decryptString(value) { if (state.failDecrypt) throw new Error("native decrypt failed"); return Buffer.from(value).map(byte => byte ^ 77).toString(); },
	} });
	return { directory, path, state, legacy, vault, backend, service: new DesktopCredentialService(vault, backend) };
}

describe("session-only desktop credentials", () => {
	test("new sign-ins work without a keyring and never write plaintext to disk or legacy storage", async () => {
		const h = await sessionHarness();
		expect(await h.service.get("oauth:anthropic")).toBeNull();
		expect(await h.service.status()).toEqual({ persistence: "session" });
		await h.service.set("oauth:anthropic", "fresh-claude-token");
		expect(await h.service.get("oauth:anthropic")).toBe("fresh-claude-token");
		expect(await h.service.has("oauth:anthropic")).toBe(true);
		expect(await h.service.keys()).toEqual(["oauth:anthropic"]);
		expect(await readdir(h.directory)).toEqual([]);
		expect(h.legacy.size).toBe(0);
		const restarted = new DesktopCredentialService(h.vault, h.backend);
		expect(await restarted.get("oauth:anthropic")).toBeNull();
	});

	test("preserves legacy values until session credentials are encrypted after recovery", async () => {
		const h = await sessionHarness();
		h.legacy.set("oauth:anthropic", "old-token");
		expect(await h.service.get("oauth:anthropic")).toBe("old-token");
		await h.service.set("oauth:anthropic", "refreshed-token");
		expect(h.legacy.get("oauth:anthropic")).toBe("old-token");
		expect(await readdir(h.directory)).toEqual([]);
		h.state.available = true;
		expect(await h.service.status()).toEqual({ persistence: "encrypted" });
		expect(h.legacy.has("oauth:anthropic")).toBe(false);
		const disk = await readFile(h.path, "utf8");
		expect(disk).not.toContain("refreshed-token");
		expect(disk).not.toContain("old-token");
		expect(await new DesktopCredentialService(h.vault, h.backend).get("oauth:anthropic")).toBe("refreshed-token");
	});

	test("locked encrypted credentials can be replaced for the session and durably deleted", async () => {
		const h = await sessionHarness();
		h.state.available = true;
		await h.service.set("oauth:anthropic", "durable-old");
		const before = await readFile(h.path, "utf8");
		h.state.available = false;
		expect(await h.service.get("oauth:anthropic")).toBeNull();
		await h.service.set("oauth:anthropic", "session-new");
		expect(await readFile(h.path, "utf8")).toBe(before);
		await h.service.delete("oauth:anthropic");
		expect(await h.service.get("oauth:anthropic")).toBeNull();
		h.state.available = true;
		expect(await new DesktopCredentialService(h.vault, h.backend).get("oauth:anthropic")).toBeNull();
	});

	test("corruption, unsafe filesystem state and decryption failures are never hidden by fallback", async () => {
		const h = await sessionHarness();
		await h.service.set("openai", "session-token");
		await writeFile(h.path, "corrupt", { mode: 0o600 });
		await expect(h.service.get("openai")).rejects.toThrow("corrupt");
		await expect(h.service.set("anthropic", "other-token")).rejects.toThrow("corrupt");
		await expect(h.service.status()).rejects.toThrow("corrupt");
		await expect(h.service.delete("openai")).rejects.toThrow("corrupt");
		await expect(h.service.clear()).rejects.toThrow("corrupt");
		expect(await readFile(h.path, "utf8")).toBe("corrupt");
		await rm(h.path);
		await mkdir(h.path);
		await expect(h.service.set("anthropic", "other-token")).rejects.toThrow("unsafe");
		await rm(h.path, { recursive: true });
		h.state.available = true;
		await h.service.status();
		h.state.failDecrypt = true;
		await expect(h.service.get("openai")).rejects.toThrow("decrypted");
		h.state.failEncrypt = true;
		await expect(h.service.set("new", "value")).rejects.toThrow("encrypt");
	});

	test("failed durable deletions reject and retain session state until an explicit retry succeeds", async () => {
		const h = await sessionHarness();
		await h.service.set("oauth:anthropic", "session-token");
		h.legacy.set("oauth:anthropic", "legacy-token");
		h.state.failDelete = true;
		await expect(h.service.delete("oauth:anthropic")).rejects.toThrow("legacy delete failed");
		expect(await h.service.get("oauth:anthropic")).toBe("session-token");
		await expect(h.service.clear()).rejects.toThrow("legacy clear failed");
		h.state.failDelete = false;
		await h.service.clear();
		expect(await h.service.keys()).toEqual([]);
		expect(h.legacy.size).toBe(0);
	});

	test("validates ids and values and serializes session mutations", async () => {
		const h = await sessionHarness();
		await expect(h.vault.set("openai", "test")).rejects.toBeInstanceOf(CredentialEncryptionUnavailableError);
		await expect(h.service.set("../outside", "token")).rejects.toThrow("id is invalid");
		await expect(h.service.set("openai", "x".repeat(MAX_CREDENTIAL_VALUE_BYTES + 1))).rejects.toThrow("value is invalid");
		await Promise.all(Array.from({ length: 12 }, (_, index) => h.service.set(`provider.${index}`, `value-${index}`)));
		expect(await h.service.keys()).toHaveLength(12);
		await Promise.all([h.service.set("openai", "first"), h.service.delete("openai"), h.service.set("openai", "last")]);
		expect(await h.service.get("openai")).toBe("last");
		expect(await readdir(h.directory)).toEqual([]);
	});

	test("caps total session credential bytes without dropping accepted values", async () => {
		const h = await sessionHarness();
		const value = "x".repeat(MAX_CREDENTIAL_VALUE_BYTES);
		for (let index = 0; index < 7; index++) await h.service.set(`provider.${index}`, value);
		await expect(h.service.set("provider.7", value)).rejects.toThrow("Session credential storage is too large");
		expect(await h.service.keys()).toHaveLength(7);
		expect(await h.service.get("provider.0")).toBe(value);
		expect(await readdir(h.directory)).toEqual([]);
	});
});
