import {
	applyPlanRevision,
	DEFAULT_PLAN_CHANGE_MODE,
	PLAN_REVISION_LIMITS,
	type PlanChangeMode,
	type PlanRevisionChange,
	type PlanRevisionItem,
	type UiDocument,
} from "@keating/learner-contracts";
import type { StorageLike } from "./event-store";
import { keatingLifecycle } from "./lifecycle";
import { loadSharedUiActionState, sharedUiActionStateKey } from "./openui/shared-actions";
import type { OpenUiPresentationRecord } from "./storage";

/**
 * Fired on `window` whenever a study plan gains a revision outside the plan's
 * own card (a tutor revision or an accepted proposal). Rendered plans reload
 * their stored state on it.
 */
export const PLAN_REVISED_EVENT = "keating:plan-revised";
const PROPOSALS_KEY = "keating:plan-revision-proposals:v1";
const MAX_PROPOSALS = 50;

export interface PlanRevisedDetail {
	documentId: string;
	revision: number;
	sessionId?: string;
	op: PlanRevisionChange["op"];
	/** How the change landed: applied by the tutor, or accepted by the learner. */
	via: "autonomous" | "accepted";
}

export type PlanRevisionProposalStatus = "pending" | "accepted" | "declined" | "stale";

/** A change waiting for the learner. Holds ids and the change itself, which the learner reviews. */
export interface PlanRevisionProposal {
	id: string;
	documentId: string;
	baseRevision: number;
	sessionId?: string;
	change: PlanRevisionChange;
	status: PlanRevisionProposalStatus;
	createdAt: number;
}

export interface PlanRevisionSource {
	getOpenUiPresentations(sessionId?: string): Promise<OpenUiPresentationRecord[]>;
}

type PlanStorage = Pick<StorageLike, "getItem" | "setItem">;

function browserStorage(): PlanStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

interface CurrentPlan {
	document: UiDocument;
	sessionId?: string;
}

/** The plan as the learner currently sees it: its newest presented snapshot advanced by stored actions. */
export async function loadCurrentPlan(source: PlanRevisionSource, documentId: string, storage: PlanStorage | null = browserStorage()): Promise<CurrentPlan | null> {
	const latest = (await source.getOpenUiPresentations())
		.filter((record) => record.documentId === documentId && record.component === "study-plan" && record.document)
		.sort((a, b) => b.createdAt - a.createdAt)[0];
	if (!latest?.document) return null;
	return {
		document: loadSharedUiActionState(storage, latest.document).document,
		...(latest.sessionId ? { sessionId: latest.sessionId } : {}),
	};
}

/**
 * Persist `next` as the plan's newest revision, keeping the learner's action
 * journal and pending deliveries, then announce it on the lifecycle bus and
 * the window so hosts and rendered plans can react.
 */
async function commitRevision(storage: PlanStorage, current: UiDocument, next: UiDocument, detail: Omit<PlanRevisedDetail, "documentId" | "revision">): Promise<void> {
	const state = loadSharedUiActionState(storage, current);
	storage.setItem(sharedUiActionStateKey(next.id), JSON.stringify({ ...state, document: next }));
	const revised: PlanRevisedDetail = { documentId: next.id, revision: next.revision, ...detail };
	await keatingLifecycle.emit({ type: "plan_revised", sessionId: detail.sessionId ?? "", documentId: next.id, revision: next.revision, op: detail.op, via: detail.via });
	if (typeof window !== "undefined") window.dispatchEvent(new window.CustomEvent<PlanRevisedDetail>(PLAN_REVISED_EVENT, { detail: revised }));
}

export type PlanRevisionOutcome =
	| { status: "applied"; document: UiDocument }
	| { status: "proposed"; proposal: PlanRevisionProposal }
	| { status: "rejected"; reason: "no-plan" | "invalid-change" };

