export const CONVERSATION_PROTOCOL_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ConversationRole = "user" | "assistant" | "system" | "tool";
export type AudioEncoding = "pcm16" | "g711_ulaw" | "g711_alaw" | "opus" | "mp3" | "wav" | "webm";

interface EventEnvelope<TType extends string, TPayload> {
	version: typeof CONVERSATION_PROTOCOL_VERSION;
	id: string;
	sequence: number;
	timestamp: string;
	sessionId: string;
	runId: string;
	type: TType;
	payload: TPayload;
}

export interface UIDocument {
	id: string;
	kind: string;
	lifecycle: "ephemeral" | "resumable" | "workspace";
	revision: number;
	content: JsonValue;
	state?: Record<string, JsonValue>;
}

export interface UIAction {
	id: string;
	documentId: string;
	documentRevision: number;
	type: string;
	params: Record<string, JsonValue>;
	formState?: Record<string, JsonValue>;
	humanFriendlyMessage?: string;
}

export type ConversationEvent =
	| EventEnvelope<"run.started", { mode: "text" | "voice" | "multimodal" }>
	| EventEnvelope<"text.delta", {
		messageId: string;
		role: ConversationRole;
		delta: string;
	}>
	| EventEnvelope<"audio.delta", {
		streamId: string;
		messageId?: string;
		role: "user" | "assistant";
		encoding: AudioEncoding;
		sampleRate?: number;
		data: string;
	}>
	| EventEnvelope<"transcript.delta", {
		transcriptId: string;
		messageId?: string;
		role: "user" | "assistant";
		delta: string;
		final: boolean;
	}>
	| EventEnvelope<"message.completed", { messageId: string }>
	| EventEnvelope<"tool.requested", {
		callId: string;
		name: string;
		arguments: Record<string, JsonValue>;
	}>
	| EventEnvelope<"tool.started", { callId: string }>
	| EventEnvelope<"tool.progress", { callId: string; update: JsonValue }>
	| EventEnvelope<"tool.completed", { callId: string; result: JsonValue }>
	| EventEnvelope<"tool.failed", { callId: string; error: ProtocolError }>
	| EventEnvelope<"tool.cancelled", { callId: string; reason?: string }>
	| EventEnvelope<"ui.document.upserted", { document: UIDocument }>
	| EventEnvelope<"ui.action", { action: UIAction }>
	| EventEnvelope<"conversation.interrupted", {
		by: "user" | "host" | "provider";
		reason?: string;
		atMessageId?: string;
		atAudioStreamId?: string;
	}>
	| EventEnvelope<"reconnect.started", { attempt: number; reason?: string }>
	| EventEnvelope<"reconnect.succeeded", { attempt: number; resumedFromSequence?: number }>
	| EventEnvelope<"reconnect.failed", { attempt: number; error: ProtocolError; retryable: boolean }>
	| EventEnvelope<"error", { error: ProtocolError; fatal: boolean }>
	| EventEnvelope<"run.completed", { reason: "completed" | "cancelled" | "interrupted" | "error" }>;

export interface ProtocolError {
	code: string;
	message: string;
	provider?: string;
	details?: JsonValue;
}

export type EventOfType<T extends ConversationEvent["type"]> = Extract<ConversationEvent, { type: T }>;

export interface EventMetadata {
	id: string;
	sequence: number;
	timestamp: string;
	sessionId: string;
	runId: string;
}

