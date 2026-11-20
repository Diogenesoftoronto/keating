import "./materials.css";
import type { UiActionReceipt, UiLabNode } from "@keating/learner-contracts";
import { LessonFrame } from "../lesson/LessonFrame";
import { Button, EmptyState, Loading, StatusDot, IconButton, Tabs, TabPanel } from "../../design-system/kit";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { css, cx } from "../../../styled-system/css";
import { PLAN_AROUND_CONSTRAINT_EVENT } from "../../keating/learning-intelligence/outlook";
import { SharedUiDocumentRenderer } from "../../keating/openui/shared-renderer";
import { retryPendingPlanSave, dismissPendingPlanSave } from "../../keating/plan-pending-saves";
import type { PlanRevisionProposal, PlanRevisionSource } from "../../keating/plan-revisions";
import {
	SESSION_MATERIAL_GROUPS, SESSION_MATERIAL_GROUP_LABEL, findSessionMaterial, resolveSessionMaterialReveal,
	type SessionMaterial, type SessionMaterialGroup,
} from "../../keating/session-materials";
import type { RevealQuoteSourceDetail } from "../../keating/session-workspace";
import { scrollBehavior } from "../../lib/motion";
import { StoredArtifactContent } from "../ArtifactViewer";
import { DeckPreview, QuizPreview, quizCompleted } from "./MaterialPreview";
import { decideWorkspaceProposal, WorkspacePlan } from "./SessionWorkspace";
import { MaterialFrame, WorkspaceMaterialSection, errorTone, muted, notice, primaryButton, workspaceButton } from "./SessionWorkspaceView";
import type { SessionMaterialsState } from "./useSessionMaterials";

/** Selection value meaning "the learner chose the list". */
export const MATERIALS_LIST_KEY = "list";

/** What the suggestion buttons ask for, sent as the learner's next message. */
export const MATERIAL_SUGGESTIONS = ["Make me a study plan", "Quiz me on what we covered", "Give me an assignment"] as const;

export interface SessionMaterialsPanelProps {
	state: SessionMaterialsState;
	sessionId: string;
	source: PlanRevisionSource;
	selectedKey: string | null;
	onSelect: (key: string) => void;
	onShowLibrary: () => void;
	onClose: () => void;
	reveal?: RevealQuoteSourceDetail | null;
	onRevealHandled?: () => void;
	headingRef?: Ref<HTMLHeadingElement>;
	/** The full-screen overlay: close it before jumping to the conversation. */
	modal?: boolean;
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const stack = "h1-materials";
const headingClass = "h1-material-heading";
const groupLabel = "h1-material-label";
const rowButton = "h1-material-row";
const kindIcon = "h1-material-icon";
const rowText = css({ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0, flex: 1 });
const rowTitle = "h1-material-name";
const rowMeta = "h1-material-label";
/* ── Small pieces ──────────────────────────────────────────────────────── */

function MaterialIcon({ material, size = 16 }: { material: SessionMaterial; size?: number }) {
	switch (material.kind) {
		case "plan": return <KeatingGlyph name="checklist" size={size} />;
		case "concept-map": return <KeatingGlyph name="tree" size={size} />;
		case "quiz": return <KeatingGlyph name="quiz" size={size} />;
		case "flashcards": return <KeatingGlyph name="layers" size={size} />;
		case "task": return <KeatingGlyph name="checklist" size={size} />;
		case "notes": return <KeatingGlyph name="note" size={size} />;
		case "goal": return <KeatingGlyph name="target" size={size} />;
		case "simulation": return <KeatingGlyph name="filter" size={size} />;
		case "coding-challenge": return <KeatingGlyph name="code" size={size} />;
		case "language-practice": return <KeatingGlyph name="globe" size={size} />;
		case "lab": return <KeatingGlyph name="tool" size={size} />;
		case "music-lab": return <KeatingGlyph name="music" size={size} />;
		case "image": return <KeatingGlyph name="image" size={size} />;
		case "media": return <KeatingGlyph name={material.label === "Audio" ? "wave" : "video"} size={size} />;
		case "saved": {
			if (material.source !== "saved") return <KeatingGlyph name="book" size={size} />;
			switch (material.legacyType) {
				case "map": return <KeatingGlyph name="route" size={size} />;
				case "animation": return <KeatingGlyph name="play" size={size} />;
				case "deck": return <KeatingGlyph name="layers" size={size} />;
				case "verification": return <KeatingGlyph name="checklist" size={size} />;
				default: return <KeatingGlyph name="book" size={size} />;
			}
		}
	}
}

const relative = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" }) : null;

/** "just now", "5 minutes ago", "yesterday", then a date. */
export function relativeTime(at: number, now = Date.now()): string {
	const seconds = Math.round((at - now) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 45) return "just now";
	if (!relative) return new Date(at).toLocaleDateString();
	if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
	if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
	if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
	return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(new Date(at).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) });
}

