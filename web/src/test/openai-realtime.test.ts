import { describe, expect, it } from "bun:test";

import { DEFAULT_WEB_SPEECH_SETTINGS } from "../keating/speech";
import { buildRealtimeSessionUpdate, realtimeFunctionOutput } from "../keating/speech-providers/openai-realtime";

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
});