export function conversationEvent<T extends ConversationEvent["type"]>(
	type: T,
	payload: EventOfType<T>["payload"],
	metadata: EventMetadata,
): EventOfType<T> {
	return {
		version: CONVERSATION_PROTOCOL_VERSION,
		type,
		payload,
		...metadata,
	} as EventOfType<T>;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const optionalString = (value: unknown): boolean => value === undefined || string(value);

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
	if (value === null || string(value) || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return true;
	if (typeof value !== "object" || seen.has(value)) return false;
	seen.add(value);
	return Array.isArray(value)
		? value.every((item) => isJsonValue(item, seen))
		: Object.entries(value as Record<string, unknown>).every(([key, item]) => key !== "__proto__" && isJsonValue(item, seen));
}

function isError(value: unknown): boolean {
	return object(value) && string(value.code) && string(value.message) && optionalString(value.provider)
		&& (value.details === undefined || isJsonValue(value.details));
}

function isDocument(value: unknown): value is UIDocument {
	return object(value) && string(value.id) && !!value.id && string(value.kind) && integer(value.revision) && value.revision >= 0
		&& ["ephemeral", "resumable", "workspace"].includes(String(value.lifecycle)) && isJsonValue(value.content)
		&& (value.state === undefined || (object(value.state) && isJsonValue(value.state)));
}

export function isUIAction(value: unknown): value is UIAction {
	return object(value) && string(value.id) && !!value.id && string(value.documentId) && !!value.documentId
		&& integer(value.documentRevision) && value.documentRevision >= 0 && string(value.type) && !!value.type
		&& object(value.params) && isJsonValue(value.params)
		&& (value.formState === undefined || (object(value.formState) && isJsonValue(value.formState)))
		&& optionalString(value.humanFriendlyMessage);
}

/** Strict guard for events crossing provider, RPC, persistence, or window boundaries. */
export function isConversationEvent(value: unknown): value is ConversationEvent {
	if (!object(value) || value.version !== CONVERSATION_PROTOCOL_VERSION || !string(value.id) || !value.id
		|| !integer(value.sequence) || value.sequence < 0 || !string(value.timestamp) || !Number.isFinite(Date.parse(value.timestamp))
		|| !string(value.sessionId) || !value.sessionId || !string(value.runId) || !value.runId || !string(value.type) || !object(value.payload)) return false;
	const payload = value.payload;
	switch (value.type) {
		case "run.started": return ["text", "voice", "multimodal"].includes(String(payload.mode));
		case "text.delta": return string(payload.messageId) && string(payload.delta) && ["user", "assistant", "system", "tool"].includes(String(payload.role));
		case "audio.delta": return string(payload.streamId) && string(payload.data) && optionalString(payload.messageId) && ["user", "assistant"].includes(String(payload.role)) && ["pcm16", "g711_ulaw", "g711_alaw", "opus", "mp3", "wav", "webm"].includes(String(payload.encoding));
		case "transcript.delta": return string(payload.transcriptId) && string(payload.delta) && typeof payload.final === "boolean" && optionalString(payload.messageId) && ["user", "assistant"].includes(String(payload.role));
		case "message.completed": return string(payload.messageId);
		case "tool.requested": return string(payload.callId) && string(payload.name) && object(payload.arguments) && isJsonValue(payload.arguments);
		case "tool.started": return string(payload.callId);
		case "tool.progress": return string(payload.callId) && isJsonValue(payload.update);
		case "tool.completed": return string(payload.callId) && isJsonValue(payload.result);
		case "tool.failed": return string(payload.callId) && isError(payload.error);
		case "tool.cancelled": return string(payload.callId) && optionalString(payload.reason);
		case "ui.document.upserted": return isDocument(payload.document);
		case "ui.action": return isUIAction(payload.action);
		case "conversation.interrupted": return ["user", "host", "provider"].includes(String(payload.by)) && optionalString(payload.reason) && optionalString(payload.atMessageId) && optionalString(payload.atAudioStreamId);
		case "reconnect.started": return integer(payload.attempt) && payload.attempt >= 0 && optionalString(payload.reason);
		case "reconnect.succeeded": return integer(payload.attempt) && payload.attempt >= 0 && (payload.resumedFromSequence === undefined || integer(payload.resumedFromSequence));
		case "reconnect.failed": return integer(payload.attempt) && payload.attempt >= 0 && isError(payload.error) && typeof payload.retryable === "boolean";
		case "error": return isError(payload.error) && typeof payload.fatal === "boolean";
		case "run.completed": return ["completed", "cancelled", "interrupted", "error"].includes(String(payload.reason));
		default: return false;
	}
}
