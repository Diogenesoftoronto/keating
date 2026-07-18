import { describe, expect, it } from "bun:test";

import { DEFAULT_WEB_SPEECH_SETTINGS } from "../keating/speech";
import type { ConversationEvent } from "../keating/protocol";
import {
	buildRealtimeSessionUpdate,
	createRealtimeCanonicalBridge,
	negotiateOpenAIRealtimeSession,
	realtimeFunctionOutput,
} from "../keating/speech-providers/openai-realtime";

describe("OpenAI Realtime 2.1 payloads", () => {
	it("enables reasoning, full-duplex interruption, and the complete tool catalog", () => {
		const payload = buildRealtimeSessionUpdate(
			{ ...DEFAULT_WEB_SPEECH_SETTINGS, model: "gpt-realtime-2.1", reasoningEffort: "high" },
			"Teach collaboratively",
			[{ name: "quiz", description: "Create a quiz", parameters: { type: "object", properties: {} } }],
		) as any;

		expect(payload.session.reasoning).toEqual({ effort: "high" });
		expect(payload.session.turn_detection).toEqual({ type: "server_vad", create_response: true, interrupt_response: true });
		expect(payload.session.tools[0]).toEqual({
			type: "function",
			name: "quiz",
			description: "Create a quiz",
			parameters: { type: "object", properties: {} },
		});
	});

	it("encodes function outputs for the model to continue speaking", () => {
		expect(realtimeFunctionOutput("call-1", { ok: true })).toEqual({
			type: "conversation.item.create",
			item: { type: "function_call_output", call_id: "call-1", output: '{"ok":true}' },
		});
	});

	it("negotiates native full-duplex WebRTC and native tool calls", () => {
		const negotiated = negotiateOpenAIRealtimeSession("gpt-realtime-2.1");
		expect(negotiated.ruleId).toBe("openai-realtime");
		expect(negotiated.realtimeAudio).toBe("native");
		expect(negotiated.transport).toBe("webrtc");
		expect(negotiated.toolCalls).toBe("native");
		expect(negotiated.missing).toEqual([]);
	});

	it("emits replay-safe canonical events without changing legacy callbacks", () => {
		const events: ConversationEvent[] = [];
		const bridge = createRealtimeCanonicalBridge((event) => events.push(event), {
			sessionId: "session-1",
			runId: "run-1",
		});

		bridge.emit("run.started", { mode: "voice" });
		bridge.emit("conversation.interrupted", { by: "user", reason: "barge-in" });
		bridge.emit("tool.requested", { callId: "call-1", name: "quiz", arguments: { topic: "fractions" } });
		bridge.emit("tool.started", { callId: "call-1" });
		bridge.emit("tool.completed", { callId: "call-1", result: { ok: true } });
		bridge.emit("run.completed", { reason: "cancelled" });

		expect(events.map((event) => event.type)).toEqual([
			"run.started",
			"conversation.interrupted",
			"tool.requested",
			"tool.started",
			"tool.completed",
			"run.completed",
		]);
		expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(events.every((event) => event.sessionId === "session-1" && event.runId === "run-1")).toBe(true);
		expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
	});
});
