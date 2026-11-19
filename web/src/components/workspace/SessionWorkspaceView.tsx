import { Chip, Loading, EmptyState } from "../../design-system/kit";
import { Tabs } from "../../design-system/kit";
import { useId, type ReactNode, type Ref } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import type { PlanRevisionChange } from "@keating/learner-contracts";
import { css, cx } from "../../../styled-system/css";
import type { PendingPlanSave } from "../../keating/plan-pending-saves";
import { comparePlanRevisions, type PlanRevisionHistoryEntry } from "../../keating/plan-revision-history";
import type { PlanRevisionProposal } from "../../keating/plan-revisions";
import { materialRevision, type WorkspaceMaterial } from "../../keating/session-workspace";
import { SharedUiDocumentRenderer } from "../../keating/openui/shared-renderer";
import type { WorkspaceLoadState, WorkspaceUpdateNotice } from "./useSessionWorkspace";

export interface SessionWorkspaceViewProps {
	load: WorkspaceLoadState;
	selectedKey: string | null;
	proposals: readonly PlanRevisionProposal[];
	history: Record<string, PlanRevisionHistoryEntry[]>;
	pendingSaves: readonly PendingPlanSave[];
	updated: WorkspaceUpdateNotice | null;
	/** Proposal id being decided, or a decision failure to show. */
	deciding?: string | null;
	decisionError?: string | null;
	compareOpen: boolean;
	headingRef?: Ref<HTMLHeadingElement>;
	onSelect: (key: string) => void;
	onShowLibrary: () => void;
	onReload: () => void;
	onDecide: (proposal: PlanRevisionProposal, decision: "accept" | "decline") => void;
	onRetrySave: (documentId: string) => void;
	onDismissSave: (documentId: string) => void;
	onDismissUpdated: () => void;
	onToggleCompare: () => void;
	/** Renders the interactive plan; the container supplies the production renderer. */
	renderPlan: (material: Extract<WorkspaceMaterial, { kind: "plan" }>, unsaved: boolean) => ReactNode;
}

export const focusRing = { _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } };

export const workspaceButton = "k-button k-ghost k-sm";
export const primaryButton = "k-button k-primary k-sm";
export const notice = "h1-material-notice";
const warnTone = "h1-material-warning";
export const errorTone = "h1-material-error";
const infoTone = "h1-material-info";
const row = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" });
export const muted = css({ color: "var(--muted-foreground)", fontSize: "0.75rem" });

const VIA_LABEL = { autonomous: "Changed by Keating", accepted: "Accepted by you" } as const;

function time(at: number): string {
	try {
		return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	} catch {
		return "";
	}
}

function proposalHeading(change: PlanRevisionChange): string {
	switch (change.op) {
		case "complete-item": return `Mark "${change.itemId}" as done`;
		case "insert-prerequisite": return `Add a prerequisite before "${change.beforeItemId}"`;
		case "expand-item": return `Split "${change.itemId}" into ${change.children.length} steps`;
	}
}

function SaveStatus({ save, onRetry, onDismiss }: { save: PendingPlanSave; onRetry: () => void; onDismiss: () => void }) {
	return <div role="alert" className={cx(notice, warnTone)}>
		<div className={row}>
			<KeatingGlyph name="alert" size={16} />
			<strong>Plan change not saved</strong>
		</div>
		<p>{save.error} The change is still shown here and kept until you retry or discard it. It will be lost if you reload this page first.</p>
		<div className={row}>
			<button type="button" className={primaryButton} onClick={onRetry}><KeatingGlyph name="refresh" size={14} /> Retry save</button>
			<button type="button" className={workspaceButton} onClick={onDismiss}><KeatingGlyph name="x" size={14} /> Discard change</button>
		</div>
	</div>;
}

