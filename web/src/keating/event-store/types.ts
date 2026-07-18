import type { ConversationEvent, JsonValue, UIAction } from "../protocol";

export interface EventStoreCheckpoint {
	throughSequence: number;
	createdAt: string;
	compactedEventCount: number;
	snapshot?: JsonValue;
}

export interface PendingUIAction {
	sessionId: string;
	runId: string;
	action: UIAction;
	createdAt: string;
}

export interface EventStoreDiagnostic {
	code: "corrupt-record" | "invalid-event" | "storage-error";
	key: string;
	message: string;
}

export interface SessionReplay {
	sessionId: string;
	events: ConversationEvent[];
	checkpoint?: EventStoreCheckpoint;
	diagnostics: EventStoreDiagnostic[];
}

export interface AppendResult {
	appended: boolean;
	eventCount: number;
}

export interface DurableProjectionOptions {
	/** Transcripts may contain sensitive spoken content and are ephemeral unless the user explicitly opts in. */
	persistTranscripts?: boolean;
}

export interface ConversationEventStore {
	append(event: ConversationEvent): AppendResult;
	appendMany(events: readonly ConversationEvent[]): { appended: number; eventCount: number };
	replay(sessionId: string): SessionReplay;
	listSessionIds(): string[];
	putPendingAction(action: PendingUIAction): void;
	listPendingActions(sessionId: string): PendingUIAction[];
	removePendingAction(sessionId: string, actionId: string): boolean;
	compact(sessionId: string, checkpoint: EventStoreCheckpoint): SessionReplay;
	clearSession(sessionId: string): void;
}

/** The common subset of Web Storage and small IndexedDB-backed key/value shims. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}
