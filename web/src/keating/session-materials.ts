import type { UiActionReceipt, UiDocument, UiDocumentNode, UiStudyPlanItem, UiTaskKind } from "@keating/learner-contracts";
import type { StorageLike } from "./event-store";
import { journalOnly, readTaskRecords, replyProse } from "./homework/load-assignments";
import { projectAssignments, type AssignmentEntry, type AssignmentEvidence, type AssignmentFeedback } from "./homework/open-assignments";
import type { SavedTaskDraft, SavedTaskSubmission } from "./homework/task-storage";
import { loadSharedUiActionState } from "./openui/shared-actions";
import { indexTranscriptDocuments, type TranscriptDocument } from "./openui/transcript-documents";
import { resolveRevealTarget, sessionWorkspaceMaterials, type RevealQuoteSourceDetail, type SessionWorkspaceData, type WorkspaceMaterial } from "./session-workspace";
import type { Animation, FlashcardDeck, LessonMap, LessonPlan, OpenUiPresentationRecord, Verification } from "./storage";

/**
 * Everything the tutor made in one chat session, for the materials panel.
 *
 * Plans and concept maps come from the session workspace unchanged (so plan
 * revisions, proposals and saves keep working). Every other material node of
 * a released reply is recovered from, in order: the presentation record's
 * snapshot, the document rebuilt from the session transcript, the action
 * journal copy. A material none of those can rebuild is still listed, with a
 * "missing" source, rather than dropped. Learner progress is read through the
 * shared action journal so status matches what the learner did in chat.
 *
 * Pure apart from the injected source: no React, no DOM.
 */

type Readable = Pick<StorageLike, "getItem">;

export type SessionMaterialKind =
	| "plan" | "concept-map" | "quiz" | "flashcards" | "task" | "notes" | "goal"
	| "simulation" | "lab" | "coding-challenge" | "language-practice" | "music-lab" | "image" | "media" | "saved";

/** Section order in the panel. */
export const SESSION_MATERIAL_GROUPS = ["plan", "maps", "practice", "assignments", "notes", "media", "saved"] as const;
export type SessionMaterialGroup = typeof SESSION_MATERIAL_GROUPS[number];

export const SESSION_MATERIAL_GROUP_LABEL: Record<SessionMaterialGroup, string> = {
	plan: "Plan",
	maps: "Maps and diagrams",
	practice: "Practice",
	assignments: "Assignments",
	notes: "Notes and goals",
	media: "Media",
	saved: "Earlier saved items",
};

export type LegacyMaterialType = "plan" | "map" | "animation" | "deck" | "verification";

interface MaterialBase {
	/** Stable selection key; plans and maps keep their workspace keys (`plan:`, `map:`). */
	key: string;
	kind: SessionMaterialKind;
	group: SessionMaterialGroup;
	/** Learner-facing kind label ("Quiz", "Practice set", "Checklist"). */
	label: string;
	title: string;
	/** When it was first shown. */
	presentedAt: number;
	/** Short factual status chip, or null. */
	status: string | null;
}

export type SessionMaterial =
	| MaterialBase & { source: "workspace"; documentId: string; workspace: WorkspaceMaterial }
	| MaterialBase & { source: "openui"; documentId: string; nodeId: string; revision: number; component: string; document: UiDocument; receipts: UiActionReceipt[] }
	| MaterialBase & { source: "missing"; documentId: string; nodeId: string; component: string }
	| MaterialBase & { source: "saved"; legacyType: LegacyMaterialType; id: string; data: unknown };

export interface SessionMaterialsData {
	/** Grouped in panel order, newest first within a group. */
	materials: SessionMaterial[];
	workspace: SessionWorkspaceData;
}

export interface LegacySessionRecords {
	plans?: readonly LessonPlan[];
	maps?: readonly LessonMap[];
	animations?: readonly Animation[];
	decks?: readonly FlashcardDeck[];
	verifications?: readonly Verification[];
}

export interface SessionMaterialsSource {
	getOpenUiPresentations(sessionId?: string): Promise<OpenUiPresentationRecord[]>;
	/** Only called when a material lacks a snapshot or a task needs its feedback replies. */
	loadSession?(id: string): Promise<{ messages?: readonly unknown[] } | null>;
	/** Earlier stored records (all sessions); filtered here by session id. */
	getLegacyRecords?(): Promise<LegacySessionRecords>;
	readLocal?<T>(store: "tasks", key: string): Promise<T | undefined>;
}

