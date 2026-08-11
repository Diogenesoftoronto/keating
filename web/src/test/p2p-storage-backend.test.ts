import { describe, expect, test } from "bun:test";
import {
	P2PStorageBackend,
	type KeatingCredentialBridge,
	type KeatingP2PBridge,
} from "../lib/p2p-storage-backend";

function harness(withCredentials = true) {
	const p2pCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
	const secrets = new Map<string, string>();
	const p2p: KeatingP2PBridge = {
		async call(method, params) {
			p2pCalls.push({ method, params });
			if (method === "get") return "p2p-value" as never;
			if (method === "keys") return ["p2p-key"] as never;
			if (method === "has") return true as never;
			return undefined as never;
		},
		onPeerStats: () => () => {},
	};
	const credentials: KeatingCredentialBridge | undefined = withCredentials ? {
		async get(id) { return secrets.get(id) ?? null; },
		async set(id, value) { secrets.set(id, value); },
		async delete(id) { secrets.delete(id); },
		async keys() { return [...secrets.keys()].sort(); },
		async has(id) { return secrets.has(id); },
		async clear() { secrets.clear(); },
	} : undefined;
	return { backend: new P2PStorageBackend(p2p, credentials), p2pCalls, secrets };
}

describe("desktop hybrid storage boundary", () => {
	test("routes all provider and OAuth credentials away from replicated P2P storage", async () => {
		const h = harness();
		await h.backend.set("provider-keys", "openai", "sk-secret");
		await h.backend.set("provider-keys", "oauth:anthropic", "oauth-secret");
		expect(await h.backend.get<string>("provider-keys", "openai")).toBe("sk-secret");
		expect(await h.backend.has("provider-keys", "oauth:anthropic")).toBe(true);
		expect(await h.backend.keys("provider-keys", "oauth:")).toEqual(["oauth:anthropic"]);
		await h.backend.delete("provider-keys", "openai");
		expect(h.secrets.has("openai")).toBe(false);
		await h.backend.clear("provider-keys");
		expect(h.secrets.size).toBe(0);
		expect(h.p2pCalls).toEqual([]);
	});

	test("continues routing learner data through the P2P backend", async () => {
		const h = harness();
		expect(await h.backend.get<string>("sessions", "lesson-1")).toBe("p2p-value");
		await h.backend.set("settings", "theme", "dark");
		expect(h.p2pCalls).toEqual([
			{ method: "get", params: { storeName: "sessions", key: "lesson-1" } },
			{ method: "set", params: { storeName: "settings", key: "theme", value: "dark" } },
		]);
	});

	test("fails closed instead of falling back to P2P when the secure bridge is missing", async () => {
		const h = harness(false);
		expect(() => h.backend.set("provider-keys", "openai", "must-not-leak")).toThrow("unavailable");
		expect(h.p2pCalls).toEqual([]);
	});

	test("rejects provider-key writes through the generic transaction path", async () => {
		const h = harness();
		await expect(h.backend.transaction(["provider-keys"], "readwrite", async (tx) => {
			await tx.set("provider-keys", "openai", "must-not-bypass");
		})).rejects.toThrow("provider settings store");
		expect(h.p2pCalls).toEqual([]);
		expect(h.secrets.size).toBe(0);
	});
});
