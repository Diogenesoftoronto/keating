import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageLike } from "../../keating/event-store";
import { sharedUiActionStateKey } from "../../keating/openui/shared-actions";
import { PLAN_SAVE_STATUS_EVENT, listPendingPlanSaves, type PendingPlanSave } from "../../keating/plan-pending-saves";
import { loadPlanHistory, type PlanRevisionHistoryEntry } from "../../keating/plan-revision-history";
import {
	PLAN_PROPOSALS_CHANGED_EVENT,
	PLAN_REVISED_EVENT,
	listPlanRevisionProposals,
	type PlanRevisedDetail,
	type PlanRevisionProposal,
	type PlanRevisionSource,
} from "../../keating/plan-revisions";
import { sessionWorkspaceMaterials, type WorkspaceMaterial } from "../../keating/session-workspace";
import { OPENUI_PRESENTATIONS_CHANGED_EVENT } from "../../keating/storage";

export type WorkspaceLoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; materials: WorkspaceMaterial[]; currentPlanKey: string | null };

export interface WorkspaceUpdateNotice {
	documentId: string;
	revision: number;
	via: "autonomous" | "accepted";
}

export interface SessionWorkspaceState {
	load: WorkspaceLoadState;
	/** Pending/settled proposals for this session's plans. */
	proposals: PlanRevisionProposal[];
	/** Linear revision history per plan document id. */
	history: Record<string, PlanRevisionHistoryEntry[]>;
	/** Unsaved plan writes for this session's plans. */
	pendingSaves: PendingPlanSave[];
	/** Set when a revision lands while the workspace is open; cleared on dismiss. */
	updated: WorkspaceUpdateNotice | null;
	dismissUpdated: () => void;
	reload: () => void;
}

type Readable = Pick<StorageLike, "getItem">;

function browserStorage(): Readable | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** Learner ticks in the chat card write the journal without an event; a light poll keeps the workspace in step. */
const JOURNAL_POLL_MS = 1500;
const NO_IDS: readonly string[] = [];

/**
 * @param watchDocumentIds Further documents (quizzes, notes, tasks…) whose
 * journals the same poll watches, so the materials list follows learner
 * progress without a second timer.
 */
export function useSessionWorkspace(sessionId: string, source: PlanRevisionSource, storage: Readable | null = browserStorage(), watchDocumentIds: readonly string[] = NO_IDS): SessionWorkspaceState {
	const [load, setLoad] = useState<WorkspaceLoadState>({ status: "loading" });
	const [proposals, setProposals] = useState<PlanRevisionProposal[]>([]);
	const [history, setHistory] = useState<Record<string, PlanRevisionHistoryEntry[]>>({});
	const [pendingSaves, setPendingSaves] = useState<PendingPlanSave[]>([]);
	const [updated, setUpdated] = useState<WorkspaceUpdateNotice | null>(null);
	const request = useRef(0);
	const planIds = useRef<string[]>([]);
	const journalSnapshot = useRef("");
	const watched = useRef(watchDocumentIds);
	watched.current = watchDocumentIds;
	const snapshotOf = useCallback((ids: readonly string[]) => [...ids, ...watched.current].map((id) => storage?.getItem(sharedUiActionStateKey(id)) ?? "").join("\u0000"), [storage]);

	const readSide = useCallback((ids: readonly string[]) => {
		setProposals(listPlanRevisionProposals(ids, storage));
		setHistory(Object.fromEntries(ids.map((id) => [id, loadPlanHistory(storage, id)])));
		setPendingSaves(listPendingPlanSaves().filter((save) => ids.includes(save.documentId)));
		journalSnapshot.current = snapshotOf(ids);
	}, [snapshotOf, storage]);

	const reload = useCallback(() => {
		const id = ++request.current;
		if (!sessionId) {
			setLoad({ status: "ready", materials: [], currentPlanKey: null });
			return;
		}
		void source.getOpenUiPresentations(sessionId).then((records) => {
			if (id !== request.current) return;
			const data = sessionWorkspaceMaterials(records, sessionId, storage);
			planIds.current = data.materials.filter((material) => material.kind === "plan").map((material) => material.documentId);
			readSide(planIds.current);
			setLoad({ status: "ready", ...data });
		}, (cause: unknown) => {
			if (id !== request.current) return;
			setLoad({ status: "error", message: cause instanceof Error && cause.message ? cause.message : "This browser's saved data could not be read." });
		});
	}, [readSide, sessionId, source, storage]);

	useEffect(() => {
		setLoad({ status: "loading" });
		setUpdated(null);
		reload();
	}, [reload]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const onRevised = (event: Event) => {
			const detail = (event as CustomEvent<PlanRevisedDetail | { documentId: string; revision: number; via: "learner" }>).detail;
			if (detail && detail.via !== "learner" && planIds.current.includes(detail.documentId)) {
				setUpdated({ documentId: detail.documentId, revision: detail.revision, via: detail.via });
			}
			reload();
		};
		const onPresented = (event: Event) => {
			const ids = (event as CustomEvent<{ sessionIds?: string[] }>).detail?.sessionIds;
			if (!ids || ids.includes(sessionId)) reload();
		};
		const onSide = () => reload();
		window.addEventListener(PLAN_REVISED_EVENT, onRevised);
		window.addEventListener(OPENUI_PRESENTATIONS_CHANGED_EVENT, onPresented);
		window.addEventListener(PLAN_SAVE_STATUS_EVENT, onSide);
		window.addEventListener(PLAN_PROPOSALS_CHANGED_EVENT, onSide);
		const poll = window.setInterval(() => {
			if (snapshotOf(planIds.current) !== journalSnapshot.current) reload();
		}, JOURNAL_POLL_MS);
		return () => {
			window.removeEventListener(PLAN_REVISED_EVENT, onRevised);
			window.removeEventListener(OPENUI_PRESENTATIONS_CHANGED_EVENT, onPresented);
			window.removeEventListener(PLAN_SAVE_STATUS_EVENT, onSide);
			window.removeEventListener(PLAN_PROPOSALS_CHANGED_EVENT, onSide);
			window.clearInterval(poll);
		};
	}, [reload, sessionId, snapshotOf]);

	const dismissUpdated = useCallback(() => setUpdated(null), []);
	return { load, proposals, history, pendingSaves, updated, dismissUpdated, reload };
}
