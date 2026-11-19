import {
	validateUiActionJournal,
	validateUiDocument,
	type UiActionReceipt,
	type UiDocument,
} from "@keating/learner-contracts";
import type { StorageLike } from "../event-store";
import { loadSharedUiActionState, sharedUiActionStateKey } from "../openui/shared-actions";
import { indexTranscriptDocuments, type TranscriptDocument } from "../openui/transcript-documents";
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

/** Prose of a reply, without OpenUI blocks; the feedback a learner reads. */
export function replyProse(text: string): string {
	return text.replace(/```+\s*openui[^\n]*\n[\s\S]*?(?:\n```+|$)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

interface TranscriptIndex {
	documents: Map<string, TranscriptDocument>;
	replies: AssignmentFeedback[];
}

/** Rebuild task documents from a session transcript and collect the replies a learner read. */
function indexTranscript(sessionId: string, messages: readonly unknown[], wanted: ReadonlySet<string>): TranscriptIndex {
	const replies: AssignmentFeedback[] = [];
	const documents = indexTranscriptDocuments(sessionId, messages, wanted, (document) => document.nodes.some((node) => node.type === "task"), (text, timestamp) => {
		if (timestamp === undefined) return;
		const prose = replyProse(text);
		if (prose) replies.push({ text: prose, at: timestamp });
	});
	return { documents, replies };
}

/** A learner-advanced journal copy, when one exists, without the presented snapshot. */
export function journalOnly(storage: Pick<StorageLike, "getItem"> | null, documentId: string): { document: UiDocument; receipts: UiActionReceipt[] } | null {
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

/** The on-device submission and draft copies for every task node of one document. */
export async function readTaskRecords(source: Pick<AssignmentDataSource, "readLocal">, document: UiDocument): Promise<Pick<AssignmentEvidence, "submissions" | "drafts">> {
	const submissions: Record<string, SavedTaskSubmission | undefined> = {};
	const drafts: Record<string, SavedTaskDraft | undefined> = {};
	for (const node of document.nodes) {
		if (node.type !== "task") continue;
		submissions[node.id] = await source.readLocal<SavedTaskSubmission>("tasks", taskSubmissionKey(document.id, node.id, node.round)).catch(() => undefined);
		drafts[node.id] = await source.readLocal<SavedTaskDraft>("tasks", taskDraftKey(document.id, node.id, node.round)).catch(() => undefined);
	}
	return { submissions, drafts };
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
			const { submissions, drafts } = await readTaskRecords(source, document);
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
