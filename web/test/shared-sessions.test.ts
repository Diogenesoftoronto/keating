import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SharedSession } from "../src/keating/shared-sessions";
import { loadSharedSessionFromUrl, sharedSessionUrl } from "../src/keating/shared-sessions";

function createMockStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	} as unknown as Storage;
}

function sharedSession(): SharedSession {
	const repeated = "Recursion reduces a problem into a smaller instance until a base case stops the chain. ".repeat(10);
	return {
		id: "share1234",
		schemaVersion: 2,
		title: "Recursion",
		createdAt: "2026-01-01T00:00:00.000Z",
		sharedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 2,
		model: { provider: "openai", id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses" },
		thinkingLevel: "medium",
		messages: [
			{ role: "user", content: [{ type: "text", text: "Explain recursion." }] },
			{
				role: "assistant",
				api: "openai-responses",
				provider: "openai",
				model: "gpt-5.5",
				responseId: "resp_metadata_should_not_be_encoded",
				usage: {
					input: 1200,
					output: 800,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2000,
					cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
				},
				stopReason: "stop",
				timestamp: 1_700_000_000_000,
				content: [{ type: "text", text: repeated }],
			},
		] as SharedSession["messages"],
	};
}

const originalCompressionStream = (globalThis as any).CompressionStream;

beforeEach(() => {
	(globalThis as any).localStorage = createMockStorage();
});

afterEach(() => {
	(globalThis as any).CompressionStream = originalCompressionStream;
});

describe("shared session URLs", () => {
	test("compressed-hash mode produces an actually compressed gz. URL without CompressionStream", async () => {
		(globalThis as any).CompressionStream = undefined;
		const session = sharedSession();

		const result = await sharedSessionUrl(session, "https://keating.help", "compressed-hash");
		const url = new URL(result.url);
		const encoded = new URLSearchParams(url.hash.slice(1)).get("session");

		expect(result.mode).toBe("compressed-hash");
		expect(result.fallback).toBe(false);
		expect(encoded?.startsWith("gz.")).toBe(true);
		expect(encoded?.startsWith("json.")).toBe(false);
		expect(result.url.length).toBeLessThan(JSON.stringify(session).length);
	});

	test("compressed share URLs load back into normalized shared sessions", async () => {
		const result = await sharedSessionUrl(sharedSession(), "https://keating.help", "compressed-hash");
		const url = new URL(result.url);
		const loaded = await loadSharedSessionFromUrl("share1234", url.hash);

		expect(loaded?.id).toBe("share1234");
		expect(loaded?.messages).toHaveLength(2);
		expect((loaded?.messages[1] as any).role).toBe("assistant");
		expect((loaded?.messages[1] as any).content[0].text).toContain("Recursion reduces");
		expect((loaded?.messages[1] as any).responseId).toBeUndefined();
		expect((loaded?.messages[1] as any).usage).toBeUndefined();
	});
});
