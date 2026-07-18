import { describe, expect, test } from "bun:test";
import { StorageConversationEventStore } from "../../keating/event-store";
import { createConversationRuntime, recordOpenUIAction } from "../../keating/integration";
import type { KeatingOpenUIAction } from "../../keating/openui/types";

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

function action(revision: number, type = "answer"): KeatingOpenUIAction {
	return {
		type,
		humanFriendlyMessage: "Answered the question",
		params: { answer: "four" },
		document: { id: "question-1", lifecycle: "resumable", revision },
	};
}

describe("OpenUI action integration", () => {
	test("records repeated actions from the current renderer without re-emitting its document", () => {
		const runtime = createConversationRuntime({
			sessionId: "session-1",
			runId: "run-1",
			store: new StorageConversationEventStore(new MemoryStorage()),
			id: (() => { let value = 0; return () => `id-${++value}`; })(),
		});

		const first = recordOpenUIAction(runtime, action(0, "first"));
		const second = recordOpenUIAction(runtime, action(0, "second"));

		expect(first.documentRevision).toBe(0);
		expect(second.documentRevision).toBe(0);
		expect(runtime.replay().uiActions).toHaveLength(2);
		expect(runtime.replay().uiDocuments["question-1"]?.revision).toBe(0);
	});

	test("rejects stale renderers and accepts exactly incremented document updates", () => {
		const runtime = createConversationRuntime({
			sessionId: "session-1",
			runId: "run-1",
			store: new StorageConversationEventStore(new MemoryStorage()),
		});

		recordOpenUIAction(runtime, action(0));
		const updated = recordOpenUIAction(runtime, action(1));
		expect(updated.documentRevision).toBe(1);
		expect(runtime.replay().uiDocuments["question-1"]?.revision).toBe(1);
		expect(() => recordOpenUIAction(runtime, action(0))).toThrow("stale OpenUI document");
		expect(() => recordOpenUIAction(runtime, action(3))).toThrow("increment by one");
		expect(runtime.replay().uiActions).toHaveLength(2);
	});
});
