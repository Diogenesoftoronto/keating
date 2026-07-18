import type {
	ConversationEvent,
	ConversationRole,
	JsonValue,
	ProtocolError,
	UIAction,
	UIDocument,
} from "./events";

export interface ConversationMessageState {
	id: string;
	role: ConversationRole;
	text: string;
	completed: boolean;
}

export interface AudioStreamState {
	id: string;
	messageId?: string;
	role: "user" | "assistant";
	encoding: string;
	sampleRate?: number;
	chunks: string[];
}

export interface TranscriptState {
	id: string;
	messageId?: string;
	role: "user" | "assistant";
	text: string;
	final: boolean;
}

export type ToolCallStatus = "requested" | "running" | "completed" | "failed" | "cancelled";
export interface ToolCallState {
	id: string;
	name: string;
	arguments: Record<string, JsonValue>;
	status: ToolCallStatus;
	updates: JsonValue[];
	result?: JsonValue;
	error?: ProtocolError;
	cancelReason?: string;
}

export interface ConversationState {
	protocolVersion: 1;
	sessionId?: string;
	runId?: string;
	status: "idle" | "active" | "reconnecting" | "completed" | "error";
	mode?: "text" | "voice" | "multimodal";
	lastSequence: number;
	processedEventIds: string[];
	messageOrder: string[];
	messages: Record<string, ConversationMessageState>;
	audioStreams: Record<string, AudioStreamState>;
	transcripts: Record<string, TranscriptState>;
	toolCalls: Record<string, ToolCallState>;
	uiDocuments: Record<string, UIDocument>;
	uiActions: UIAction[];
	interruption?: Extract<ConversationEvent, { type: "conversation.interrupted" }>["payload"];
	reconnectAttempt?: number;
	errors: ProtocolError[];
	completionReason?: Extract<ConversationEvent, { type: "run.completed" }>["payload"]["reason"];
}

export function initialConversationState(): ConversationState {
	return {
		protocolVersion: 1,
		status: "idle",
		lastSequence: -1,
		processedEventIds: [],
		messageOrder: [],
		messages: {},
		audioStreams: {},
		transcripts: {},
		toolCalls: {},
		uiDocuments: {},
		uiActions: [],
		errors: [],
	};
}

function toolCall(state: ConversationState, callId: string): ToolCallState {
	return state.toolCalls[callId] ?? {
		id: callId,
		name: "unknown",
		arguments: {},
		status: "requested",
		updates: [],
	};
}

/**
 * Pure event-log reducer. Duplicate IDs and stale sequence numbers are ignored,
 * making replay and reconnect resume safe. Events are expected to be reduced in
 * ascending sequence order within one run.
 */
