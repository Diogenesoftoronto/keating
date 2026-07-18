import { describe, expect, test } from "bun:test";
import {
	createRealtimeTelemetry,
	recommendRealtimeTransport,
	type RealtimeTelemetryEvent,
} from "../../keating/observability";

describe("realtime observability", () => {
	test("emits only approved privacy-safe attributes", () => {
		const events: RealtimeTelemetryEvent[] = [];
		const telemetry = createRealtimeTelemetry(
			{ onEvent: (event) => events.push(event) },
			{ now: () => 42 },
		);
		telemetry.emit("tool.completed", {
			provider: "openai",
			toolName: "web_search",
			outcome: "success",
			// Deliberately attempt to inject content-bearing fields.
			transcript: "private learner text",
			arguments: "secret arguments",
			apiKey: "sk-test",
		} as Record<string, string>);

		expect(events).toEqual([{
			name: "tool.completed",
			timestampMs: 42,
			durationMs: undefined,
			attributes: { provider: "openai", toolName: "web_search", outcome: "success" },
		}]);
	});

	test("isolates observer failures", () => {
		const telemetry = createRealtimeTelemetry({ onEvent: () => { throw new Error("collector down"); } });
		expect(() => telemetry.emit("session.completed", { outcome: "completed" })).not.toThrow();
	});

	test("uses direct WebRTC for a simple one-user provider session", () => {
		expect(recommendRealtimeTransport({})).toEqual({
			transport: "direct-webrtc",
			reasons: ["single-user provider session"],
		});
	});

	test("recommends LiveKit only when media infrastructure is required", () => {
		expect(recommendRealtimeTransport({ partyCount: 3 }).transport).toBe("livekit");
		expect(recommendRealtimeTransport({ telephony: true }).transport).toBe("livekit");
		expect(recommendRealtimeTransport({ recording: true }).transport).toBe("livekit");
		expect(recommendRealtimeTransport({ serverMediaWorkers: true }).transport).toBe("livekit");
	});
});
