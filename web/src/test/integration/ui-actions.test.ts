import { describe, expect, test } from "bun:test";
import { StorageConversationEventStore } from "../../keating/event-store";
import { createConversationRuntime, recordOpenUIAction } from "../../keating/integration";
import type { KeatingOpenUIAction } from "../../keating/openui/types";
import { dispatchSharedUiAction } from "../../keating/openui/shared-actions";
import type { UiDocument } from "@keating/learner-contracts";

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

function sharedDocument(): UiDocument {
	return {
		schemaVersion: 1,
		id: "message-1-openui",
		revision: 0,
		lifecycle: "ready",
		supportedSurfaces: ["web"],
		nodes: [{ type: "question", id: "question-1", kind: "short_answer", prompt: "Why?" }],
		createdAt: "2026-08-11T00:00:00.000Z",
		updatedAt: "2026-08-11T00:00:00.000Z",
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

	test("projects a completed canonical receipt with the real source and resulting documents", () => {
		const eventStorage = new MemoryStorage();
		const actionStorage = new MemoryStorage();
		const runtime = createConversationRuntime({
			sessionId: "session-1",
			runId: "run-1",
			store: new StorageConversationEventStore(eventStorage),
			id: (() => { let value = 0; return () => `id-${++value}`; })(),
		});
		const source = sharedDocument();
		const dispatched = dispatchSharedUiAction(
			actionStorage,
			source,
			{ type: "submit-answer", nodeId: "question-1", answer: "Because the evidence changed." },
			"2026-08-11T00:00:01.000Z",
		);
		const hostAction: KeatingOpenUIAction = {
			kind: "canonical",
			type: dispatched.action.type,
			humanFriendlyMessage: "Answered the question",
			params: { nodeId: "question-1", answer: "Because the evidence changed." },
			document: { id: source.id, revision: source.revision, lifecycle: "resumable" },
			action: dispatched.action,
			sourceDocument: dispatched.sourceDocument,
			receipt: dispatched.receipt,
		};

		const request = recordOpenUIAction(runtime, hostAction);
		expect(runtime.replay().uiDocuments[source.id]).toMatchObject({
			kind: "shared-openui",
			revision: 1,
			content: { id: source.id, revision: 1 },
		});
		expect(runtime.replay().uiActions).toHaveLength(1);
		expect(runtime.replay().uiActions[0]?.params).toMatchObject({
			action: { idempotencyKey: dispatched.action.idempotencyKey },
			receipt: { state: "completed" },
		});
		expect(runtime.pendingActions()).toHaveLength(1);
		expect(runtime.pendingLearnerResponses()).toHaveLength(1);
		expect(runtime.pendingLearnerResponses()[0]).toMatchObject({
			receiptId: request.id,
			uiActionId: request.id,
			sessionMessageId: `openui:${request.id}`,
			createdAt: dispatched.receipt.createdAt,
		});
		expect(runtime.pendingLearnerResponses()[0]?.serialized).toContain(`\"id\":\"openui:${request.id}\"`);

		const replayed = recordOpenUIAction(runtime, hostAction);
		expect(replayed).toEqual(request);
		expect(runtime.replay().uiActions).toHaveLength(1);
		expect(runtime.pendingLearnerResponses()).toHaveLength(1);
	});
});
