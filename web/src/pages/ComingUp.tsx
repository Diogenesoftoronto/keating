import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { KeatingGlyph } from "../design-system/glyphs";

import { Stat } from "../design-system/charts";
import { Button, Card, EmptyState, Loading, Segmented } from "../design-system/kit";
import { ExportSheet } from "../components/export/ExportSheet";
import { KeatingBot } from "../components/KeatingBot";
import "./coming-up.css";
import { cx } from "../../styled-system/css";
import { FlashcardRenderer } from "../components/FlashcardRenderer";
import { ComingUpReadiness } from "../components/ComingUpReadiness";
import { LearningOutlook } from "../components/LearningOutlook";
import { LearningShell } from "../components/LearningInsightsHeader";
import { Select } from "../components/Select";
import { getInitPromise, keatingStorage } from "../hooks/keating-storage";
import { useSeo } from "../hooks/useSeo";
import { buildAnkiPackage, buildAnkiTsv, mergeAnkiDeck, parseAnkiPackage, parseAnkiText } from "../keating/anki-package";
import { buildComingUpQueue, type ComingUpItem, type ComingUpQueue } from "../keating/coming-up";
import { formatDueIn } from "../keating/srs";
import { LEARNING_EVIDENCE_CHANGED_EVENT, QUESTION_JUDGEMENT_CHANGED_EVENT, type FlashcardDeck, type LearnerState, type StudyPriority, type Verification } from "../keating/storage";
import { downloadFile, downloadTextFile } from "../lib/browser-download";
import { estimateStudyDeck, loadStudySnapshot, type StudyEstimateReceipt, type StudyEstimateResult } from "../keating/judgement/study-estimates";
import { StudyEstimateStore } from "../keating/judgement/study-estimate-store";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../keating/judgement-model";
import { judgementAccountStatus } from "../keating/judgement/public-account";
import type { WebOnlineEvidence } from "../keating/judgement/online-evidence";
import { webOnlineEvidence } from "../keating/judgement/online-evidence";
import { projectOnlineLearningQueue } from "../keating/judgement/online-projection";
import { useOnlineLearning } from "../hooks/useOnlineLearning";
import { OnlineLearningStatus } from "../components/OnlineLearningStatus";
import { OpenAssignmentsSection } from "../components/homework/OpenAssignmentsSection";
import { useOpenAssignments } from "../components/homework/useOpenAssignments";
import { assignmentChatTarget, type AssignmentEntry } from "../keating/homework/open-assignments";

const PRIORITIES: Array<{ id: StudyPriority; label: string; note: string }> = [
	{ id: "focus", label: "Focus", note: "What matters most now" },
	{ id: "maintain", label: "Maintain", note: "Keep knowledge available" },
	{ id: "low", label: "Low priority", note: "Keep visible, spend less time" },
];

function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(value);
}

