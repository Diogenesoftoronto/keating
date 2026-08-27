import { describe, expect, test } from "bun:test";
import { StorageConversationEventStore, type StorageLike } from "../../keating/event-store";
import { conversationEvent, replayConversation, type ConversationEvent } from "../../keating/protocol";

class MemoryStorage implements StorageLike {
	readonly values = new Map<string, string>();
	getItem(key: string) { return this.values.get(key) ?? null; }
	setItem(key: string, value: string) { this.values.set(key, value); }
	removeItem(key: string) { this.values.delete(key); }
}

class FaultingStorage extends MemoryStorage {
	readonly setAttempts: string[] = [];
	readonly removeAttempts: string[] = [];
	failSet = false;
	failRemove = false;
	failIndexSet = false;

	override setItem(key: string, value: string) {
		this.setAttempts.push(key);
		if (this.failSet || (this.failIndexSet && key.endsWith(":sessions"))) {
			const error = new Error(`Quota exceeded while writing ${key}`);
			error.name = "QuotaExceededError";
			throw error;
		}
		super.setItem(key, value);
	}

	override removeItem(key: string) {
		this.removeAttempts.push(key);
		if (this.failRemove) throw new Error(`Removal failed for ${key}`);
		super.removeItem(key);
	}
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

function messageEvent(id: string, sequence: number, messageId: string, delta: string, sessionId = "session-1"): ConversationEvent {
	return conversationEvent("text.delta", { messageId, role: "assistant", delta }, {
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

	test("coalesces adjacent text deltas without changing the replayed message", () => {
		const storage = new MemoryStorage();
		const store = new StorageConversationEventStore(storage, { maxSessionBytes: 8_192 });

		expect(store.append(event("hello ", 1))).toEqual({ appended: true, eventCount: 1 });
		expect(store.append(event("world", 2))).toEqual({ appended: true, eventCount: 1 });

		const replay = store.replay("session-1");
		expect(replay.events).toHaveLength(1);
		expect(replay.events[0]?.type).toBe("text.delta");
		expect(replay.events[0]?.payload).toMatchObject({ delta: "hello world" });
		expect(replayConversation(replay.events).messages["message-1"]?.text).toBe("hello world");
	});

	test("keeps an oversized active session replayable without writing beyond its byte budget", () => {
		const probeStorage = new MemoryStorage();
		const probe = new StorageConversationEventStore(probeStorage);
		probe.append(messageEvent("probe", 1, "probe", "x".repeat(256)));
		const oneEventBytes = new TextEncoder().encode(
			probeStorage.values.get("keating:conversation-events:v1:session:session-1") ?? "",
		).byteLength;
		const storage = new MemoryStorage();
		const diagnostics: string[] = [];
		const maxSessionBytes = oneEventBytes + 32;
		const store = new StorageConversationEventStore(storage, {
			maxSessionBytes,
			onDiagnostic: ({ code }) => diagnostics.push(code),
		});

		store.append(messageEvent("old", 1, "old-message", "x".repeat(256)));
		expect(() => store.append(messageEvent("new", 2, "new-message", "y".repeat(256)))).not.toThrow();

		expect(store.replay("session-1").events.map(({ id }) => id)).toEqual(["old", "new"]);
		expect(diagnostics).toContain("storage-error");
		expect(new TextEncoder().encode(
			storage.values.get("keating:conversation-events:v1:session:session-1") ?? "",
		).byteLength).toBeLessThanOrEqual(maxSessionBytes);
		const index = JSON.parse(storage.values.get("keating:conversation-events:v1:sessions") ?? "{}") as { sessions?: Array<{ id: string }> };
		expect(index.sessions?.map(({ id }) => id) ?? []).not.toContain("session-1");
	});

	test("prunes the oldest sessions to bounded retention while preserving the active session", () => {
		const storage = new MemoryStorage();
		const store = new StorageConversationEventStore(storage, {
			maxSessionBytes: 2_048,
			maxTotalBytes: 3_000,
			maxSessions: 2,
		});

		store.append(event("old-a", 1, "old-a"));
		store.append(event("old-b", 2, "old-b"));
		store.append(event("active", 3, "active"));

		expect(store.listSessionIds()).toEqual(["active", "old-b"]);
		expect(store.replay("old-a").events).toEqual([]);
		expect(store.replay("active").events.map(({ id }) => id)).toEqual(["active"]);
	});

	test("enforces the total byte budget by pruning older sessions before the active session", () => {
		const storage = new MemoryStorage();
		const seed = new StorageConversationEventStore(storage);
		seed.append(event("old", 1, "old"));
		const oldRecordBytes = new TextEncoder().encode(storage.values.get("keating:conversation-events:v1:session:old") ?? "").byteLength;
		const store = new StorageConversationEventStore(storage, {
			maxSessionBytes: oldRecordBytes * 2,
			maxTotalBytes: oldRecordBytes + Math.floor(oldRecordBytes / 2),
			maxSessions: 10,
		});

		store.append(event("current", 2, "current"));

		expect(store.listSessionIds()).toEqual(["current"]);
		expect(store.replay("old").events).toEqual([]);
		expect(store.replay("current").events.map(({ id }) => id)).toEqual(["current"]);
	});

	test("retention preserves older sessions with pending deliveries and prunes an unpinned session first", () => {
		const storage = new MemoryStorage();
		let clock = 1;
		const seed = new StorageConversationEventStore(storage, { now: () => clock++ });
		seed.putPendingAction({
			sessionId: "pinned-action",
			runId: "run-1",
			createdAt: "2026-07-18T00:00:01.000Z",
			action: { id: "answer", documentId: "quiz", documentRevision: 0, type: "submit", params: { answer: 4 } },
		});
		seed.putPendingLearnerResponse({
			version: 1,
			sessionId: "pinned-response",
			receiptId: "receipt",
			uiActionId: "answer",
			sessionMessageId: "openui:receipt",
			serialized: "serialized response",
			createdAt: "2026-07-18T00:00:02.000Z",
		});
		seed.append(event("unpinned", 3, "unpinned"));

		const sessionPrefix = "keating:conversation-events:v1:session:";
		const existingBytes = [...storage.values.entries()]
			.filter(([key]) => key.startsWith(sessionPrefix))
			.reduce((total, [, value]) => total + new TextEncoder().encode(value).byteLength, 0);
		const probeStorage = new MemoryStorage();
		new StorageConversationEventStore(probeStorage).append(event("active", 4, "active"));
		const activeBytes = new TextEncoder().encode(probeStorage.values.get(`${sessionPrefix}active`) ?? "").byteLength;
		const unpinnedBytes = new TextEncoder().encode(storage.values.get(`${sessionPrefix}unpinned`) ?? "").byteLength;
		const store = new StorageConversationEventStore(storage, {
			maxSessionBytes: 4_096,
			maxTotalBytes: existingBytes + activeBytes - Math.max(1, Math.floor(unpinnedBytes / 2)),
			maxSessions: 3,
			now: () => clock++,
		});

		store.append(event("active", 4, "active"));

		expect(store.listSessionIds()).toEqual(["active", "pinned-action", "pinned-response"]);
		expect(store.replay("unpinned").events).toEqual([]);
		expect(store.replay("active").events.map(({ id }) => id)).toEqual(["active"]);
		expect(store.listPendingActions("pinned-action")).toHaveLength(1);
		expect(store.listPendingLearnerResponses("pinned-response")).toHaveLength(1);
	});

	test("keeps quota-failed appends replayable in memory and reports a storage diagnostic", () => {
		const storage = new FaultingStorage();
		const diagnostics: string[] = [];
		const store = new StorageConversationEventStore(storage, {
			onDiagnostic: ({ code }) => diagnostics.push(code),
		});
		storage.failSet = true;

		expect(() => store.append(event("survives", 1))).not.toThrow();
		expect(store.replay("session-1").events.map(({ id }) => id)).toEqual(["survives"]);
		expect(diagnostics).toContain("storage-error");
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

	test("persists learner-response delivery exactly once until acknowledged", () => {
		const storage = new MemoryStorage();
		const store = new StorageConversationEventStore(storage);
		const response = {
			version: 1 as const,
			sessionId: "session-1",
			receiptId: "receipt-1",
			uiActionId: "action-1",
			sessionMessageId: "openui:receipt-1",
			serialized: "<keating-learner-response>saved</keating-learner-response>",
			createdAt: "2026-07-18T00:00:00.000Z",
		};
		store.putPendingLearnerResponse(response);
		store.putPendingLearnerResponse(response);

		const reopened = new StorageConversationEventStore(storage);
		expect(reopened.listPendingLearnerResponses("session-1")).toEqual([response]);
		expect(reopened.removePendingLearnerResponse("session-1", response.receiptId)).toBe(true);
		expect(reopened.removePendingLearnerResponse("session-1", response.receiptId)).toBe(false);
	});

	test("compacts acknowledged events while retaining checkpoint metadata and pending deliveries", () => {
		const store = new StorageConversationEventStore(new MemoryStorage());
		store.appendMany([event("one", 1), event("two", 2), event("three", 3)]);
		store.putPendingAction({
			sessionId: "session-1", runId: "run-1", createdAt: "2026-07-18T00:00:00.000Z",
			action: { id: "pending", documentId: "doc", documentRevision: 0, type: "answer", params: {} },
		});
		store.putPendingLearnerResponse({
			version: 1, sessionId: "session-1", receiptId: "receipt", uiActionId: "pending",
			sessionMessageId: "openui:receipt", serialized: "serialized",
			createdAt: "2026-07-18T00:00:00.000Z",
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
		expect(store.listPendingLearnerResponses("session-1")).toHaveLength(1);
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

	test("does not throw while clearing when record removal or index persistence fails", () => {
		const removalStorage = new FaultingStorage();
		const removalDiagnostics: string[] = [];
		const removalStore = new StorageConversationEventStore(removalStorage, {
			onDiagnostic: ({ code }) => removalDiagnostics.push(code),
		});
		removalStore.append(event("one", 1));
		removalStorage.failRemove = true;

		expect(() => removalStore.clearSession("session-1")).not.toThrow();
		expect(removalStorage.removeAttempts).toContain("keating:conversation-events:v1:session:session-1");
		expect(removalDiagnostics).toContain("storage-error");

		const indexStorage = new FaultingStorage();
		const indexDiagnostics: string[] = [];
		const indexStore = new StorageConversationEventStore(indexStorage, {
			onDiagnostic: ({ code }) => indexDiagnostics.push(code),
		});
		indexStore.append(event("one", 1));
		indexStorage.failIndexSet = true;

		expect(() => indexStore.clearSession("session-1")).not.toThrow();
		expect(indexStorage.values.has("keating:conversation-events:v1:session:session-1")).toBe(false);
		expect(indexDiagnostics).toContain("storage-error");
	});
});
