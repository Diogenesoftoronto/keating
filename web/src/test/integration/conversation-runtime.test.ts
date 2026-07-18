import { describe, expect, test } from "bun:test";
import { StorageConversationEventStore } from "../../keating/event-store";
import { authorizeVoiceToolCall, createConversationRuntime } from "../../keating/integration";

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

describe("conversation integration runtime", () => {
	test("persists canonical events and replays them without duplication", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		const runtime = createConversationRuntime({ sessionId: "s1", runId: "r1", store, id: (() => { let i = 0; return () => `id-${++i}`; })() });
		const event = runtime.emit("text.delta", { messageId: "m1", role: "assistant", delta: "hello" });
		expect(runtime.accept(event)).toBe(false);
		expect(runtime.replay().messages.m1?.text).toBe("hello");
	});

	test("retains pending UI actions until resolved", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		const runtime = createConversationRuntime({ sessionId: "s1", store });
		runtime.emit("ui.document.upserted", { document: { id: "d1", kind: "quiz", lifecycle: "resumable", revision: 3, content: {} } });
		runtime.emit("ui.action", { action: { id: "a1", documentId: "d1", documentRevision: 3, type: "submit", params: {} } });
		expect(runtime.pendingActions()).toHaveLength(1);
		expect(runtime.pendingActions()[0]).toMatchObject({ sessionId: "s1", action: { documentRevision: 3 } });
		expect(runtime.resolveAction("a1")).toBe(true);
		expect(runtime.pendingActions()).toHaveLength(0);
	});

	test("rejects malformed, cross-session, cross-run, stale, and duplicate events without consuming sequence", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		const runtime = createConversationRuntime({ sessionId: "s1", runId: "r1", store, id: (() => { let i = 0; return () => `local-${++i}`; })() });
		const base = {
			version: 1 as const, id: "external-1", sequence: 0, timestamp: "2026-07-18T12:00:00.000Z", sessionId: "s1", runId: "r1",
			type: "text.delta" as const, payload: { messageId: "m1", role: "assistant" as const, delta: "safe" },
		};
		expect(runtime.accept({ ...base, sessionId: "other" })).toBe(false);
		expect(runtime.accept({ ...base, runId: "other" })).toBe(false);
		expect(runtime.accept({ ...base, payload: { ...base.payload, delta: 42 } } as never)).toBe(false);
		expect(runtime.accept(base)).toBe(true);
		expect(runtime.accept({ ...base, id: "stale", sequence: 0 })).toBe(false);
		expect(runtime.accept({ ...base, sequence: 1 })).toBe(false);
		const emitted = runtime.emit("text.delta", { messageId: "m1", role: "assistant", delta: " next" });
		expect(emitted.sequence).toBe(1);
		expect(runtime.replay().messages.m1?.text).toBe("safe next");
	});

	test("rejects stale and duplicate UI actions without advancing sequence", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		const runtime = createConversationRuntime({ sessionId: "s1", runId: "r1", store, id: (() => { let i = 0; return () => `id-${++i}`; })() });
		runtime.emit("ui.document.upserted", { document: { id: "d1", kind: "quiz", lifecycle: "resumable", revision: 2, content: {} } });
		const envelope = (id: string, sequence: number, documentRevision: number) => ({
			version: 1 as const, id: `event-${id}`, sequence, timestamp: "2026-07-18T12:00:00.000Z", sessionId: "s1", runId: "r1",
			type: "ui.action" as const, payload: { action: { id, documentId: "d1", documentRevision, type: "submit", params: {} } },
		});
		expect(runtime.accept(envelope("stale", 1, 1))).toBe(false);
		const staleDocument = {
			version: 1 as const, id: "stale-document", sequence: 1, timestamp: "2026-07-18T12:00:00.000Z", sessionId: "s1", runId: "r1",
			type: "ui.document.upserted" as const,
			payload: { document: { id: "d1", kind: "quiz", lifecycle: "resumable" as const, revision: 1, content: {} } },
		};
		expect(runtime.accept(staleDocument)).toBe(false);
		expect(runtime.accept(envelope("a1", 1, 2))).toBe(true);
		expect(runtime.accept(envelope("a1", 2, 2))).toBe(false);
		const next = runtime.emit("text.delta", { messageId: "m1", role: "assistant", delta: "ok" });
		expect(next.sequence).toBe(2);
	});
});

describe("voice permissions", () => {
	test("allows informational tools and blocks confirmation-requiring tools", () => {
		expect(authorizeVoiceToolCall({ callId: "1", name: "quiz", arguments: {} }).allowed).toBe(true);
		expect(authorizeVoiceToolCall({ callId: "2", name: "set_learner_goal", arguments: { title: "Learn" } }).allowed).toBe(false);
		expect(authorizeVoiceToolCall({ callId: "3", name: "bash", arguments: { command: "env" } }).reason).not.toContain("env");
	});
});
