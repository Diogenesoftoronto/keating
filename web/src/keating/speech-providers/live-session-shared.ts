/**
 * Plumbing shared by every duplex speech provider.
 *
 * Keating drives providers at different capability tiers, but a live session
 * must look the same to the rest of the app regardless of which provider is
 * behind it — persistence, replay, and the /live surface all consume the
 * canonical event stream. Keeping the bridge and the tool-call lifecycle here
 * (rather than duplicated per provider) is what makes the tier-parity test
 * meaningful.
 */
import type { RealtimeTelemetry } from "../observability";
import {
	conversationEvent,
	type ConversationEvent,
	type JsonValue,
	type ProtocolError,
} from "../protocol";
import type { LiveSpeechToolCall } from "../speech";

export type LiveProviderId = "openai" | "google";

export function randomId(prefix: string): string {
	const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}-${id}`;
}

export function jsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return String(value);
	}
}

export function jsonRecord(value: unknown): Record<string, JsonValue> {
	const converted = jsonValue(value);
	return converted && typeof converted === "object" && !Array.isArray(converted)
		? converted as Record<string, JsonValue>
		: {};
}

export function protocolError(error: unknown, code: string, provider: LiveProviderId): ProtocolError {
	return {
		code,
		message: error instanceof Error ? error.message : String(error),
		provider,
	};
}

export interface RealtimeCanonicalBridge {
	readonly sessionId: string;
	readonly runId: string;
	emit<T extends ConversationEvent["type"]>(
		type: T,
		payload: Extract<ConversationEvent, { type: T }>["payload"],
	): void;
}

export function createRealtimeCanonicalBridge(
	onEvent?: (event: ConversationEvent) => void,
	ids: { sessionId?: string; runId?: string } = {},
): RealtimeCanonicalBridge {
	const sessionId = ids.sessionId ?? randomId("voice-session");
	const runId = ids.runId ?? randomId("voice-run");
	let sequence = 0;
	return {
		sessionId,
		runId,
		emit(type, payload) {
			if (!onEvent) return;
			onEvent(conversationEvent(type, payload as never, {
				id: randomId("voice-event"),
				sequence: sequence++,
				timestamp: new Date().toISOString(),
				sessionId,
				runId,
			}));
		},
	};
}

export interface LiveToolCallOptions {
	call: LiveSpeechToolCall;
	provider: LiveProviderId;
	canonical: RealtimeCanonicalBridge;
	telemetry: RealtimeTelemetry;
	execute: (call: LiveSpeechToolCall) => Promise<unknown>;
	/** Send a successful result back over the provider's transport. */
	respond: (callId: string, output: unknown) => void;
	/**
	 * Send a failure back over the provider's transport. Providers differ in
	 * whether they have a dedicated error shape, so each supplies its own.
	 */
	respondError: (callId: string, message: string) => void;
}

/**
 * Run one tool call through the canonical lifecycle.
 *
 * The requested/started events are emitted before execution begins so a slow
 * tool still shows up immediately in the UI, and the transport response is sent
 * on both the success and failure paths — a live session that never answers a
 * function call will stall until the provider times it out.
 */
export async function runLiveToolCall(options: LiveToolCallOptions): Promise<void> {
	const { call, provider, canonical, telemetry, execute, respond, respondError } = options;

	canonical.emit("tool.requested", {
		callId: call.callId,
		name: call.name,
		arguments: jsonRecord(call.arguments),
	});
	canonical.emit("tool.started", { callId: call.callId });
	telemetry.emit("tool.started", { provider, toolName: call.name });
	const startedAt = telemetry.start();

	try {
		const output = await execute(call);
		canonical.emit("tool.completed", { callId: call.callId, result: jsonValue(output) });
		telemetry.emit(
			"tool.completed",
			{ provider, toolName: call.name, outcome: "success" },
			telemetry.durationSince(startedAt),
		);
		respond(call.callId, output);
	} catch (error) {
		canonical.emit("tool.failed", {
			callId: call.callId,
			error: protocolError(error, "tool_execution_failed", provider),
		});
		telemetry.emit(
			"tool.completed",
			{ provider, toolName: call.name, outcome: "failed" },
			telemetry.durationSince(startedAt),
		);
		respondError(call.callId, error instanceof Error ? error.message : String(error));
	}
}

/** Parse a provider's JSON-encoded tool arguments without throwing. */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
	if (typeof raw !== "string" || raw.length === 0) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}
