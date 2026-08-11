import { describe, expect, test } from "bun:test";
import {
	conversationEvent,
	initialConversationState,
	reduceConversation,
	replayConversation,
	type ConversationEvent,
	type EventMetadata,
} from "../../keating/protocol";
import { isConversationEvent } from "../../keating/protocol/validation";

const metadata = (sequence: number): EventMetadata => ({
	id: `event-${sequence}`,
	sequence,
	timestamp: `2026-07-18T00:00:${String(sequence).padStart(2, "0")}.000Z`,
	sessionId: "session-1",
	runId: "run-1",
});

describe("conversation protocol", () => {
	test("rejects unknown event types and malformed discriminated payloads", () => {
		expect(isConversationEvent({ ...conversationEvent("tool.started", { callId: "c1" }, metadata(0)), type: "future.event" })).toBe(false);
		expect(isConversationEvent({ ...conversationEvent("tool.started", { callId: "c1" }, metadata(0)), payload: { callId: 7 } })).toBe(false);
		expect(isConversationEvent({ ...conversationEvent("tool.started", { callId: "c1" }, metadata(0)), timestamp: "yesterday" })).toBe(false);
	});

	test("is JSON round-trip serializable for multimodal and UI payloads", () => {
		const events: ConversationEvent[] = [
			conversationEvent("audio.delta", {
				streamId: "audio-1",
				messageId: "message-1",
				role: "assistant",
				encoding: "pcm16",
				sampleRate: 24_000,
				data: "AQID",
			}, metadata(0)),
			conversationEvent("ui.document.upserted", {
				document: {
					id: "quiz-1",
					kind: "quiz",
					lifecycle: "resumable",
					revision: 1,
					content: { questions: [{ id: "q1", prompt: "Why?" }] },
					state: { answered: false },
				},
			}, metadata(1)),
		];

		expect(JSON.parse(JSON.stringify(events))).toEqual(events);
	});

	test("reduces streaming text, audio, and final transcripts", () => {
		const state = replayConversation([
			conversationEvent("run.started", { mode: "multimodal" }, metadata(0)),
			conversationEvent("text.delta", { messageId: "m1", role: "assistant", delta: "Hel" }, metadata(1)),
			conversationEvent("text.delta", { messageId: "m1", role: "assistant", delta: "lo" }, metadata(2)),
			conversationEvent("audio.delta", { streamId: "a1", messageId: "m1", role: "assistant", encoding: "opus", data: "one" }, metadata(3)),
			conversationEvent("audio.delta", { streamId: "a1", messageId: "m1", role: "assistant", encoding: "opus", data: "two" }, metadata(4)),
			conversationEvent("transcript.delta", { transcriptId: "t1", messageId: "m1", role: "assistant", delta: "Hel", final: false }, metadata(5)),
			conversationEvent("transcript.delta", { transcriptId: "t1", messageId: "m1", role: "assistant", delta: "lo", final: true }, metadata(6)),
			conversationEvent("message.completed", { messageId: "m1" }, metadata(7)),
		]);

		expect(state.status).toBe("active");
		expect(state.messages.m1).toEqual({ id: "m1", role: "assistant", text: "Hello", completed: true });
		expect(state.audioStreams.a1.chunks).toEqual(["one", "two"]);
		expect(state.transcripts.t1).toMatchObject({ text: "Hello", final: true });
	});

	test("tracks parallel tool lifecycles independently", () => {
		const state = replayConversation([
			conversationEvent("tool.requested", { callId: "search", name: "web_search", arguments: { query: "Keating" } }, metadata(0)),
			conversationEvent("tool.requested", { callId: "goal", name: "set_goal", arguments: { topic: "events" } }, metadata(1)),
			conversationEvent("tool.started", { callId: "search" }, metadata(2)),
			conversationEvent("tool.started", { callId: "goal" }, metadata(3)),
			conversationEvent("tool.progress", { callId: "search", update: { results: 2 } }, metadata(4)),
			conversationEvent("tool.completed", { callId: "goal", result: { saved: true } }, metadata(5)),
			conversationEvent("tool.failed", { callId: "search", error: { code: "timeout", message: "Search timed out" } }, metadata(6)),
		]);

		expect(state.toolCalls.goal).toMatchObject({ status: "completed", result: { saved: true } });
		expect(state.toolCalls.search).toMatchObject({ status: "failed", updates: [{ results: 2 }] });
	});

	test("preserves newest UI revision and records host actions", () => {
		const document = { id: "quiz", kind: "quiz", lifecycle: "resumable" as const, revision: 2, content: { title: "Fractions" } };
		const state = replayConversation([
			conversationEvent("ui.document.upserted", { document }, metadata(0)),
			conversationEvent("ui.document.upserted", { document: { ...document, revision: 1, content: { title: "Old" } } }, metadata(1)),
			conversationEvent("ui.action", { action: { id: "answer-1", documentId: "quiz", documentRevision: 2, type: "submit", params: { answer: "1/2" } } }, metadata(2)),
		]);

		expect(state.uiDocuments.quiz).toEqual(document);
		expect(state.uiActions).toHaveLength(1);
	});

	test("replays durable UI state across successive runtime runs in one session", () => {
		const firstRun = metadata(0);
		const secondRun = { ...metadata(1), runId: "run-2" };
		const document = { id: "resume-me", kind: "shared-openui", lifecycle: "resumable" as const, revision: 0, content: {} };
		const state = replayConversation([
			conversationEvent("ui.document.upserted", { document }, firstRun),
			conversationEvent("ui.action", {
				action: { id: "resume-action", documentId: document.id, documentRevision: 0, type: "complete", params: {} },
			}, secondRun),
		]);

		expect(state.uiDocuments[document.id]).toEqual(document);
		expect(state.uiActions.map((action) => action.id)).toEqual(["resume-action"]);
		expect(state.runId).toBe("run-2");
	});

	test("models interruption, reconnect, errors, and completion", () => {
		const state = replayConversation([
			conversationEvent("run.started", { mode: "voice" }, metadata(0)),
			conversationEvent("conversation.interrupted", { by: "user", reason: "barge-in", atAudioStreamId: "a1" }, metadata(1)),
			conversationEvent("reconnect.started", { attempt: 1, reason: "network" }, metadata(2)),
			conversationEvent("reconnect.failed", { attempt: 1, retryable: true, error: { code: "offline", message: "Offline" } }, metadata(3)),
			conversationEvent("reconnect.succeeded", { attempt: 2, resumedFromSequence: 3 }, metadata(4)),
			conversationEvent("error", { fatal: false, error: { code: "audio_drop", message: "One chunk dropped" } }, metadata(5)),
			conversationEvent("run.completed", { reason: "completed" }, metadata(6)),
		]);

		expect(state.interruption).toMatchObject({ by: "user", reason: "barge-in" });
		expect(state.errors.map((error) => error.code)).toEqual(["offline", "audio_drop"]);
		expect(state.status).toBe("completed");
		expect(state.completionReason).toBe("completed");
	});

	test("ignores replay duplicates and stale sequence numbers", () => {
		const first = conversationEvent("text.delta", { messageId: "m1", role: "assistant", delta: "once" }, metadata(1));
		const stale = conversationEvent("text.delta", { messageId: "m1", role: "assistant", delta: "stale" }, { ...metadata(0), id: "stale" });
		const once = reduceConversation(initialConversationState(), first);
		const duplicate = reduceConversation(once, first);
		const afterStale = reduceConversation(duplicate, stale);

		expect(afterStale).toBe(duplicate);
		expect(afterStale.messages.m1.text).toBe("once");
	});
});
