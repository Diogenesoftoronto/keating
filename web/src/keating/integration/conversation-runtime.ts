import { StorageConversationEventStore, type ConversationEventStore, type StorageLike } from "../event-store";
import type { PendingLearnerResponse } from "../event-store/types";
import { conversationEvent, isConversationEvent, replayConversation, type ConversationEvent, type ConversationState, type EventOfType, type JsonValue } from "../protocol";

export interface ConversationRuntime {
	emit<T extends ConversationEvent["type"]>(type: T, payload: EventOfType<T>["payload"]): EventOfType<T>;
	accept(event: ConversationEvent): boolean;
	replay(): ConversationState;
	pendingActions(): ReturnType<ConversationEventStore["listPendingActions"]>;
	resolveAction(actionId: string): boolean;
	putPendingLearnerResponse(response: Omit<PendingLearnerResponse, "sessionId">): void;
	pendingLearnerResponses(): PendingLearnerResponse[];
	resolveLearnerResponse(receiptId: string): boolean;
	readonly sessionId: string;
}

export interface ConversationRuntimeOptions {
	sessionId: string;
	store: ConversationEventStore;
	runId?: string;
	now?: () => Date;
	id?: () => string;
}

const fallbackId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
	? crypto.randomUUID()
	: `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createConversationRuntime(options: ConversationRuntimeOptions): ConversationRuntime {
	const now = options.now ?? (() => new Date());
	const id = options.id ?? fallbackId;
	const runId = options.runId ?? id();
	let sequence = Math.max(-1, ...options.store.replay(options.sessionId).events.map((event) => event.sequence));

	const accept = (event: ConversationEvent) => {
		if (!isConversationEvent(event) || event.sessionId !== options.sessionId || event.runId !== runId) return false;
		const replay = options.store.replay(options.sessionId).events;
		if (event.sequence <= sequence || replay.some((stored) => stored.id === event.id)) return false;
		if (event.type === "ui.document.upserted") {
			const current = replayConversation(replay).uiDocuments[event.payload.document.id];
			if (current && current.revision >= event.payload.document.revision) return false;
		}
		if (event.type === "ui.action") {
			const action = event.payload.action;
			const state = replayConversation(replay);
			const document = state.uiDocuments[action.documentId];
			if (!document || document.revision !== action.documentRevision) return false;
			if (state.uiActions.some((stored) => stored.id === action.id)) return false;
		}
		const appended = options.store.append(event).appended;
		if (appended) sequence = event.sequence;
		return appended;
	};

	return {
		sessionId: options.sessionId,
		emit(type, payload) {
			const event = conversationEvent(type, payload, {
				id: id(),
				sequence: sequence + 1,
				timestamp: now().toISOString(),
				 sessionId: options.sessionId,
				runId,
			});
			const canonicalEvent: ConversationEvent = event;
			const accepted = accept(canonicalEvent);
			if (!accepted) throw new Error(`Rejected invalid ${type} event`);
			if (canonicalEvent.type === "ui.action") {
				options.store.putPendingAction({ sessionId: canonicalEvent.sessionId, runId: canonicalEvent.runId, action: canonicalEvent.payload.action, createdAt: canonicalEvent.timestamp });
			}
			return event as EventOfType<typeof type>;
		},
		accept,
		replay: () => replayConversation(options.store.replay(options.sessionId).events),
		pendingActions: () => options.store.listPendingActions(options.sessionId),
		resolveAction: (actionId) => options.store.removePendingAction(options.sessionId, actionId),
		putPendingLearnerResponse: (response) => options.store.putPendingLearnerResponse({ ...response, sessionId: options.sessionId }),
		pendingLearnerResponses: () => options.store.listPendingLearnerResponses(options.sessionId),
		resolveLearnerResponse: (receiptId) => options.store.removePendingLearnerResponse(options.sessionId, receiptId),
	};
}

export function browserConversationRuntime(sessionId: string, storage: StorageLike): ConversationRuntime {
	return createConversationRuntime({ sessionId, store: new StorageConversationEventStore(storage) });
}

export function jsonSafe(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return String(value);
	}
}
