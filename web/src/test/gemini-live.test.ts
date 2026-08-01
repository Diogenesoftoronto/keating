import { describe, expect, it } from "bun:test";

import {
	buildGeminiToolConfig,
	geminiFunctionResponse,
	geminiHistoryTurn,
	negotiateGeminiLiveSession,
	supportsNonBlockingTools,
} from "../keating/speech-providers/gemini-live";
import type { LiveSpeechTool } from "../keating/speech";

const QUIZ_TOOL: LiveSpeechTool = {
	name: "quiz",
	description: "Create a quiz",
	parameters: { type: "object", properties: {} },
};

describe("Gemini Live tool declarations", () => {
	it("maps Keating tools onto the SDK's camelCase declaration shape", () => {
		// The SDK marshals `functionDeclarations`; the snake_case spelling from
		// the REST docs is silently dropped, leaving the session tool-blind.
		const config = buildGeminiToolConfig([QUIZ_TOOL], "gemini-3.1-flash-live-preview");
		expect(config).toBeDefined();
		expect(config![0].functionDeclarations).toEqual([
			{ name: "quiz", description: "Create a quiz", parameters: { type: "object", properties: {} } },
		]);
	});

	it("omits the tool block entirely when there are no tools", () => {
		expect(buildGeminiToolConfig([], "gemini-3.1-flash-live-preview")).toBeUndefined();
	});

	it("marks declarations non-blocking only on models that support it", () => {
		// 3.1 Live is synchronous-only; sending the flag there is an error.
		expect(supportsNonBlockingTools("gemini-2.5-flash-live-preview")).toBe(true);
		expect(supportsNonBlockingTools("gemini-3.1-flash-live-preview")).toBe(false);
		expect(supportsNonBlockingTools("gemini-2.0-flash-live-001")).toBe(false);

		const async = buildGeminiToolConfig([QUIZ_TOOL], "gemini-2.5-flash-live-preview");
		expect((async![0].functionDeclarations as any[])[0].behavior).toBe("NON_BLOCKING");

		const sync = buildGeminiToolConfig([QUIZ_TOOL], "gemini-3.1-flash-live-preview");
		expect((sync![0].functionDeclarations as any[])[0].behavior).toBeUndefined();
	});
});

describe("Gemini Live tool responses", () => {
	it("echoes the call id and puts the result under the reserved output key", () => {
		expect(geminiFunctionResponse("call-1", "quiz", { ok: true }, "gemini-3.1-flash-live-preview")).toEqual({
			id: "call-1",
			name: "quiz",
			response: { output: { ok: true } },
		});
	});

	it("reports failures under the error key so they are not read as output", () => {
		const failed = geminiFunctionResponse("call-1", "quiz", "boom", "gemini-3.1-flash-live-preview", { failed: true });
		expect(failed.response).toEqual({ error: "boom" });
	});

	it("keeps scheduling a sibling of response, never nested inside it", () => {
		// Nested inside `response` it would be treated as tool output and the
		// model would keep blocking on every call.
		const scheduled = geminiFunctionResponse("call-1", "quiz", { ok: true }, "gemini-2.5-flash-live-preview");
		expect(scheduled.scheduling).toBe("WHEN_IDLE");
		expect(scheduled.response).toEqual({ output: { ok: true } });
	});

	it("omits scheduling on models without non-blocking support", () => {
		const plain = geminiFunctionResponse("call-1", "quiz", { ok: true }, "gemini-3.1-flash-live-preview");
		expect(plain.scheduling).toBeUndefined();
	});
});

describe("Gemini Live session setup", () => {
	it("negotiates native duplex audio, native video, and native tools", () => {
		const negotiated = negotiateGeminiLiveSession("gemini-3.1-flash-live-preview");
		expect(negotiated.realtimeAudio).toBe("native");
		expect(negotiated.realtimeVideo).toBe("native");
		expect(negotiated.toolCalls).toBe("native");
		expect(negotiated.transport).toBe("websocket");
		expect(negotiated.missing).toEqual([]);
	});

	it("maps assistant turns onto Gemini's model role when replaying history", () => {
		expect(geminiHistoryTurn({ role: "assistant", text: "try the base case" })).toEqual({
			role: "model",
			parts: [{ text: "try the base case" }],
		});
		expect(geminiHistoryTurn({ role: "user", text: "why?" })).toEqual({
			role: "user",
			parts: [{ text: "why?" }],
		});
	});
});
