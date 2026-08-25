import { useEffect, useState, type KeyboardEvent } from "react";
import { PEDAGOGY_RUBRIC_KEYS, type TrajectoryReviewTarget } from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { deskTab } from "../../../styled-system/recipes";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { artifactReviewTask } from "./pool-compatibility";
import { annotationKindColor, verdictLabel } from "./review-vocabulary";
import { useSurfaceCollapse } from "./use-surface-collapse";
import { ReviewDesk } from "./ReviewDesk";
import { compactButtonClass, metaTextClass, primaryButtonClass } from "./styles";
import { TrajectoryCanvas, type TrajectoryCanvasMode } from "./TrajectoryCanvas";
import { TurnPicker, TurnRail } from "./TurnRail";
import type {
	ArtifactRenderer,
	TrajectoryPassCallbacks,
	TrajectoryPassState,
	TrajectoryReviewWorkspaceCallbacks,
	TrajectoryReviewWorkspaceData,
	TrajectoryTextSelection,
} from "./types";

type MobileWorkspaceTab = "turns" | "session" | "review";

const MOBILE_TABS: Array<{ value: MobileWorkspaceTab; label: string; icon: keyof typeof reviewIcon }> = [
	{ value: "turns", label: "Contents", icon: "contents" },
	{ value: "session", label: "Page", icon: "page" },
	{ value: "review", label: "Margin", icon: "margin" },
];

export interface TrajectoryReviewWorkspaceProps {
	data: TrajectoryReviewWorkspaceData;
	callbacks: TrajectoryReviewWorkspaceCallbacks;
	renderArtifact?: ArtifactRenderer;
	/** Omit both to render the workspace with no AI passes. */
	passes?: TrajectoryPassState;
	passCallbacks?: TrajectoryPassCallbacks;
	className?: string;
}

