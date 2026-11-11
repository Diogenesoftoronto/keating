import { useId, type ReactNode, type Ref } from "react";
import { AlertTriangle, Check, History, Library, ListTree, RefreshCw, Sparkles, X } from "lucide-react";
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

const focusRing = { _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } };

export const workspaceButton = css({
	display: "inline-flex", alignItems: "center", gap: "0.375rem", minHeight: "2rem", borderRadius: "{radii.keating}",
	paddingInline: "0.625rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer",
	border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { opacity: 0.6, cursor: "default" },
	...focusRing,
});

const primaryButton = cx(workspaceButton, css({ background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)", _hover: { background: "var(--primary)", color: "var(--primary-foreground)", opacity: 0.9 } }));

const notice = css({ display: "flex", flexDirection: "column", gap: "0.5rem", borderRadius: "0.625rem", border: "1px solid var(--border)", padding: "0.75rem", fontSize: "0.8125rem", lineHeight: 1.45, color: "var(--foreground)" });
const warnTone = css({ borderColor: "rgb(245 158 11 / 0.5)", background: "rgb(245 158 11 / 0.1)" });
const errorTone = css({ borderColor: "color-mix(in srgb, var(--destructive) 45%, transparent)", background: "color-mix(in srgb, var(--destructive) 8%, transparent)" });
const infoTone = css({ borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)", background: "color-mix(in srgb, var(--primary) 6%, transparent)" });
const row = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" });
const muted = css({ color: "var(--muted-foreground)", fontSize: "0.75rem" });

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

function MaterialSwitcher({ materials, selectedKey, onSelect }: { materials: readonly WorkspaceMaterial[]; selectedKey: string | null; onSelect: (key: string) => void }) {
	const id = useId();
	if (materials.length < 2) return null;
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 })}>
		<label htmlFor={id} className={muted}>This session's materials</label>
		<select
			id={id}
			value={selectedKey ?? ""}
			onChange={(event) => onSelect(event.target.value)}
			className={css({ width: "100%", maxWidth: "100%", minHeight: "2.25rem", borderRadius: "{radii.keating}", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", paddingInline: "0.5rem", fontSize: "0.875rem", ...focusRing })}
		>
			{materials.map((material) => <option key={material.key} value={material.key}>
				{material.kind === "plan" ? "Study plan" : "Concept map"}: {material.title}
			</option>)}
		</select>
	</div>;
}

function SaveStatus({ save, onRetry, onDismiss }: { save: PendingPlanSave; onRetry: () => void; onDismiss: () => void }) {
	return <div role="alert" className={cx(notice, warnTone)}>
		<div className={row}>
			<AlertTriangle size={16} aria-hidden="true" />
			<strong>Plan change not saved</strong>
		</div>
		<p>{save.error} The change is still shown here and kept until you retry or discard it. It will be lost if you reload this page first.</p>
		<div className={row}>
			<button type="button" className={primaryButton} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Retry save</button>
			<button type="button" className={workspaceButton} onClick={onDismiss}><X size={14} aria-hidden="true" /> Discard change</button>
		</div>
	</div>;
}

function ProposalList({ proposals, deciding, onDecide }: { proposals: readonly PlanRevisionProposal[]; deciding?: string | null; onDecide: SessionWorkspaceViewProps["onDecide"] }) {
	const pending = proposals.filter((proposal) => proposal.status === "pending");
	if (!pending.length) return null;
	return <section aria-label="Proposed plan changes" className={cx(notice, infoTone)}>
		<div className={row}><ListTree size={16} aria-hidden="true" /><strong>{pending.length === 1 ? "1 proposed change" : `${pending.length} proposed changes`}</strong></div>
		<ul className={css({ display: "flex", flexDirection: "column", gap: "0.625rem" })}>
			{pending.map((proposal) => {
				const items = proposal.change.op === "insert-prerequisite" ? [proposal.change.item] : proposal.change.op === "expand-item" ? proposal.change.children : [];
				return <li key={proposal.id} data-proposal-id={proposal.id} className={css({ display: "flex", flexDirection: "column", gap: "0.375rem" })}>
					<span className={css({ fontWeight: 600 })}>{proposalHeading(proposal.change)}</span>
					{items.length ? <ul className={css({ paddingLeft: "1.25rem", listStyle: "disc" })}>{items.map((item) => <li key={item.id}>{item.title}</li>)}</ul> : null}
					<div className={row}>
						<button type="button" className={primaryButton} disabled={deciding === proposal.id} onClick={() => onDecide(proposal, "accept")}><Check size={14} aria-hidden="true" /> Accept</button>
						<button type="button" className={workspaceButton} disabled={deciding === proposal.id} onClick={() => onDecide(proposal, "decline")}><X size={14} aria-hidden="true" /> Decline</button>
					</div>
				</li>;
			})}
		</ul>
	</section>;
}

/** Previous revision against the current one: what changed, plus the linear history. */
export function PlanRevisionCompare({ material, history }: { material: Extract<WorkspaceMaterial, { kind: "plan" }>; history: readonly PlanRevisionHistoryEntry[] }) {
	const latest = history[history.length - 1];
	if (!latest) return <p className={muted}>No earlier revision yet. Changes Keating makes to this plan, or that you accept, will be listed here.</p>;
	const diff = comparePlanRevisions(latest.before, material.current);
	const list = (label: string, entries: string[]) => entries.length ? <div><p className={css({ fontWeight: 600 })}>{label}</p><ul className={css({ paddingLeft: "1.25rem", listStyle: "disc" })}>{entries.map((entry) => <li key={entry}>{entry}</li>)}</ul></div> : null;
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.8125rem" })}>
		<p>Revision {diff.previousRevision} (before the last change) compared with revision {diff.currentRevision} (now).</p>
		{diff.unchanged ? <p className={muted}>No item-level differences.</p> : <>
			{list("Added", diff.added.map((item) => `+ ${item.title}`))}
			{list("Removed", diff.removed.map((item) => `− ${item.title}`))}
			{list("Renamed", diff.retitled.map((item) => `${item.from} → ${item.to}`))}
			{list("Progress", diff.statusChanged.map((item) => `${item.title}: ${item.from} → ${item.to}`))}
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

function MaterialFrame({ material, children }: { material: WorkspaceMaterial; children: ReactNode }) {
	return <div
		data-workspace-material={material.key}
		data-quote-source-kind="artifact"
		data-quote-source-id={material.documentId}
		data-quote-source-revision={materialRevision(material)}
		className={css({ minWidth: 0, maxWidth: "100%", overflowX: "auto" })}
	>{children}</div>;
}

export function SessionWorkspaceView(props: SessionWorkspaceViewProps) {
	const { load, selectedKey, headingRef } = props;
	const header = (materials: readonly WorkspaceMaterial[]) => <header className={css({ display: "flex", flexDirection: "column", gap: "0.625rem" })}>
		<div className={css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" })}>
			<div className={css({ minWidth: 0 })}>
				<h2 ref={headingRef} tabIndex={-1} className={css({ fontSize: "1rem", fontWeight: 700, color: "var(--foreground)", borderRadius: "0.25rem", ...focusRing })}>Session workspace</h2>
				<p className={muted}>The plan and maps from this conversation.</p>
			</div>
			<button type="button" className={workspaceButton} onClick={props.onShowLibrary}><Library size={14} aria-hidden="true" /> All materials</button>
		</div>
		<MaterialSwitcher materials={materials} selectedKey={selectedKey} onSelect={props.onSelect} />
	</header>;

	if (load.status === "loading") {
		return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>{header([])}<p role="status" className={muted}>Loading this session's plan and maps…</p></div>;
	}
	if (load.status === "error") {
		return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>{header([])}
			<div role="alert" className={cx(notice, errorTone)}>
				<div className={row}><AlertTriangle size={16} aria-hidden="true" /><strong>Couldn't load this session's materials</strong></div>
				<p>{load.message}</p>
				<div className={row}><button type="button" className={primaryButton} onClick={props.onReload}><RefreshCw size={14} aria-hidden="true" /> Try again</button></div>
			</div>
		</div>;
	}
	const { materials, currentPlanKey } = load;
	if (!materials.length) {
		return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem" })}>{header([])}
			<div className={notice} data-workspace-empty="">
				<strong>No study plan yet for this session</strong>
				<p>Ask Keating for one in the chat, for example "Make me a study plan for this topic" or "Draw a concept map of what we covered". Plans and concept maps it shows will appear here, and stay here when you come back.</p>
			</div>
		</div>;
	}
	const selected = materials.find((material) => material.key === selectedKey) ?? materials.find((material) => material.key === currentPlanKey) ?? materials[0]!;
	const saves = props.pendingSaves.filter((save) => selected.kind === "plan" && save.documentId === selected.documentId);
	const otherSaves = props.pendingSaves.filter((save) => !saves.includes(save));
	const outdated = selected.kind === "plan" && currentPlanKey && selected.key !== currentPlanKey;
	const history = selected.kind === "plan" ? props.history[selected.documentId] ?? [] : [];
	const updatedHere = props.updated && props.updated.documentId === selected.documentId ? props.updated : null;
	const latestEntry = history[history.length - 1];

	return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 })}>
		{header(materials)}
		{[...saves, ...otherSaves].map((save) => <SaveStatus key={save.documentId} save={save} onRetry={() => props.onRetrySave(save.documentId)} onDismiss={() => props.onDismissSave(save.documentId)} />)}
		{props.decisionError ? <p role="alert" className={cx(notice, errorTone)}>{props.decisionError}</p> : null}
		<section aria-labelledby={`${selected.key}-title`} className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 })}>
			<div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" })}>
				<h3 id={`${selected.key}-title`} className={css({ fontSize: "0.9375rem", fontWeight: 700, overflowWrap: "anywhere" })}>
					<span className={muted}>{selected.kind === "plan" ? "Study plan" : "Concept map"} · </span>{selected.title}
				</h3>
				<span className={muted} data-workspace-revision={materialRevision(selected)}>Revision {materialRevision(selected)}{latestEntry ? ` · ${history.length} change${history.length === 1 ? "" : "s"} logged` : ""}</span>
			</div>
			{updatedHere ? <div role="status" className={cx(notice, infoTone)} data-workspace-updated={updatedHere.revision}>
				<div className={row}><Sparkles size={16} aria-hidden="true" /><strong>Updated to revision {updatedHere.revision}</strong></div>
				<p>{latestEntry && latestEntry.revision === updatedHere.revision ? `${latestEntry.summary}. ` : ""}{VIA_LABEL[updatedHere.via]}.</p>
				<div className={row}>
					{!props.compareOpen ? <button type="button" className={workspaceButton} onClick={props.onToggleCompare}><History size={14} aria-hidden="true" /> See what changed</button> : null}
					<button type="button" className={workspaceButton} onClick={props.onDismissUpdated}>Dismiss</button>
				</div>
			</div> : null}
			{outdated ? <div role="status" className={cx(notice, warnTone)} data-workspace-outdated="">
				<div className={row}><AlertTriangle size={16} aria-hidden="true" /><strong>Older plan</strong></div>
				<p>Keating has shown a newer study plan in this session since this one.</p>
				<div className={row}><button type="button" className={workspaceButton} onClick={() => props.onSelect(currentPlanKey!)}>Show the current plan</button></div>
			</div> : null}
			{selected.kind === "plan" ? <ProposalList proposals={props.proposals.filter((proposal) => proposal.documentId === selected.documentId)} deciding={props.deciding} onDecide={props.onDecide} /> : null}
			<MaterialFrame material={selected}>
				{selected.kind === "plan" ? props.renderPlan(selected, saves.length > 0) : <SharedUiDocumentRenderer document={selected.document} />}
			</MaterialFrame>
			{selected.kind === "plan" ? <div className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" })}>
				<button type="button" className={workspaceButton} aria-expanded={props.compareOpen} onClick={props.onToggleCompare}>
					<History size={14} aria-hidden="true" /> {props.compareOpen ? "Hide revisions" : "Compare with previous revision"}
				</button>
				{props.compareOpen ? <div className={css({ marginTop: "0.75rem" })}><PlanRevisionCompare material={selected} history={history} /></div> : null}
			</div> : null}
		</section>
	</div>;
}
