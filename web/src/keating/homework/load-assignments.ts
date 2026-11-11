import {
	tryCompileOpenUISourceToSharedDocument,
	validateUiActionJournal,
	validateUiDocument,
	type UiActionReceipt,
	type UiDocument,
} from "@keating/learner-contracts";
import type { StorageLike } from "../event-store";
import { loadSharedUiActionState, sharedUiActionStateKey } from "../openui/shared-actions";
import { parseOpenUIMessageSegments } from "../openui/segments";
import type { OpenUiPresentationRecord } from "../storage";
import {
	handedInAssignments,
	openAssignments,
	projectAssignments,
	type AssignmentEntry,
	type AssignmentEvidence,
	type AssignmentFeedback,
} from "./open-assignments";
import { taskDraftKey, taskSubmissionKey, type SavedTaskDraft, type SavedTaskSubmission } from "./task-storage";

/**
 * Gathers the evidence for {@link projectAssignments}.
 *
 * What survives a task after its message scrolls away:
 * - the presentation record (ids, session, time) — no document snapshot,
 *   because the recorder keeps snapshots only for plans and concept maps;
 * - the action journal in localStorage, which holds the full document, but
 *   only once the learner has acted on it (ticked an item, submitted);
 * - the on-device submission and draft copies in the `tasks` store;
 * - the session transcript, from which the presented document is rebuilt
 *   with the same document scope the chat renderer uses.
 */
export interface AssignmentDataSource {
	getOpenUiPresentations(sessionId?: string): Promise<OpenUiPresentationRecord[]>;
	loadSession(id: string): Promise<{ title?: string; messages?: readonly unknown[] } | null>;
	readLocal<T>(store: "tasks", key: string): Promise<T | undefined>;
	storage: Pick<StorageLike, "getItem"> | null;
}

export interface LoadOpenAssignmentsOptions {
	/** Only this session's tasks. */
	sessionId?: string;
	now?: number;
	source?: AssignmentDataSource;
}

export interface LoadedAssignments {
	/** Every task, sorted overdue → due date → most recent. */
	all: AssignmentEntry[];
	/** Not started or in progress. */
	open: AssignmentEntry[];
	/** Waiting for feedback or with feedback ready, most recent first. */
	handedIn: AssignmentEntry[];
	/** Tasks recorded as presented whose content could not be recovered. */
	unrecoverable: number;
}

interface SessionMessage { role?: unknown; content?: unknown; timestamp?: unknown }

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").filter(Boolean).join("\n");
}

