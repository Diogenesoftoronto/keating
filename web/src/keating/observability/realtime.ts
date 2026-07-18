import type {
	RealtimeTelemetryAttributes,
	RealtimeTelemetryClock,
	RealtimeTelemetryEventName,
	RealtimeTelemetryObserver,
} from "./types";

const SAFE_ATTRIBUTE_KEYS = new Set([
	"provider", "model", "transport", "outcome", "reason", "errorCode",
	"attempt", "turn", "toolName", "partyCount", "telephony", "recording",
	"serverMediaWorkers",
]);

export interface RealtimeTelemetry {
	emit(name: RealtimeTelemetryEventName, attributes?: RealtimeTelemetryAttributes, durationMs?: number): void;
	start(): number;
	durationSince(startedAt: number): number;
}

export function createRealtimeTelemetry(
	observer?: RealtimeTelemetryObserver,
	clock: RealtimeTelemetryClock = { now: () => Date.now() },
): RealtimeTelemetry {
	return {
		emit(name, attributes, durationMs) {
			if (!observer) return;
			const safeAttributes = attributes
				? Object.fromEntries(Object.entries(attributes).filter(([key]) => SAFE_ATTRIBUTE_KEYS.has(key)))
				: undefined;
			try {
				observer.onEvent({ name, timestampMs: clock.now(), durationMs, attributes: safeAttributes });
			} catch {
				// Telemetry must never affect a live conversation.
			}
		},
		start: () => clock.now(),
		durationSince: (startedAt) => Math.max(0, clock.now() - startedAt),
	};
}

export interface RealtimeTransportRequirements {
	partyCount?: number;
	telephony?: boolean;
	recording?: boolean;
	serverMediaWorkers?: boolean;
}

export interface RealtimeTransportRecommendation {
	transport: "direct-webrtc" | "livekit";
	reasons: string[];
}

export function recommendRealtimeTransport(
	requirements: RealtimeTransportRequirements,
): RealtimeTransportRecommendation {
	const reasons: string[] = [];
	if ((requirements.partyCount ?? 2) > 2) reasons.push("multi-party session");
	if (requirements.telephony) reasons.push("telephony integration");
	if (requirements.recording) reasons.push("server-side recording");
	if (requirements.serverMediaWorkers) reasons.push("server media workers");
	return reasons.length > 0
		? { transport: "livekit", reasons }
		: { transport: "direct-webrtc", reasons: ["single-user provider session"] };
}

