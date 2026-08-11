import type { ConversationEvent } from "../protocol";
import { isConversationEvent, isUIAction } from "../protocol/validation";
import { redactSecrets } from "../security/redaction";
import type {
	AppendResult,
	ConversationEventStore,
	EventStoreCheckpoint,
	EventStoreDiagnostic,
	PendingUIAction,
	PendingLearnerResponse,
	SessionReplay,
	StorageLike,
	DurableProjectionOptions,
} from "./types";

interface StoredSession {
	format: 1;
	events: ConversationEvent[];
	pendingActions: PendingUIAction[];
	pendingLearnerResponses: PendingLearnerResponse[];
	checkpoint?: EventStoreCheckpoint;
}

const emptySession = (): StoredSession => ({ format: 1, events: [], pendingActions: [], pendingLearnerResponses: [] });

function isPendingAction(value: unknown): value is PendingUIAction {
	if (!value || typeof value !== "object") return false;
	const pending = value as Partial<PendingUIAction>;
	return typeof pending.sessionId === "string" && !!pending.sessionId
		&& typeof pending.runId === "string" && !!pending.runId
		&& typeof pending.createdAt === "string" && Number.isFinite(Date.parse(pending.createdAt))
		&& isUIAction(pending.action);
}

function isPendingLearnerResponse(value: unknown): value is PendingLearnerResponse {
	if (!value || typeof value !== "object") return false;
	const pending = value as Partial<PendingLearnerResponse>;
	return pending.version === 1
		&& typeof pending.sessionId === "string" && !!pending.sessionId
		&& typeof pending.receiptId === "string" && !!pending.receiptId
		&& typeof pending.uiActionId === "string" && !!pending.uiActionId
		&& typeof pending.sessionMessageId === "string" && !!pending.sessionMessageId
		&& typeof pending.serialized === "string" && !!pending.serialized
		&& typeof pending.createdAt === "string" && Number.isFinite(Date.parse(pending.createdAt));
}

/** Produces the privacy-safe event representation written to durable storage. */
export function projectDurableEvent(event: ConversationEvent, options: DurableProjectionOptions = {}): ConversationEvent | null {
	if (!isConversationEvent(event)) return null;
	if (event.type === "audio.delta") return null;
	if (event.type === "transcript.delta" && !options.persistTranscripts) return null;

	let projected: ConversationEvent = event;
	if (event.type === "tool.requested") projected = { ...event, payload: { ...event.payload, arguments: {} } };
	else if (event.type === "tool.progress") projected = { ...event, payload: { ...event.payload, update: null } };
	else if (event.type === "tool.completed") projected = { ...event, payload: { ...event.payload, result: null } };

	const redacted = { ...projected, payload: redactSecrets(projected.payload) } as ConversationEvent;
	return isConversationEvent(redacted) ? redacted : null;
}

function projectPendingAction(pending: PendingUIAction): PendingUIAction | null {
	if (!isPendingAction(pending)) return null;
	const action = redactSecrets(pending.action) as PendingUIAction["action"];
	return isUIAction(action) ? { ...pending, action } : null;
}

function normalizeSession(value: unknown, key: string, diagnostics: EventStoreDiagnostic[]): StoredSession {
	if (!value || typeof value !== "object") {
		diagnostics.push({ code: "corrupt-record", key, message: "Session record is not an object" });
		return emptySession();
	}
	const record = value as Partial<StoredSession>;
	if (record.format !== 1 || !Array.isArray(record.events) || !Array.isArray(record.pendingActions)) {
		diagnostics.push({ code: "corrupt-record", key, message: "Session record has an unsupported shape" });
		return emptySession();
	}
	const events = record.events.filter((event) => {
		const valid = isConversationEvent(event);
		if (!valid) diagnostics.push({ code: "invalid-event", key, message: "Ignored an invalid stored event" });
		return valid;
	});
	const pendingActions = record.pendingActions.filter((action) => {
		const valid = isPendingAction(action);
		if (!valid) diagnostics.push({ code: "corrupt-record", key, message: "Ignored an invalid pending UI action" });
		return valid;
	});
	const pendingLearnerResponses = (Array.isArray(record.pendingLearnerResponses)
		? record.pendingLearnerResponses
		: []).filter((response) => {
			const valid = isPendingLearnerResponse(response);
			if (!valid) diagnostics.push({ code: "corrupt-record", key, message: "Ignored an invalid pending learner response" });
			return valid;
		});
	return { format: 1, events, pendingActions, pendingLearnerResponses, checkpoint: record.checkpoint };
}