/** Prose of a reply, without OpenUI blocks; the feedback a learner reads. */
export function replyProse(text: string): string {
	return text.replace(/```+\s*openui[^\n]*\n[\s\S]*?(?:\n```+|$)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

function documentsIn(text: string, sessionId: string, messageId: string): UiDocument[] {
	return parseOpenUIMessageSegments(text, { sessionId, messageId }).flatMap((segment) => {
		if (segment.type !== "openui" || !segment.complete) return [];
		if (segment.format === "document") return segment.error || !segment.document ? [] : [segment.document];
		const compiled = tryCompileOpenUISourceToSharedDocument(segment.program || segment.rawProgram, {
			documentId: segment.metadata.id,
			revision: segment.metadata.revision,
			retention: segment.metadata.lifecycle,
		});
		return compiled.ok ? [compiled.document] : [];
	});
}

interface TranscriptIndex {
	documents: Map<string, { document: UiDocument; messageTimestamp?: number }>;
	replies: AssignmentFeedback[];
}

/**
 * Rebuild documents from a session transcript. Chat message ids are
 * `assistant-${index}-${timestamp}`; the index is the array position, which
 * is tried first, with a scan of nearby positions for native session trees.
 */
function indexTranscript(sessionId: string, messages: readonly unknown[], wanted: ReadonlySet<string>): TranscriptIndex {
	const documents = new Map<string, { document: UiDocument; messageTimestamp?: number }>();
	const replies: AssignmentFeedback[] = [];
	messages.forEach((raw, index) => {
		const message = raw as SessionMessage;
		if (message?.role !== "assistant") return;
		const text = messageText(message.content);
		const timestamp = typeof message.timestamp === "number" ? message.timestamp : undefined;
		if (timestamp !== undefined) {
			const prose = replyProse(text);
			if (prose) replies.push({ text: prose, at: timestamp });
		}
		if (!text.includes("openui") || documents.size >= wanted.size) return;
		// Scope changes ids, not content: skip messages that present no task at all.
		const atIndex = documentsIn(text, sessionId, `assistant-${index}-${timestamp ?? ""}`);
		if (!atIndex.some((document) => document.nodes.some((node) => node.type === "task"))) return;
		const offsets = [0, ...Array.from({ length: 40 }, (_, step) => (step % 2 ? -1 : 1) * (Math.floor(step / 2) + 1))];
		for (const offset of offsets) {
			const candidate = index + offset;
			if (candidate < 0) continue;
			const found = documentsIn(text, sessionId, `assistant-${candidate}-${timestamp ?? ""}`).filter((document) => wanted.has(document.id));
			if (!found.length) continue;
			for (const document of found) documents.set(document.id, { document, ...(timestamp !== undefined ? { messageTimestamp: timestamp } : {}) });
			break;
		}
	});
	return { documents, replies };
}

/** A learner-advanced journal copy, when one exists, without the presented snapshot. */
function journalOnly(storage: Pick<StorageLike, "getItem"> | null, documentId: string): { document: UiDocument; receipts: UiActionReceipt[] } | null {
	try {
		const raw = storage?.getItem(sharedUiActionStateKey(documentId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { document?: unknown; journal?: unknown };
		if (!validateUiDocument(parsed.document) || !validateUiActionJournal(parsed.journal)) return null;
		if (parsed.document.id !== documentId) return null;
		return { document: parsed.document, receipts: parsed.journal.receipts };
	} catch {
		return null;
	}
}

export async function gatherAssignmentEvidence(source: AssignmentDataSource, sessionId?: string): Promise<{ evidence: AssignmentEvidence[]; replies: Record<string, AssignmentFeedback[]>; unrecoverable: number }> {
	const records = (await source.getOpenUiPresentations(sessionId)).filter((record) => record.component === "task" && record.sessionId);
	const bySession = new Map<string, OpenUiPresentationRecord[]>();
	for (const record of records) bySession.set(record.sessionId!, [...(bySession.get(record.sessionId!) ?? []), record]);
	const evidence: AssignmentEvidence[] = [];
	const replies: Record<string, AssignmentFeedback[]> = {};
	let unrecoverable = 0;
	for (const [session, sessionRecords] of bySession) {
		const firstByDocument = new Map<string, OpenUiPresentationRecord>();
		for (const record of sessionRecords) {
			const current = firstByDocument.get(record.documentId);
			if (!current || record.createdAt < current.createdAt) firstByDocument.set(record.documentId, record);
		}
		const data = await source.loadSession(session).catch(() => null);
		const transcript = indexTranscript(session, data?.messages ?? [], new Set(firstByDocument.keys()));
		replies[session] = transcript.replies;
		for (const [documentId, record] of firstByDocument) {
			const presented = record.document ?? transcript.documents.get(documentId)?.document ?? null;
			let document: UiDocument;
			let receipts: readonly UiActionReceipt[];
			if (presented) {
				const state = loadSharedUiActionState(source.storage, presented);
				document = state.document;
				receipts = state.journal.receipts;
			} else {
				const journal = journalOnly(source.storage, documentId);
				if (!journal) { unrecoverable += 1; continue; }
				({ document, receipts } = journal);
			}
			const tasks = document.nodes.filter((node) => node.type === "task");
			const submissions: Record<string, SavedTaskSubmission | undefined> = {};
			const drafts: Record<string, SavedTaskDraft | undefined> = {};
			for (const node of tasks) {
				if (node.type !== "task") continue;
				submissions[node.id] = await source.readLocal<SavedTaskSubmission>("tasks", taskSubmissionKey(documentId, node.id, node.round)).catch(() => undefined);
				drafts[node.id] = await source.readLocal<SavedTaskDraft>("tasks", taskDraftKey(documentId, node.id, node.round)).catch(() => undefined);
			}
			const messageTimestamp = transcript.documents.get(documentId)?.messageTimestamp;
			evidence.push({
				sessionId: session,
				...(data?.title ? { sessionTitle: data.title } : {}),
				documentId,
				presentedAt: record.createdAt,
				...(messageTimestamp !== undefined ? { messageTimestamp } : {}),
				document,
				receipts,
				submissions,
				drafts,
			});
		}
	}
	return { evidence, replies, unrecoverable };
}

function browserStorage(): Pick<StorageLike, "getItem"> | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

async function defaultSource(): Promise<AssignmentDataSource> {
	const [{ getInitPromise, keatingStorage, sessions }, { localRead }] = await Promise.all([
		import("../../hooks/keating-storage"),
		import("../../submissions/local-store"),
	]);
	await getInitPromise();
	return {
		getOpenUiPresentations: (sessionId) => keatingStorage.getOpenUiPresentations(sessionId),
		loadSession: async (id) => {
			const data = await sessions.loadSession(id);
			return data ? { title: data.title, messages: data.messages } : null;
		},
		readLocal: (store, key) => localRead(store, key),
		storage: browserStorage(),
	};
}

/**
 * Stable entry point for any surface that lists homework (Coming Up, the
 * session workspace). Never throws for one unreadable task; it is counted
 * in `unrecoverable` instead.
 */
export async function loadOpenAssignments(options: LoadOpenAssignmentsOptions = {}): Promise<LoadedAssignments> {
	const source = options.source ?? await defaultSource();
	const { evidence, replies, unrecoverable } = await gatherAssignmentEvidence(source, options.sessionId);
	const all = projectAssignments(evidence, replies, options.now ?? Date.now());
	return { all, open: openAssignments(all), handedIn: handedInAssignments(all), unrecoverable };
}

/** Earlier rounds for the task card: finds the card's session from its document id. */
export async function loadEarlierRounds(documentId: string, nodeId: string, source?: AssignmentDataSource): Promise<AssignmentEntry | null> {
	const resolved = source ?? await defaultSource();
	const record = (await resolved.getOpenUiPresentations()).find((entry) => entry.documentId === documentId && entry.sessionId);
	if (!record?.sessionId) return null;
	const { all } = await loadOpenAssignments({ sessionId: record.sessionId, source: resolved });
	return all.find((entry) => entry.nodeId === nodeId && (entry.documentId === documentId || entry.earlierRounds.some((round) => round.documentId === documentId))) ?? null;
}
