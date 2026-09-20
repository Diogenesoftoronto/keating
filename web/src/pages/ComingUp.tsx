import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowRight,
	Brain,
	CheckCircle2,
	Clock3,
	Download,
	GripVertical,
	Layers3,
	Play,
	RefreshCw,
	Upload,
} from "lucide-react";

import { css, cx } from "../../styled-system/css";
import { FlashcardRenderer } from "../components/FlashcardRenderer";
import { ComingUpReadiness } from "../components/ComingUpReadiness";
import { LearningInsightsHeader, LearningMetric } from "../components/LearningInsightsHeader";
import { Nav } from "../components/Nav";
import { Select } from "../components/Select";
import { getInitPromise, keatingStorage } from "../hooks/keating-storage";
import { useSeo } from "../hooks/useSeo";
import { buildAnkiPackage, buildAnkiTsv, mergeAnkiDeck, parseAnkiPackage, parseAnkiText } from "../keating/anki-package";
import { buildComingUpQueue, type ComingUpItem, type ComingUpQueue } from "../keating/coming-up";
import { formatDueIn } from "../keating/srs";
import type { FlashcardDeck, LearnerState, StudyPriority, Verification } from "../keating/storage";
import { downloadFile, downloadTextFile } from "../lib/browser-download";
import { estimateStudyDeck, loadStudySnapshot, type StudyEstimateReceipt, type StudyEstimateResult } from "../keating/judgement/study-estimates";
import { StudyEstimateStore } from "../keating/judgement/study-estimate-store";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../keating/judgement-model";
import { judgementAccountStatus } from "../keating/judgement/public-account";
import { WebDecisionPolicyStore, projectWebDecisionPolicies, subscribeWebDecisionPolicies, type WebDecisionPolicies, type WebDecisionEvidence } from "../keating/judgement/decision-policies";

const PRIORITIES: Array<{ id: StudyPriority; label: string; note: string }> = [
	{ id: "focus", label: "Focus", note: "What matters most now" },
	{ id: "maintain", label: "Maintain", note: "Keep knowledge available" },
	{ id: "low", label: "Low priority", note: "Keep visible, spend less time" },
];