/* ── Kinds ─────────────────────────────────────────────────────────────── */

const TASK_LABEL: Record<UiTaskKind, string> = {
	assignment: "Assignment",
	practice: "Practice set",
	draft: "Draft",
	fieldwork: "Fieldwork",
	connect: "Connect",
	person: "Person brief",
};

const MEDIA_LABEL = { animation: "Animation", audio: "Audio", video: "Video" } as const;

interface NodeKind { kind: SessionMaterialKind; group: SessionMaterialGroup; label: string; title: string }

/** Node types listed as materials; anything else (questions, prose, handoffs) is conversation. */
export const MATERIAL_COMPONENTS: ReadonlySet<string> = new Set([
	"quiz", "deck", "task", "notes", "goal", "simulation", "lab", "coding-challenge", "language-practice", "music-lab", "image", "media",
]);

const GENERIC_LABEL: Record<string, Omit<NodeKind, "title">> = {
	quiz: { kind: "quiz", group: "practice", label: "Quiz" },
	deck: { kind: "flashcards", group: "practice", label: "Flashcards" },
	task: { kind: "task", group: "assignments", label: "Assignment" },
	notes: { kind: "notes", group: "notes", label: "Notes" },
	goal: { kind: "goal", group: "notes", label: "Goal" },
	simulation: { kind: "simulation", group: "practice", label: "Simulation" },
	"coding-challenge": { kind: "coding-challenge", group: "practice", label: "Coding challenge" },
	"language-practice": { kind: "language-practice", group: "practice", label: "Language practice" },
	lab: { kind: "lab", group: "practice", label: "Lab" },
	"music-lab": { kind: "music-lab", group: "practice", label: "Music lab" },
	image: { kind: "image", group: "media", label: "Image" },
	media: { kind: "media", group: "media", label: "Media" },
};

function clip(text: string, limit = 120): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function nodeKind(node: UiDocumentNode): NodeKind | null {
	switch (node.type) {
		case "quiz": return { ...GENERIC_LABEL.quiz!, title: node.title || "Quiz" };
		case "deck": return { ...GENERIC_LABEL.deck!, title: node.title || node.topic || "Flashcards" };
		case "task": return { ...GENERIC_LABEL.task!, label: TASK_LABEL[node.kind] ?? "Assignment", title: node.title || TASK_LABEL[node.kind] || "Assignment" };
		case "notes": return { ...GENERIC_LABEL.notes!, title: node.title || "Notes" };
		case "goal": return { ...GENERIC_LABEL.goal!, title: node.title || "Goal" };
		case "simulation": return { ...GENERIC_LABEL.simulation!, title: node.title || "Simulation" };
		case "coding-challenge": return { ...GENERIC_LABEL["coding-challenge"]!, title: node.title || "Coding challenge" };
		case "language-practice": return { ...GENERIC_LABEL["language-practice"]!, title: node.title || "Language practice" };
		case "lab": return { ...GENERIC_LABEL.lab!, title: node.title };
		case "music-lab": return { ...GENERIC_LABEL["music-lab"]!, title: node.title || "Music lab" };
		case "image": return { ...GENERIC_LABEL.image!, title: clip(node.resource?.title || node.alt || "Image") };
		case "media": return { ...GENERIC_LABEL.media!, label: MEDIA_LABEL[node.kind] ?? "Media", title: node.resource?.title || MEDIA_LABEL[node.kind] || "Media" };
		default: return null;
	}
}

/* ── Status ────────────────────────────────────────────────────────────── */

function receiptsFor(receipts: readonly UiActionReceipt[], nodeId: string, type: string): UiActionReceipt[] {
	return receipts.filter((receipt) => receipt.state !== "rejected" && receipt.action.type === type && "nodeId" in receipt.action && receipt.action.nodeId === nodeId);
}

function flatItems(items: readonly UiStudyPlanItem[] | undefined): UiStudyPlanItem[] {
	return (items ?? []).flatMap((item) => item.children?.length ? flatItems(item.children) : [item]);
}

function planStatus(document: UiDocument): string | null {
	const plan = document.nodes.find((node) => node.type === "study-plan");
	if (plan?.type !== "study-plan") return null;
	const items = flatItems(plan.items);
	if (!items.length) return null;
	return `${items.filter((item) => item.status === "done").length} of ${items.length} done`;
}