export function DueReviewSummary({queue,deckCount,openChecks,onStart}: {
    queue:ComingUpQueue; deckCount:number; openChecks:number; onStart:()=>void;
}) {
    return <><div className="cu-metrics">
					<Stat label="Cards due now" value={formatNumber(queue.dueCardCount)} support={queue.overdueCardCount > 0 ? `${formatNumber(queue.overdueCardCount)} overdue by more than a day` : "Nothing overdue by more than a day"} />
					<Stat label="Review time" value={`~${formatNumber(queue.estimatedMinutes)} min`} support="Estimated from the due cards, not the whole board" />
					<Stat label="Learning items" value={formatNumber(queue.items.length)} support={`${formatNumber(deckCount)} decks · ${formatNumber(openChecks)} open checks`} />
				</div>

				<Card as="section" className="cu-reviewStrip k-halftone" aria-labelledby="due-review-title">
					<div>
						<h2 id="due-review-title" className="cu-stripTitle">{queue.dueCardCount ? <KeatingGlyph name="check" size={18}/> : <KeatingBot size={36} state={queue.items.length ? "success" : "waving"} label=""/>}{queue.dueCardCount > 0 ? `${formatNumber(queue.dueCardCount)} ${queue.dueCardCount === 1 ? "card is" : "cards are"} ready` : "Review runway is clear"}</h2>
						<p className="cu-stripCopy">{queue.dueCardCount > 0 ? "Priority chooses the order; recall evidence chooses what is due." : "You can still reorganize priorities or import another deck below."}</p>
					</div>
					<Button variant="primary" disabled={queue.dueCardCount === 0} onClick={onStart}><KeatingGlyph name="play" size={15} />Start due review</Button>
				</Card></>;
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
			className={cx("cu-card", dragging ? "cu-cardDragging" : "")}
		>
			<div className="cu-cardHead" data-glyph-host>
				<KeatingGlyph name="grip" size={16} className="cu-dragHandle" />
				<div className="cu-cardText">
					<h3 className="cu-cardTitle">{item.title}</h3>
					<p className="cu-cardDescription">{item.description}</p>
				</div>
			</div>
			<div className="cu-badges" data-glyph-host>
				{item.targetType === "deck" ? <span className={cx("cu-badge", item.dueCount > 0 ? "cu-dueBadge" : "")}><KeatingGlyph name="layers" size={11} />{itemDueLabel(item, now)}</span> : null}
				{item.overdueCount > 0 ? <span className={cx("cu-badge", "cu-overdueBadge")}><KeatingGlyph name="alert" size={11} />{formatNumber(item.overdueCount)} overdue</span> : null}
				<span className="cu-badge"><KeatingGlyph name="clock" size={11} />~{item.estimatedMinutes} min</span>
				{item.prioritySource === "recommended" ? <span className="cu-badge">Keating suggested</span> : null}
			</div>
			{item.weakConcepts.length > 0 ? (
				<div className="cu-weakList">Needs attention: {item.weakConcepts.slice(0, 2).join(" · ")}</div>
			) : null}
			<div className="cu-cardFooter">
				<label className="cu-selectLabel">
					<span>Learning priority</span>
					<Select className="cu-select" value={item.priority} onValueChange={(value) => onPriority(value as StudyPriority)}>
						{PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
					</Select>
				</label>
				{item.targetType === "deck" && item.dueCount > 0 ? <button type="button" className="cu-cardAction" onClick={onReview}>Review this deck</button> : null}
				{item.targetType === "deck" && item.dueCount > 0 ? <>
					<Button variant="ghost" disabled={estimateBusy} onClick={onEstimate} aria-label={`Estimate study effort for ${item.title}`}>{estimateBusy ? "Estimating…" : "Estimate study effort"}</Button>
					<p className="cu-stripCopy">Uses your <a href="/chat?settings=judgement" style={{ textDecoration: "underline" }}>judgement settings</a>. Hosted review sends this deck and recent assessed work.</p>
					{estimateStatus ? <p className="cu-stripCopy" role="status">{estimateStatus}</p> : null}
					{estimate ? <StudyEstimateDetails receipt={estimate} fronts={estimateFronts} /> : null}
				</> : null}
				{item.targetType === "verification" ? <button type="button" className="cu-cardAction" onClick={onCompleteCheck}>Mark checklist complete</button> : null}
				{item.targetType === "topic" ? <button type="button" className="cu-cardAction" onClick={onOpenTopic}>Practice in chat</button> : null}
			</div>
		</article>
	);
}

