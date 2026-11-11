import type { UiActionReceipt, UiDocument, UiSubmissionAttachment, UiTaskNode } from "@keating/learner-contracts";
import { draftHasContent, type SavedTaskDraft, type SavedTaskSubmission } from "./task-storage";

/**
 * Homework as the learner sees it outside the chat: every task they were
 * given, where it stands, and what to do next. Pure — the loader gathers the
 * evidence (presentation records, action journals, on-device work, the
 * tutor's later replies) and this module only decides.
 */
export type AssignmentStatus = "not_started" | "in_progress" | "submitted" | "feedback_received" | "done";

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
	not_started: "Not started",
	in_progress: "In progress",
	submitted: "Handed in, waiting for feedback",
	feedback_received: "Feedback ready",
	done: "Done",
};

/** What the learner handed in for one round. */
export interface AssignmentSubmission {
	text: string;
	attachments: UiSubmissionAttachment[];
	submittedAt: number;
}

/** The tutor's first reply in the session after a submission: the feedback, as far as records show. */
export interface AssignmentFeedback {
	text: string;
	at: number;
}

export interface AssignmentRound {
	round: number;
	documentId: string;
	presentedAt: number;
	submission?: AssignmentSubmission;
	feedback?: AssignmentFeedback;
}

export interface AssignmentEntry {
	/** Stable across rounds: `${sessionId}:${task identity}`. */
	key: string;
	sessionId: string;
	sessionTitle?: string;
	documentId: string;
	nodeId: string;
	/** Timestamp of the assistant message that presented this round, when known. */
	messageTimestamp?: number;
	presentedAt: number;
	kind: UiTaskNode["kind"];
	title: string;
	/** Plain-text first line of the brief: what is being asked. */
	ask: string;
	/** Current-round node with the learner's recorded item progress applied. */
	node: UiTaskNode;
	round: number;
	dueAt: number | null;
	availableFrom: number | null;
	overdue: boolean;
	notYetOpen: boolean;
	status: AssignmentStatus;
	/** Still needs the learner's work: not started or in progress. */
	open: boolean;
	items: { done: number; total: number };
	hasDraft: boolean;
	draft?: SavedTaskDraft;
	submission?: AssignmentSubmission;
	feedback?: AssignmentFeedback;
	/** Earlier rounds of the same task, oldest first. */
	earlierRounds: AssignmentRound[];
	lastActivityAt: number;
}

/** One presented task document plus everything recorded against it. */
export interface AssignmentEvidence {
	sessionId: string;
	sessionTitle?: string;
	documentId: string;
	presentedAt: number;
	messageTimestamp?: number;
	/** Latest known document: the learner-advanced journal copy, else the presented snapshot. */
	document: UiDocument;
	receipts: readonly UiActionReceipt[];
	/** On-device submissions and drafts, keyed by node id, for the node's current round. */
	submissions?: Readonly<Record<string, SavedTaskSubmission | undefined>>;
	drafts?: Readonly<Record<string, SavedTaskDraft | undefined>>;
}

/** Assistant replies per session, used to find the tutor's response to a submission. */
export type SessionReplies = Readonly<Record<string, readonly AssignmentFeedback[]>>;

function parseTime(value: string | undefined): number | null {
	if (!value) return null;
	const at = Date.parse(value);
	return Number.isFinite(at) ? at : null;
}