function StatusChip({ status, pushed }: { status: string | null; pushed?: boolean }) {
	if (!status) return null;
	return <span className="h1-material-status" style={pushed ? { marginInlineStart: "auto" } : undefined}><StatusDot tone={status === "Overdue" ? "warn" : "idle"} />{status}</span>;
}

/** Kinds the learner works on in the chat card; the panel shows a copy. */
const WORKED_IN_CHAT = new Set(["quiz", "flashcards", "task", "notes", "goal", "simulation", "coding-challenge", "language-practice", "music-lab", "lab"]);

function sendSuggestion(sessionId: string, text: string) {
	if (typeof window === "undefined") return;
	// The chat panel's existing "send this in this session" path (used by "Plan around this").
	window.dispatchEvent(new CustomEvent(PLAN_AROUND_CONSTRAINT_EVENT, { detail: { sessionId, text } }));
}

/** The panel's own scrolling container, so opening a material never scrolls the page. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
	for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if (overflow === "auto" || overflow === "scroll") return node;
	}
	return null;
}

/** The transcript element that shows this document, when it is on the page. */
function conversationAnchor(documentId: string): HTMLElement | null {
	if (typeof document === "undefined") return null;
	return document.querySelector<HTMLElement>(`.chat-page-panel [data-openui-document="${CSS.escape(documentId)}"]`);
}

function ShowInConversation({ documentId, modal, onClose }: { documentId: string; modal?: boolean; onClose: () => void }) {
	const [available, setAvailable] = useState(false);
	useEffect(() => {
		setAvailable(Boolean(conversationAnchor(documentId)));
	}, [documentId]);
	if (!available) return null;
	return <button type="button" className={cx(workspaceButton, css({ textAlign: "left", "& svg": { flexShrink: 0 } }))} onClick={() => {
		const jump = () => conversationAnchor(documentId)?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
		if (modal) {
			onClose();
			requestAnimationFrame(() => requestAnimationFrame(jump));
		} else jump();
	}}>
		<KeatingGlyph name="message" size={14} /> Show in conversation
	</button>;
}

/* ── View ──────────────────────────────────────────────────────────────── */

function PanelHeader({ headingRef, onShowLibrary, onClose }: Pick<SessionMaterialsPanelProps, "headingRef" | "onShowLibrary" | "onClose">) {
	return <header className="h1-material-head k-halftone">
		<div className={css({ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: 0 })}>
			<h2 ref={headingRef} tabIndex={-1} className={headingClass}>Materials</h2>
			<Button size="sm" variant="ghost" glyph="layers" title="Materials from all your conversations" onClick={onShowLibrary}>All materials</Button>
      <IconButton size="sm" glyph="x" label="Close materials" onClick={onClose} />
		</div>
		<p className={cx(muted, css({ fontSize: "0.8125rem" }))}>Everything Keating made for you in this conversation.</p>
	</header>;
}

function MaterialRow({ material, selected, onOpen, now }: { material: SessionMaterial; selected: boolean; onOpen: () => void; now: number }) {
	return <button type="button" className={rowButton} aria-current={selected ? "true" : undefined} data-material-key={material.key} onClick={onOpen}>
		<span className={kindIcon}><MaterialIcon material={material} /></span>
		<span className={rowText}>
			<span className={rowTitle}>{material.title}</span>
			<span className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: "0.5rem", rowGap: "0.25rem" })}>
				<span className={rowMeta}>{material.label} · {relativeTime(material.presentedAt, now)}</span>
				<StatusChip status={material.source === "missing" ? "Can't show" : material.status} pushed />
			</span>
		</span>
	</button>;
}

