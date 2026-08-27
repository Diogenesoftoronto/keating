import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { StorageConversationEventStore, type StorageLike } from "../../keating/event-store";
import { conversationEvent } from "../../keating/protocol";

class CapacityStorage implements StorageLike {
	readonly values = new Map<string, string>();
	rejectedWrites = 0;

	constructor(readonly capacity: number, initial: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
	}

	get length() { return this.values.size; }
	get used() { return [...this.values.values()].reduce((total, value) => total + value.length, 0); }
	getItem(key: string) { return this.values.get(key) ?? null; }
	key(index: number) { return [...this.values.keys()][index] ?? null; }
	removeItem(key: string) { this.values.delete(key); }
	setItem(key: string, value: string) {
		const nextUsed = this.used - (this.values.get(key)?.length ?? 0) + value.length;
		if (nextUsed > this.capacity) {
			this.rejectedWrites += 1;
			throw new DOMException(`Storage capacity ${this.capacity} exceeded`, "QuotaExceededError");
		}
		this.values.set(key, value);
	}
}

class RejectingStorage extends CapacityStorage {
	constructor() { super(0); }
}

function textEvent(sessionId: string, sequence: number, delta: string) {
	return conversationEvent("text.delta", {
		messageId: "answer",
		role: "assistant",
		delta,
	}, {
		id: `${sessionId}:${sequence}`,
		sequence,
		timestamp: new Date(sequence).toISOString(),
		sessionId,
		runId: "pressure-run",
	});
}

function eventRecordKeys(storage: CapacityStorage): string[] {
	return [...storage.values.keys()].filter((key) => key.includes(":session:"));
}

describe("StorageConversationEventStore pressure invariants", () => {
	test("generated streaming pressure preserves exact text while compacting event overhead", () => {
		fc.assert(fc.property(
			fc.array(fc.string({ minLength: 1, maxLength: 24 }), { minLength: 1, maxLength: 160 }),
			(chunks) => {
				const storage = new CapacityStorage(256 * 1024);
				const store = new StorageConversationEventStore(storage);
				chunks.forEach((chunk, sequence) => store.append(textEvent("stream", sequence, chunk)));

				const replay = store.replay("stream");
				const event = replay.events[0];
				expect(replay.events).toHaveLength(1);
				expect(event?.type).toBe("text.delta");
				if (event?.type === "text.delta") expect(event.payload.delta).toBe(chunks.join(""));
			},
		), { numRuns: 60 });
	});

	test("generated session churn always respects durable count and byte budgets", () => {
		fc.assert(fc.property(
			fc.integer({ min: 1, max: 48 }),
			fc.integer({ min: 1, max: 8 }),
			(sessionCount, maxSessions) => {
				const maxTotalBytes = 12 * 1024;
				const storage = new CapacityStorage(256 * 1024);
				const store = new StorageConversationEventStore(storage, {
					maxSessionBytes: 2 * 1024,
					maxTotalBytes,
					maxSessions,
					now: (() => { let tick = 0; return () => ++tick; })(),
				});
				for (let index = 0; index < sessionCount; index += 1) {
					store.append(textEvent(`session-${index}`, index, "x".repeat(64)));
				}

				const activeId = `session-${sessionCount - 1}`;
				expect(eventRecordKeys(storage).length).toBeLessThanOrEqual(maxSessions);
				expect(eventRecordKeys(storage).reduce(
					(total, key) => total + (storage.getItem(key)?.length ?? 0),
					0,
				)).toBeLessThanOrEqual(maxTotalBytes);
				expect(store.replay(activeId).events).toHaveLength(1);
			},
		), { numRuns: 60 });
	});

	test("real quota rejection prunes eligible history, retries, and preserves unrelated storage", () => {
		const unrelated = "u".repeat(2_000);
		const storage = new CapacityStorage(12_000, { "keating:unrelated-setting": unrelated });
		const store = new StorageConversationEventStore(storage, {
			maxSessionBytes: 4 * 1024,
			maxTotalBytes: 64 * 1024,
			maxSessions: 100,
			now: (() => { let tick = 0; return () => ++tick; })(),
		});
		for (let index = 0; index < 30; index += 1) {
			expect(() => store.append(textEvent(`quota-${index}`, index, "q".repeat(700)))).not.toThrow();
		}

		expect(storage.rejectedWrites).toBeGreaterThan(0);
		expect(eventRecordKeys(storage).length).toBeLessThan(30);
		expect(storage.used).toBeLessThanOrEqual(storage.capacity);
		expect(storage.getItem("keating:unrelated-setting")).toBe(unrelated);
		expect(store.replay("quota-29").events).toHaveLength(1);
	});

	test("memory-only fallback bounds inactive session churn and remains shared across store instances", () => {
		const storage = new RejectingStorage();
		const options = { maxSessionBytes: 4 * 1024, maxTotalBytes: 16 * 1024, maxSessions: 8 };
		const store = new StorageConversationEventStore(storage, options);
		for (let index = 0; index < 100; index += 1) {
			expect(() => store.append(textEvent(`volatile-${index}`, index, "v".repeat(128)))).not.toThrow();
		}

		expect(store.listSessionIds().length).toBeLessThanOrEqual(options.maxSessions);
		expect(store.listSessionIds()).toContain("volatile-99");
		const reopened = new StorageConversationEventStore(storage, options);
		expect(reopened.replay("volatile-99").events).toHaveLength(1);
		expect(storage.values.size).toBe(0);
	});
});