export interface StorageEventStoreOptions {
	prefix?: string;
	onDiagnostic?: (diagnostic: EventStoreDiagnostic) => void;
	durable?: DurableProjectionOptions;
}

export class StorageConversationEventStore implements ConversationEventStore {
	private readonly prefix: string;
	private readonly onDiagnostic?: (diagnostic: EventStoreDiagnostic) => void;
	private readonly durable: DurableProjectionOptions;

	constructor(private readonly storage: StorageLike, options: StorageEventStoreOptions = {}) {
		this.prefix = options.prefix ?? "keating:conversation-events:v1";
		this.onDiagnostic = options.onDiagnostic;
		this.durable = options.durable ?? {};
	}

	append(event: ConversationEvent): AppendResult {
		if (!isConversationEvent(event)) {
			this.diagnose({ code: "invalid-event", key: this.sessionKey(String((event as { sessionId?: unknown }).sessionId ?? "invalid")), message: "Rejected an invalid event" });
			return { appended: false, eventCount: 0 };
		}
		const session = this.read(event.sessionId).record;
		if (session.events.some((existing) => existing.id === event.id)) {
			return { appended: false, eventCount: session.events.length };
		}
		const durableEvent = projectDurableEvent(event, this.durable);
		if (!durableEvent) return { appended: false, eventCount: session.events.length };
		session.events.push(durableEvent);
		session.events.sort((a, b) => a.sequence - b.sequence || a.timestamp.localeCompare(b.timestamp));
		this.write(event.sessionId, session);
		this.addToIndex(event.sessionId);
		return { appended: true, eventCount: session.events.length };
	}

	appendMany(events: readonly ConversationEvent[]): { appended: number; eventCount: number } {
		let appended = 0;
		let eventCount = 0;
		for (const event of events) {
			const result = this.append(event);
			if (result.appended) appended++;
			eventCount = result.eventCount;
		}
		return { appended, eventCount };
	}

	replay(sessionId: string): SessionReplay {
		const { record, diagnostics } = this.read(sessionId);
		return {
			sessionId,
			events: [...record.events].sort((a, b) => a.sequence - b.sequence || a.timestamp.localeCompare(b.timestamp)),
			checkpoint: record.checkpoint,
			diagnostics,
		};
	}

	listSessionIds(): string[] {
		const key = this.indexKey();
		try {
			const raw = this.storage.getItem(key);
			if (raw === null) return [];
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return [...new Set(parsed)].sort();
			this.diagnose({ code: "corrupt-record", key, message: "Session index has an unsupported shape" });
		} catch (error) {
			this.diagnose({ code: "corrupt-record", key, message: error instanceof Error ? error.message : String(error) });
		}
		return [];
	}

	putPendingAction(action: PendingUIAction): void {
		const durableAction = projectPendingAction(action);
		if (!durableAction) {
			this.diagnose({ code: "corrupt-record", key: this.sessionKey(String((action as { sessionId?: unknown }).sessionId ?? "invalid")), message: "Rejected an invalid pending UI action" });
			return;
		}
		const session = this.read(durableAction.sessionId).record;
		const index = session.pendingActions.findIndex((item) => item.action.id === durableAction.action.id);
		if (index >= 0) session.pendingActions[index] = durableAction;
		else session.pendingActions.push(durableAction);
		this.write(durableAction.sessionId, session);
		this.addToIndex(durableAction.sessionId);
	}

