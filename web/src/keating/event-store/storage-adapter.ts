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
	/** IDs absorbed by lossless stream-delta compaction. */
	compactedEventIds?: string[];
	checkpoint?: EventStoreCheckpoint;
}

const emptySession = (): StoredSession => ({ format: 1, events: [], pendingActions: [], pendingLearnerResponses: [] });

interface SessionIndexEntry {
	id: string;
	updatedAt: number;
}

interface StoredSessionIndex {
	format: 1;
	sessions: SessionIndexEntry[];
}

interface VolatileSessionEntry {
	record: StoredSession;
	updatedAt: number;
	size: number;
}

const DEFAULT_MAX_SESSION_BYTES = 256 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 16;
const MAX_COMPACTED_EVENT_IDS = 512;
const volatileSessionsByStorage = new WeakMap<StorageLike, Map<string, VolatileSessionEntry>>();

function volatileSessionsFor(storage: StorageLike): Map<string, VolatileSessionEntry> {
	let sessions = volatileSessionsByStorage.get(storage);
	if (!sessions) {
		sessions = new Map();
		volatileSessionsByStorage.set(storage, sessions);
	}
	return sessions;
}

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
	const compactedEventIds = Array.isArray(record.compactedEventIds)
		? record.compactedEventIds.filter((id): id is string => typeof id === "string" && !!id).slice(-MAX_COMPACTED_EVENT_IDS)
		: [];
	return { format: 1, events, pendingActions, pendingLearnerResponses, compactedEventIds, checkpoint: record.checkpoint };
}

export interface StorageEventStoreOptions {
	prefix?: string;
	onDiagnostic?: (diagnostic: EventStoreDiagnostic) => void;
	durable?: DurableProjectionOptions;
	/** Maximum serialized size of one durable session record. */
	maxSessionBytes?: number;
	/** Maximum serialized size of all indexed durable session records. */
	maxTotalBytes?: number;
	/** Maximum number of durable session records retained at once. */
	maxSessions?: number;
	now?: () => number;
}

export class StorageConversationEventStore implements ConversationEventStore {
	private readonly prefix: string;
	private readonly onDiagnostic?: (diagnostic: EventStoreDiagnostic) => void;
	private readonly durable: DurableProjectionOptions;
	private readonly maxSessionBytes: number;
	private readonly maxTotalBytes: number;
	private readonly maxSessions: number;
	private readonly now: () => number;
	private readonly volatileSessions: Map<string, VolatileSessionEntry>;

	constructor(private readonly storage: StorageLike, options: StorageEventStoreOptions = {}) {
		this.prefix = options.prefix ?? "keating:conversation-events:v1";
		this.onDiagnostic = options.onDiagnostic;
		this.durable = options.durable ?? {};
		this.maxSessionBytes = options.maxSessionBytes ?? DEFAULT_MAX_SESSION_BYTES;
		this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
		this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
		this.now = options.now ?? Date.now;
		this.volatileSessions = volatileSessionsFor(storage);
	}

	append(event: ConversationEvent): AppendResult {
		if (!isConversationEvent(event)) {
			this.diagnose({ code: "invalid-event", key: this.sessionKey(String((event as { sessionId?: unknown }).sessionId ?? "invalid")), message: "Rejected an invalid event" });
			return { appended: false, eventCount: 0 };
		}
		const session = this.read(event.sessionId).record;
		if (session.events.some((existing) => existing.id === event.id) || session.compactedEventIds?.includes(event.id)) {
			return { appended: false, eventCount: session.events.length };
		}
		const durableEvent = projectDurableEvent(event, this.durable);
		if (!durableEvent) return { appended: false, eventCount: session.events.length };
		this.appendCompacted(session, durableEvent);
		const persisted = this.write(event.sessionId, session);
		if (persisted) this.addToIndex(event.sessionId);
		return { appended: true, eventCount: this.read(event.sessionId).record.events.length };
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
		return [...new Set([
			...this.readIndex().map(({ id }) => id),
			...this.volatileSessions.keys(),
		])].sort();
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
		if (this.write(durableAction.sessionId, session)) this.addToIndex(durableAction.sessionId);
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
		if (this.write(response.sessionId, session)) this.addToIndex(response.sessionId);
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
		if (this.write(sessionId, session)) this.addToIndex(sessionId);
		return this.replay(sessionId);
	}