export function StudyEstimateDetails({ receipt, fronts = {} }: { receipt: StudyEstimateReceipt; fronts?: Record<string, string> }) {
	return <div className="cu-stripCopy" aria-label="Study estimates" aria-live="polite">
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
	const [exportFormat, setExportFormat] = useState<"apkg" | "tsv" | null>(null);
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
	const [decisionEvidence, setDecisionEvidence] = useState<Omit<WebOnlineEvidence, "decks">>({ checks: [], reviews: [] });
	const importRef = useRef<HTMLInputElement>(null);
	const estimateStore = useMemo(() => new StudyEstimateStore(), []);
	const [estimates, setEstimates] = useState<Record<string, StudyEstimateReceipt>>({});
	const [estimateStatuses, setEstimateStatuses] = useState<Record<string, string>>({});
	const [estimating, setEstimating] = useState<Set<string>>(new Set());
	const estimateRuns = useRef(new Map<string, AbortController>());
	const estimatesRef = useRef(estimates);
	estimatesRef.current = estimates;
	const assignments = useOpenAssignments();
	// Chat has no message anchor yet, so this opens the session that holds the task.
	const openAssignment = useCallback((entry: AssignmentEntry) => {
		void navigate(assignmentChatTarget(entry));
	}, [navigate]);

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

	const loadRevision = useRef(0);
	const loadData = useCallback(async () => {
		const revision = ++loadRevision.current;
		await getInitPromise();
		const [nextDecks, nextVerifications, nextLearnerState, checks, reviews] = await Promise.all([
			keatingStorage.getDecks(),
			keatingStorage.getVerifications(),
			keatingStorage.getLearnerState(),
			keatingStorage.getQuestionChecks(),
			keatingStorage.getCardReviews(),
		]);
		if (revision !== loadRevision.current) return;
		setNow(Date.now());
		setDecisionEvidence({ checks, reviews });
		dispatch({ type: "data.loaded", decks: nextDecks, verifications: nextVerifications, learnerState: nextLearnerState });
	}, []);

	useEffect(() => {
		void loadData().catch((cause) => {
			dispatch({ type: "data.failed", error: cause instanceof Error ? cause.message : String(cause) });
		});
	}, [loadData]);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const refresh = () => {
			clearTimeout(timer);
			timer = setTimeout(() => { void loadData().catch(() => {
				dispatch({ type: "feedback.error", error: "Saved learning history could not be refreshed." });
			}); }, 50);
		};
		// Storage notifications fire after commits. Focus/minute refresh also observes changes from other tabs.
		const events = [LEARNING_EVIDENCE_CHANGED_EVENT, QUESTION_JUDGEMENT_CHANGED_EVENT, "keating:artifacts-changed", "focus"];
		events.forEach(event => window.addEventListener(event, refresh));
		const interval = window.setInterval(refresh, 60_000);
		return () => {
			loadRevision.current++; clearTimeout(timer); window.clearInterval(interval);
			events.forEach(event => window.removeEventListener(event, refresh));
		};
	}, [loadData]);

	const onlineEvidence = useMemo(() => {
		try { return learnerState ? webOnlineEvidence({ ...decisionEvidence, decks }, now) : null; }
		catch { return null; }
	}, [decks, decisionEvidence, learnerState, now]);
	const outlookHistory = useMemo(() => ({ ...decisionEvidence, decks }), [decisionEvidence, decks]);
	const onlineLearning = useOnlineLearning(onlineEvidence, now);
	const queue = useMemo(() => learnerState ? projectOnlineLearningQueue(buildComingUpQueue({ decks, verifications, learnerState, now }), onlineLearning.state.results) : emptyQueue(), [decks, learnerState, now, verifications, onlineLearning.state.results]);
	// A running review owns its starting cards. Background prediction/storage refreshes must not restart it.
	const activeReviewId = reviewDeckIds[reviewIndex] ?? null;
	const reviewSnapshot = useRef<{ id: string; deck: FlashcardDeck; dueCardIds: string[] } | null>(null);
	if (reviewSnapshot.current?.id !== activeReviewId) {
		const deck = decks.find(row => row.id === activeReviewId);
		reviewSnapshot.current = deck ? { id: deck.id, deck, dueCardIds: deck.cards.filter(card => card.srs.dueAt <= now).map(card => card.id) } : null;
	}
	const currentReviewDeck = reviewSnapshot.current?.deck ?? null;
	const dueCardIds = reviewSnapshot.current?.dueCardIds ?? [];

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

	const cardCount = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
	const retryLoad = () => {
		dispatch({type:"feedback.clear"});
		void loadData().catch(cause => dispatch({type:"data.failed",error:cause instanceof Error ? cause.message : String(cause)}));
	};
	const exportApkg = useCallback(async () => {
		dispatch({ type: "transfer.started" });
		try {
			const bytes = await buildAnkiPackage(decks);
			downloadFile("keating-review-decks.apkg", bytes, "application/octet-stream");
			setExportFormat(null);
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
			setExportFormat(null);
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
		return <div className="cu-page"><LearningShell current="coming-up"><Loading size="page" label="Loading your review queue…"/></LearningShell></div>;
	}

	return (
		<div className="cu-page">
			<LearningShell current="coming-up">
			<main className="cu-main">
				{onlineLearning.enabled && <OnlineLearningStatus state={onlineLearning.state} evidenceAvailable={onlineEvidence !== null} />}
				<DueReviewSummary queue={queue} deckCount={decks.length} openChecks={verifications.filter(check => !check.completed).length} onStart={() => startReview()}/>

				<div className="cu-assignments" data-glyph-host><OpenAssignmentsSection
					open={assignments.data?.open ?? []}
					handedIn={assignments.data?.handedIn ?? []}
					now={now}
					onOpen={openAssignment}
					status={assignments.loading ? "Looking for assignments in your sessions…" : assignments.error || (assignments.data?.unrecoverable ? `${assignments.data.unrecoverable} older task${assignments.data.unrecoverable === 1 ? "" : "s"} could not be recovered from this device.` : "")}
				/></div>

				<LearningOutlook history={outlookHistory}
					onPractice={(question) => navigate({ to: "/chat", search: { ask: `Can we practice this question again? I keep missing it: “${question}”` } })} />

				<ComingUpReadiness source={keatingStorage} contextVersion={JSON.stringify({ queue, decks, verifications, learnerState, reviewDeckIds })}
					hasDueDecks={queue.dueDeckIds.length > 0} onStart={(deckId) => startReview([deckId])} />

				{currentReviewDeck ? (
					<section id="coming-up-review" className="cu-reviewer" aria-labelledby="review-title">
						<div className="cu-reviewerHead">
							<div><h2 id="review-title" className="cu-reviewerTitle">Reviewing {currentReviewDeck.title}</h2><p className="cu-stripCopy">Deck {reviewIndex + 1} of {reviewDeckIds.length} · {dueCardIds.length} due</p></div>
							<Button variant="line" onClick={() => dispatch({ type: "review.ended" })}>End review</Button>
						</div>
						<FlashcardRenderer key={currentReviewDeck.id} deck={currentReviewDeck} restrictToCardIds={dueCardIds} autoFocusKeyboard onComplete={handleReviewComplete} />
					</section>
				) : null}

				<section className="cu-workspace" aria-labelledby="priority-board-title">
					<div className="cu-workspaceHead">
						<div><h2 id="priority-board-title" className="cu-workspaceTitle">Priority board</h2><p className="cu-workspaceCopy">Drag cards between lanes or use each card’s priority menu. Moving a card changes your intent—not its spaced-repetition date.</p></div>

					</div>
					<div className="cu-mobileTabs"><Segmented<StudyPriority> label="Priority lane" wide value={mobileLane} onChange={setMobileLane}
                      options={PRIORITIES.map(lane => ({value:lane.id,label:`${lane.label} (${queue.lanes[lane.id].length})`}))}/></div>
                    <div className="cu-board">
						{PRIORITIES.map((priority) => (
							<section
								key={priority.id}
								aria-labelledby={`lane-${priority.id}`}
								className={cx("cu-lane", dropLane === priority.id ? "cu-laneDragging" : "", mobileLane === priority.id ? "cu-visible" : "")}
								onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; dispatch({ type: "drag.entered", lane: priority.id }); }}
								onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dispatch({ type: "drag.ended" }); }}
								onDrop={(event) => { event.preventDefault(); const item = queue.items.find((candidate) => candidate.id === (draggedId ?? event.dataTransfer.getData("text/plain"))); dispatch({ type: "drag.ended" }); if (item) void moveItem(item, priority.id); }}
							>
								<div className="cu-laneHead k-halftone"><div><h3 id={`lane-${priority.id}`} className="cu-laneTitle">{priority.label}</h3><p className="cu-laneNote">{priority.note}</p></div><span className="cu-count">{queue.lanes[priority.id].length}</span></div>
								<div className="cu-laneBody">
									{queue.lanes[priority.id].length === 0 ? <EmptyState className="cu-emptyLane k-grid" heading={priority.id === "focus" ? "Drop the work that deserves your attention here." : "Nothing here yet."}/> : queue.lanes[priority.id].map((item) => (
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
					{status || error ? <div className={cx("cu-status", error ? "cu-statusError" : "")} role="status" aria-live="polite">{error || status}{error && <Button onClick={retryLoad}>Reload queue</Button>}</div> : null}
				</section>
				<footer className="cu-transfer"><strong>Your data</strong><div className="cu-toolbar">
							<label data-glyph-host className={cx("cu-button", "cu-primaryButton")}>
								<KeatingGlyph name="import" size={15} />{busy ? "Working…" : "Import Anki"}
								<input ref={importRef} className="cu-fileInput" type="file" accept=".apkg,.csv,.tsv,.txt,application/octet-stream,text/csv,text/tab-separated-values" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.currentTarget.value = ""; }} />
							</label>
							<Button variant="ghost" disabled={busy || decks.length === 0} onClick={() => { dispatch({type:"feedback.clear"}); setExportFormat("apkg"); }}><KeatingGlyph name="export" size={15} />Export .apkg</Button>
							<Button variant="ghost" disabled={busy || decks.length === 0} onClick={() => { dispatch({type:"feedback.clear"}); setExportFormat("tsv"); }}>TSV fallback</Button>
						</div><p className="cu-copy" data-glyph-host><KeatingGlyph name="info" size={13} />Anki imports run locally in this browser. Templates never execute, and media is left out of Keating’s text-first reviews.</p></footer>
                <ExportSheet open={exportFormat !== null} onClose={() => { if (!busy) setExportFormat(null); }}
                  title="Export review decks" included={`${decks.length} ${decks.length === 1 ? "deck" : "decks"} · ${cardCount} ${cardCount === 1 ? "card" : "cards"}`}
                  format={exportFormat === "apkg" ? "Native Anki package (.apkg)" : "Tab-separated text (.tsv)"}
                  destination={`Your browser downloads · keating-review-decks.${exportFormat ?? "apkg"}`}
                  confirmLabel={exportFormat === "apkg" ? "Export .apkg" : "Export TSV"} busy={busy} error={error || undefined}
                  onConfirm={() => exportFormat === "apkg" ? exportApkg() : exportTsv()}/>
			</main>
			</LearningShell>
		</div>
	);
}
