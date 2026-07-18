import { CONVERSATION_PROTOCOL_VERSION, type ConversationEvent, type JsonValue, type UIAction } from "./events";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown) => value === undefined || text(value);
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
	if (value === null || text(value) || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || ancestors.has(value)) return false;
	ancestors.add(value);
	const valid = Array.isArray(value)
		? value.every((entry) => isJsonValue(entry, ancestors))
		: Object.entries(value as Record<string, unknown>).every(([key, entry]) => key !== "__proto__" && isJsonValue(entry, ancestors));
	ancestors.delete(value);
	return valid;
}

const protocolError = (value: unknown) => object(value) && text(value.code) && text(value.message) && optionalText(value.provider)
	&& (value.details === undefined || isJsonValue(value.details));

export function isUIAction(value: unknown): value is UIAction {
	return object(value) && text(value.id) && !!value.id && text(value.documentId) && !!value.documentId
		&& natural(value.documentRevision) && text(value.type) && !!value.type && object(value.params) && isJsonValue(value.params)
		&& (value.formState === undefined || (object(value.formState) && isJsonValue(value.formState))) && optionalText(value.humanFriendlyMessage);
}

function validDocument(value: unknown): boolean {
	return object(value) && text(value.id) && text(value.kind) && ["ephemeral", "resumable", "workspace"].includes(String(value.lifecycle))
		&& natural(value.revision) && isJsonValue(value.content) && (value.state === undefined || (object(value.state) && isJsonValue(value.state)));
}

function validPayload(type: string, p: unknown): boolean {
	if (!object(p)) return false;
	switch (type) {
		case "run.started": return ["text", "voice", "multimodal"].includes(String(p.mode));
		case "text.delta": return text(p.messageId) && ["user", "assistant", "system", "tool"].includes(String(p.role)) && text(p.delta);
		case "audio.delta": return text(p.streamId) && optionalText(p.messageId) && ["user", "assistant"].includes(String(p.role)) && ["pcm16", "g711_ulaw", "g711_alaw", "opus", "mp3", "wav", "webm"].includes(String(p.encoding)) && (p.sampleRate === undefined || natural(p.sampleRate)) && text(p.data);
		case "transcript.delta": return text(p.transcriptId) && optionalText(p.messageId) && ["user", "assistant"].includes(String(p.role)) && text(p.delta) && typeof p.final === "boolean";
		case "message.completed": return text(p.messageId);
		case "tool.requested": return text(p.callId) && text(p.name) && object(p.arguments) && isJsonValue(p.arguments);
		case "tool.started": return text(p.callId);
		case "tool.progress": return text(p.callId) && isJsonValue(p.update);
		case "tool.completed": return text(p.callId) && isJsonValue(p.result);
		case "tool.failed": return text(p.callId) && protocolError(p.error);
		case "tool.cancelled": return text(p.callId) && optionalText(p.reason);
		case "ui.document.upserted": return validDocument(p.document);
		case "ui.action": return isUIAction(p.action);
		case "conversation.interrupted": return ["user", "host", "provider"].includes(String(p.by)) && optionalText(p.reason) && optionalText(p.atMessageId) && optionalText(p.atAudioStreamId);
		case "reconnect.started": return natural(p.attempt) && optionalText(p.reason);
		case "reconnect.succeeded": return natural(p.attempt) && (p.resumedFromSequence === undefined || natural(p.resumedFromSequence));
		case "reconnect.failed": return natural(p.attempt) && protocolError(p.error) && typeof p.retryable === "boolean";
		case "error": return protocolError(p.error) && typeof p.fatal === "boolean";
		case "run.completed": return ["completed", "cancelled", "interrupted", "error"].includes(String(p.reason));
		default: return false;
	}
}

export function isConversationEvent(value: unknown): value is ConversationEvent {
	return object(value) && value.version === CONVERSATION_PROTOCOL_VERSION && text(value.id) && !!value.id && natural(value.sequence)
		&& text(value.timestamp) && Number.isFinite(Date.parse(value.timestamp)) && text(value.sessionId) && !!value.sessionId
		&& text(value.runId) && !!value.runId && text(value.type) && validPayload(value.type, value.payload);
}
