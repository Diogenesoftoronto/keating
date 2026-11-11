import type { UiDocument } from "@keating/learner-contracts";
import type { StorageLike } from "./event-store";
import { loadSharedUiActionState } from "./openui/shared-actions";
import { overlayPlanStorage } from "./plan-pending-saves";
import type { OpenUiPresentationRecord } from "./storage";

/**
 * The session workspace: the study plans and concept maps the tutor actually
 * presented in one chat session, read from OpenUI presentation records. Plans
 * are advanced to their current revision through the shared action journal, so
 * the workspace and the chat card show the same state.
 */

/** Another lane's quote hook asks the workspace to show a quoted material. */
export const REVEAL_QUOTE_SOURCE_EVENT = "keating:reveal-quote-source";

export interface RevealQuoteSourceDetail {
	kind: "artifact" | "message" | "document";
	id: string;
	revision?: number;
}

export type WorkspaceMaterial =
	| {
		kind: "plan";
		/** Stable selection key. */
		key: string;
		documentId: string;
		title: string;
		presentedAt: number;
		/** The snapshot first shown in chat; the shared journal key is derived from it. */
		presented: UiDocument;
		/** Presented snapshot advanced by the journal (and any unsaved change). */
		current: UiDocument;
	}
	| {
		kind: "concept-map";
		key: string;
		documentId: string;
		nodeId: string;
		title: string;
		presentedAt: number;
		/** The presented document narrowed to the one concept-map node. */
		document: UiDocument;
	};

export interface SessionWorkspaceData {
	materials: WorkspaceMaterial[];
	/** Key of the newest presented plan, the default selection. */
	currentPlanKey: string | null;
}

type Readable = Pick<StorageLike, "getItem">;

function planTitle(document: UiDocument): string {
	const plan = document.nodes.find((node) => node.type === "study-plan");
	return (plan?.type === "study-plan" && plan.title) || "Study plan";
}

function mapNode(document: UiDocument, nodeId: string): Extract<UiDocument["nodes"][number], { type: "concept-map" }> | null {
	const node = document.nodes.find((candidate) => candidate.id === nodeId && candidate.type === "concept-map");
	return node?.type === "concept-map" ? node : null;
}

/** Group a session's presentation records into workspace materials, newest first. */
export function sessionWorkspaceMaterials(records: readonly OpenUiPresentationRecord[], sessionId: string, storage: Readable | null): SessionWorkspaceData {
	const plans = new Map<string, OpenUiPresentationRecord>();
	const maps: WorkspaceMaterial[] = [];
	for (const record of records) {
		if (record.sessionId !== sessionId || !record.document) continue;
		if (record.component === "study-plan") {
			const earlier = plans.get(record.documentId);
			// Revisions keep the first link; prefer the newest snapshot for a document.
			if (!earlier || record.createdAt > earlier.createdAt || record.revision > earlier.revision) plans.set(record.documentId, record);
		} else if (record.component === "concept-map") {
			const node = mapNode(record.document, record.nodeId);
			if (!node) continue;
			maps.push({
				kind: "concept-map",
				key: `map:${record.id}`,
				documentId: record.documentId,
				nodeId: record.nodeId,
				title: node.title || "Concept map",
				presentedAt: record.createdAt,
				document: { ...record.document, nodes: [node] },
			});
		}
	}
	const overlay = overlayPlanStorage(storage);
	const planMaterials: WorkspaceMaterial[] = [...plans.values()].map((record) => {
		const presented = record.document!;
		const current = loadSharedUiActionState(overlay, presented).document;
		return { kind: "plan", key: `plan:${record.documentId}`, documentId: record.documentId, title: planTitle(current), presentedAt: record.createdAt, presented, current };
	});
	const materials = [...planMaterials, ...maps].sort((a, b) => b.presentedAt - a.presentedAt || (a.kind === "plan" ? -1 : 1));
	const newestPlan = planMaterials.sort((a, b) => b.presentedAt - a.presentedAt)[0];
	return { materials, currentPlanKey: newestPlan?.key ?? null };
}

/**
 * Listen for reveal requests from the quote hook. Only `kind: "artifact"`
 * requests with an id reach the listener; message/document reveals belong to
 * other surfaces.
 */
export function onRevealQuoteSource(listener: (detail: RevealQuoteSourceDetail) => void, target: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null = typeof window === "undefined" ? null : window): () => void {
	if (!target) return () => {};
	const handle = (event: Event) => {
		const detail = (event as CustomEvent<RevealQuoteSourceDetail>).detail;
		if (!detail || detail.kind !== "artifact" || typeof detail.id !== "string" || !detail.id) return;
		listener({ kind: "artifact", id: detail.id, ...(typeof detail.revision === "number" ? { revision: detail.revision } : {}) });
	};
	target.addEventListener(REVEAL_QUOTE_SOURCE_EVENT, handle);
	return () => target.removeEventListener(REVEAL_QUOTE_SOURCE_EVENT, handle);
}

/** The material a reveal request names: an exact key, else the first material of that document. */
export function resolveRevealTarget(materials: readonly WorkspaceMaterial[], detail: RevealQuoteSourceDetail | null | undefined): WorkspaceMaterial | null {
	if (!detail || detail.kind !== "artifact" || typeof detail.id !== "string" || !detail.id) return null;
	return materials.find((material) => material.key === detail.id)
		?? materials.find((material) => material.documentId === detail.id && material.kind === "plan")
		?? materials.find((material) => material.documentId === detail.id)
		?? null;
}

export function materialRevision(material: WorkspaceMaterial): number {
	return material.kind === "plan" ? material.current.revision : material.document.revision;
}

/* Per-session workspace preferences (open + selected material). */

const PREFS_PREFIX = "keating:session-workspace:v1:";

export interface SessionWorkspacePrefs {
	open: boolean;
	selectedKey: string | null;
}

function browserStorage(): Pick<StorageLike, "getItem" | "setItem"> | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function loadSessionWorkspacePrefs(sessionId: string, storage: Readable | null = browserStorage()): SessionWorkspacePrefs {
	const fallback = { open: false, selectedKey: null };
	if (!sessionId || !storage) return fallback;
	try {
		const parsed: unknown = JSON.parse(storage.getItem(`${PREFS_PREFIX}${sessionId}`) ?? "null");
		if (!parsed || typeof parsed !== "object") return fallback;
		const raw = parsed as Partial<SessionWorkspacePrefs>;
		return { open: raw.open === true, selectedKey: typeof raw.selectedKey === "string" ? raw.selectedKey : null };
	} catch {
		return fallback;
	}
}

/** Best effort: a refused write only loses the remembered layout, never learner work. */
export function saveSessionWorkspacePrefs(sessionId: string, prefs: SessionWorkspacePrefs, storage: Pick<StorageLike, "setItem"> | null = browserStorage()): boolean {
	if (!sessionId || !storage) return false;
	try {
		storage.setItem(`${PREFS_PREFIX}${sessionId}`, JSON.stringify(prefs));
		return true;
	} catch {
		return false;
	}
}
