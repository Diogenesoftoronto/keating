import { describe, expect, it } from "bun:test";
import type { KeatingPortableSession } from "../keating/portable-data";
import {
	chatSyncStateEqual,
	emptyChatSyncState,
	mergeChatSyncStates,
	parseChatSyncState,
	updateChatSyncState,
} from "../keating/sync/chat-sync-state";

function session(id: string, texts = ["Teach me calculus"], title = id): KeatingPortableSession {
	const at = "2026-11-06T00:00:00.000Z";
	return {
		data: { id, title, createdAt: at, lastModified: at, thinkingLevel: "off",
			model: { id: "balanced", name: "Balanced", api: "openai-completions", provider: "notorganic", baseUrl: "https://api.notorganic.info/v1",
				reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4_096 },
			messages: texts.map((text, index) => ({ role: "user", content: text, timestamp: index })) },
		metadata: { id, title, createdAt: at, lastModified: at, thinkingLevel: "off", messageCount: texts.length, preview: texts.join("\n"),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
	};
}

describe("account chat reconciliation", () => {
	it("restores onto an empty device and preserves different chats on two devices", () => {
		const first = updateChatSyncState(emptyChatSyncState(), [session("one")], "device-a", []);
		const second = updateChatSyncState(emptyChatSyncState(), [session("two")], "device-b", []);
		expect(mergeChatSyncStates(emptyChatSyncState(), first)).toEqual(first);
		const merged = mergeChatSyncStates(first, second);
		expect(merged.entries.map(entry => entry.id)).toEqual(["one", "two"]);
		expect(chatSyncStateEqual(merged, mergeChatSyncStates(second, first))).toBe(true);
		expect(mergeChatSyncStates(merged, merged)).toEqual(merged);
	});

	it("does not infer deletion of a remote chat not yet materialized locally", () => {
		const remote = updateChatSyncState(emptyChatSyncState(), [session("remote")], "device-a", []);
		expect(updateChatSyncState(remote, [], "device-b", [])).toEqual(remote);
	});

	it("propagates explicit local deletion and does not resurrect it from stale devices", () => {
		const original = session("one");
		const state = updateChatSyncState(emptyChatSyncState(), [original], "device-a", []);
		const deleted = updateChatSyncState(state, [], "device-a", [original]);
		expect(deleted.entries[0]?.session).toBeNull();
		expect(mergeChatSyncStates(deleted, state)).toEqual(deleted);
		expect(updateChatSyncState(deleted, [original], "device-b", [original])).toEqual(deleted);
	});

	it("does not manufacture updates after JSON serialization or model credential removal", () => {
		const local = session("one");
		Object.assign(local.data.model, { headers: { authorization: "Bearer secret" }, apiKey: "secret" });
		const state = updateChatSyncState(emptyChatSyncState(), [local], "device-a", []);
		expect(JSON.stringify(state)).not.toContain("secret");
		expect(updateChatSyncState(state, [local], "device-a", JSON.parse(JSON.stringify([local])))).toEqual(state);
	});

	it("keeps a continuation as a single chat", () => {
		const base = session("one", ["hello"]);
		const state = updateChatSyncState(emptyChatSyncState(), [base], "device-a", []);
		const continuation = updateChatSyncState(state, [session("one", ["hello", "continue"])], "device-b", [base]);
		const merged = mergeChatSyncStates(state, continuation);
		expect(merged.entries).toHaveLength(1);
		expect(merged.entries[0]?.session?.data.messages).toHaveLength(2);
	});

	it("preserves both concurrently divergent transcripts as a deterministic visible fork", () => {
		const base = session("one", ["hello"]);
		const start = updateChatSyncState(emptyChatSyncState(), [base], "device-a", []);
		const first = updateChatSyncState(start, [session("one", ["hello", "algebra"])], "device-a", [base]);
		const second = updateChatSyncState(start, [session("one", ["hello", "calculus"])], "device-b", [base]);
		const merged = mergeChatSyncStates(first, second);
		expect(merged.entries).toHaveLength(2);
		expect(mergeChatSyncStates(second, first)).toEqual(merged);
		expect(mergeChatSyncStates(merged, first)).toEqual(merged);
		expect(merged.entries[1]?.session?.data.parentSessionId).toBe("one");
		expect(merged.entries[1]?.session?.metadata.hiddenAlternative).toBe(false);
		const endings = merged.entries.map(entry => (entry.session?.data.messages.at(-1) as { content?: unknown } | undefined)?.content);
		expect(endings).toContain("algebra");
		expect(endings).toContain("calculus");
	});

	it("retains a deleted conflict fork when a stale branch is seen again", () => {
		const base = session("one", ["hello"]);
		const start = updateChatSyncState(emptyChatSyncState(), [base], "device-a", []);
		const first = updateChatSyncState(start, [session("one", ["hello", "algebra"])], "device-a", [base]);
		const second = updateChatSyncState(start, [session("one", ["hello", "calculus"])], "device-b", [base]);
		const merged = mergeChatSyncStates(first, second);
		const materialized = merged.entries.map(entry => entry.session!);
		const deleted = updateChatSyncState(merged, [materialized[0]!], "device-b", materialized);
		expect(mergeChatSyncStates(deleted, first)).toEqual(deleted);
	});

	it("rejects duplicate IDs, mismatched session identity, and malformed logical versions", () => {
		const state = updateChatSyncState(emptyChatSyncState(), [session("one")], "device-a", []);
		expect(() => parseChatSyncState({ ...state, entries: [...state.entries, ...state.entries] })).toThrow("Invalid chat sync entry");
		expect(() => parseChatSyncState({ ...state, entries: [{ ...state.entries[0], version: Number.MAX_SAFE_INTEGER + 1 }] })).toThrow();
		const mismatched = structuredClone(state);
		mismatched.entries[0]!.session!.data.id = "someone-else";
		expect(() => parseChatSyncState(mismatched)).toThrow("Invalid synced conversation");
	});
});
