import { describe, expect, it } from "bun:test";

import { createRealtimeTelemetry } from "../keating/observability";
import type { RealtimeTelemetryEvent } from "../keating/observability/types";
import type { ConversationEvent } from "../keating/protocol";
import {
	createRealtimeCanonicalBridge,
	parseToolArguments,
	runLiveToolCall,
	type LiveProviderId,
} from "../keating/speech-providers/live-session-shared";

interface Transcript {
	events: ConversationEvent[];
	telemetry: RealtimeTelemetryEvent[];
	responses: Array<{ callId: string; output: unknown; failed: boolean }>;
}

/**
 * Drive one provider through a scripted session and record everything it emits.
 *
 * Keating runs different providers at different capability tiers, but the rest
 * of the app — persistence, replay, the live HUD — only ever sees the canonical
 * event stream. If two providers disagree about that stream, a session's
 * meaning depends on which provider produced it.
 */
async function runScriptedSession(
	provider: LiveProviderId,
	options: { toolFails?: boolean } = {},
): Promise<Transcript> {
	const events: ConversationEvent[] = [];
	const telemetryEvents: RealtimeTelemetryEvent[] = [];
	const responses: Transcript["responses"] = [];

	const canonical = createRealtimeCanonicalBridge((event) => events.push(event), {
		sessionId: "session-fixed",
		runId: "run-fixed",
	});
	let tick = 0;
	const telemetry = createRealtimeTelemetry(
		{ onEvent: (event) => telemetryEvents.push(event) },
		{ now: () => (tick += 1000) },
	);

	// connect
	canonical.emit("run.started", { mode: "multimodal" });

	// learner speaks, model transcribes
	canonical.emit("transcript.delta", {
		transcriptId: "user-transcript",
		role: "user",
		delta: "quiz me on recursion",
		final: false,
	});

	// model calls a tool
	await runLiveToolCall({
		call: { callId: "call-1", name: "quiz", arguments: { topic: "recursion" } },
		provider,
		canonical,
		telemetry,
		execute: async () => {
			if (options.toolFails) throw new Error("quiz backend unavailable");
			return { ok: true };
		},
		respond: (callId, output) => responses.push({ callId, output, failed: false }),
		respondError: (callId, message) => responses.push({ callId, output: message, failed: true }),
	});

	// learner barges in over the answer
	canonical.emit("conversation.interrupted", { by: "user", reason: "barge-in" });

	// session ends
	canonical.emit("run.completed", { reason: "cancelled" });

	return { events, telemetry: telemetryEvents, responses };
}

describe("live session parity across capability tiers", () => {
	it("emits an identical canonical event sequence for both providers", async () => {
		const openai = await runScriptedSession("openai");
		const google = await runScriptedSession("google");

		const shape = (transcript: Transcript) =>
			transcript.events.map((event) => ({
				type: event.type,
				sequence: event.sequence,
				payload: event.payload,
			}));

		expect(shape(openai)).toEqual(shape(google));
		expect(openai.events.map((event) => event.type)).toEqual([
			"run.started",
			"transcript.delta",
			"tool.requested",
			"tool.started",
			"tool.completed",
			"conversation.interrupted",
			"run.completed",
		]);
	});

	it("emits an identical failure sequence for both providers", async () => {
		const openai = await runScriptedSession("openai", { toolFails: true });
		const google = await runScriptedSession("google", { toolFails: true });

		expect(openai.events.map((event) => event.type)).toEqual([
			"run.started",
			"transcript.delta",
			"tool.requested",
			"tool.started",
			"tool.failed",
			"conversation.interrupted",
			"run.completed",
		]);
		expect(openai.events.map((event) => event.type)).toEqual(google.events.map((event) => event.type));

		// The provider name is the one thing that legitimately differs.
		const failure = (transcript: Transcript) =>
			transcript.events.find((event) => event.type === "tool.failed") as
				| Extract<ConversationEvent, { type: "tool.failed" }>
				| undefined;
		expect(failure(openai)?.payload.error.provider).toBe("openai");
		expect(failure(google)?.payload.error.provider).toBe("google");
		expect(failure(openai)?.payload.error.code).toBe(failure(google)?.payload.error.code);
	});

	it("answers the transport on both the success and failure paths", async () => {
		// A live session that never answers a function call stalls until the
		// provider times it out, which the learner experiences as dead air.
		const ok = await runScriptedSession("openai");
		expect(ok.responses).toEqual([{ callId: "call-1", output: { ok: true }, failed: false }]);

		const failed = await runScriptedSession("openai", { toolFails: true });
		expect(failed.responses).toEqual([
			{ callId: "call-1", output: "quiz backend unavailable", failed: true },
		]);
	});

	it("emits matching tool telemetry for both providers", async () => {
		const openai = await runScriptedSession("openai");
		const google = await runScriptedSession("google");

		const toolEvents = (transcript: Transcript) =>
			transcript.telemetry
				.filter((event) => event.name.startsWith("tool."))
				.map((event) => ({ name: event.name, outcome: event.attributes?.outcome }));

		expect(toolEvents(openai)).toEqual([
			{ name: "tool.started", outcome: undefined },
			{ name: "tool.completed", outcome: "success" },
		]);
		expect(toolEvents(openai)).toEqual(toolEvents(google));
	});

	it("keeps event ids unique and sequence numbers gapless", async () => {
		const { events } = await runScriptedSession("openai");
		expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
		expect(events.every((event) => event.sessionId === "session-fixed")).toBe(true);
	});
});

describe("tool argument parsing", () => {
	it("accepts the JSON string OpenAI sends and the object Gemini sends", () => {
		expect(parseToolArguments('{"topic":"recursion"}')).toEqual({ topic: "recursion" });
		expect(parseToolArguments({ topic: "recursion" })).toEqual({ topic: "recursion" });
	});

	it("degrades to empty arguments rather than throwing mid-session", () => {
		// A malformed argument blob must not take down a live call.
		expect(parseToolArguments("not json")).toEqual({});
		expect(parseToolArguments("")).toEqual({});
		expect(parseToolArguments(undefined)).toEqual({});
		expect(parseToolArguments(null)).toEqual({});
		expect(parseToolArguments("[1,2,3]")).toEqual({});
	});
});