function ProposalList({ proposals, deciding, onDecide }: { proposals: readonly PlanRevisionProposal[]; deciding?: string | null; onDecide: SessionWorkspaceViewProps["onDecide"] }) {
	const pending = proposals.filter((proposal) => proposal.status === "pending");
	if (!pending.length) return null;
	return <section aria-label="Proposed plan changes" className={cx(notice, infoTone)}>
		<div className={row} data-glyph-host><KeatingGlyph name="tree" size={16} /><strong>{pending.length === 1 ? "1 proposed change" : `${pending.length} proposed changes`}</strong></div>
		<ul className={css({ display: "flex", flexDirection: "column", gap: "0.625rem" })}>
			{pending.map((proposal) => {
				const items = proposal.change.op === "insert-prerequisite" ? [proposal.change.item] : proposal.change.op === "expand-item" ? proposal.change.children : [];
				return <li key={proposal.id} data-proposal-id={proposal.id} className={css({ display: "flex", flexDirection: "column", gap: "0.375rem" })}>
					<span className={css({ fontWeight: 600 })}>{proposalHeading(proposal.change)}</span>
					{items.length ? <ul className={css({ paddingLeft: "1.25rem", listStyle: "disc" })}>{items.map((item) => <li key={item.id} data-glyph-host>{item.title}</li>)}</ul> : null}
					<div className={row}>
						<button type="button" className={primaryButton} disabled={deciding === proposal.id} onClick={() => onDecide(proposal, "accept")}><KeatingGlyph name="check" size={14} /> Accept</button>
						<button type="button" className={workspaceButton} disabled={deciding === proposal.id} onClick={() => onDecide(proposal, "decline")}><KeatingGlyph name="x" size={14} /> Decline</button>
					</div>
				</li>;
			})}
		</ul>
	</section>;
}

/** Previous revision against the current one: what changed, plus the linear history. */
export function PlanRevisionCompare({ material, history }: { material: Extract<WorkspaceMaterial, { kind: "plan" }>; history: readonly PlanRevisionHistoryEntry[] }) {
	const latest = history[history.length - 1];
	if (!latest) return <EmptyState glyph="clock" heading="No earlier revision yet.">Changes Keating makes to this plan, or that you accept, will be listed here.</EmptyState>;
	const diff = comparePlanRevisions(latest.before, material.current);
	const list = (label: string, entries: ReactNode[]) => entries.length ? <div><p className={css({ fontWeight: 600 })}>{label}</p><ul className={css({ paddingLeft: "1.25rem", listStyle: "disc", "& svg": { display: "inline-block", verticalAlign: "middle" } })}>{entries}</ul></div> : null;
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.8125rem" })}>
		<p>Revision {diff.previousRevision} (before the last change) compared with revision {diff.currentRevision} (now).</p>
		{diff.unchanged ? <EmptyState glyph="checklist" heading="No item-level differences." /> : <>
			{list("Added", diff.added.map((item) => <li key={item.id} data-glyph-host><KeatingGlyph name="plus" size={13} /> {item.title}</li>))}
			{list("Removed", diff.removed.map((item) => <li key={item.id} data-glyph-host><KeatingGlyph name="minus" size={13} /> {item.title}</li>))}
			{list("Renamed", diff.retitled.map((item) => <li key={item.id} data-glyph-host>{item.from} <KeatingGlyph name="right" size={13} label="to" /> {item.to}</li>))}
			{list("Progress", diff.statusChanged.map((item) => <li key={item.id} data-glyph-host>{item.title}: {item.from} <KeatingGlyph name="right" size={13} label="to" /> {item.to}</li>))}
		</>}
		<details>
			<summary className={css({ cursor: "pointer", fontWeight: 600, borderRadius: "0.25rem", ...focusRing })}>Show revision {diff.previousRevision} as it was</summary>
			<div className={css({ marginTop: "0.5rem", opacity: 0.85 })} aria-label={`Plan at revision ${diff.previousRevision}, read only`}>
				<SharedUiDocumentRenderer document={latest.before} />
			</div>
		</details>
		<div>
			<p className={css({ fontWeight: 600 })}>History (newest first)</p>
			<ol className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
				{[...history].reverse().map((entry) => <li key={entry.revision} className={css({ display: "flex", flexWrap: "wrap", columnGap: "0.5rem" })}>
					<span className={css({ fontWeight: 600 })}>Rev {entry.revision}</span>
					<span>{entry.summary}</span>
					<span className={muted}>{VIA_LABEL[entry.via]} · {time(entry.at)}</span>
				</li>)}
			</ol>
		</div>
	</div>;
}