function mobileTabKeyDown(
	event: KeyboardEvent<HTMLButtonElement>,
	current: MobileWorkspaceTab,
	onChange: (tab: MobileWorkspaceTab) => void,
) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const index = MOBILE_TABS.findIndex((tab) => tab.value === current);
	const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? MOBILE_TABS.length - 1 : event.key === "ArrowRight" ? (index + 1) % MOBILE_TABS.length : (index - 1 + MOBILE_TABS.length) % MOBILE_TABS.length;
	const next = MOBILE_TABS[nextIndex].value;
	onChange(next);
	event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-workspace-tab="${next}"]`)?.focus();
}

function formattedDate(timestamp: number | undefined): string | null {
	if (!timestamp || !Number.isFinite(timestamp)) return null;
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(timestamp);
}

const spineButtonClass = css({
	display: "grid",
	width: "1.9rem",
	height: "1.9rem",
	flex: "0 0 auto",
	placeItems: "center",
	borderRadius: "0.25rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
	color: "var(--foreground)",
	_hover: { borderColor: "var(--ink)", background: "var(--muted)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
});

const spineBadgeClass = css({
	fontSize: "0.5625rem",
	letterSpacing: "0.04em",
	color: "var(--muted-foreground)",
	fontVariantNumeric: "tabular-nums",
});

export function TrajectoryReviewWorkspace({ data, callbacks, renderArtifact, passes, passCallbacks, className }: TrajectoryReviewWorkspaceProps) {
	const [mobileTab, setMobileTab] = useState<MobileWorkspaceTab>("session");
	const { open: railOpen, set: setRailOpen } = useSurfaceCollapse("rail", false);
	const { open: deskOpen, set: setDeskOpen } = useSurfaceCollapse("desk", false);
	// Only one surface may own the open draft at a time. The canvas takes it whenever
	// it has a rect to anchor to; otherwise (a whole-turn note, say) the desk keeps it.
	const [draftAnchored, setDraftAnchored] = useState(false);
	const [canvasMode, setCanvasMode] = useState<TrajectoryCanvasMode>(() => data.activeTargetKey.startsWith("artifact:") ? "artifact" : "transcript");
	const activeMessage = data.messages.find((message) => message.id === data.activeTurnId) ?? data.messages[0];
	const activeArtifact = data.artifacts.find((artifact) => artifact.id === data.activeArtifactId) ?? data.artifacts[0];
	const targetIsArtifact = data.activeTargetKey.startsWith("artifact:");
	const activeArtifactTask = targetIsArtifact && activeArtifact
		? artifactReviewTask(activeArtifact.reference.artifactType)
		: null;
	const activeTask = targetIsArtifact
		? activeArtifactTask
		: activeMessage?.role === "assistant"
			? "response" as const
			: null;
	const generationUnavailableReason = targetIsArtifact && activeArtifact && activeArtifactTask === null
		? `Annotate this ${activeArtifact.reference.artifactType} directly. Parallel candidates currently return text only and cannot materialize native media.`
		: undefined;
	const activeTarget: TrajectoryReviewTarget = targetIsArtifact && activeArtifact
		? { kind: "artifact", artifact: activeArtifact.reference }
		: activeMessage
			? { kind: "message", messageId: activeMessage.id, role: activeMessage.role, messageTimestamp: activeMessage.timestamp, contentFingerprint: activeMessage.contentFingerprint }
			: { kind: "session" };
	const promptCharacters = 1_500
		+ data.messages.reduce((total, message) => total + message.text.length, 0)
		+ (targetIsArtifact ? activeArtifact?.plainText?.length ?? 0 : 0)
		+ data.annotations.reduce((total, annotation) => total
			+ annotation.note.length
			+ (annotation.pedagogicalImpact?.length ?? 0)
			+ (annotation.suggestedAlternative?.length ?? 0), 0);
	const sessionDate = formattedDate(data.session.startedAt);
	const scoredCount = PEDAGOGY_RUBRIC_KEYS.filter((key) => data.review.ratings[key]).length;

	// One dot per turn, carrying the strongest signal on it: a problem outranks a
	// suggestion outranks a strength, because that is the order a reviewer triages in.
	const turnDots = data.messages.map((message) => {
		const kinds = new Set(
			data.annotations
				.filter((annotation) => (annotation.target.kind === "message" || annotation.target.kind === "message-span") && annotation.target.messageId === message.id)
				.map((annotation) => annotation.kind),
		);
		const kind = kinds.has("problem") ? "problem" : kinds.has("suggestion") ? "suggestion" : kinds.has("strength") ? "strength" : undefined;
		return {
			id: message.id,
			tone: kind ? annotationKindColor(kind) : undefined,
			label: `Turn ${message.ordinal + 1} · ${message.role}${kind ? ` · ${kind}` : ""}`,
		};
	});

	useEffect(() => {
		// Mobile has no anchored popover, so the draft still routes to the Margin tab
		// there. On desktop the editor comes to the text instead.
		if (data.annotationDraft) setMobileTab("review");
	}, [data.annotationDraft]);

	useEffect(() => {
		setCanvasMode(data.activeTargetKey.startsWith("artifact:") ? "artifact" : "transcript");
	}, [data.activeTargetKey, data.session.id]);

	function selectTurn(messageId: string) {
		callbacks.onSelectTurn(messageId);
		setCanvasMode("transcript");
		setMobileTab("session");
	}

	function selectArtifact(artifactId: string) {
		callbacks.onSelectArtifact(artifactId);
		setCanvasMode("artifact");
		setMobileTab("session");
	}

	function changeCanvasMode(mode: TrajectoryCanvasMode) {
		if (mode === "artifact") {
			if (!activeArtifact) return;
			callbacks.onSelectArtifact(activeArtifact.id);
		} else {
			if (!activeMessage) return;
			callbacks.onSelectTurn(activeMessage.id);
		}
		setCanvasMode(mode);
	}

	function beginAnnotation(target: TrajectoryReviewTarget) {
		callbacks.onStartAnnotation(target);
		setMobileTab("review");
	}

	function textSelection(selection: TrajectoryTextSelection) {
		callbacks.onTextSelection(selection);
		setMobileTab("review");
	}

	function selectAnnotation(annotationId: string) {
		const annotation = data.annotations.find((item) => item.id === annotationId);
		if (annotation) {
			callbacks.onEditAnnotation(annotation);
			setMobileTab("review");
		}
	}

	return (
		<main
			className={cx(
				css({
					display: "flex",
					width: "100%",
					height: { base: "auto", md: "min(88dvh, 58rem)" },
					minHeight: { base: "36rem", md: "40rem" },
					flexDirection: "column",
					overflow: "hidden",
					border: "1px solid var(--border)",
					borderRadius: { base: 0, md: "0.5rem" },
					background: "var(--paper, var(--background))",
					color: "var(--foreground)",
				}),
				className,
			)}
		>
			<header className={css({ display: "flex", minHeight: "4rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.625rem", borderBottom: "1px solid var(--border)", background: "var(--paper, var(--background))", padding: { base: "0.625rem 0.75rem", md: "0.625rem 1rem" } })}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						<h1 className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "serif", fontSize: { base: "1rem", md: "1.125rem" }, fontWeight: 700, color: "var(--foreground)" })}>{data.session.title}</h1>
						<span className={css({ display: "inline-flex", flex: "0 0 auto", alignItems: "center", gap: "0.2rem", borderRadius: "9999px", background: data.review.status === "final" ? "color-mix(in srgb, var(--accent-green) 25%, transparent)" : "var(--muted)", padding: "0.15rem 0.4rem", fontSize: "0.5625rem", fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted-foreground)" })}>
							{data.review.status}
						</span>
					</div>
					<div className={cx(metaTextClass, css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem", marginTop: "0.125rem" }))}>
						<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.2rem" })}><KeatingIcon icon={reviewIcon.verdict} size={11} /> Review records stay local</span>
						{data.session.subtitle ? <><span aria-hidden="true">·</span><span>{data.session.subtitle}</span></> : null}
						{sessionDate ? <><span aria-hidden="true">·</span><span>{sessionDate}</span></> : null}
					</div>
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.375rem" })}>
					<span role="status" aria-live="polite" className={metaTextClass}>{data.busy?.saving ? "Saving changes..." : data.busy?.exporting ? "Preparing export..." : data.reviewDirty ? "Unsaved changes" : ""}</span>
					<button type="button" className={compactButtonClass} disabled={data.busy?.exporting} onClick={callbacks.onExport}><KeatingIcon icon={reviewIcon.export} size={13} /> <span className={css({ display: "none", sm: { display: "inline" } })}>Export</span></button>
					<button type="button" className={primaryButtonClass} disabled={data.busy?.saving || !data.reviewDirty} onClick={callbacks.onSave}><KeatingIcon icon={reviewIcon.save} size={13} /> <span className={css({ display: "none", sm: { display: "inline" } })}>{data.busy?.saving ? "Saving" : "Save review"}</span></button>
				</div>
			</header>

			<div role="tablist" aria-label="Review workspace" className={css({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", borderBottom: "1px solid var(--border)", md: { display: "none" } })}>
				{MOBILE_TABS.map((option) => {
					const selected = mobileTab === option.value;
					return (
						<button
							key={option.value}
							type="button"
							role="tab"
							id={`trajectory-workspace-${option.value}-tab`}
							aria-controls={`trajectory-workspace-${option.value}-panel`}
							aria-selected={selected}
							tabIndex={selected ? 0 : -1}
							data-workspace-tab={option.value}
							className={deskTab()}
							onClick={() => setMobileTab(option.value)}
							onKeyDown={(event) => mobileTabKeyDown(event, option.value, setMobileTab)}
						>
							<KeatingIcon icon={reviewIcon[option.icon]} size={14} /> {option.label}
						</button>
					);
				})}
			</div>

			{/*
			 * The desktop grid never changes width. Both side surfaces collapse to
			 * spines and expand as overlays, so opening one cannot reflow the canvas —
			 * a reader who opens the desk must not lose the line they were reading.
			 */}
			<div
				className={css({
					position: "relative",
					display: { base: "block", md: "grid" },
					minHeight: 0,
					flex: 1,
					gridTemplateColumns: { md: "2.75rem minmax(0, 1fr) 2.75rem" },
				})}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					if (deskOpen) {
						setDeskOpen(false);
						event.stopPropagation();
						return;
					}
					if (railOpen) {
						setRailOpen(false);
						event.stopPropagation();
					}
				}}
			>
				<nav
					aria-label="Turns"
					className={css({ display: "none", md: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", borderRight: "1px solid var(--border)", background: "var(--card, var(--background))", paddingBlock: "0.6rem" } })}
				>
					<button
						type="button"
						aria-expanded={railOpen}
						aria-controls="trajectory-workspace-turns-panel"
						title={railOpen ? "Collapse turn list" : "Expand turn list"}
						className={spineButtonClass}
						onClick={() => setRailOpen(!railOpen)}
					>
						<KeatingIcon icon={reviewIcon.contents} size={14} />
					</button>
					{/* Collapsed, the spine is still a map: colour tells you where the
					    problems cluster without opening anything. */}
					{turnDots.map((dot) => (
						<button
							key={dot.id}
							type="button"
							title={dot.label}
							aria-label={dot.label}
							aria-current={dot.id === data.activeTurnId ? "true" : undefined}
							className={css({
								width: "0.7rem",
								height: "0.7rem",
								flex: "0 0 auto",
								borderRadius: "9999px",
								border: "1.5px solid var(--border)",
								_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
							})}
							style={{
								background: dot.tone ?? "transparent",
								borderColor: dot.tone ?? "var(--border)",
								boxShadow: dot.id === data.activeTurnId ? "0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)" : undefined,
							}}
							onClick={() => selectTurn(dot.id)}
						/>
					))}
				</nav>

				<div
					id="trajectory-workspace-turns-panel"
					role="tabpanel"
					aria-labelledby="trajectory-workspace-turns-tab"
					className={css({
						display: mobileTab === "turns" ? "block" : "none",
						minHeight: "32rem",
						md: {
							display: railOpen ? "block" : "none",
							position: "absolute",
							insetBlock: 0,
							left: "2.75rem",
							zIndex: 25,
							width: "15rem",
							minHeight: 0,
							borderRight: "1px solid var(--ink)",
							background: "var(--card, var(--background))",
							boxShadow: "14px 0 30px -24px rgba(0, 0, 0, 0.8)",
						},
					})}
				>
					<TurnRail messages={data.messages} annotations={data.annotations} activeMessageId={data.activeTurnId} onSelect={selectTurn} />
				</div>

				<div id="trajectory-workspace-session-panel" role="tabpanel" aria-labelledby="trajectory-workspace-session-tab" className={css({ display: mobileTab === "session" ? "flex" : "none", minWidth: 0, minHeight: "32rem", flexDirection: "column", md: { display: "flex", minHeight: 0 } })}>
					<div className={css({ display: "none", borderBottom: "1px solid var(--border)", padding: "0.5rem 0.75rem", md: { display: "block" }, xl: { display: "none" } })}>
						<TurnPicker messages={data.messages} activeMessageId={data.activeTurnId} onSelect={selectTurn} />
					</div>
					<TrajectoryCanvas
						messages={data.messages}
						artifacts={data.artifacts}
						annotations={data.annotations}
						activeMessageId={data.activeTurnId}
						activeArtifactId={data.activeArtifactId}
						activeAnnotationId={data.activeAnnotationId}
						mode={canvasMode}
						onModeChange={changeCanvasMode}
						onSelectMessage={selectTurn}
						onSelectArtifact={selectArtifact}
						onSelectAnnotation={selectAnnotation}
						onTextSelection={textSelection}
						onStartAnnotation={beginAnnotation}
						onDeleteAnnotation={callbacks.onDeleteAnnotation}
						annotationDraft={data.annotationDraft}
						onAnnotationDraftChange={callbacks.onAnnotationDraftChange}
						onSaveAnnotation={callbacks.onSaveAnnotation}
						onCancelAnnotation={callbacks.onCancelAnnotation}
						onExpandAnnotation={passes && passCallbacks ? () => passCallbacks.onRunPass("annotation-expand") : undefined}
						isSavingAnnotation={data.busy?.saving}
						isExpandingAnnotation={passes?.running === "annotation-expand"}
						onDraftAnchoredChange={setDraftAnchored}
						renderArtifact={renderArtifact}
						className={css({ minHeight: 0, flex: 1 })}
					/>
				</div>

				<div
					id="trajectory-workspace-review-panel"
					role="tabpanel"
					aria-labelledby="trajectory-workspace-review-tab"
					className={css({
						display: mobileTab === "review" ? "block" : "none",
						minWidth: 0,
						minHeight: "32rem",
						md: {
							display: deskOpen ? "block" : "none",
							position: "absolute",
							insetBlock: 0,
							right: "2.75rem",
							zIndex: 25,
							width: "22rem",
							maxWidth: "70vw",
							minHeight: 0,
							borderLeft: "1px solid var(--ink)",
							background: "var(--card, var(--background))",
							boxShadow: "-14px 0 30px -24px rgba(0, 0, 0, 0.8)",
						},
					})}
				>
					<ReviewDesk data={data} callbacks={callbacks} activeTarget={activeTarget} activeTask={activeTask} generationUnavailableReason={generationUnavailableReason} promptCharacters={promptCharacters} passes={passes} passCallbacks={passCallbacks} draftAnchored={draftAnchored} />
				</div>

				<nav
					aria-label="Review desk"
					className={css({ display: "none", md: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", borderLeft: "1px solid var(--border)", background: "var(--card, var(--background))", paddingBlock: "0.6rem" } })}
				>
					<button
						type="button"
						aria-expanded={deskOpen}
						aria-controls="trajectory-workspace-review-panel"
						title={deskOpen ? "Collapse review desk" : "Open review desk"}
						className={spineButtonClass}
						onClick={() => setDeskOpen(!deskOpen)}
					>
						<KeatingIcon icon={reviewIcon.margin} size={14} />
					</button>
					{/* Collapsed, the desk still reports itself. Without this the spine is
					    a memory tax; with it, the glance replaces opening the panel. */}
					<span title={`Verdict: ${verdictLabel(data.review.verdict)}`} className={spineBadgeClass}>
						{data.review.verdict === "accepted" ? "✓" : data.review.verdict === "rejected" ? "✕" : data.review.verdict === "review" ? "!" : "—"}
					</span>
					<span title={`Rubric: ${scoredCount} of ${PEDAGOGY_RUBRIC_KEYS.length} scored`} className={spineBadgeClass}>
						{scoredCount}/{PEDAGOGY_RUBRIC_KEYS.length}
					</span>
					<span title={`${data.candidates.length} candidates`} className={spineBadgeClass}>
						{data.candidates.length}◇
					</span>
					{passes?.rubric ? (
						<span title="A rubric proposal is waiting" className={cx(spineBadgeClass, css({ color: "var(--accent-dim)", fontWeight: 700 }))}>
							●
						</span>
					) : null}
				</nav>
			</div>
		</main>
	);
}