function Suggestions({ sessionId, quiet, onSent }: { sessionId: string; quiet?: boolean; onSent?: () => void }) {
	const id = useId();
	if (quiet) {
		return <section aria-labelledby={id} className={css({ display: "flex", flexDirection: "column", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.875rem" })}>
			<h3 id={id} className={groupLabel}>Ask Keating for…</h3>
			<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.375rem" })}>
				{MATERIAL_SUGGESTIONS.map((text) => <Button key={text} variant="ghost" size="sm" onClick={() => { sendSuggestion(sessionId, text); onSent?.(); }}>{text}</Button>)}
			</div>
		</section>;
	}
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })} aria-label="Ask Keating for a material" role="group">
		{MATERIAL_SUGGESTIONS.map((text) => <Button key={text} variant="ghost" size="sm" onClick={() => { sendSuggestion(sessionId, text); onSent?.(); }}>
			<KeatingGlyph name="spark" size={14} /> {text}
		</Button>)}
	</div>;
}

export interface MaterialListProps {
	materials: readonly SessionMaterial[];
	selectedKey: string | null;
	sessionId: string;
	onOpen: (key: string) => void;
	onSent?: () => void;
	now?: number;
}

export function SessionMaterialList({ materials, selectedKey, sessionId, onOpen, onSent, now = Date.now() }: MaterialListProps) {
	const groups = useMemo(() => SESSION_MATERIAL_GROUPS
		.map((group) => ({ group, items: materials.filter((material) => material.group === group) }))
		.filter((entry) => entry.items.length), [materials]);
	if (!materials.length) {
		return <EmptyState data-materials-empty="" glyph="layers" heading="Ask Keating for…" actions={<Suggestions sessionId={sessionId} {...(onSent ? { onSent } : {})} />}>
			Study plans, quizzes, flashcards, assignments and maps Keating makes in this conversation collect here, so you can come back to them.
		</EmptyState>;
	}
	return <div className={css({ display: "flex", flexDirection: "column", gap: "1rem", containerType: "inline-size" })}>
		{groups.map(({ group, items }) => <GroupSection key={group} group={group}>
			{items.map((material) => <li key={material.key}><MaterialRow material={material} selected={material.key === selectedKey} now={now} onOpen={() => onOpen(material.key)} /></li>)}
		</GroupSection>)}
		<Suggestions sessionId={sessionId} quiet {...(onSent ? { onSent } : {})} />
	</div>;
}

function GroupSection({ group, children }: { group: SessionMaterialGroup; children: ReactNode }) {
	const id = useId();
	return <section aria-labelledby={id} className={css({ display: "flex", flexDirection: "column", gap: "0.25rem" })}>
		<h3 id={id} className={groupLabel}>{SESSION_MATERIAL_GROUP_LABEL[group]}</h3>
		<ul className={css({ display: "flex", flexDirection: "column", gap: "0.125rem", listStyle: "none", margin: 0, padding: 0 })}>{children}</ul>
	</section>;
}

/* ── Container ─────────────────────────────────────────────────────────── */