/** Wraps a material so quote capture and reveal targeting can find it. */
export function MaterialFrame({ material, children }: { material: Pick<WorkspaceMaterial, "key" | "documentId"> & ({ revision: number } | WorkspaceMaterial); children: ReactNode }) {
	return <div
		data-workspace-material={material.key}
		data-quote-source-kind="artifact"
		data-quote-source-id={material.documentId}
		data-quote-source-revision={"revision" in material ? material.revision : materialRevision(material)}
		className={css({ minWidth: 0, maxWidth: "100%", overflowX: "auto" })}
	>{children}</div>;
}

export function SessionWorkspaceView(props: SessionWorkspaceViewProps) {
	const { load, selectedKey, headingRef } = props;
	const prefix = useId();
	const header = (materials: readonly WorkspaceMaterial[], active?: string) => <header className={css({ display: "flex", flexDirection: "column", gap: "0.625rem" })}>
		<div className={css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" })}>
			<div className={css({ minWidth: 0 })}>
				<h2 ref={headingRef} tabIndex={-1} className={css({ fontSize: "1rem", fontWeight: 700, color: "var(--foreground)", borderRadius: "0.25rem", ...focusRing })}>Session workspace</h2>
				<p className={muted}>The plan and maps from this conversation.</p>
			</div>
			<button type="button" className={workspaceButton} onClick={props.onShowLibrary}><KeatingGlyph name="book" size={14} /> All materials</button>
		</div>
		{materials.length > 1 && <Tabs label="This session's materials" value={prefix + active}
      items={materials.map(m => ({ id: prefix + m.key, label: (m.kind === "plan" ? "Study plan: " : "Concept map: ") + m.title }))}
      onChange={id => props.onSelect(id.slice(prefix.length))} />}
	</header>;

	if (load.status === "loading") {
		return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>{header([])}<Loading label="Loading this session's plan and maps…" /></div>;
	}
	if (load.status === "error") {
		return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>{header([])}
			<div role="alert" className={cx(notice, errorTone)}>
				<div className={row} data-glyph-host><KeatingGlyph name="alert" size={16} /><strong>Couldn't load this session's materials</strong></div>
				<p>{load.message}</p>
				<div className={row}><button type="button" className={primaryButton} onClick={props.onReload}><KeatingGlyph name="refresh" size={14} /> Try again</button></div>
			</div>
		</div>;
	}
	const { materials, currentPlanKey } = load;
	if (!materials.length) {
		return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>{header([])}
			<EmptyState data-workspace-empty="" heading="No study plan yet for this session" glyph="route">Ask Keating for one in the chat, for example "Make me a study plan for this topic" or "Draw a concept map of what we covered". Plans and concept maps it shows will appear here, and stay here when you come back.
			</EmptyState>
		</div>;
	}
	const selected = materials.find((material) => material.key === selectedKey) ?? materials.find((material) => material.key === currentPlanKey) ?? materials[0]!;

	return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 })}>
		{header(materials, selected.key)}
		<div id={prefix + selected.key} role={materials.length > 1 ? "tabpanel" : undefined} aria-labelledby={materials.length > 1 ? prefix + selected.key + "-tab" : undefined}><WorkspaceMaterialSection {...props} selected={selected} currentPlanKey={currentPlanKey} /></div>
	</div>;
}

export type WorkspaceMaterialSectionProps = Omit<SessionWorkspaceViewProps, "load" | "selectedKey" | "headingRef" | "onShowLibrary" | "onReload"> & {
	selected: WorkspaceMaterial;
	currentPlanKey: string | null;
	/** The surrounding detail view already shows the kind and title as its heading (with this section's `${key}-title` id). */
	headless?: boolean;
};

