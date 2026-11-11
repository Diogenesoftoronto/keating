import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { KeatingOpenUIActionProvider, KeatingOpenUIRenderer } from "../../keating/openui/renderer";
import type { KeatingOpenUIAction, OpenUIDocumentMetadata } from "../../keating/openui/types";
import { dismissPendingPlanSave, retryPendingPlanSave } from "../../keating/plan-pending-saves";
import { scrollBehavior } from "../../lib/motion";
import {
	announcePlanLearnerUpdate,
	resolvePlanRevisionProposal,
	type PlanRevisionProposal,
	type PlanRevisionSource,
} from "../../keating/plan-revisions";
import { resolveRevealTarget, type RevealQuoteSourceDetail, type WorkspaceMaterial } from "../../keating/session-workspace";
import { SessionWorkspaceView } from "./SessionWorkspaceView";
import { useSessionWorkspace } from "./useSessionWorkspace";

export interface SessionWorkspaceProps {
	sessionId: string;
	source: PlanRevisionSource;
	selectedKey: string | null;
	onSelect: (key: string) => void;
	onShowLibrary: () => void;
	/** A reveal request from the quote hook; consumed once resolved. */
	reveal?: RevealQuoteSourceDetail | null;
	onRevealHandled?: () => void;
	headingRef?: Ref<HTMLHeadingElement>;
}

function browserStorage() {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

type PlanMaterial = Extract<WorkspaceMaterial, { kind: "plan" }>;

/** The interactive plan through the production renderer, sharing the chat card's journal. */
function WorkspacePlan({ material, sessionId, unsaved }: { material: PlanMaterial; sessionId: string; unsaved: boolean }) {
	// The presented snapshot keeps the renderer mounted across ticks (focus stays put);
	// an unsaved change is only in memory, so show that document instead.
	const document = unsaved ? material.current : material.presented;
	const metadata = useMemo<OpenUIDocumentMetadata>(() => ({
		id: document.id,
		revision: document.revision,
		// Same lifecycle as the chat card, so both use the same (or no) stored journal.
		lifecycle: document.retention ?? "resumable",
		sessionId,
	}), [document.id, document.retention, document.revision, sessionId]);
	// Deliveries stay pending here; the chat card (with the real host) reloads on
	// the announcement below and delivers them, so there is exactly one sender.
	// Announce each delivery once: the announcement reloads this renderer too, which
	// re-offers still-pending deliveries, and must not loop.
	const announced = useRef(new Set<string>());
	const onAction = useCallback((action: KeatingOpenUIAction) => {
		const key = action.kind === "canonical" ? `${action.action.documentId}-${action.action.idempotencyKey}` : `${action.type}:${JSON.stringify(action.params)}`;
		if (!announced.current.has(key)) {
			announced.current.add(key);
			queueMicrotask(() => announcePlanLearnerUpdate(document.id, document.revision));
		}
		return false;
	}, [document.id, document.revision]);
	return <KeatingOpenUIActionProvider onAction={onAction}>
		<KeatingOpenUIRenderer document={document} metadata={metadata} />
	</KeatingOpenUIActionProvider>;
}

/** Settle a proposal from the workspace; returns a learner-facing problem, or null when it went through. */
export async function decideWorkspaceProposal(
	source: PlanRevisionSource,
	proposal: Pick<PlanRevisionProposal, "id">,
	decision: "accept" | "decline",
	storage: Parameters<typeof resolvePlanRevisionProposal>[3],
): Promise<string | null> {
	try {
		const status = await resolvePlanRevisionProposal(source, proposal.id, decision, storage);
		if (status === "stale") return "This change no longer fits the plan as it is now, so it was not applied.";
		if (status === null) return "This proposal could not be found. It may have been settled in another tab.";
		if (status === "pending") return "That decision was not saved. Try again.";
		return null;
	} catch (cause) {
		return cause instanceof Error ? `That decision was not saved: ${cause.message}` : "That decision was not saved. Try again.";
	}
}

export function SessionWorkspace({ sessionId, source, selectedKey, onSelect, onShowLibrary, reveal, onRevealHandled, headingRef }: SessionWorkspaceProps) {
	const storage = useMemo(browserStorage, []);
	const workspace = useSessionWorkspace(sessionId, source, storage);
	const [deciding, setDeciding] = useState<string | null>(null);
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [compareOpen, setCompareOpen] = useState(false);
	const lastKey = useRef(selectedKey);

	useEffect(() => {
		if (lastKey.current !== selectedKey) setCompareOpen(false);
		lastKey.current = selectedKey;
	}, [selectedKey]);

	useEffect(() => {
		if (!reveal || workspace.load.status !== "ready") return;
		const target = resolveRevealTarget(workspace.load.materials, reveal);
		if (target) {
			onSelect(target.key);
			queueMicrotask(() => {
				if (typeof document === "undefined") return;
				const frame = document.querySelector<HTMLElement>(`[data-workspace-material="${CSS.escape(target.key)}"]`);
				frame?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			});
		}
		onRevealHandled?.();
	}, [onRevealHandled, onSelect, reveal, workspace.load]);

	const decide = useCallback(async (proposal: PlanRevisionProposal, decision: "accept" | "decline") => {
		setDeciding(proposal.id);
		setDecisionError(null);
		try {
			setDecisionError(await decideWorkspaceProposal(source, proposal, decision, storage));
		} finally {
			setDeciding(null);
			workspace.reload();
		}
	}, [source, storage, workspace]);

	return <SessionWorkspaceView
		load={workspace.load}
		selectedKey={selectedKey}
		proposals={workspace.proposals}
		history={workspace.history}
		pendingSaves={workspace.pendingSaves}
		updated={workspace.updated}
		deciding={deciding}
		decisionError={decisionError}
		compareOpen={compareOpen}
		{...(headingRef ? { headingRef } : {})}
		onSelect={onSelect}
		onShowLibrary={onShowLibrary}
		onReload={workspace.reload}
		onDecide={(proposal, decision) => void decide(proposal, decision)}
		onRetrySave={(documentId) => void retryPendingPlanSave(documentId, storage)}
		onDismissSave={dismissPendingPlanSave}
		onDismissUpdated={workspace.dismissUpdated}
		onToggleCompare={() => setCompareOpen((open) => !open)}
		renderPlan={(material, unsaved) => <WorkspacePlan key={`${material.documentId}:${unsaved ? "unsaved" : "stored"}`} material={material} sessionId={sessionId} unsaved={unsaved} />}
	/>;
}
