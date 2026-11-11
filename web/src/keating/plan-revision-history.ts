import type { PlanRevisionChange, UiDocument, UiStudyPlanItem } from "@keating/learner-contracts";
import type { StorageLike } from "./event-store";
import { overlayPlanStorage } from "./plan-pending-saves";

/**
 * A bounded, linear log of the revisions a study plan gained from the tutor or
 * from an accepted proposal. Each entry keeps the plan before and after, so the
 * workspace can compare the previous revision with the current one. Learner
 * ticks are not entries; they live in the plan's action journal.
 */
export const MAX_PLAN_HISTORY = 12;
const HISTORY_PREFIX = "keating:plan-revision-history:v1:";

export interface PlanRevisionHistoryEntry {
	revision: number;
	previousRevision: number;
	op: PlanRevisionChange["op"];
	via: "autonomous" | "accepted";
	/** Short human-readable description of the change. */
	summary: string;
	at: number;
	before: UiDocument;
	after: UiDocument;
}

export function planHistoryKey(documentId: string): string {
	return `${HISTORY_PREFIX}${documentId}`;
}

export function describePlanChange(change: PlanRevisionChange, document?: UiDocument): string {
	const title = (id: string) => (document ? flattenPlanItems(document).find((item) => item.id === id)?.title : undefined) ?? id;
	switch (change.op) {
		case "complete-item":
			return `Marked "${title(change.itemId)}" as done`;
		case "insert-prerequisite":
			return `Added "${change.item.title}" before "${title(change.beforeItemId)}"`;
		case "expand-item":
			return `Split "${title(change.itemId)}" into ${change.children.length} steps`;
	}
}

function isEntry(value: unknown): value is PlanRevisionHistoryEntry {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<PlanRevisionHistoryEntry>;
	return typeof entry.revision === "number" && typeof entry.at === "number" && !!entry.before && !!entry.after
		&& (entry.via === "autonomous" || entry.via === "accepted") && typeof entry.summary === "string";
}

/** Oldest first. Reads through unsaved writes so a pending change is included. */
export function loadPlanHistory(storage: Pick<StorageLike, "getItem"> | null, documentId: string): PlanRevisionHistoryEntry[] {
	try {
		const raw = overlayPlanStorage(storage)?.getItem(planHistoryKey(documentId));
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
	} catch {
		return [];
	}
}

/** Append one entry, keeping the newest MAX_PLAN_HISTORY in revision order. */
export function appendPlanHistory(entries: readonly PlanRevisionHistoryEntry[], entry: PlanRevisionHistoryEntry, max = MAX_PLAN_HISTORY): PlanRevisionHistoryEntry[] {
	const kept = entries.filter((candidate) => candidate.revision < entry.revision);
	return [...kept, entry].slice(-Math.max(1, max));
}

export function flattenPlanItems(document: UiDocument): UiStudyPlanItem[] {
	const walk = (items: readonly UiStudyPlanItem[] | undefined): UiStudyPlanItem[] =>
		(items ?? []).flatMap((item) => [item, ...walk(item.children)]);
	return document.nodes.flatMap((node) => node.type === "study-plan" ? walk(node.items) : []);
}

export interface PlanRevisionComparison {
	previousRevision: number;
	currentRevision: number;
	added: Array<{ id: string; title: string }>;
	removed: Array<{ id: string; title: string }>;
	retitled: Array<{ id: string; from: string; to: string }>;
	statusChanged: Array<{ id: string; title: string; from: string; to: string }>;
	/** True when nothing item-level differs. */
	unchanged: boolean;
}

const STATUS_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", done: "Done" };
export const planStatusLabel = (status: string | undefined) => STATUS_LABEL[status ?? "not_started"] ?? status ?? "Not started";

/** Item-level differences between two revisions of one plan. */
export function comparePlanRevisions(previous: UiDocument, current: UiDocument): PlanRevisionComparison {
	const before = new Map(flattenPlanItems(previous).map((item) => [item.id, item]));
	const after = new Map(flattenPlanItems(current).map((item) => [item.id, item]));
	const added = [...after.values()].filter((item) => !before.has(item.id)).map(({ id, title }) => ({ id, title }));
	const removed = [...before.values()].filter((item) => !after.has(item.id)).map(({ id, title }) => ({ id, title }));
	const retitled: PlanRevisionComparison["retitled"] = [];
	const statusChanged: PlanRevisionComparison["statusChanged"] = [];
	for (const [id, item] of after) {
		const old = before.get(id);
		if (!old) continue;
		if (old.title !== item.title) retitled.push({ id, from: old.title, to: item.title });
		if ((old.status ?? "not_started") !== (item.status ?? "not_started")) {
			statusChanged.push({ id, title: item.title, from: planStatusLabel(old.status), to: planStatusLabel(item.status) });
		}
	}
	return {
		previousRevision: previous.revision,
		currentRevision: current.revision,
		added, removed, retitled, statusChanged,
		unchanged: !added.length && !removed.length && !retitled.length && !statusChanged.length,
	};
}