/** First meaningful line of a markdown brief, as plain text. */
export function plainAsk(markdown: string, limit = 180): string {
	const line = markdown.split("\n")
		.map((entry) => entry.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "").trim())
		.find(Boolean) ?? "";
	const plain = line
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[*_`~]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length <= limit ? plain : `${plain.slice(0, limit - 1).trimEnd()}…`;
}

function itemDone(node: UiTaskNode, receipts: readonly UiActionReceipt[], itemId: string): boolean {
	// The newest completed receipt for an item wins; the document copy covers journals already folded in.
	let state: boolean | undefined;
	for (const receipt of receipts) {
		if (receipt.state !== "completed" || receipt.action.type !== "complete-task-item") continue;
		if (receipt.action.nodeId !== node.id || receipt.action.itemId !== itemId) continue;
		state = receipt.action.completed;
	}
	return state ?? node.items?.find((item) => item.id === itemId)?.status === "done";
}

function submissionFrom(node: UiTaskNode, receipts: readonly UiActionReceipt[], local: SavedTaskSubmission | undefined): AssignmentSubmission | undefined {
	const round = node.round;
	const receipt = [...receipts].reverse().find((entry) => entry.state === "completed"
		&& entry.action.type === "submit-task"
		&& entry.action.nodeId === node.id
		&& (entry.action.round ?? undefined) === round);
	if (receipt?.action.type === "submit-task") {
		return {
			text: receipt.action.submission,
			attachments: receipt.action.attachments ?? [],
			submittedAt: parseTime(receipt.createdAt) ?? 0,
		};
	}
	if (local && local.intent.nodeId === node.id) {
		return {
			text: local.intent.submission,
			attachments: local.intent.attachments ?? [],
			submittedAt: parseTime(local.savedAt) ?? 0,
		};
	}
	return undefined;
}

function feedbackAfter(replies: readonly AssignmentFeedback[] | undefined, at: number): AssignmentFeedback | undefined {
	if (!replies?.length) return undefined;
	return [...replies].sort((a, b) => a.at - b.at).find((reply) => reply.at > at && reply.text.trim());
}

/** One presented round, before rounds of the same task are merged. */
interface RoundCandidate {
	evidence: AssignmentEvidence;
	node: UiTaskNode;
	identity: string;
}

function identityOf(node: UiTaskNode): string {
	return `${node.kind}:${node.id}`;
}

function candidates(evidence: readonly AssignmentEvidence[]): RoundCandidate[] {
	return evidence.flatMap((entry) => entry.document.nodes.flatMap((node) => node.type === "task"
		? [{ evidence: entry, node, identity: identityOf(node) }]
		: []));
}

function roundNumber(node: UiTaskNode): number {
	return node.round ?? 1;
}

function project(candidate: RoundCandidate, replies: SessionReplies, now: number): Omit<AssignmentEntry, "earlierRounds" | "key"> {
	const { evidence, node } = candidate;
	const receipts = evidence.receipts;
	const items = node.items ?? [];
	const doneItems = items.filter((item) => itemDone(node, receipts, item.id));
	const appliedNode: UiTaskNode = items.length
		? { ...node, items: items.map((item) => ({ ...item, status: doneItems.includes(item) ? "done" as const : (item.status === "done" ? "not_started" as const : item.status) })) }
		: node;
	const submission = submissionFrom(node, receipts, evidence.submissions?.[node.id]);
	const feedback = submission ? feedbackAfter(replies[evidence.sessionId], submission.submittedAt) : undefined;
	const draft = evidence.drafts?.[node.id];
	const hasDraft = !submission && draftHasContent(draft);
	const format = node.submission?.format ?? "none";
	let status: AssignmentStatus;
	if (submission) status = feedback ? "feedback_received" : "submitted";
	else if (format === "none" && items.length > 0 && doneItems.length === items.length) status = "done";
	else if (doneItems.length > 0 || hasDraft) status = "in_progress";
	else status = "not_started";
	const dueAt = parseTime(node.dueAt);
	const availableFrom = parseTime(node.availableFrom);
	const open = status === "not_started" || status === "in_progress";
	const itemActivity = receipts
		.filter((receipt) => receipt.state === "completed" && "nodeId" in receipt.action && receipt.action.nodeId === node.id)
		.map((receipt) => parseTime(receipt.createdAt) ?? 0);
	return {
		sessionId: evidence.sessionId,
		...(evidence.sessionTitle ? { sessionTitle: evidence.sessionTitle } : {}),
		documentId: evidence.documentId,
		nodeId: node.id,
		...(evidence.messageTimestamp !== undefined ? { messageTimestamp: evidence.messageTimestamp } : {}),
		presentedAt: evidence.presentedAt,
		kind: node.kind,
		title: node.title,
		ask: plainAsk(node.brief),
		node: appliedNode,
		round: roundNumber(node),
		dueAt,
		availableFrom,
		overdue: open && dueAt !== null && now > dueAt,
		notYetOpen: availableFrom !== null && now < availableFrom,
		status,
		open,
		items: { done: doneItems.length, total: items.length },
		hasDraft,
		...(draft && hasDraft ? { draft } : {}),
		...(submission ? { submission } : {}),
		...(feedback ? { feedback } : {}),
		lastActivityAt: Math.max(evidence.presentedAt, submission?.submittedAt ?? 0, feedback?.at ?? 0, parseTime(draft?.savedAt) ?? 0, ...itemActivity),
	};
}

/** Overdue first, then soonest due, then most recently given. */
export function compareAssignments(left: AssignmentEntry, right: AssignmentEntry): number {
	if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
	const leftDue = left.dueAt ?? Number.POSITIVE_INFINITY;
	const rightDue = right.dueAt ?? Number.POSITIVE_INFINITY;
	if (leftDue !== rightDue) return leftDue - rightDue;
	if (left.presentedAt !== right.presentedAt) return right.presentedAt - left.presentedAt;
	return left.title.localeCompare(right.title);
}

/**
 * Every task the learner has been given, one entry per task with its latest
 * round current and earlier rounds attached. A later round of the same task
 * (same session, kind and node id) supersedes the earlier one.
 */
export function projectAssignments(evidence: readonly AssignmentEvidence[], replies: SessionReplies = {}, now = Date.now()): AssignmentEntry[] {
	const groups = new Map<string, RoundCandidate[]>();
	for (const candidate of candidates(evidence)) {
		const key = `${candidate.evidence.sessionId}:${candidate.identity}`;
		groups.set(key, [...(groups.get(key) ?? []), candidate]);
	}
	const entries: AssignmentEntry[] = [];
	for (const [key, group] of groups) {
		// Same document seen twice (re-render, revision) collapses to its first presentation.
		const unique = [...new Map(group.map((candidate) => [`${candidate.evidence.documentId}:${roundNumber(candidate.node)}`, candidate])).values()];
		const ordered = unique.sort((a, b) => roundNumber(a.node) - roundNumber(b.node) || a.evidence.presentedAt - b.evidence.presentedAt);
		const current = ordered[ordered.length - 1]!;
		const earlierRounds = ordered.slice(0, -1).map((candidate) => {
			const projected = project(candidate, replies, now);
			return {
				round: projected.round,
				documentId: projected.documentId,
				presentedAt: projected.presentedAt,
				...(projected.submission ? { submission: projected.submission } : {}),
				...(projected.feedback ? { feedback: projected.feedback } : {}),
			} satisfies AssignmentRound;
		});
		entries.push({ key, ...project(current, replies, now), earlierRounds });
	}
	return entries.sort(compareAssignments);
}

/** The open list: work still waiting for the learner. */
export function openAssignments(entries: readonly AssignmentEntry[]): AssignmentEntry[] {
	return entries.filter((entry) => entry.open);
}

/** Handed in recently: waiting for, or holding, the tutor's feedback. */
export function handedInAssignments(entries: readonly AssignmentEntry[]): AssignmentEntry[] {
	return entries
		.filter((entry) => entry.status === "submitted" || entry.status === "feedback_received")
		.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

const MS_PER_DAY = 86_400_000;

function startOfDay(at: number): number {
	const date = new Date(at);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

/** A due date in words: "Due today at 5:00 PM", "Was due 2 days ago (Mon, Nov 10)". */
export function describeDue(dueAt: number | null, now = Date.now(), locale?: string): string {
	if (dueAt === null) return "No due date";
	const time = new Date(dueAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
	const day = new Date(dueAt).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
	const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / MS_PER_DAY);
	if (dueAt < now) {
		if (days === 0) return `Was due today at ${time}`;
		if (days === -1) return `Was due yesterday at ${time}`;
		return `Was due ${-days} days ago, on ${day}`;
	}
	if (days === 0) return `Due today at ${time}`;
	if (days === 1) return `Due tomorrow at ${time}`;
	if (days < 7) return `Due ${day} at ${time}, in ${days} days`;
	return `Due ${day}`;
}

/** The one next step for an entry, used for the row's primary action label. */
export function nextStepLabel(entry: AssignmentEntry): string {
	switch (entry.status) {
		case "not_started": return entry.notYetOpen ? "Read the brief" : "Start in session";
		case "in_progress": return "Continue in session";
		case "submitted": return "Open in session";
		case "feedback_received": return "Read feedback and revise";
		case "done": return "Open in session";
	}
}

/**
 * Where a row's primary action goes: the session that holds the task. Chat
 * has no message anchor yet, so landing on the exact task needs Chat support.
 */
export function assignmentChatTarget(entry: Pick<AssignmentEntry, "sessionId">): { to: "/chat"; search: { session: string } } {
	return { to: "/chat", search: { session: entry.sessionId } };
}