	listPendingActions(sessionId: string): PendingUIAction[] {
		return [...this.read(sessionId).record.pendingActions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	removePendingAction(sessionId: string, actionId: string): boolean {
		const session = this.read(sessionId).record;
		const next = session.pendingActions.filter((item) => item.action.id !== actionId);
		if (next.length === session.pendingActions.length) return false;
		session.pendingActions = next;
		this.write(sessionId, session);
		return true;
	}

	putPendingLearnerResponse(response: PendingLearnerResponse): void {
		if (!isPendingLearnerResponse(response)) {
			this.diagnose({ code: "corrupt-record", key: this.sessionKey(String((response as { sessionId?: unknown }).sessionId ?? "invalid")), message: "Rejected an invalid pending learner response" });
			return;
		}
		const session = this.read(response.sessionId).record;
		const index = session.pendingLearnerResponses.findIndex((item) => item.receiptId === response.receiptId);
		if (index >= 0) {
			if (JSON.stringify(session.pendingLearnerResponses[index]) !== JSON.stringify(response)) {
				this.diagnose({ code: "corrupt-record", key: this.sessionKey(response.sessionId), message: "Rejected a conflicting pending learner response" });
			}
			return;
		}
		session.pendingLearnerResponses.push(response);
		this.write(response.sessionId, session);
		this.addToIndex(response.sessionId);
	}

	listPendingLearnerResponses(sessionId: string): PendingLearnerResponse[] {
		return [...this.read(sessionId).record.pendingLearnerResponses]
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.receiptId.localeCompare(b.receiptId));
	}

	removePendingLearnerResponse(sessionId: string, receiptId: string): boolean {
		const session = this.read(sessionId).record;
		const next = session.pendingLearnerResponses.filter((item) => item.receiptId !== receiptId);
		if (next.length === session.pendingLearnerResponses.length) return false;
		session.pendingLearnerResponses = next;
		this.write(sessionId, session);
		return true;
	}

	compact(sessionId: string, checkpoint: EventStoreCheckpoint): SessionReplay {
		const session = this.read(sessionId).record;
		session.events = session.events.filter((event) => event.sequence > checkpoint.throughSequence);
		session.checkpoint = checkpoint;
		this.write(sessionId, session);
		this.addToIndex(sessionId);
		return this.replay(sessionId);
	}

	clearSession(sessionId: string): void {
		this.storage.removeItem(this.sessionKey(sessionId));
		this.writeIndex(this.listSessionIds().filter((id) => id !== sessionId));
	}

	private read(sessionId: string): { record: StoredSession; diagnostics: EventStoreDiagnostic[] } {
		const key = this.sessionKey(sessionId);
		const diagnostics: EventStoreDiagnostic[] = [];
		try {
			const raw = this.storage.getItem(key);
			if (raw === null) return { record: emptySession(), diagnostics };
			const record = normalizeSession(JSON.parse(raw) as unknown, key, diagnostics);
			for (const diagnostic of diagnostics) this.diagnose(diagnostic);
			return { record, diagnostics };
		} catch (error) {
			const diagnostic: EventStoreDiagnostic = {
				code: "corrupt-record",
				key,
				message: error instanceof Error ? error.message : String(error),
			};
			diagnostics.push(diagnostic);
			this.diagnose(diagnostic);
			return { record: emptySession(), diagnostics };
		}
	}

	private write(sessionId: string, record: StoredSession): void {
		this.storage.setItem(this.sessionKey(sessionId), JSON.stringify(record));
	}

	private addToIndex(sessionId: string): void {
		const ids = this.listSessionIds();
		if (!ids.includes(sessionId)) this.writeIndex([...ids, sessionId].sort());
	}

	private writeIndex(ids: string[]): void {
		this.storage.setItem(this.indexKey(), JSON.stringify(ids));
	}

	private sessionKey(sessionId: string): string {
		return `${this.prefix}:session:${encodeURIComponent(sessionId)}`;
	}

	private indexKey(): string {
		return `${this.prefix}:sessions`;
	}

	private diagnose(diagnostic: EventStoreDiagnostic): void {
		this.onDiagnostic?.(diagnostic);
	}
}