/**
 * One plan or concept map with everything around it: unsaved-change recovery,
 * decision errors, the "updated" and "older plan" notices, proposals, the live
 * plan renderer inside the quote-source frame, and revision compare/history.
 */
export function WorkspaceMaterialSection(props: WorkspaceMaterialSectionProps) {
	const { selected, currentPlanKey } = props;
	const saves = props.pendingSaves.filter((save) => selected.kind === "plan" && save.documentId === selected.documentId);
	const otherSaves = props.pendingSaves.filter((save) => !saves.includes(save));
	const outdated = selected.kind === "plan" && currentPlanKey && selected.key !== currentPlanKey;
	const history = selected.kind === "plan" ? props.history[selected.documentId] ?? [] : [];
	const updatedHere = props.updated && props.updated.documentId === selected.documentId ? props.updated : null;
	const latestEntry = history[history.length - 1];
	const revision = <Chip data-workspace-revision={materialRevision(selected)}>Revision {materialRevision(selected)}{latestEntry ? ` · ${history.length} change${history.length === 1 ? "" : "s"} logged` : ""}</Chip>;

	return <>
		{[...saves, ...otherSaves].map((save) => <SaveStatus key={save.documentId} save={save} onRetry={() => props.onRetrySave(save.documentId)} onDismiss={() => props.onDismissSave(save.documentId)} />)}
		{props.decisionError ? <p role="alert" className={cx(notice, errorTone)}>{props.decisionError}</p> : null}
		<section aria-labelledby={`${selected.key}-title`} className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 })}>
			{/* In the panel the revision only matters once a plan has changed; "Revision 0" on a fresh plan or a map is noise. */}
			{props.headless ? (selected.kind === "plan" ? revision : null) : <div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" })}>
				<h3 id={`${selected.key}-title`} className={css({ fontSize: "0.9375rem", fontWeight: 700, overflowWrap: "anywhere" })}>
					<span className={muted}>{selected.kind === "plan" ? "Study plan" : "Concept map"} · </span>{selected.title}
				</h3>
				{revision}
			</div>}
			{updatedHere ? <div role="status" className={cx(notice, infoTone)} data-workspace-updated={updatedHere.revision}>
				<div className={row} data-glyph-host><KeatingGlyph name="spark" size={16} /><strong>Updated to revision {updatedHere.revision}</strong></div>
				<p>{latestEntry && latestEntry.revision === updatedHere.revision ? `${latestEntry.summary}. ` : ""}{VIA_LABEL[updatedHere.via]}.</p>
				<div className={row}>
					<button type="button" className={workspaceButton} onClick={props.onDismissUpdated}>Dismiss</button>
				</div>
			</div> : null}
			{outdated ? <div role="status" className={cx(notice, warnTone)} data-workspace-outdated="">
				<div className={row} data-glyph-host><KeatingGlyph name="alert" size={16} /><strong>Older plan</strong></div>
				<p>Keating has shown a newer study plan in this session since this one.</p>
				<div className={row}><button type="button" className={workspaceButton} onClick={() => props.onSelect(currentPlanKey!)}>Show the current plan</button></div>
			</div> : null}
			{selected.kind === "plan" ? <ProposalList proposals={props.proposals.filter((proposal) => proposal.documentId === selected.documentId)} deciding={props.deciding} onDecide={props.onDecide} /> : null}
			<MaterialFrame material={selected}>
				{selected.kind === "plan" ? props.renderPlan(selected, saves.length > 0) : <SharedUiDocumentRenderer document={selected.document} />}
			</MaterialFrame>
			{selected.kind === "plan" ? <div className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" })}>
				<button type="button" className={workspaceButton} aria-expanded={props.compareOpen} onClick={props.onToggleCompare}>
					<KeatingGlyph name="clock" size={14} /> {props.compareOpen ? "Hide revisions" : "See what changed"}
				</button>
				{props.compareOpen ? <div className={css({ marginTop: "0.75rem" })}><PlanRevisionCompare material={selected} history={history} /></div> : null}
			</div> : null}
		</section>
	</>;
}