/** Autonomous mode applies the change now; approval mode stores it for the learner's Accept. */
export async function revisePlan(
	source: PlanRevisionSource,
	documentId: string,
	change: PlanRevisionChange,
	mode: PlanChangeMode = DEFAULT_PLAN_CHANGE_MODE,
	storage: PlanStorage | null = browserStorage(),
	now: () => number = Date.now,
): Promise<PlanRevisionOutcome> {
	if (!storage) return { status: "rejected", reason: "no-plan" };
	const current = await loadCurrentPlan(source, documentId, storage);
	if (!current) return { status: "rejected", reason: "no-plan" };
	const next = applyPlanRevision(current.document, change, new Date(now()).toISOString());
	if (!next) return { status: "rejected", reason: "invalid-change" };
	if (mode === "autonomous") {
		await commitRevision(storage, current.document, next, { op: change.op, via: "autonomous", ...(current.sessionId ? { sessionId: current.sessionId } : {}) });
		return { status: "applied", document: next };
	}
	const proposal: PlanRevisionProposal = {
		id: `plan-rev-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		documentId, baseRevision: current.document.revision, change, status: "pending", createdAt: now(),
		...(current.sessionId ? { sessionId: current.sessionId } : {}),
	};
	saveProposals(storage, [...loadProposals(storage), proposal]);
	return { status: "proposed", proposal };
}

function loadProposals(storage: Pick<StorageLike, "getItem"> | null): PlanRevisionProposal[] {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(PROPOSALS_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed as PlanRevisionProposal[] : [];
	} catch {
		return [];
	}
}

function saveProposals(storage: PlanStorage, proposals: readonly PlanRevisionProposal[]): void {
	storage.setItem(PROPOSALS_KEY, JSON.stringify(proposals.slice(-MAX_PROPOSALS)));
}

export function getPlanRevisionProposal(id: string, storage: Pick<StorageLike, "getItem"> | null = browserStorage()): PlanRevisionProposal | null {
	return loadProposals(storage).find((proposal) => proposal.id === id) ?? null;
}

/**
 * Settle a pending proposal. Accept re-applies the change to the plan as it is
 * now (the learner may have ticked items since), and marks the proposal stale
 * when it no longer fits instead of forcing a partial edit.
 */
export async function resolvePlanRevisionProposal(
	source: PlanRevisionSource,
	id: string,
	decision: "accept" | "decline",
	storage: PlanStorage | null = browserStorage(),
	now: () => number = Date.now,
): Promise<PlanRevisionProposalStatus | null> {
	if (!storage) return null;
	const proposals = loadProposals(storage);
	const proposal = proposals.find((candidate) => candidate.id === id);
	if (!proposal) return null;
	if (proposal.status !== "pending") return proposal.status;
	let status: PlanRevisionProposalStatus = "declined";
	if (decision === "accept") {
		const current = await loadCurrentPlan(source, proposal.documentId, storage);
		const next = current ? applyPlanRevision(current.document, proposal.change, new Date(now()).toISOString()) : null;
		status = next ? "accepted" : "stale";
		if (current && next) await commitRevision(storage, current.document, next, { op: proposal.change.op, via: "accepted", ...(proposal.sessionId ? { sessionId: proposal.sessionId } : {}) });
	}
	saveProposals(storage, proposals.map((candidate) => candidate.id === id ? { ...candidate, status } : candidate));
	return status;
}

const clean = (value: unknown, max: number): string => typeof value === "string" ? value.trim().slice(0, max) : "";

function revisionItem(value: unknown): PlanRevisionItem | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const id = clean(raw.id, 128);
	const title = clean(raw.title, 512);
	if (!id || !title) return null;
	const detail = clean(raw.detail, 8192);
	const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes.map((outcome) => clean(outcome, 512)).filter(Boolean).slice(0, 16) : [];
	return { id, title, ...(detail ? { detail } : {}), ...(outcomes.length ? { outcomes } : {}) };
}

/** Parse loosely-typed tool arguments into one bounded change, or null. */
export function planRevisionChangeFrom(params: Record<string, unknown>): PlanRevisionChange | null {
	const itemId = clean(params.item_id, 128);
	if (!itemId) return null;
	switch (params.change) {
		case "complete-item":
			return { op: "complete-item", itemId };
		case "insert-prerequisite": {
			const item = revisionItem(Array.isArray(params.items) ? params.items[0] : null);
			return item ? { op: "insert-prerequisite", beforeItemId: itemId, item } : null;
		}
		case "expand-item": {
			const children = Array.isArray(params.items) ? params.items.map(revisionItem) : [];
			if (!children.length || children.length > PLAN_REVISION_LIMITS.children || children.some((child) => !child)) return null;
			return { op: "expand-item", itemId, children: children as PlanRevisionItem[] };
		}
		default:
			return null;
	}
}