export function SessionMaterialsPanel(props: SessionMaterialsPanelProps) {
	const { state, sessionId, selectedKey, onSelect, reveal, onRevealHandled, headingRef } = props;
	const { load, workspace } = state;
	const [deciding, setDeciding] = useState<string | null>(null);
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [compareOpen, setCompareOpen] = useState(false);
	const listRoot = useRef<HTMLDivElement>(null);
	const returnTo = useRef<string | null>(null);
	const storage = useMemo(() => {
		try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
	}, []);

	const materials = load.status === "ready" ? load.materials : [];
	const chosen = selectedKey === MATERIALS_LIST_KEY ? null : findSessionMaterial(materials, selectedKey);
	const current = chosen ?? (selectedKey !== MATERIALS_LIST_KEY && materials.length === 1 ? materials[0]! : null);

	useEffect(() => { setCompareOpen(false); }, [current?.key]);

	const tabPrefix = useId();
	const kindTabs = Array.from(new Map(materials.map(item => [item.kind, { id: tabPrefix + item.kind, label: item.label, key: item.key }])).values());
	const activeTab = tabPrefix + (current?.kind ?? "all");
	const tabs = materials.length > 0 && <Tabs className="h1-kind-tabs" label="Material kinds" value={activeTab}
		items={[{ id: tabPrefix + "all", label: "All" }, ...kindTabs]}
		onChange={id => onSelect(kindTabs.find(tab => tab.id === id)?.key ?? MATERIALS_LIST_KEY)} />;

	// Back to the list: give focus to the row the learner came from.
	useEffect(() => {
		if (current || !returnTo.current) return;
		const key = returnTo.current;
		returnTo.current = null;
		requestAnimationFrame(() => listRoot.current?.querySelector<HTMLElement>(`[data-material-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: false }));
	}, [current]);

	useEffect(() => {
		if (!reveal || load.status !== "ready") return;
		const target = resolveSessionMaterialReveal(load.materials, reveal);
		if (target) {
			onSelect(target.key);
			queueMicrotask(() => {
				if (typeof document === "undefined") return;
				const frame = document.querySelector<HTMLElement>(`[data-workspace-material="${CSS.escape(target.key)}"]`);
				frame?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			});
		}
		onRevealHandled?.();
	}, [load, onRevealHandled, onSelect, reveal]);

	const decide = useCallback(async (proposal: PlanRevisionProposal, decision: "accept" | "decline") => {
		setDeciding(proposal.id);
		setDecisionError(null);
		try {
			setDecisionError(await decideWorkspaceProposal(props.source, proposal, decision, storage));
		} finally {
			setDeciding(null);
			workspace.reload();
		}
	}, [props.source, storage, workspace]);

	const open = (key: string) => {
		onSelect(key);
		requestAnimationFrame(() => {
			listRoot.current?.querySelector<HTMLElement>("[data-material-detail-heading]")?.focus({ preventScroll: true });
			const scroller = scrollParent(listRoot.current);
			if (scroller) scroller.scrollTop = 0;
		});
	};
	const back = () => {
		returnTo.current = current?.key ?? null;
		onSelect(MATERIALS_LIST_KEY);
	};
	const onSent = props.modal ? props.onClose : undefined;

	if (load.status !== "ready") {
		return <div ref={listRoot} className={stack}>
			<PanelHeader headingRef={headingRef} onShowLibrary={props.onShowLibrary} onClose={props.onClose} />
			{load.status === "loading" ? <Loading label="Loading this session's materials…" /> : <div role="alert" className={cx(notice, errorTone)} data-glyph-host>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}><KeatingGlyph name="alert" size={16} /><strong>Couldn't load this session's materials</strong></div>
				<p>{load.message}</p>
				<div><button type="button" className={primaryButton} onClick={state.reload}><KeatingGlyph name="refresh" size={14} /> Try again</button></div>
			</div>}
		</div>;
	}

	if (!current) {
		return <div ref={listRoot} className={stack}>
			<PanelHeader headingRef={headingRef} onShowLibrary={props.onShowLibrary} onClose={props.onClose} />
			{tabs}
			<div role={tabs ? "tabpanel" : undefined} id={activeTab} aria-labelledby={tabs ? activeTab + "-tab" : undefined}><SessionMaterialList materials={materials} selectedKey={chosen?.key ?? null} sessionId={sessionId} onOpen={open} {...(onSent ? { onSent } : {})} /></div>
		</div>;
	}

	const titleId = current.source === "workspace" ? `${current.workspace.key}-title` : `${current.key}-title`;
	const title = <span id={titleId} role="heading" aria-level={3} tabIndex={-1} data-material-detail-heading="">{current.title}</span>;
	const body = <MaterialBody material={current} sessionId={sessionId} state={state} deciding={deciding} decisionError={decisionError}
		compareOpen={compareOpen} onToggleCompare={() => setCompareOpen(value => !value)}
		onDecide={(proposal, decision) => void decide(proposal, decision)} onSelect={onSelect} storage={storage} />;
	const planHasFrame = current.source === "workspace" && current.kind === "plan";
	return <div ref={listRoot} className={stack} data-material-detail={current.key}>
		<PanelHeader headingRef={headingRef} onShowLibrary={props.onShowLibrary} onClose={props.onClose} />
		{tabs}
		<TabPanel active id={activeTab}>
			<Button size="sm" variant="ghost" glyph="left" onClick={back}>All materials in this session</Button>
			<div className="h1-material-meta">
				<small>{relativeTime(current.presentedAt)}</small>
				{current.source !== "missing" && <StatusChip status={current.status} />}
				{current.source !== "saved" && <ShowInConversation documentId={current.documentId} modal={props.modal} onClose={props.onClose} />}
			</div>
			{planHasFrame ? <div id={titleId} tabIndex={-1} data-material-detail-heading="" role="region" aria-label={current.title}>{body}</div> : <LessonFrame glyph="book" kind={current.label} title={title}>{body}</LessonFrame>}
		</TabPanel>
	</div>;
}

function LabPreview({ node, receipts }: { node: UiLabNode; receipts: readonly UiActionReceipt[] }) {
	return <div data-material-preview="lab">
		<p>{node.brief}</p>
		<ol aria-label="Recorded checkpoints">
			{node.checkpoints.map(point => {
				const observations = receipts.flatMap(({ state, action }) =>
					state !== "rejected" && action.type === "observe-lab" && action.nodeId === node.id && action.checkpointId === point.id
						? [{ state, action }] : []);
				const outcome = observations.filter(item => item.action.passed).at(-1) ?? observations.at(-1);
				return <li key={point.id} className="h1-material-preview-row">
					<strong>{point.title}</strong>
					<p className={muted}>{outcome ? outcome.action.passed ? "Checkpoint met" : "Attempt recorded" : "No observation yet"}
						{outcome?.state === "pending" && " · Saving"}{outcome?.state === "retryable" && " · Awaiting retry"}</p>
					{outcome && <p>{outcome.action.evidence}</p>}
				</li>;
			})}
		</ol>
	</div>;
}

function MaterialBody({ material, sessionId, state, deciding, decisionError, compareOpen, onToggleCompare, onDecide, onSelect, storage }: {
	material: SessionMaterial; sessionId: string; state: SessionMaterialsState; deciding: string | null; decisionError: string | null; compareOpen: boolean;
	onToggleCompare: () => void; onDecide: (proposal: PlanRevisionProposal, decision: "accept" | "decline") => void; onSelect: (key: string) => void;
	storage: Storage | null;
}) {
	const { workspace } = state;
	switch (material.source) {
		case "workspace":
			return <WorkspaceMaterialSection
				headless
				selected={material.workspace}
				currentPlanKey={state.load.status === "ready" ? state.load.currentPlanKey : null}
				proposals={workspace.proposals}
				history={workspace.history}
				pendingSaves={workspace.pendingSaves}
				updated={workspace.updated}
				deciding={deciding}
				decisionError={decisionError}
				compareOpen={compareOpen}
				onSelect={onSelect}
				onDecide={onDecide}
				onRetrySave={(documentId) => void retryPendingPlanSave(documentId, storage)}
				onDismissSave={dismissPendingPlanSave}
				onDismissUpdated={workspace.dismissUpdated}
				onToggleCompare={onToggleCompare}
				renderPlan={(plan, unsaved) => <WorkspacePlan key={`${plan.documentId}:${unsaved ? "unsaved" : "stored"}`} material={plan} sessionId={sessionId} unsaved={unsaved} />}
			/>;
		case "openui": {
			const node = material.document.nodes.find(candidate => candidate.id === material.nodeId);
			if (!node) return <p className={notice}>This material is missing from the saved document.</p>;
			const preview = node.type === "quiz" ? <QuizPreview node={node} completed={quizCompleted(material.receipts, node.id)} />
				: node.type === "deck" ? <DeckPreview node={node} />
				: node.type === "lab" ? <LabPreview node={node} receipts={material.receipts} /> : null;
			return <>
				{!preview && WORKED_IN_CHAT.has(material.kind) ? <p className={cx(muted, css({ fontSize: "0.8125rem", lineHeight: 1.45 }))}>A copy to look back at. To answer or change it, use it in the conversation.</p> : null}
				<MaterialFrame material={{ key: material.key, documentId: material.documentId, revision: material.revision }}>
					{preview ?? <SharedUiDocumentRenderer document={material.document} receipts={material.receipts} />}
				</MaterialFrame>
			</>;
		}
		case "saved":
			return <div className={css({ minWidth: 0, maxWidth: "100%", overflowX: "auto", color: "var(--foreground)" })} role="region" aria-label={`${material.title}, saved ${material.label.toLowerCase()}`} tabIndex={0}>
				<StoredArtifactContent type={material.legacyType} data={material.data} />
			</div>;
		case "missing":
			return <div className={notice} data-material-missing="">
				<strong>This {material.label.toLowerCase()} can't be shown here</strong>
				<p>Its content wasn't kept on this device. Open it in the conversation where Keating shared it.</p>
			</div>;
	}
}

