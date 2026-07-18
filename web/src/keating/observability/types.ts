export type RealtimeTelemetryEventName =
	| "connection.setup.started"
	| "connection.setup.completed"
	| "audio.first"
	| "speech.turn.started"
	| "speech.turn.completed"
	| "speech.interrupted"
	| "tool.started"
	| "tool.completed"
	| "reconnect.started"
	| "reconnect.completed"
	| "session.error"
	| "session.completed";

export type RealtimeTelemetryAttributes = Readonly<Record<string, string | number | boolean>>;

export interface RealtimeTelemetryEvent {
	readonly name: RealtimeTelemetryEventName;
	readonly timestampMs: number;
	readonly durationMs?: number;
	readonly attributes?: RealtimeTelemetryAttributes;
}

export interface RealtimeTelemetryObserver {
	onEvent(event: RealtimeTelemetryEvent): void;
}

export interface RealtimeTelemetryClock {
	now(): number;
}