export function reduceConversation(state: ConversationState, event: ConversationEvent): ConversationState {
	if (event.version !== state.protocolVersion) return state;
	if (state.processedEventIds.includes(event.id) || event.sequence <= state.lastSequence) return state;
	if (state.sessionId && state.sessionId !== event.sessionId) return state;
	if (state.runId && state.runId !== event.runId) return state;

	let next: ConversationState = {
		...state,
		sessionId: event.sessionId,
		runId: event.runId,
		lastSequence: event.sequence,
		processedEventIds: [...state.processedEventIds, event.id],
	};

	switch (event.type) {
		case "run.started":
			return { ...next, status: "active", mode: event.payload.mode, completionReason: undefined };
		case "text.delta": {
			const current = state.messages[event.payload.messageId];
			const isNew = !current;
			const message: ConversationMessageState = current
				? { ...current, text: current.text + event.payload.delta }
				: { id: event.payload.messageId, role: event.payload.role, text: event.payload.delta, completed: false };
			return {
				...next,
				messageOrder: isNew ? [...state.messageOrder, message.id] : state.messageOrder,
				messages: { ...state.messages, [message.id]: message },
			};
		}
		case "message.completed": {
			const current = state.messages[event.payload.messageId];
			if (!current) return next;
			return { ...next, messages: { ...state.messages, [current.id]: { ...current, completed: true } } };
		}
		case "audio.delta": {
			const current = state.audioStreams[event.payload.streamId];
			const stream: AudioStreamState = current
				? { ...current, chunks: [...current.chunks, event.payload.data] }
				: { ...event.payload, id: event.payload.streamId, chunks: [event.payload.data] };
			return { ...next, audioStreams: { ...state.audioStreams, [stream.id]: stream } };
		}
		case "transcript.delta": {
			const current = state.transcripts[event.payload.transcriptId];
			const transcript: TranscriptState = current
				? { ...current, text: current.text + event.payload.delta, final: event.payload.final }
				: {
					id: event.payload.transcriptId,
					messageId: event.payload.messageId,
					role: event.payload.role,
					text: event.payload.delta,
					final: event.payload.final,
				};
			return { ...next, transcripts: { ...state.transcripts, [transcript.id]: transcript } };
		}
		case "tool.requested":
			return {
				...next,
				toolCalls: {
					...state.toolCalls,
					[event.payload.callId]: {
						id: event.payload.callId,
						name: event.payload.name,
						arguments: event.payload.arguments,
						status: "requested",
						updates: [],
					},
				},
			};
		case "tool.started": {
			const call = toolCall(state, event.payload.callId);
			return { ...next, toolCalls: { ...state.toolCalls, [call.id]: { ...call, status: "running" } } };
		}
		case "tool.progress": {
			const call = toolCall(state, event.payload.callId);
			return { ...next, toolCalls: { ...state.toolCalls, [call.id]: { ...call, updates: [...call.updates, event.payload.update] } } };
		}
		case "tool.completed": {
			const call = toolCall(state, event.payload.callId);
			return { ...next, toolCalls: { ...state.toolCalls, [call.id]: { ...call, status: "completed", result: event.payload.result } } };
		}
		case "tool.failed": {
			const call = toolCall(state, event.payload.callId);
			return { ...next, toolCalls: { ...state.toolCalls, [call.id]: { ...call, status: "failed", error: event.payload.error } } };
		}
		case "tool.cancelled": {
			const call = toolCall(state, event.payload.callId);
			return { ...next, toolCalls: { ...state.toolCalls, [call.id]: { ...call, status: "cancelled", cancelReason: event.payload.reason } } };
		}
		case "ui.document.upserted": {
			const previous = state.uiDocuments[event.payload.document.id];
			if (previous && previous.revision >= event.payload.document.revision) return next;
			return { ...next, uiDocuments: { ...state.uiDocuments, [event.payload.document.id]: event.payload.document } };
		}
		case "ui.action": {
			const action = event.payload.action;
			const document = state.uiDocuments[action.documentId];
			if (!document || document.revision !== action.documentRevision || state.uiActions.some((item) => item.id === action.id)) return state;
			return { ...next, uiActions: [...state.uiActions, action] };
		}
		case "conversation.interrupted":
			return { ...next, status: "active", interruption: event.payload };
		case "reconnect.started":
			return { ...next, status: "reconnecting", reconnectAttempt: event.payload.attempt };
		case "reconnect.succeeded":
			return { ...next, status: "active", reconnectAttempt: undefined };
		case "reconnect.failed":
			return {
				...next,
				status: event.payload.retryable ? "reconnecting" : "error",
				reconnectAttempt: event.payload.attempt,
				errors: [...state.errors, event.payload.error],
			};
		case "error":
			return { ...next, status: event.payload.fatal ? "error" : state.status, errors: [...state.errors, event.payload.error] };
		case "run.completed":
			return {
				...next,
				status: event.payload.reason === "error" ? "error" : "completed",
				completionReason: event.payload.reason,
			};
	}
}

export function replayConversation(events: readonly ConversationEvent[]): ConversationState {
	return events.reduce(reduceConversation, initialConversationState());
}