	clearSession(sessionId: string): void {
		this.volatileSessions.delete(sessionId);
		this.removeStoredSession(sessionId);
		this.writeIndex(this.readIndex().filter(({ id }) => id !== sessionId));
	}

	private read(sessionId: string): { record: StoredSession; diagnostics: EventStoreDiagnostic[] } {
		const key = this.sessionKey(sessionId);
		const diagnostics: EventStoreDiagnostic[] = [];
		const volatile = this.volatileSessions.get(sessionId);
		if (volatile) return { record: volatile.record, diagnostics };
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

	private write(sessionId: string, record: StoredSession): boolean {
		const key = this.sessionKey(sessionId);
		const serialized = JSON.stringify(record);
		if (serialized.length > this.maxSessionBytes || serialized.length > this.maxTotalBytes) {
			this.retainVolatile(sessionId, record);
			this.diagnose({
				code: "storage-error",
				key,
				message: `Session record is ${serialized.length} bytes and exceeds the durable event-store budget; retaining it in memory`,
			});
			return false;
		}

		try {
			this.storage.setItem(key, serialized);
			this.volatileSessions.delete(sessionId);
			return true;
		} catch (error) {
			this.diagnose({ code: "storage-error", key, message: error instanceof Error ? error.message : String(error) });
		}

		for (const candidate of this.prunableSessions(sessionId)) {
			this.removeStoredSession(candidate.id);
			try {
				this.storage.setItem(key, serialized);
				this.volatileSessions.delete(sessionId);
				this.writeIndex(this.readIndex().filter(({ id }) => id !== candidate.id));
				return true;
			} catch {
				// Continue freeing eligible records. The final fallback is in-memory.
			}
		}

		this.retainVolatile(sessionId, record);
		return false;
	}

	private addToIndex(sessionId: string): void {
		const entries = this.readIndex().filter(({ id }) => id !== sessionId);
		entries.push({ id: sessionId, updatedAt: this.now() });
		this.pruneRetention(entries, sessionId);
	}

	private readIndex(): SessionIndexEntry[] {
		const key = this.indexKey();
		try {
			const raw = this.storage.getItem(key);
			if (raw === null) return this.discoverOrphanedSessions();
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
				return this.mergeDiscovered(parsed.map((id) => ({ id, updatedAt: 0 })));
			}
			if (parsed && typeof parsed === "object" && (parsed as Partial<StoredSessionIndex>).format === 1) {
				const sessions = (parsed as Partial<StoredSessionIndex>).sessions;
				if (Array.isArray(sessions) && sessions.every((entry) => entry && typeof entry.id === "string" && typeof entry.updatedAt === "number")) {
					return this.mergeDiscovered(sessions);
				}
			}
			this.diagnose({ code: "corrupt-record", key, message: "Session index has an unsupported shape" });
		} catch (error) {
			this.diagnose({ code: "corrupt-record", key, message: error instanceof Error ? error.message : String(error) });
		}
		return this.discoverOrphanedSessions();
	}

	private writeIndex(entries: SessionIndexEntry[]): void {
		const key = this.indexKey();
		const deduplicated = [...new Map(entries.map((entry) => [entry.id, entry])).values()]
			.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
		try {
			this.storage.setItem(key, JSON.stringify({ format: 1, sessions: deduplicated } satisfies StoredSessionIndex));
		} catch (error) {
			this.diagnose({ code: "storage-error", key, message: error instanceof Error ? error.message : String(error) });
		}
	}