function formatScore(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shortDate(at: number): string {
	try {
		return new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
	} catch {
		return "";
	}
}

const TASK_STATUS: Record<AssignmentEntry["status"], string> = {
	not_started: "Not started",
	in_progress: "In progress",
	submitted: "Handed in",
	feedback_received: "Feedback ready",
	done: "Done",
};

/** One chip for a task: overdue, then the due date while open, else where it stands. */
export function taskStatusLabel(entry: Pick<AssignmentEntry, "status" | "open" | "overdue" | "dueAt">): string {
	if (entry.open && entry.overdue) return "Overdue";
	if (entry.open && entry.dueAt !== null) return `Due ${shortDate(entry.dueAt)}`;
	return TASK_STATUS[entry.status];
}

function nodeStatus(node: UiDocumentNode, presented: UiDocumentNode | undefined, receipts: readonly UiActionReceipt[], task: AssignmentEntry | undefined): string | null {
	switch (node.type) {
		case "quiz": {
			const done = receiptsFor(receipts, node.id, "complete-quiz").at(-1);
			if (!done || done.action.type !== "complete-quiz") return "Not started";
			const score = done.action.score;
			return Number.isFinite(score) && node.questions.length ? `Completed · ${formatScore(score)}/${node.questions.length}` : "Completed";
		}
		case "deck": {
			const cards = `${node.cards.length} card${node.cards.length === 1 ? "" : "s"}`;
			return receiptsFor(receipts, node.id, "complete-deck").length ? `${cards} · reviewed` : cards;
		}
		case "task": return task ? taskStatusLabel(task) : null;
		case "notes": {
			const before = presented?.type === "notes" ? presented.value : node.value;
			return before !== node.value || receiptsFor(receipts, node.id, "update-notes").length ? "Edited" : null;
		}
		case "goal": {
			if (node.status === "completed") return "Completed";
			if (node.status === "paused") return "Paused";
			return node.steps.length ? `${node.steps.filter((step) => step.status === "done").length} of ${node.steps.length} steps` : null;
		}
		case "language-practice": return receiptsFor(receipts, node.id, "complete-language-practice").length ? "Completed" : null;
		case "lab": {
			const observations = receiptsFor(receipts, node.id, "observe-lab");
			if (!observations.length) return null;
			const matched = new Set(observations.flatMap(({ action }) => action.type === "observe-lab" && action.passed ? [action.checkpointId] : []));
			return `${node.checkpoints.filter(point => matched.has(point.id)).length} of ${node.checkpoints.length} checkpoints`;
		}
		case "coding-challenge": return receiptsFor(receipts, node.id, "run-coding-challenge").length ? "Tried" : null;
		default: return null;
	}
}

/* ── Gathering (pure) ──────────────────────────────────────────────────── */

export interface SessionMaterialsInput {
	sessionId: string;
	records: readonly OpenUiPresentationRecord[];
	storage: Readable | null;
	/** Documents rebuilt from the transcript, by document id. */
	transcript?: ReadonlyMap<string, TranscriptDocument>;
	/** Assistant replies, for task feedback status. */
	replies?: readonly AssignmentFeedback[];
	/** Submission and draft copies per task document id. */
	taskRecords?: ReadonlyMap<string, { submissions: Record<string, SavedTaskSubmission | undefined>; drafts: Record<string, SavedTaskDraft | undefined> }>;
	legacy?: LegacySessionRecords;
	now?: number;
	/** Precomputed workspace data (the hook shares one with the plan side panel). */
	workspace?: SessionWorkspaceData;
}

interface RecoveredDocument { document: UiDocument; presented: UiDocument | null; receipts: readonly UiActionReceipt[] }

function recover(record: OpenUiPresentationRecord, input: SessionMaterialsInput): RecoveredDocument | null {
	const presented = record.document ?? input.transcript?.get(record.documentId)?.document ?? null;
	if (presented) {
		const state = loadSharedUiActionState(input.storage, presented);
		return { document: state.document, presented, receipts: state.journal.receipts };
	}
	const journal = journalOnly(input.storage, record.documentId);
	return journal ? { document: journal.document, presented: null, receipts: journal.receipts } : null;
}

function legacyMaterials(sessionId: string, legacy: LegacySessionRecords | undefined): SessionMaterial[] {
	if (!legacy) return [];
	const mine = <T extends { sessionId?: string }>(rows: readonly T[] | undefined) => (rows ?? []).filter((row) => row.sessionId === sessionId);
	// The animation tool is still in use, so its records are current media; the rest predate inline materials.
	const saved = (legacyType: LegacyMaterialType, id: string, label: string, title: string, presentedAt: number, data: unknown, status: string | null = null): SessionMaterial => ({
		key: `saved:${legacyType}:${id}`, kind: "saved", group: legacyType === "animation" ? "media" : "saved", label, title: title || label, presentedAt, status, source: "saved", legacyType, id, data,
	});
	return [
		...mine(legacy.plans).map((row) => saved("plan", row.id, "Lesson plan", row.topic, row.createdAt, row)),
		...mine(legacy.maps).map((row) => saved("map", row.id, "Concept map", row.topic, row.createdAt, row)),
		...mine(legacy.animations).map((row) => saved("animation", row.id, "Animation", row.topic, row.createdAt, row)),
		...mine(legacy.decks).map((row) => saved("deck", row.id, "Flashcards", row.title, row.updatedAt ?? row.createdAt, row, `${row.cards.length} card${row.cards.length === 1 ? "" : "s"}`)),
		...mine(legacy.verifications).map((row) => saved("verification", row.id, "Checklist", row.topic, row.createdAt, row)),
	];
}

function workspaceMaterial(material: WorkspaceMaterial): SessionMaterial {
	if (material.kind === "plan") {
		return { key: material.key, kind: "plan", group: "plan", label: "Study plan", title: material.title, presentedAt: material.presentedAt, status: planStatus(material.current), source: "workspace", documentId: material.documentId, workspace: material };
	}
	return { key: material.key, kind: "concept-map", group: "maps", label: "Concept map", title: material.title, presentedAt: material.presentedAt, status: null, source: "workspace", documentId: material.documentId, workspace: material };
}

/** Panel order: fixed group order, newest first inside a group, the current plan first of all. */
export function orderSessionMaterials(materials: readonly SessionMaterial[], currentPlanKey: string | null = null): SessionMaterial[] {
	const rank = (material: SessionMaterial) => SESSION_MATERIAL_GROUPS.indexOf(material.group);
	return [...materials].sort((a, b) => rank(a) - rank(b)
		|| (a.key === currentPlanKey ? -1 : b.key === currentPlanKey ? 1 : 0)
		|| b.presentedAt - a.presentedAt
		|| a.key.localeCompare(b.key));
}

export function gatherSessionMaterials(input: SessionMaterialsInput): SessionMaterialsData {
	const { sessionId } = input;
	const records = input.records.filter((record) => record.sessionId === sessionId);
	const workspace = input.workspace ?? sessionWorkspaceMaterials(records, sessionId, input.storage);
	const materials: SessionMaterial[] = workspace.materials.map(workspaceMaterial);

	const seen = new Set<string>();
	const recovered = new Map<string, RecoveredDocument | null>();
	const tasks = new Map<string, AssignmentEntry>();
	const pending: Array<{ record: OpenUiPresentationRecord; doc: RecoveredDocument | null }> = [];
	for (const record of [...records].sort((a, b) => a.createdAt - b.createdAt)) {
		if (!MATERIAL_COMPONENTS.has(record.component) || seen.has(record.id)) continue;
		seen.add(record.id);
		if (!recovered.has(record.documentId)) recovered.set(record.documentId, recover(record, input));
		pending.push({ record, doc: recovered.get(record.documentId) ?? null });
	}

	// Task status through the homework projection, one evidence row per task document.
	const evidence: AssignmentEvidence[] = [];
	for (const [documentId, doc] of recovered) {
		if (!doc || !doc.document.nodes.some((node) => node.type === "task")) continue;
		const first = pending.find((entry) => entry.record.documentId === documentId)!.record;
		const messageTimestamp = input.transcript?.get(documentId)?.messageTimestamp;
		evidence.push({
			sessionId, documentId, presentedAt: first.createdAt,
			...(messageTimestamp !== undefined ? { messageTimestamp } : {}),
			document: doc.document, receipts: doc.receipts,
			...(input.taskRecords?.get(documentId) ?? {}),
		});
	}
	if (evidence.length) {
		for (const entry of projectAssignments(evidence, { [sessionId]: input.replies ?? [] }, input.now ?? Date.now())) {
			tasks.set(`${entry.documentId}:${entry.nodeId}`, entry);
			for (const round of entry.earlierRounds) tasks.set(`${round.documentId}:${entry.nodeId}`, entry);
		}
	}

	for (const { record, doc } of pending) {
		const node = doc?.document.nodes.find((candidate) => candidate.id === record.nodeId);
		const kind = node ? nodeKind(node) : null;
		const base = { key: `node:${record.id}`, presentedAt: record.createdAt };
		if (!doc || !node || !kind) {
			const fallback = GENERIC_LABEL[record.component]!;
			materials.push({ ...base, ...fallback, title: `${fallback.label} shared in the conversation`, status: null, source: "missing", documentId: record.documentId, nodeId: record.nodeId, component: record.component });
			continue;
		}
		const presentedNode = doc.presented?.nodes.find((candidate) => candidate.id === record.nodeId);
		materials.push({
			...base, ...kind,
			status: nodeStatus(node, presentedNode, doc.receipts, tasks.get(record.id)),
			source: "openui", documentId: record.documentId, nodeId: record.nodeId, revision: doc.document.revision, component: record.component,
			document: { ...doc.document, nodes: [node] },
			receipts: doc.receipts.filter((receipt) => !("nodeId" in receipt.action) || receipt.action.nodeId === node.id),
		});
	}

	materials.push(...legacyMaterials(sessionId, input.legacy));
	return { materials: orderSessionMaterials(materials, workspace.currentPlanKey), workspace };
}

/* ── Loading ───────────────────────────────────────────────────────────── */

/** Read everything one session needs, touching the transcript only when a snapshot is missing or a task needs replies. */
export async function loadSessionMaterials(
	source: SessionMaterialsSource,
	sessionId: string,
	storage: Readable | null,
	options: { now?: number; records?: readonly OpenUiPresentationRecord[]; workspace?: SessionWorkspaceData } = {},
): Promise<SessionMaterialsData> {
	if (!sessionId) return { materials: [], workspace: { materials: [], currentPlanKey: null } };
	const [records, legacy] = await Promise.all([
		options.records ? Promise.resolve(options.records) : source.getOpenUiPresentations(sessionId),
		source.getLegacyRecords?.().catch(() => ({})) ?? Promise.resolve({}),
	]);
	const mine = records.filter((record) => record.sessionId === sessionId && MATERIAL_COMPONENTS.has(record.component));
	const missing = new Set(mine.filter((record) => !record.document).map((record) => record.documentId));
	const hasTasks = mine.some((record) => record.component === "task");
	let transcript: Map<string, TranscriptDocument> | undefined;
	const replies: AssignmentFeedback[] = [];
	if ((missing.size || hasTasks) && source.loadSession) {
		const data = await source.loadSession(sessionId).catch(() => null);
		transcript = indexTranscriptDocuments(sessionId, data?.messages ?? [], missing, (document) => document.nodes.some((node) => MATERIAL_COMPONENTS.has(node.type)), (text, timestamp) => {
			if (timestamp === undefined || !hasTasks) return;
			const prose = replyProse(text);
			if (prose) replies.push({ text: prose, at: timestamp });
		});
	}
	const taskRecords = new Map<string, { submissions: Record<string, SavedTaskSubmission | undefined>; drafts: Record<string, SavedTaskDraft | undefined> }>();
	if (hasTasks && source.readLocal) {
		const readLocal = source.readLocal.bind(source);
		for (const documentId of new Set(mine.filter((record) => record.component === "task").map((record) => record.documentId))) {
			const record = mine.find((entry) => entry.documentId === documentId)!;
			const document = record.document ?? transcript?.get(documentId)?.document ?? journalOnly(storage, documentId)?.document;
			if (!document) continue;
			const read = await readTaskRecords({ readLocal }, document);
			taskRecords.set(documentId, { submissions: { ...read.submissions }, drafts: { ...read.drafts } });
		}
	}
	return gatherSessionMaterials({
		sessionId, records, storage, legacy, replies, taskRecords,
		...(transcript ? { transcript } : {}),
		...(options.now !== undefined ? { now: options.now } : {}),
		...(options.workspace ? { workspace: options.workspace } : {}),
	});
}

/** The material a reveal request names: workspace rules first (plans, maps), then any other material of that document. */
export function resolveSessionMaterialReveal(materials: readonly SessionMaterial[], detail: RevealQuoteSourceDetail | null | undefined): SessionMaterial | null {
	const workspace = materials.flatMap((material) => material.source === "workspace" ? [material.workspace] : []);
	const target = resolveRevealTarget(workspace, detail);
	if (target) return materials.find((material) => material.key === target.key) ?? null;
	if (!detail || detail.kind !== "artifact" || !detail.id) return null;
	return materials.find((material) => material.key === detail.id)
		?? materials.find((material) => "documentId" in material && material.documentId === detail.id)
		?? null;
}

/**
 * The material a remembered selection names. Workspace keys (`plan:`, `map:`)
 * resolve as before; an unknown key falls back to null (the list).
 */
export function findSessionMaterial(materials: readonly SessionMaterial[], key: string | null | undefined): SessionMaterial | null {
	return key ? materials.find((material) => material.key === key) ?? null : null;
}

/* ── Across sessions ───────────────────────────────────────────────────── */

/** What one session holds, by kind: enough to find the session a material lives in. */
export interface SessionMaterialSummary {
	sessionId: string;
	/** When the newest material was shown or saved. */
	latestAt: number;
	total: number;
	/** In panel group order. */
	kinds: Array<{ label: string; count: number }>;
}

const SUMMARY_KIND: Record<string, { group: SessionMaterialGroup; label: string }> = {
	"study-plan": { group: "plan", label: "Study plan" },
	"concept-map": { group: "maps", label: "Concept map" },
	...Object.fromEntries(Object.entries(GENERIC_LABEL).map(([component, { group, label }]) => [component, { group, label }])),
};

/**
 * Counts every session's materials from presentation records and earlier
 * stored records, newest session first. Reads no documents, so it stays
 * cheap across the whole library; task kinds are all counted as assignments.
 */
export function summarizeMaterialsBySession(records: readonly OpenUiPresentationRecord[], legacy?: LegacySessionRecords): SessionMaterialSummary[] {
	const sessions = new Map<string, { latestAt: number; seen: Set<string>; counts: Map<string, { group: SessionMaterialGroup; label: string; count: number }> }>();
	const add = (sessionId: string | undefined, identity: string, group: SessionMaterialGroup, label: string, at: number) => {
		if (!sessionId) return;
		const entry = sessions.get(sessionId) ?? { latestAt: 0, seen: new Set<string>(), counts: new Map() };
		sessions.set(sessionId, entry);
		entry.latestAt = Math.max(entry.latestAt, at);
		// A revised plan or a re-rendered reply is still one material.
		if (entry.seen.has(identity)) return;
		entry.seen.add(identity);
		const count = entry.counts.get(label) ?? { group, label, count: 0 };
		count.count += 1;
		entry.counts.set(label, count);
	};
	for (const record of records) {
		const kind = SUMMARY_KIND[record.component];
		if (!kind) continue;
		const identity = record.component === "study-plan" ? `plan:${record.documentId}` : `${record.documentId}:${record.nodeId}`;
		add(record.sessionId, identity, kind.group, kind.label, record.createdAt);
	}
	for (const row of legacy?.plans ?? []) add(row.sessionId, `saved:plan:${row.id}`, "saved", "Lesson plan", row.createdAt);
	for (const row of legacy?.maps ?? []) add(row.sessionId, `saved:map:${row.id}`, "saved", "Concept map", row.createdAt);
	for (const row of legacy?.animations ?? []) add(row.sessionId, `saved:animation:${row.id}`, "media", "Animation", row.createdAt);
	for (const row of legacy?.decks ?? []) add(row.sessionId, `saved:deck:${row.id}`, "saved", "Flashcards", row.updatedAt ?? row.createdAt);
	for (const row of legacy?.verifications ?? []) add(row.sessionId, `saved:verification:${row.id}`, "saved", "Checklist", row.createdAt);
	return [...sessions.entries()].map(([sessionId, { latestAt, seen, counts }]) => ({
		sessionId, latestAt, total: seen.size,
		kinds: [...counts.values()]
			.sort((a, b) => SESSION_MATERIAL_GROUPS.indexOf(a.group) - SESSION_MATERIAL_GROUPS.indexOf(b.group) || a.label.localeCompare(b.label))
			.map(({ label, count }) => ({ label, count })),
	})).sort((a, b) => b.latestAt - a.latestAt || a.sessionId.localeCompare(b.sessionId));
}