const styles = {
	page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
	main: css({ mx: "auto", maxW: "72rem", px: "1rem", py: "1.5rem" }),
	metrics: css({ display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
	reviewStrip: css({
		mt: "1.25rem", display: "flex", flexDir: "column", gap: "1rem", border: "2px solid var(--ink)",
		bg: "color-mix(in srgb, var(--accent-dim) 12%, var(--card))", p: "1rem",
		md: { flexDir: "row", alignItems: "center", justifyContent: "space-between", px: "1.25rem" },
	}),
	stripTitle: css({ display: "flex", alignItems: "center", gap: "0.625rem", fontFamily: "var(--mono-display)", fontSize: "1rem", fontWeight: 700 }),
	stripCopy: css({ mt: "0.25rem", fontSize: "0.75rem", lineHeight: "1.2rem", color: "var(--ink-soft)" }),
	button: css({
		display: "inline-flex", minH: "2.75rem", alignItems: "center", justifyContent: "center", gap: "0.5rem",
		border: "2px solid var(--ink)", borderRadius: "0.25rem", px: "0.875rem", fontFamily: "var(--mono-body)",
		fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", transition: "transform 120ms, box-shadow 120ms, background-color 120ms",
		_hover: { transform: "translate(-1px, -1px)", boxShadow: "3px 3px 0 color-mix(in srgb, var(--ink) 22%, transparent)" },
		_active: { transform: "translate(0, 0)", boxShadow: "none" },
		_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
		_disabled: { cursor: "not-allowed", opacity: 0.5, transform: "none", boxShadow: "none" },
	}),
	primaryButton: css({ bg: "var(--ink)", color: "var(--paper)", _hover: { bg: "var(--accent-dim)", color: "white" } }),
	accentButton: css({ bg: "var(--accent-dim)", color: "white", _hover: { bg: "var(--ink)" } }),
	quietButton: css({ bg: "var(--card)", color: "var(--ink)" }),
	workspace: css({ mt: "1.25rem", border: "2px solid var(--ink)", bg: "var(--card)", boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 18%, transparent)" }),
	workspaceHead: css({ display: "flex", flexDir: "column", gap: "1rem", borderBottom: "1px solid var(--ink)", p: "1rem", md: { flexDir: "row", alignItems: "center", justifyContent: "space-between", px: "1.25rem" } }),
	workspaceTitle: css({ fontFamily: "var(--mono-display)", fontSize: "1.125rem", fontWeight: 700 }),
	workspaceCopy: css({ mt: "0.25rem", maxW: "66ch", fontSize: "0.75rem", lineHeight: "1.2rem", color: "var(--ink-soft)" }),
	toolbar: css({
		display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem",
		"& > *": { w: "100%" },
		"& > :first-child": { gridColumn: "1 / -1" },
		md: { display: "flex", flexWrap: "wrap", "& > *": { w: "auto" }, "& > :first-child": { gridColumn: "auto" } },
	}),
	fileInput: css({ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap" }),
	mobileTabs: css({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", borderBottom: "1px solid var(--ink)", md: { display: "none" } }),
	mobileTab: css({
		minH: "2.75rem", borderRight: "1px solid var(--ink)", bg: "var(--paper)", px: "0.25rem",
		fontSize: "0.625rem", fontWeight: 700, lineHeight: "1rem", overflowWrap: "anywhere",
		"&[data-active=true]": { bg: "var(--ink)", color: "var(--paper)" },
		_last: { borderRight: 0 },
		_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-3px" },
	}),
	board: css({ display: "grid", gap: 0, md: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } }),
	lane: css({ minW: 0, bg: "color-mix(in srgb, var(--paper) 72%, var(--card))", md: { borderRight: "1px solid var(--ink)", _last: { borderRight: 0 } } }),
	laneDragging: css({ bg: "color-mix(in srgb, var(--green-wash) 58%, var(--paper))" }),
	laneHead: css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--ink)", px: "0.875rem", py: "0.75rem" }),
	laneTitle: css({ fontFamily: "var(--mono-display)", fontSize: "0.875rem", fontWeight: 700 }),
	laneNote: css({ mt: "0.125rem", fontSize: "0.625rem", lineHeight: "1rem", color: "var(--ink-soft)" }),
	count: css({ display: "inline-flex", minW: "1.75rem", height: "1.5rem", alignItems: "center", justifyContent: "center", border: "1px solid var(--ink)", borderRadius: "9999px", bg: "var(--card)", px: "0.4rem", fontSize: "0.6875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }),
	laneBody: css({ display: "grid", alignContent: "start", gap: "0.75rem", minH: "18rem", p: "0.75rem" }),
	emptyLane: css({ border: "1px dashed color-mix(in srgb, var(--ink) 38%, transparent)", p: "1rem", textAlign: "center", fontSize: "0.6875rem", lineHeight: "1.1rem", color: "var(--ink-soft)" }),
	card: css({ border: "1px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--card)", p: "0.75rem", transition: "transform 120ms, box-shadow 120ms, opacity 120ms", _hover: { transform: "translate(-1px, -1px)", boxShadow: "3px 3px 0 color-mix(in srgb, var(--ink) 16%, transparent)" }, _focusWithin: { outline: "2px solid var(--accent)", outlineOffset: "1px" } }),
	cardDragging: css({ opacity: 0.55, transform: "rotate(1deg)" }),
	cardHead: css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" }),
	dragHandle: css({ flexShrink: 0, mt: "0.05rem", color: "var(--ink-soft)", cursor: "grab" }),
	cardText: css({ minW: 0, flex: 1 }),
	cardTitle: css({ overflowWrap: "anywhere", fontFamily: "var(--mono-display)", fontSize: "0.8125rem", fontWeight: 700, lineHeight: "1.15rem" }),
	cardDescription: css({ mt: "0.25rem", overflow: "hidden", lineClamp: 2, fontSize: "0.6875rem", lineHeight: "1.05rem", color: "var(--ink-soft)" }),
	badges: css({ mt: "0.625rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }),
	badge: css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", border: "1px solid color-mix(in srgb, var(--ink) 30%, transparent)", borderRadius: "9999px", bg: "var(--paper)", px: "0.45rem", py: "0.2rem", fontSize: "0.625rem", color: "var(--ink-soft)" }),
	dueBadge: css({ borderColor: "color-mix(in srgb, var(--accent-dim) 52%, transparent)", bg: "color-mix(in srgb, var(--green-wash) 65%, var(--card))", color: "var(--accent-dim)", fontWeight: 700 }),
	overdueBadge: css({ borderColor: "color-mix(in srgb, var(--red) 55%, transparent)", bg: "color-mix(in srgb, var(--red) 10%, var(--card))", color: "var(--red)", fontWeight: 700 }),
	weakList: css({ mt: "0.625rem", borderLeft: "2px solid var(--amber)", pl: "0.5rem", fontSize: "0.625rem", lineHeight: "1rem", color: "var(--ink-soft)" }),
	cardFooter: css({ mt: "0.75rem", display: "flex", flexDir: "column", gap: "0.5rem", borderTop: "1px solid color-mix(in srgb, var(--ink) 20%, transparent)", pt: "0.625rem" }),
	selectLabel: css({ display: "grid", gap: "0.25rem", fontSize: "0.625rem", color: "var(--ink-soft)" }),
	select: css({ minH: "2.75rem", w: "100%", border: "1px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--paper)", px: "0.625rem", color: "var(--ink)", fontSize: "0.6875rem", _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } }),
	cardAction: css({ minH: "2.5rem", width: "100%", border: "1px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--ink)", color: "var(--paper)", fontSize: "0.6875rem", fontWeight: 700, _hover: { bg: "var(--accent-dim)", color: "white" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" } }),
	status: css({ borderTop: "1px solid var(--ink)", bg: "var(--paper)", px: "1rem", py: "0.75rem", fontSize: "0.6875rem", lineHeight: "1.1rem", color: "var(--ink-soft)" }),
	statusError: css({ color: "var(--red)" }),
	reviewer: css({ mt: "1.25rem", border: "2px solid var(--ink)", bg: "var(--card)", p: "1rem", boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 18%, transparent)" }),
	reviewerHead: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", borderBottom: "1px solid var(--ink)", pb: "0.75rem" }),
	reviewerTitle: css({ fontFamily: "var(--mono-display)", fontSize: "1rem", fontWeight: 700 }),
	loading: css({ display: "flex", minH: "20rem", alignItems: "center", justifyContent: "center", gap: "0.5rem", color: "var(--ink-soft)" }),
};

function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(value);
}

function itemDueLabel(item: ComingUpItem, now: number): string {
	if (item.dueCount > 0) return `${formatNumber(item.dueCount)} due · ${item.nextDueAt ? formatDueIn(item.nextDueAt, now) : "now"}`;
	if (item.nextDueAt) return `Next ${formatDueIn(item.nextDueAt, now)}`;
	return "No scheduled cards";
}

function QueueCard({
	item,
	now,
	dragging,
	onDragStart,
	onDragEnd,
	onPriority,
	onReview,
	onCompleteCheck,
	onOpenTopic,
	onEstimate,
	estimate,
	estimateBusy,
	estimateStatus,
	estimateFronts,
}: {
	item: ComingUpItem;
	now: number;
	dragging: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	onPriority: (priority: StudyPriority) => void;
	onReview: () => void;
	onCompleteCheck: () => void;
	onOpenTopic: () => void;
	onEstimate: () => void;
	estimate?: StudyEstimateReceipt;
	estimateBusy: boolean;
	estimateStatus?: string;
	estimateFronts: Record<string, string>;
}) {
	return (
		<article
			draggable
			onDragStart={(event) => {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", item.id);
				onDragStart();
			}}
			onDragEnd={onDragEnd}
			className={cx(styles.card, dragging ? styles.cardDragging : "")}
		>
			<div className={styles.cardHead}>
				<GripVertical size={16} className={styles.dragHandle} aria-hidden="true" />
				<div className={styles.cardText}>
					<h3 className={styles.cardTitle}>{item.title}</h3>
					<p className={styles.cardDescription}>{item.description}</p>
				</div>
			</div>
			<div className={styles.badges}>
				{item.targetType === "deck" ? <span className={cx(styles.badge, item.dueCount > 0 ? styles.dueBadge : "")}><Layers3 size={11} />{itemDueLabel(item, now)}</span> : null}
				{item.overdueCount > 0 ? <span className={cx(styles.badge, styles.overdueBadge)}><AlertTriangle size={11} />{formatNumber(item.overdueCount)} overdue</span> : null}
				<span className={styles.badge}><Clock3 size={11} />~{item.estimatedMinutes} min</span>
				{item.prioritySource === "recommended" ? <span className={styles.badge}>Keating suggested</span> : null}
			</div>
			{item.weakConcepts.length > 0 ? (
				<div className={styles.weakList}>Needs attention: {item.weakConcepts.slice(0, 2).join(" · ")}</div>
			) : null}
			{item.decisionEstimates && Object.keys(item.decisionEstimates).length > 0 ? <div className={styles.stripCopy} aria-label="Fitted learning estimates">
				{Object.entries(item.decisionEstimates).map(([target, estimate]) => <p key={target} title={`${estimate.evidenceLabel}. ${estimate.domain}. File ${estimate.fileSha256}. Fit ${estimate.fitSha256}.`}>
					{target === "mastery" ? "Independent-answer prediction" : target === "retention" ? "Mean card recall prediction" : "Due-deck lapse prediction"}: {Math.round(estimate.value * 100)}% · {estimate.evidenceLabel}
				</p>)}
				{item.decisionExploration ? <p>Usual queue position retained for comparison.</p> : null}
			</div> : null}
			<div className={styles.cardFooter}>
				<label className={styles.selectLabel}>
					<span>Learning priority</span>
					<Select className={styles.select} value={item.priority} onValueChange={(value) => onPriority(value as StudyPriority)}>
						{PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
					</Select>
				</label>
				{item.targetType === "deck" && item.dueCount > 0 ? <button type="button" className={styles.cardAction} onClick={onReview}>Review this deck</button> : null}
				{item.targetType === "deck" && item.dueCount > 0 ? <>
					<button type="button" className={cx(styles.button, styles.quietButton)} disabled={estimateBusy} onClick={onEstimate} aria-label={`Estimate study effort for ${item.title}`}>{estimateBusy ? "Estimating…" : "Estimate study effort"}</button>
					<p className={styles.stripCopy}>Uses your <a href="/chat?settings=judgement" style={{ textDecoration: "underline" }}>judgement settings</a>. Hosted review sends this deck and recent assessed work.</p>
					{estimateStatus ? <p className={styles.stripCopy} role="status">{estimateStatus}</p> : null}
					{estimate ? <StudyEstimateDetails receipt={estimate} fronts={estimateFronts} /> : null}
				</> : null}
				{item.targetType === "verification" ? <button type="button" className={styles.cardAction} onClick={onCompleteCheck}>Mark checklist complete</button> : null}
				{item.targetType === "topic" ? <button type="button" className={styles.cardAction} onClick={onOpenTopic}>Practice in chat</button> : null}
			</div>
		</article>
	);
}

export function StudyEstimateDetails({ receipt, fronts = {} }: { receipt: StudyEstimateReceipt; fronts?: Record<string, string> }) {
	return <div className={styles.stripCopy} aria-label="Study estimates" aria-live="polite">
		<strong style={{ color: "var(--ink)" }}>Uncalibrated study estimates</strong>
		<p>Expected unaided recall: {receipt.expectedCorrect === null ? "unknown" : `${receipt.expectedCorrect.toFixed(1)} of ${receipt.cards.length} cards`}.</p>
		<p>Readiness: {receipt.readinessProbability === null ? "unknown" : `${Math.round(receipt.readinessProbability * 100)}% model probability`}.</p>
		<p>Planning time: {receipt.estimatedSeconds === null ? "unknown" : `about ${Math.max(1, Math.ceil(receipt.estimatedSeconds / 60))} min`}.</p>
		<p>Reviewed by {receipt.backend.model}. Planning time uses generic effort bands. These estimates have not been validated for your learning.</p>
		<details><summary style={{ cursor: "pointer", padding: "0.4rem 0" }}>Per-card estimates ({receipt.cards.length})</summary>
			<ol style={{ paddingLeft: "1rem", overflowWrap: "anywhere" }}>{receipt.cards.map((card, index) => <li key={card.id}>
				<strong>{fronts[card.id] ?? `Card ${index + 1}`}</strong>: {card.successProbability === null ? "recall unknown" : `${Math.round(card.successProbability * 100)}% predicted unaided recall`}. {card.difficulty ?? "Difficulty unknown."} Effort: {card.effort?.replaceAll("-", " ") ?? "unknown"}.
			</li>)}</ol>
		</details>
	</div>;
}

function studyEstimateStatus(result: Extract<StudyEstimateResult, { ok: false }>): string {
	return ({ "no-due-cards": "No due cards to estimate.", "too-many-cards": "This deck has more than 20 due cards. A whole-deck estimate is unavailable; you can still start reviewing.",
		"no-history": "Estimate unknown. Review cards or complete assessed topic work first.", "too-much-evidence": "This deck has too much text for a complete estimate. You can still start reviewing.",
		unavailable: "Estimate unavailable. Check judgement settings or account access; review is still available.", stale: "Your study evidence changed. Request a fresh estimate when ready.", cancelled: "Estimate cancelled. Review is still available." })[result.reason];
}

function emptyQueue(): ComingUpQueue {
	return { items: [], lanes: { focus: [], maintain: [], low: [] }, dueCardCount: 0, overdueCardCount: 0, estimatedMinutes: 0, dueDeckIds: [] };
}

interface ComingUpPageState {
	data: {
		decks: FlashcardDeck[];
		verifications: Verification[];
		learnerState: LearnerState | null;
	};
	loadState: "loading" | "ready";
	transferBusy: boolean;
	feedback: { status: string; error: string };
	drag: { itemId: string | null; lane: StudyPriority | null };
	review: { deckIds: string[]; index: number };
}

export type ComingUpPageAction =
	| { type: "data.loaded"; decks: FlashcardDeck[]; verifications: Verification[]; learnerState: LearnerState }
	| { type: "data.failed"; error: string }
	| { type: "transfer.started" }
	| { type: "transfer.finished" }
	| { type: "feedback.clear" }
	| { type: "feedback.status"; status: string }
	| { type: "feedback.error"; error: string }
	| { type: "drag.started"; itemId: string }
	| { type: "drag.entered"; lane: StudyPriority }
	| { type: "drag.ended" }
	| { type: "review.started"; deckIds: string[] }
	| { type: "review.advanced" }
	| { type: "review.ended" };

export const initialComingUpPageState: ComingUpPageState = {
	data: { decks: [], verifications: [], learnerState: null },
	loadState: "loading",
	transferBusy: false,
	feedback: { status: "", error: "" },
	drag: { itemId: null, lane: null },
	review: { deckIds: [], index: 0 },
};

export function comingUpPageReducer(state: ComingUpPageState, action: ComingUpPageAction): ComingUpPageState {
	switch (action.type) {
		case "data.loaded":
			return {
				...state,
				data: { decks: action.decks, verifications: action.verifications, learnerState: action.learnerState },
				loadState: "ready",
			};
		case "data.failed":
			return { ...state, loadState: "ready", feedback: { status: "", error: action.error } };
		case "transfer.started":
			return { ...state, transferBusy: true, feedback: { status: "", error: "" } };
		case "transfer.finished":
			return { ...state, transferBusy: false };
		case "feedback.clear":
			return { ...state, feedback: { status: "", error: "" } };
		case "feedback.status":
			return { ...state, feedback: { status: action.status, error: "" } };
		case "feedback.error":
			return { ...state, feedback: { status: "", error: action.error } };
		case "drag.started":
			return { ...state, drag: { itemId: action.itemId, lane: null } };
		case "drag.entered":
			return { ...state, drag: { ...state.drag, lane: action.lane } };
		case "drag.ended":
			return { ...state, drag: { itemId: null, lane: null } };
		case "review.started":
			return action.deckIds.length > 0 ? { ...state, review: { deckIds: [...action.deckIds], index: 0 } } : state;
		case "review.advanced": {
			const index = state.review.index + 1;
			return index < state.review.deckIds.length
				? { ...state, review: { ...state.review, index } }
				: { ...state, review: { deckIds: [], index: 0 } };
		}
		case "review.ended":
			return { ...state, review: { deckIds: [], index: 0 } };
	}
}

export function ComingUp() {
	useSeo({ title: "Coming Up — Keating", description: "Plan spaced-repetition reviews and set your learning priorities.", canonical: "https://keating.help/coming-up" });
	const navigate = useNavigate();
	const [pageState, dispatch] = useReducer(comingUpPageReducer, initialComingUpPageState);
	const { decks, verifications, learnerState } = pageState.data;
	const { status, error } = pageState.feedback;
	const { itemId: draggedId, lane: dropLane } = pageState.drag;
	const { deckIds: reviewDeckIds, index: reviewIndex } = pageState.review;
	const loading = pageState.loadState === "loading";
	const busy = pageState.transferBusy;
	const [mobileLane, setMobileLane] = useState<StudyPriority>("focus");
	const [now, setNow] = useState(() => Date.now());
	const policyStore = useMemo(() => new WebDecisionPolicyStore(), []);
	const [decisionPolicies, setDecisionPolicies] = useState<WebDecisionPolicies>({});
	const [decisionEvidence, setDecisionEvidence] = useState<Omit<WebDecisionEvidence, "decks">>({ checks: [], reviews: [] });
	useEffect(() => {
		let active = true, generation = 0;
		const load = async () => {
			const revision = ++generation;
			const targets = ["mastery", "retention", "urgency"] as const;
			const policies = await Promise.all(targets.map(async target => [target, await policyStore.load(target)] as const));
			if (active && generation === revision) setDecisionPolicies(Object.fromEntries(policies.filter(([, policy]) => policy)));
		};
		void load(); const unsubscribe = subscribeWebDecisionPolicies(() => { void load(); });
		return () => { active = false; unsubscribe(); };
	}, [policyStore]);
	const importRef = useRef<HTMLInputElement>(null);
	const estimateStore = useMemo(() => new StudyEstimateStore(), []);
	const [estimates, setEstimates] = useState<Record<string, StudyEstimateReceipt>>({});
	const [estimateStatuses, setEstimateStatuses] = useState<Record<string, string>>({});
	const [estimating, setEstimating] = useState<Set<string>>(new Set());
	const estimateRuns = useRef(new Map<string, AbortController>());
	const estimatesRef = useRef(estimates);
	estimatesRef.current = estimates;

	useEffect(() => {
		let active = true;
		let checking = false;
		let generation = 0;
		const clear = () => {
			generation++;
			for (const controller of estimateRuns.current.values()) controller.abort();
			estimateStore.clear(); setEstimates({});
		};
		const unsubscribe = subscribeJudgementModelSettings(() => clear());
		const refresh = async () => {
			if (checking) return;
			const settings = loadJudgementModelSettings();
			if (settings.backend === "off") { clear(); return; }
			if (!judgementAccountStatus().judgementAuthorized) {
				for (const id of estimateStore.deckIds()) {
					if (estimatesRef.current[id]?.backend.backend === "system-one") { clear(); return; }
				}
			}
			checking = true;
			const startedGeneration = generation;
			try {
				const restored: Record<string, StudyEstimateReceipt> = {};
				for (const id of estimateStore.deckIds()) {
					const snapshot = await loadStudySnapshot(keatingStorage, id);
					const receipt = estimateStore.current(snapshot);
					if (receipt && (receipt.backend.backend !== "system-one" || judgementAccountStatus().judgementAuthorized)) restored[id] = receipt;
					else estimateStore.remove(id);
				}
				if (active && generation === startedGeneration) setEstimates(restored);
			} catch { if (active) clear(); } finally { checking = false; }
		};
		void getInitPromise().then(refresh);
		const timer = window.setInterval(() => { void refresh(); }, 2_000);
		window.addEventListener("focus", refresh);
		return () => { active = false; unsubscribe(); window.clearInterval(timer); window.removeEventListener("focus", refresh);
			for (const controller of estimateRuns.current.values()) controller.abort(); };
	}, [estimateStore]);

	const estimateDeck = useCallback(async (deckId: string) => {
		if (estimateRuns.current.has(deckId)) return;
		const controller = new AbortController(); estimateRuns.current.set(deckId, controller);
		setEstimating(current => new Set([...current, deckId]));
		setEstimateStatuses(current => ({ ...current, [deckId]: "" }));
		try {
			const result = await estimateStudyDeck({ source: keatingStorage, deckId, signal: controller.signal });
			if (controller.signal.aborted) return;
			if (result.ok) {
				estimateStore.save(result.receipt);
				setEstimates(current => ({ ...current, [deckId]: result.receipt }));
			} else {
				estimateStore.remove(deckId);
				setEstimates(current => { const next = { ...current }; delete next[deckId]; return next; });
				setEstimateStatuses(current => ({ ...current, [deckId]: studyEstimateStatus(result) }));
			}
		} catch { setEstimateStatuses(current => ({ ...current, [deckId]: "Estimate unavailable. Your review is ready to start." })); }
		finally { estimateRuns.current.delete(deckId); setEstimating(current => { const next = new Set(current); next.delete(deckId); return next; }); }
	}, [estimateStore]);

	const loadData = useCallback(async () => {
		await getInitPromise();
		const [nextDecks, nextVerifications, nextLearnerState, checks, reviews] = await Promise.all([
			keatingStorage.getDecks(),
			keatingStorage.getVerifications(),
			keatingStorage.getLearnerState(),
			keatingStorage.getQuestionChecks(),
			keatingStorage.getCardReviews(),
		]);
		setDecisionEvidence({ checks, reviews });
		dispatch({ type: "data.loaded", decks: nextDecks, verifications: nextVerifications, learnerState: nextLearnerState });
	}, []);

	useEffect(() => {
		void loadData().catch((cause) => {
			dispatch({ type: "data.failed", error: cause instanceof Error ? cause.message : String(cause) });
		});
	}, [loadData]);

	useEffect(() => {
		const refreshClock = () => setNow(Date.now());
		const timer = window.setInterval(refreshClock, 60_000);
		window.addEventListener("focus", refreshClock);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", refreshClock);
		};
	}, []);

	const queue = useMemo(() => learnerState ? projectWebDecisionPolicies(buildComingUpQueue({ decks, verifications, learnerState, now }),
		{ ...decisionEvidence, decks }, decisionPolicies, now) : emptyQueue(), [decks, learnerState, now, verifications, decisionEvidence, decisionPolicies]);
	const currentReviewDeck = reviewDeckIds.length > 0 ? decks.find((deck) => deck.id === reviewDeckIds[reviewIndex]) ?? null : null;
	const dueCardIds = currentReviewDeck?.cards.filter((card) => card.srs.dueAt <= now).map((card) => card.id) ?? [];

	const moveItem = useCallback(async (item: ComingUpItem, priority: StudyPriority) => {
		if (item.priority === priority && item.prioritySource === "learner") return;
		dispatch({ type: "feedback.status", status: `Moving ${item.title} to ${PRIORITIES.find((entry) => entry.id === priority)?.label}.` });
		try {
			const updated = await keatingStorage.setStudyPriority({ targetId: item.targetId, targetType: item.targetType, priority });
			dispatch({ type: "data.loaded", decks, verifications, learnerState: updated });
			setMobileLane(priority);
			dispatch({ type: "feedback.status", status: `${item.title} is now ${PRIORITIES.find((entry) => entry.id === priority)?.label.toLowerCase()}. Review dates were not changed.` });
		} catch (cause) {
			dispatch({ type: "feedback.error", error: cause instanceof Error ? cause.message : String(cause) });
		}
	}, [decks, verifications]);

	const startReview = useCallback((deckIds: string[] = queue.dueDeckIds) => {
		if (deckIds.length === 0) return;
		for (const id of deckIds) { estimateRuns.current.get(id)?.abort(); estimateStore.remove(id); }
		setEstimates(current => Object.fromEntries(Object.entries(current).filter(([id]) => !deckIds.includes(id))));
		dispatch({ type: "review.started", deckIds });
		requestAnimationFrame(() => document.getElementById("coming-up-review")?.scrollIntoView({ behavior: "smooth", block: "start" }));
	}, [queue.dueDeckIds, estimateStore]);

	const handleReviewComplete = useCallback(() => {
		if (reviewIndex + 1 < reviewDeckIds.length) {
			dispatch({ type: "review.advanced" });
			return;
		}
		dispatch({ type: "review.ended" });
		dispatch({ type: "feedback.status", status: "Review session complete. Keating scheduled the next appearances from your ratings." });
		void loadData().catch((cause) => {
			dispatch({ type: "data.failed", error: cause instanceof Error ? cause.message : String(cause) });
		});
	}, [loadData, reviewDeckIds.length, reviewIndex]);

	const handleImport = useCallback(async (file: File) => {
		dispatch({ type: "transfer.started" });
		try {
			const lower = file.name.toLowerCase();
			const imported = lower.endsWith(".apkg")
				? await parseAnkiPackage(new Uint8Array(await file.arrayBuffer()))
				: parseAnkiText(await file.text(), file.name);
			let added = 0;
			let updated = 0;
			let unchanged = 0;
			for (const incoming of imported.decks) {
				const existing = await keatingStorage.getDeck(incoming.id);
				const merged = mergeAnkiDeck(existing, incoming);
				await keatingStorage.saveDeck(merged.deck);
				added += merged.added;
				updated += merged.updated;
				unchanged += merged.unchanged;
			}
			await loadData();
			dispatch({ type: "feedback.status", status: `Imported ${formatNumber(imported.cardCount)} cards across ${formatNumber(imported.decks.length)} decks · ${formatNumber(added)} added · ${formatNumber(updated)} updated · ${formatNumber(unchanged)} kept${imported.warnings.length ? ` · ${imported.warnings.join(" ")}` : ""}` });
		} catch (cause) {
			dispatch({ type: "feedback.error", error: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			dispatch({ type: "transfer.finished" });
		}
	}, [loadData]);

	const exportApkg = useCallback(async () => {
		dispatch({ type: "transfer.started" });
		try {
			const bytes = await buildAnkiPackage(decks);
			downloadFile("keating-review-decks.apkg", bytes, "application/octet-stream");
			dispatch({ type: "feedback.status", status: `Exported ${formatNumber(decks.reduce((sum, deck) => sum + deck.cards.length, 0))} cards as a native Anki package.` });
		} catch (cause) {
			dispatch({ type: "feedback.error", error: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			dispatch({ type: "transfer.finished" });
		}
	}, [decks]);

	const exportTsv = useCallback(() => {
		try {
			downloadTextFile("keating-review-decks.tsv", buildAnkiTsv(decks), "text/tab-separated-values;charset=utf-8");
			dispatch({ type: "feedback.status", status: "Exported a tab-separated text fallback for Anki or spreadsheets." });
		} catch (cause) {
			dispatch({ type: "feedback.error", error: cause instanceof Error ? cause.message : String(cause) });
		}
	}, [decks]);

	const completeVerification = useCallback(async (item: ComingUpItem) => {
		dispatch({ type: "feedback.clear" });
		try {
			await keatingStorage.setVerificationCompleted(item.targetId, true);
			dispatch({ type: "feedback.status", status: `${item.title} marked complete.` });
			await loadData();
		} catch (cause) {
			dispatch({ type: "feedback.error", error: cause instanceof Error ? cause.message : String(cause) });
		}
	}, [loadData]);

	if (loading) {
		return <div className={cx("retro-layout", "retro-page", styles.page)}><Nav /><div className={styles.loading}><RefreshCw size={16} />Loading your review queue…</div></div>;
	}

	return (
		<div className={cx("retro-layout", "retro-page", styles.page)}>
			<Nav />
			<LearningInsightsHeader
				current="coming-up"
				context="Learning intelligence // Review runway"
				title="Coming up"
				description="Set what deserves attention, work the reviews that are actually due, and carry decks between Keating and Anki."
			/>
			<main className={styles.main}>
				<div className={styles.metrics}>
					<LearningMetric icon={<Brain size={18} />} label="Cards due now" value={formatNumber(queue.dueCardCount)} detail={queue.overdueCardCount > 0 ? `${formatNumber(queue.overdueCardCount)} overdue by more than a day` : "Nothing overdue by more than a day"} />
					<LearningMetric icon={<Clock3 size={18} />} label="Review time" value={`~${formatNumber(queue.estimatedMinutes)} min`} detail="Estimated from the due cards, not the whole board" />
					<LearningMetric icon={<Layers3 size={18} />} label="Learning items" value={formatNumber(queue.items.length)} detail={`${formatNumber(decks.length)} decks · ${formatNumber(verifications.filter((item) => !item.completed).length)} open checks`} />
				</div>

				<section className={styles.reviewStrip} aria-labelledby="due-review-title">
					<div>
						<h2 id="due-review-title" className={styles.stripTitle}><CheckCircle2 size={18} />{queue.dueCardCount > 0 ? `${formatNumber(queue.dueCardCount)} cards are ready` : "Review runway is clear"}</h2>
						<p className={styles.stripCopy}>{queue.dueCardCount > 0 ? "Priority chooses the order; recall evidence chooses what is due." : "You can still reorganize priorities or import another deck below."}</p>
					</div>
					<button type="button" className={cx(styles.button, styles.accentButton)} disabled={queue.dueCardCount === 0} onClick={() => startReview()}><Play size={15} />Start due review</button>
				</section>

				<ComingUpReadiness source={keatingStorage} contextVersion={JSON.stringify({ queue, decks, verifications, learnerState, reviewDeckIds })}
					hasDueDecks={queue.dueDeckIds.length > 0} onStart={(deckId) => startReview([deckId])} />

				{currentReviewDeck ? (
					<section id="coming-up-review" className={styles.reviewer} aria-labelledby="review-title">
						<div className={styles.reviewerHead}>
							<div><h2 id="review-title" className={styles.reviewerTitle}>Reviewing {currentReviewDeck.title}</h2><p className={styles.stripCopy}>Deck {reviewIndex + 1} of {reviewDeckIds.length} · {dueCardIds.length} due</p></div>
							<button type="button" className={cx(styles.button, styles.quietButton)} onClick={() => dispatch({ type: "review.ended" })}>End review</button>
						</div>
						<FlashcardRenderer key={currentReviewDeck.id} deck={currentReviewDeck} restrictToCardIds={dueCardIds} autoFocusKeyboard onComplete={handleReviewComplete} />
					</section>
				) : null}

				<section className={styles.workspace} aria-labelledby="priority-board-title">
					<div className={styles.workspaceHead}>
						<div><h2 id="priority-board-title" className={styles.workspaceTitle}>Priority board</h2><p className={styles.workspaceCopy}>Drag cards between lanes or use each card’s priority menu. Moving a card changes your intent—not its spaced-repetition date.</p></div>
						<div className={styles.toolbar}>
							<label className={cx(styles.button, styles.primaryButton)}>
								<Upload size={15} />{busy ? "Working…" : "Import Anki"}
								<input ref={importRef} className={styles.fileInput} type="file" accept=".apkg,.csv,.tsv,.txt,application/octet-stream,text/csv,text/tab-separated-values" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.currentTarget.value = ""; }} />
							</label>
							<button type="button" className={cx(styles.button, styles.quietButton)} disabled={busy || decks.length === 0} onClick={() => void exportApkg()}><Download size={15} />Export .apkg</button>
							<button type="button" className={cx(styles.button, styles.quietButton)} disabled={busy || decks.length === 0} onClick={exportTsv}>TSV fallback</button>
						</div>
					</div>
					<div className={styles.mobileTabs} aria-label="Priority lane">
						{PRIORITIES.map((priority) => {
							const active = mobileLane === priority.id;
							return (
								<button
									key={priority.id}
									type="button"
									data-active={active}
									className={styles.mobileTab}
									style={{ padding: "0.25rem", fontSize: "0.6875rem", lineHeight: "1rem", background: active ? "var(--ink)" : "var(--paper)", color: active ? "var(--paper)" : "var(--ink)" }}
									onClick={() => setMobileLane(priority.id)}
								>
									{priority.id === "low" ? "Low" : priority.label} ({queue.lanes[priority.id].length})
								</button>
							);
						})}
					</div>
					<div className={styles.board}>
						{PRIORITIES.map((priority) => (
							<section
								key={priority.id}
								aria-labelledby={`lane-${priority.id}`}
								className={cx(styles.lane, dropLane === priority.id ? styles.laneDragging : "", css({ display: { base: mobileLane === priority.id ? "block" : "none", md: "block" } }))}
								onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; dispatch({ type: "drag.entered", lane: priority.id }); }}
								onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dispatch({ type: "drag.ended" }); }}
								onDrop={(event) => { event.preventDefault(); const item = queue.items.find((candidate) => candidate.id === (draggedId ?? event.dataTransfer.getData("text/plain"))); dispatch({ type: "drag.ended" }); if (item) void moveItem(item, priority.id); }}
							>
								<div className={styles.laneHead}><div><h3 id={`lane-${priority.id}`} className={styles.laneTitle}>{priority.label}</h3><p className={styles.laneNote}>{priority.note}</p></div><span className={styles.count}>{queue.lanes[priority.id].length}</span></div>
								<div className={styles.laneBody}>
									{queue.lanes[priority.id].length === 0 ? <div className={styles.emptyLane}>{priority.id === "focus" ? "Drop the work that deserves your attention here." : "Nothing here yet."}</div> : queue.lanes[priority.id].map((item) => (
										<QueueCard
											key={item.id}
											item={item}
											now={now}
											dragging={draggedId === item.id}
											onDragStart={() => dispatch({ type: "drag.started", itemId: item.id })}
											onDragEnd={() => dispatch({ type: "drag.ended" })}
											onPriority={(nextPriority) => void moveItem(item, nextPriority)}
											onReview={() => startReview([item.targetId])}
											onCompleteCheck={() => void completeVerification(item)}
											onOpenTopic={() => navigate({ to: "/chat" })}
											onEstimate={() => void estimateDeck(item.targetId)}
											estimate={estimates[item.targetId]}
											estimateBusy={estimating.has(item.targetId)}
											estimateStatus={estimateStatuses[item.targetId]}
											estimateFronts={Object.fromEntries((decks.find(deck => deck.id === item.targetId)?.cards ?? []).map(card => [card.id, card.front]))}
										/>
									))}
								</div>
							</section>
						))}
					</div>
					{status || error ? <div className={cx(styles.status, error ? styles.statusError : "")} role="status" aria-live="polite">{error || status}</div> : null}
				</section>
				<p className={css({ mt: "1rem", display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.6875rem", color: "var(--ink-soft)" })}><ArrowRight size={13} />Anki imports run locally in this browser. Templates never execute, and media is left out of Keating’s text-first reviews.</p>
			</main>
		</div>
	);
}