	private appendCompacted(session: StoredSession, event: ConversationEvent): void {
		const previous = session.events.at(-1);
		const mergeText = previous?.type === "text.delta" && event.type === "text.delta"
			&& previous.runId === event.runId && previous.payload.messageId === event.payload.messageId
			&& previous.payload.role === event.payload.role && event.sequence > previous.sequence;
		const mergeProgress = previous?.type === "tool.progress" && event.type === "tool.progress"
			&& previous.runId === event.runId && previous.payload.callId === event.payload.callId
			&& event.sequence > previous.sequence;
		if (mergeText) {
			session.events[session.events.length - 1] = {
				...event,
				payload: { ...event.payload, delta: previous.payload.delta + event.payload.delta },
			};
			session.compactedEventIds = [...(session.compactedEventIds ?? []), previous.id].slice(-MAX_COMPACTED_EVENT_IDS);
			return;
		}
		if (mergeProgress) {
			session.events[session.events.length - 1] = event;
			session.compactedEventIds = [...(session.compactedEventIds ?? []), previous.id].slice(-MAX_COMPACTED_EVENT_IDS);
			return;
		}
		session.events.push(event);
		session.events.sort((a, b) => a.sequence - b.sequence || a.timestamp.localeCompare(b.timestamp));
	}

	private pruneRetention(entries: SessionIndexEntry[], activeSessionId: string): void {
		let retained = [...entries];
		for (const candidate of this.prunableSessions(activeSessionId, retained)) {
			const totalBytes = this.totalStoredBytes(retained);
			if (retained.length <= this.maxSessions && totalBytes <= this.maxTotalBytes) break;
			if (!this.removeStoredSession(candidate.id)) continue;
			retained = retained.filter(({ id }) => id !== candidate.id);
		}
		this.writeIndex(retained);
	}

	private prunableSessions(activeSessionId: string, entries = this.readIndex()): SessionIndexEntry[] {
		return [...entries]
			.filter(({ id }) => id !== activeSessionId)
			.filter(({ id }) => {
				const record = this.read(id).record;
				return record.pendingActions.length === 0 && record.pendingLearnerResponses.length === 0;
			})
			.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
	}

	private totalStoredBytes(entries: SessionIndexEntry[]): number {
		return entries.reduce((total, { id }) => {
			try {
				return total + (this.storage.getItem(this.sessionKey(id))?.length ?? 0);
			} catch {
				return total;
			}
		}, 0);
	}

	private removeStoredSession(sessionId: string): boolean {
		const key = this.sessionKey(sessionId);
		try {
			this.storage.removeItem(key);
			return true;
		} catch (error) {
			this.diagnose({ code: "storage-error", key, message: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	private retainVolatile(sessionId: string, record: StoredSession): void {
		this.removeStoredSession(sessionId);
		this.volatileSessions.set(sessionId, {
			record,
			updatedAt: this.now(),
			size: JSON.stringify(record).length,
		});
		this.pruneVolatile(sessionId);
		this.writeIndex(this.readIndex().filter(({ id }) => id !== sessionId));
	}

	private pruneVolatile(activeSessionId: string): void {
		let totalSize = [...this.volatileSessions.values()].reduce((total, entry) => total + entry.size, 0);
		const candidates = [...this.volatileSessions.entries()]
			.filter(([id, { record }]) => id !== activeSessionId
				&& record.pendingActions.length === 0
				&& record.pendingLearnerResponses.length === 0)
			.sort(([, left], [, right]) => left.updatedAt - right.updatedAt);
		for (const [id, entry] of candidates) {
			if (this.volatileSessions.size <= this.maxSessions && totalSize <= this.maxTotalBytes) break;
			this.volatileSessions.delete(id);
			totalSize -= entry.size;
		}
	}

	private discoverOrphanedSessions(): SessionIndexEntry[] {
		const prefix = `${this.prefix}:session:`;
		const entries: SessionIndexEntry[] = [];
		try {
			const length = this.storage.length;
			if (typeof length !== "number" || typeof this.storage.key !== "function") return entries;
			for (let index = 0; index < length; index += 1) {
				const key = this.storage.key(index);
				if (key?.startsWith(prefix)) entries.push({ id: decodeURIComponent(key.slice(prefix.length)), updatedAt: 0 });
			}
		} catch (error) {
			this.diagnose({ code: "storage-error", key: this.indexKey(), message: error instanceof Error ? error.message : String(error) });
		}
		return entries;
	}

	private mergeDiscovered(entries: SessionIndexEntry[]): SessionIndexEntry[] {
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		for (const discovered of this.discoverOrphanedSessions()) {
			if (!byId.has(discovered.id)) byId.set(discovered.id, discovered);
		}
		return [...byId.values()];
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
