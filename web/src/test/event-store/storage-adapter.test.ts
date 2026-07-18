import { describe, expect, test } from "bun:test";
import { StorageConversationEventStore, type StorageLike } from "../../keating/event-store";
import { conversationEvent, replayConversation, type ConversationEvent } from "../../keating/protocol";

class MemoryStorage implements StorageLike {
	readonly values = new Map<string, string>();
	getItem(key: string) { return this.values.get(key) ?? null; }
	setItem(key: string, value: string) { this.values.set(key, value); }
	removeItem(key: string) { this.values.delete(key); }
}

function event(id: string, sequence: number, sessionId = "session-1"): ConversationEvent {
	return conversationEvent("text.delta", { messageId: "message-1", role: "assistant", delta: id }, {
		id,
		sequence,
		timestamp: `2026-07-18T00:00:0${sequence}.000Z`,
		sessionId,
		runId: "run-1",
	});
}

describe("StorageConversationEventStore", () => {
	test("keeps raw events in memory while persisting only a privacy-safe projection", () => {
		const storage = new MemoryStorage();
		const store = new StorageConversationEventStore(storage);
		const audio = conversationEvent("audio.delta", { streamId: "voice", role: "user", encoding: "pcm16", data: "RAW-PCM" }, {
			id: "audio", sequence: 1, timestamp: "2026-07-18T00:00:01.000Z", sessionId: "session-1", runId: "run-1",
		});
		const transcript = conversationEvent("transcript.delta", { transcriptId: "t1", role: "user", delta: "private speech", final: true }, {
			id: "transcript", sequence: 2, timestamp: "2026-07-18T00:00:02.000Z", sessionId: "session-1", runId: "run-1",
		});
		const tool = conversationEvent("tool.requested", { callId: "call", name: "web_search", arguments: { query: "secret", apiKey: "sk-abcdefghijklmnop" } }, {
			id: "tool", sequence: 3, timestamp: "2026-07-18T00:00:03.000Z", sessionId: "session-1", runId: "run-1",
		});

		expect(audio.payload.data).toBe("RAW-PCM");
		expect(store.append(audio).appended).toBe(false);
		expect(store.append(transcript).appended).toBe(false);
		expect(store.append(tool).appended).toBe(true);
		expect(store.replay("session-1").events).toEqual([{ ...tool, payload: { ...tool.payload, arguments: {} } }]);
		expect([...storage.values.values()].join(" ")).not.toContain("RAW-PCM");
		expect([...storage.values.values()].join(" ")).not.toContain("sk-abcdefghijklmnop");
	});

	test("persists transcripts only after explicit opt-in and redacts secret values", () => {
		const store = new StorageConversationEventStore(new MemoryStorage(), { durable: { persistTranscripts: true } });
		const transcript = conversationEvent("transcript.delta", { transcriptId: "t1", role: "user", delta: "use sk-abcdefghijklmnop", final: true }, {
			id: "transcript", sequence: 1, timestamp: "2026-07-18T00:00:01.000Z", sessionId: "session-1", runId: "run-1",
		});
		expect(store.append(transcript).appended).toBe(true);
		expect(store.replay("session-1").events[0]?.payload).toMatchObject({ delta: "use [REDACTED]" });
	});

	test("rejects malformed event payloads without writing durable state", () => {
		const storage = new MemoryStorage();
		const diagnostics: string[] = [];
		const store = new StorageConversationEventStore(storage, { onDiagnostic: ({ code }) => diagnostics.push(code) });
		const malformed = { ...event("bad", 1), type: "tool.completed", payload: { callId: 42, result: undefined } } as unknown as ConversationEvent;
		expect(store.append(malformed)).toEqual({ appended: false, eventCount: 0 });
		expect(storage.values.size).toBe(0);
		expect(diagnostics).toEqual(["invalid-event"]);
	});

	test("filters malformed stored events and pending actions", () => {
		const storage = new MemoryStorage();
		storage.setItem("test:session:session-1", JSON.stringify({
			format: 1,
			events: [event("valid", 1), { ...event("invalid", 2), payload: { role: "root" } }],
			pendingActions: [
				{ sessionId: "session-1", runId: "run-1", createdAt: "not-a-date", action: { id: "bad" } },
			],
		}));
		const store = new StorageConversationEventStore(storage, { prefix: "test" });
		const replay = store.replay("session-1");
		expect(replay.events.map(({ id }) => id)).toEqual(["valid"]);
		expect(replay.diagnostics.map(({ code }) => code)).toEqual(["invalid-event", "corrupt-record"]);
		expect(store.listPendingActions("session-1")).toEqual([]);
	});

	test("rejects malformed pending actions and redacts valid action secrets", () => {
		const storage = new MemoryStorage();
		const store = new StorageConversationEventStore(storage);
		store.putPendingAction({ sessionId: "session-1", runId: "run-1", createdAt: "bad", action: { id: "bad", documentId: "doc", documentRevision: 0, type: "submit", params: {} } });
		expect(storage.values.size).toBe(0);
		store.putPendingAction({
			sessionId: "session-1", runId: "run-1", createdAt: "2026-07-18T00:00:00.000Z",
			action: { id: "good", documentId: "doc", documentRevision: 0, type: "submit", params: { apiKey: "secret-value", answer: 4 } },
		});
		expect(store.listPendingActions("session-1")[0]?.action.params).toEqual({ apiKey: "[REDACTED]", answer: 4 });
	});

	test("appends idempotently and replays in sequence order", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		expect(store.append(event("second", 2)).appended).toBe(true);
		expect(store.append(event("first", 1)).appended).toBe(true);
		expect(store.append(event("first", 1)).appended).toBe(false);

		const replay = store.replay("session-1");
		expect(replay.events.map(({ id }) => id)).toEqual(["first", "second"]);
		expect(replayConversation(replay.events).messages["message-1"]?.text).toBe("firstsecond");
		expect(store.listSessionIds()).toEqual(["session-1"]);
	});

	test("persists pending UI actions until explicitly removed", () => {
		const storage = new MemoryStorage();
		const store = new StorageConversationEventStore(storage);
		store.putPendingAction({
			sessionId: "session-1",
			runId: "run-1",
			createdAt: "2026-07-18T00:00:00.000Z",
			action: { id: "answer-1", documentId: "quiz-1", documentRevision: 0, type: "submit", params: { answer: 4 } },
		});

		const reopened = new StorageConversationEventStore(storage);
		expect(reopened.listPendingActions("session-1")[0]?.action.params).toEqual({ answer: 4 });
		expect(reopened.removePendingAction("session-1", "answer-1")).toBe(true);
		expect(reopened.removePendingAction("session-1", "answer-1")).toBe(false);
		expect(reopened.listPendingActions("session-1")).toEqual([]);
	});

	test("compacts acknowledged events while retaining checkpoint metadata and pending actions", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		store.appendMany([event("one", 1), event("two", 2), event("three", 3)]);
		store.putPendingAction({
			sessionId: "session-1", runId: "run-1", createdAt: "2026-07-18T00:00:00.000Z",
			action: { id: "pending", documentId: "doc", documentRevision: 0, type: "answer", params: {} },
		});

		const replay = store.compact("session-1", {
			throughSequence: 2,
			createdAt: "2026-07-18T00:01:00.000Z",
			compactedEventCount: 2,
			snapshot: { status: "active" },
		});
		expect(replay.events.map(({ id }) => id)).toEqual(["three"]);
		expect(replay.checkpoint?.throughSequence).toBe(2);
		expect(store.listPendingActions("session-1")).toHaveLength(1);
	});

	test("returns diagnostics rather than throwing for corrupt storage", () => {
		const storage = new MemoryStorage();
		storage.setItem("test:session:broken", "{ definitely-not-json");
		storage.setItem("test:sessions", "not-json");
		const observed: string[] = [];
		const store = new StorageConversationEventStore(storage, {
			prefix: "test",
			onDiagnostic: ({ code }) => observed.push(code),
		});

		const replay = store.replay("broken");
		expect(replay.events).toEqual([]);
		expect(replay.diagnostics[0]?.code).toBe("corrupt-record");
		expect(store.listSessionIds()).toEqual([]);
		expect(observed).toEqual(["corrupt-record", "corrupt-record"]);
	});

	test("isolates sessions and clears only the requested one", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		store.append(event("a", 1, "a"));
		store.append(event("b", 1, "b"));
		store.clearSession("a");
		expect(store.replay("a").events).toEqual([]);
		expect(store.replay("b").events.map(({ id }) => id)).toEqual(["b"]);
		expect(store.listSessionIds()).toEqual(["b"]);
	});
});
