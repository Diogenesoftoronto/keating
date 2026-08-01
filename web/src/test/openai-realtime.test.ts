import { describe, expect, it } from "bun:test";

import { DEFAULT_WEB_SPEECH_SETTINGS } from "../keating/speech";
import type { ConversationEvent } from "../keating/protocol";
import {
	buildRealtimeSessionConfig,
	buildRealtimeSessionUpdate,
	createRealtimeCanonicalBridge,
	negotiateOpenAIRealtimeSession,
	realtimeFunctionOutput,
	realtimeHistoryItem,
	realtimeImageItem,
} from "../keating/speech-providers/openai-realtime";

describe("OpenAI Realtime 2.1 payloads", () => {
	it("enables reasoning, full-duplex interruption, and the complete tool catalog", () => {
		const payload = buildRealtimeSessionUpdate(
			{ ...DEFAULT_WEB_SPEECH_SETTINGS, model: "gpt-realtime-2.1", reasoningEffort: "high" },
			"Teach collaboratively",
			[{ name: "quiz", description: "Create a quiz", parameters: { type: "object", properties: {} } }],
		) as any;

		expect(payload.session.reasoning).toEqual({ effort: "high" });
		expect(payload.session.audio.input.turn_detection).toEqual({
			type: "semantic_vad",
			create_response: true,
			interrupt_response: true,
		});
		expect(payload.session.tools[0]).toEqual({
			type: "function",
			name: "quiz",
			description: "Create a quiz",
			parameters: { type: "object", properties: {} },
		});
	});

	it("nests audio config where the GA endpoint actually reads it", () => {
		// The older flat layout (turn_detection / input_audio_transcription at the
		// session root) is silently ignored, so those settings never took effect.
		const session = buildRealtimeSessionConfig(
			{ ...DEFAULT_WEB_SPEECH_SETTINGS, model: "gpt-realtime-2.1", voiceName: "cedar" },
		) as any;

		expect(session.turn_detection).toBeUndefined();
		expect(session.input_audio_transcription).toBeUndefined();
		expect(session.modalities).toBeUndefined();

		expect(session.output_modalities).toEqual(["audio"]);
		expect(session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
		expect(session.audio.input.transcription).toEqual({ model: "gpt-4o-transcribe" });
		expect(session.audio.output.voice).toBe("cedar");
	});

	it("falls back to a supported voice rather than sending an unknown one", () => {
		const session = buildRealtimeSessionConfig(
			{ ...DEFAULT_WEB_SPEECH_SETTINGS, model: "gpt-realtime-2.1", voiceName: "Kore" },
		) as any;
		// "Kore" is a Gemini voice; switching providers must not break the session.
		expect(session.audio.output.voice).toBe("marin");
	});

	it("only sends a reasoning budget to models that accept one", () => {
		const reasoning = buildRealtimeSessionConfig(
			{ ...DEFAULT_WEB_SPEECH_SETTINGS, model: "gpt-realtime-2", reasoningEffort: "low" },
		) as any;
		expect(reasoning.reasoning).toEqual({ effort: "low" });

		for (const model of ["gpt-realtime", "gpt-4o-realtime-preview-2024-12-17"]) {
			const session = buildRealtimeSessionConfig({ ...DEFAULT_WEB_SPEECH_SETTINGS, model }) as any;
			expect(session.reasoning).toBeUndefined();
		}
	});

	it("omits tools entirely when there are none, rather than sending an empty list", () => {
		const session = buildRealtimeSessionConfig({ ...DEFAULT_WEB_SPEECH_SETTINGS, model: "gpt-realtime-2.1" }) as any;
		expect(session.tools).toBeUndefined();
		expect(session.tool_choice).toBeUndefined();
	});

	it("sends a sampled frame as context, never as a turn", () => {
		// Realtime has no video lane, so vision arrives as a still image on the
		// conversation. Following it with response.create would make the model
		// narrate the camera feed instead of waiting for the learner.
		const item = realtimeImageItem("data:image/jpeg;base64,AAAA") as any;
		expect(item.type).toBe("conversation.item.create");
		expect(item.item.role).toBe("user");
		expect(item.item.content).toEqual([
			{ type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
		]);
	});

	it("replays prior chat turns with the role-correct content type", () => {
		expect(realtimeHistoryItem({ role: "user", text: "why does this compile?" }) as any).toEqual({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "why does this compile?" }],
			},
		});
		expect((realtimeHistoryItem({ role: "assistant", text: "look at the lifetime" }) as any).item.content[0].type)
			.toBe("output_text");
	});

	it("encodes function outputs for the model to continue speaking", () => {
		expect(realtimeFunctionOutput("call-1", { ok: true })).toEqual({
			type: "conversation.item.create",
			item: { type: "function_call_output", call_id: "call-1", output: '{"ok":true}' },
		});
	});

	it("negotiates native full-duplex WebRTC and native tool calls", () => {
		const negotiated = negotiateOpenAIRealtimeSession("gpt-realtime-2.1");
		expect(negotiated.ruleId).toBe("openai-realtime-vision");
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
