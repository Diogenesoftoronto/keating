import { Select } from "../Select";
import { KeatingGlyph } from "../../design-system/glyphs";
import { useEffect, useState } from "react";
import { ExportSheet } from "../export/ExportSheet";
import { AppBar, Button, ButtonLink, IconButton, Loading, Menu, Segmented, SubBar, Tabs } from "../../design-system/kit";
import { PEDAGOGY_RUBRIC_KEYS, type TrajectoryReviewTarget } from "../../keating/trajectory-review";
import { cx } from "../../../styled-system/css";
import { artifactReviewTask } from "./pool-compatibility";
import { verdictLabel } from "./review-vocabulary";
import { useSurfaceCollapse } from "./use-surface-collapse";
import { ReviewDesk, type DeskTab } from "./ReviewDesk";
import { CandidateLedger } from "./CandidateLedger";
import { TrajectoryCanvas, type TrajectoryCanvasMode } from "./TrajectoryCanvas";
import { TurnRail } from "./TurnRail";
import type {
	ArtifactRenderer,
	TrajectoryPassCallbacks,
	TrajectoryPassState,
	TrajectoryReviewWorkspaceCallbacks,
	TrajectoryReviewWorkspaceData,
	TrajectoryTextSelection,
} from "./types";
import "./review.css";

export interface TrajectoryReviewWorkspaceProps {
	data: TrajectoryReviewWorkspaceData;
	callbacks: TrajectoryReviewWorkspaceCallbacks;
	renderArtifact?: ArtifactRenderer;
	/** Omit both to render the workspace with no AI passes. */
	passes?: TrajectoryPassState;
	passCallbacks?: TrajectoryPassCallbacks;
	className?: string;
}

function countLabel(count: number, label: string) {
	return count + " " + label + (count === 1 ? "" : "s");
}

function formattedDate(timestamp: number | undefined): string | null {
	if (!timestamp || !Number.isFinite(timestamp)) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(timestamp);
}

export function TrajectoryReviewWorkspace({
	data,
	callbacks,
	renderArtifact,
	passes,
	passCallbacks,
	className,
}: TrajectoryReviewWorkspaceProps) {
	const [mobileTab, setMobileTab] = useState<"session" | "review" | "turns">("session");
	const { open: railOpen, set: setRailOpen } = useSurfaceCollapse("rail", true);
	const { open: deskOpen, set: setDeskOpen } = useSurfaceCollapse("desk", true);
	const [exporting, setExporting] = useState(false);
	const [exportResult, setExportResult] = useState("");
	const [exportError, setExportError] = useState("");
	const openExport = () => { setExportResult(""); setExportError(""); setExportOpen(true); };
	const [exportOpen, setExportOpen] = useState(false);
	const [raw, setRaw] = useState(false);
	const [deskTab, setDeskTab] = useState<DeskTab>("notes");
	const [canvasMode, setCanvasMode] = useState<TrajectoryCanvasMode>(() =>
		data.activeTargetKey.startsWith("artifact:") ? "artifact" : "transcript",
	);
	const [transcriptMode, setTranscriptMode] = useState<"single" | "continuous">("continuous");
	const activeMessage = data.messages.find((message) => message.id === data.activeTurnId) ?? data.messages[0];
	const activeArtifact = data.artifacts.find((artifact) => artifact.id === data.activeArtifactId) ?? data.artifacts[0];
	const targetIsArtifact = data.activeTargetKey.startsWith("artifact:");
	const activeArtifactTask =
		targetIsArtifact && activeArtifact ? artifactReviewTask(activeArtifact.reference.artifactType) : null;
	const activeTask = targetIsArtifact
		? activeArtifactTask
		: activeMessage?.role === "assistant"
			? ("response" as const)
			: null;
	const generationUnavailableReason =
		targetIsArtifact && activeArtifact && activeArtifactTask === null
			? `Annotate this ${activeArtifact.reference.artifactType} directly. Parallel candidates currently return text only and cannot materialize native media.`
			: undefined;
	const activeTarget: TrajectoryReviewTarget =
		targetIsArtifact && activeArtifact
			? { kind: "artifact", artifact: activeArtifact.reference }
			: activeMessage
				? {
						kind: "message",
						messageId: activeMessage.id,
						role: activeMessage.role,
						messageTimestamp: activeMessage.timestamp,
						contentFingerprint: activeMessage.contentFingerprint,
					}
				: { kind: "session" };
	const promptCharacters =
		1_500 +
		data.messages.reduce((total, message) => total + message.text.length, 0) +
		(targetIsArtifact ? (activeArtifact?.plainText?.length ?? 0) : 0) +
		data.annotations.reduce(
			(total, annotation) =>
				total +
				annotation.note.length +
				(annotation.pedagogicalImpact?.length ?? 0) +
				(annotation.suggestedAlternative?.length ?? 0),
			0,
		);
	const sessionDate = formattedDate(data.session.startedAt);
	const scoredCount = PEDAGOGY_RUBRIC_KEYS.filter((key) => data.review.ratings[key]).length;

	const candidateCount = data.candidates.filter((candidate) => candidate.targetKey === data.activeTargetKey).length;
	const activeIndex = data.messages.indexOf(activeMessage);
	const model = activeMessage?.model ?? data.messages.find((message) => message.model)?.model;
	const chatHref = "/chat?session=" + encodeURIComponent(data.session.id);
	const status = data.busy?.saving
		? "Saving changes..."
		: data.busy?.exporting
			? "Preparing export..."
			: data.reviewDirty
				? "Unsaved changes"
				: "";
	const tabs = [
		{ id: "trajectory-transcript-panel", label: "Transcript" },
		...(data.artifacts.length
			? [{ id: "trajectory-artifact-panel", label: "Artifacts", count: data.artifacts.length }]
			: []),
		{ id: "trajectory-candidates-panel", label: "Model results", count: candidateCount },
	];
	useEffect(() => {
		setCanvasMode(data.activeTargetKey.startsWith("artifact:") ? "artifact" : "transcript");
	}, [data.activeTargetKey, data.session.id]);
	useEffect(() => {
		setExportOpen(false);
		setTranscriptMode("continuous");
		setRaw(false);
	}, [data.session.id]);
	useEffect(() => {
		if (canvasMode === "artifact" && !data.artifacts.length) setCanvasMode("transcript");
	}, [canvasMode, data.artifacts.length]);
	function selectTurn(messageId: string) {
		callbacks.onSelectTurn(messageId);
		setCanvasMode("transcript");
		setTranscriptMode("single");
		setMobileTab("session");
	}
	function selectArtifact(id: string) {
		callbacks.onSelectArtifact(id);
		setCanvasMode("artifact");
		setMobileTab("session");
	}
	function changeCanvasMode(mode: TrajectoryCanvasMode) {
		if (mode === "artifact" && activeArtifact) callbacks.onSelectArtifact(activeArtifact.id);
		if (mode === "transcript" && activeMessage) callbacks.onSelectTurn(activeMessage.id);
		setCanvasMode(mode);
		setMobileTab("session");
	}
	function openNotes() {
		setDeskTab("notes");
		setDeskOpen(true);
		setMobileTab("session");
	}
	useEffect(() => {
		if (data.annotationDraft) openNotes();
	}, [data.annotationDraft?.targetKey, data.annotationDraft?.id]);
	function beginAnnotation(target: TrajectoryReviewTarget) {
		openNotes();
		callbacks.onStartAnnotation(target);
	}
	function textSelection(selection: TrajectoryTextSelection) {
		openNotes();
		callbacks.onTextSelection(selection);
	}
	function selectAnnotation(id: string) {
		const annotation = data.annotations.find((note) => note.id === id);
		if (annotation) {
			openNotes();
			callbacks.onEditAnnotation(annotation);
		}
	}
	function step(delta: number) {
		const next = data.messages[activeIndex + delta];
		if (next) selectTurn(next.id);
	}
	useEffect(() => {
		function shortcut(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				event.isComposing ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				document.querySelector('dialog[open], [role="dialog"]:not([hidden]), [role="menu"]:not([hidden])') ||
				(event.target instanceof Element &&
					event.target.closest(
						'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
					))
			)
				return;
			switch (event.key.toLowerCase()) {
				case "j":
					step(1);
					break;
				case "k":
					step(-1);
					break;
				case "n":
					if (!activeMessage || event.repeat) return;
					beginAnnotation({
						kind: "message",
						messageId: activeMessage.id,
						role: activeMessage.role,
						messageTimestamp: activeMessage.timestamp,
						contentFingerprint: activeMessage.contentFingerprint,
					});
					break;
				default:
					return;
			}
			event.preventDefault();
		}
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	});
	const renderCandidates = (compact = false) => (
		<CandidateLedger
			compact={compact}
			candidates={data.candidates}
			modelPools={data.modelPools}
			availableModels={data.availableModels}
			activeTargetKey={data.activeTargetKey}
			activeTask={activeTask}
			generationUnavailableReason={generationUnavailableReason}
			promptCharacters={promptCharacters}
			activeCandidateId={data.activeCandidateId}
			activeModelPoolId={data.activeModelPoolId}
			selectedCandidateId={data.review.selectedCandidateIds[data.activeTargetKey]}
			isGenerating={data.busy?.generating}
			onSelectCandidate={callbacks.onSelectCandidate}
			onSelectModelPool={callbacks.onSelectModelPool}
			onGenerate={callbacks.onGenerateCandidates}
			onChoose={callbacks.onChooseCandidate}
			onInsert={callbacks.onInsertCandidate}
			onRegenerate={callbacks.onRegenerateCandidate}
		/>
	);
	const phoneTab = mobileTab === "review" ? deskTab : mobileTab === "turns" ? "turns" : canvasMode;
	const extraPhoneLabel = { rewrites: "Rewrites", turns: "Turns", artifact: "Artifacts", candidates: "Model results" };
	const phoneItems = [
		{ id: "rv-phone-transcript", label: "Transcript" },
		{ id: "rv-phone-notes", label: "Notes", count: data.annotations.length },
		{ id: "rv-phone-rubric", label: "Rubric", count: scoredCount + "/" + PEDAGOGY_RUBRIC_KEYS.length },
	];
	const auxiliaryMode = phoneTab === "transcript" || phoneTab === "notes" || phoneTab === "rubric" ? null : extraPhoneLabel[phoneTab];
	function openDeskTab(tab: DeskTab) {
		setDeskTab(tab);
		setMobileTab("review");
	}
	return (
		<main className={cx("rv-work", className)}>
			<ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} title="Export this review"
				included={`${countLabel(data.messages.length, "turn")} of “${data.session.title}”, ${countLabel(data.annotations.length, "note")}, ${scoredCount} of ${PEDAGOGY_RUBRIC_KEYS.length} rubric scores, ${countLabel(Object.keys(data.review.selectedCandidateIds).length, "chosen rewrite")}`}
				excluded="Other sessions, your profile, your keys"
				format="ZIP with JSONL files and a README" destination="Your downloads folder. Nothing is uploaded."
				error={exportError || undefined}
				note={exportResult ? <span role="status">{exportResult}</span> : data.reviewDirty ? "You have unsaved changes. Exporting saves the review first." : undefined}
				confirmLabel={data.reviewDirty ? "Save and download" : "Download ZIP"} busy={exporting || data.busy?.exporting}
				onConfirm={async () => {
					setExporting(true); setExportResult(""); setExportError("");
					try { await callbacks.onExport(); setExportResult("ZIP download started."); }
					catch (cause) { setExportError(cause instanceof Error ? cause.message : "Could not export this review."); }
					finally { setExporting(false); }
				}}
			/>
			<AppBar
				className="rv-head"
				menu={false}
				start={
					<ButtonLink href="/review" glyph="left" variant="ghost" aria-label="Reviews">
						<span className="rv-desktop">Reviews</span>
					</ButtonLink>
				}
				title={<h1>{data.session.title}</h1>}
			>
				<Select
					className="rv-status"
					aria-label="Review status"
					value={data.review.status}
					onValueChange={(value) =>
						callbacks.onReviewChange({
							...data.review,
							updatedAt: Date.now(),
							status: value === "final" ? "final" : "draft",
						})
					}
				>
					<option value="draft">Draft</option>
					<option value="final">Final</option>
				</Select>
				<span className="rv-meta" title={data.session.subtitle}>
					{[data.messages.length + " turns", model, sessionDate].filter(Boolean).join(" · ")}
				</span>
				<ButtonLink
					className="rv-desktop rv-chat k-bloom"
					href={chatHref}
					variant="ghost"
					glyph="ext"
					aria-label="Return to this chat session"
					title="Return to this chat session"
				/>
				{data.busy?.saving || data.busy?.exporting
					? <Loading className="rv-save-state" size="inline" aria-live="polite" label={status} />
					: <span className="rv-save-state" role="status" aria-live="polite">{status}</span>}
				<Button className="rv-desktop" variant="ghost" glyph="export" disabled={data.busy?.exporting} onClick={openExport}>
					Export
				</Button>
				<Button
					className="rv-save"
					aria-label="Save review"
					glyph="save"
					variant="primary"
					disabled={data.busy?.saving}
					onClick={callbacks.onSave}
				>
					<span className="rv-desktop">{data.busy?.saving ? "Saving" : "Save review"}</span>
				</Button>
				<Menu
					className="rv-phone"
					label="Review actions"
					trigger={<IconButton glyph="more" label="More review actions" />}
					items={[
						{
							id: "export",
							label: "Export",
							glyph: "export",
							disabled: data.busy?.exporting,
							onSelect: openExport,
						},
						{ id: "rewrites", label: "Rewrites", onSelect: () => openDeskTab("rewrites") },
						{
							id: "results",
							label: "Model results (" + candidateCount + ")",
							onSelect: () => changeCanvasMode("candidates"),
						},
						...(data.artifacts.length
							? [
									{
										id: "artifacts",
										label: "Artifacts (" + data.artifacts.length + ")",
										onSelect: () => changeCanvasMode("artifact"),
									},
								]
							: []),
						{
							id: "view",
							label: raw ? "Show rendered transcript" : "Show raw transcript",
							onSelect: () => {
								setRaw(!raw);
								changeCanvasMode("transcript");
							},
						},
						{
							id: "layout",
							label: transcriptMode === "single" ? "All turns" : "One turn",
							onSelect: () => {
								setTranscriptMode(transcriptMode === "single" ? "continuous" : "single");
								changeCanvasMode("transcript");
							},
						},
						{ id: "chat", label: "Return to this chat session", onSelect: () => window.location.assign(chatHref) },
					]}
				/>
			</AppBar>
			<SubBar className="rv-desktop rv-sub">
				<Tabs
					label="Review page"
					items={tabs}
					value={`trajectory-${canvasMode}-panel`}
					onChange={(id) => changeCanvasMode(id.split("-")[1] as TrajectoryCanvasMode)}
				/>
				{canvasMode === "transcript" && (
					<>
						<Segmented<"single" | "continuous">
							size="sm"
							label="Transcript layout"
							value={transcriptMode}
							onChange={setTranscriptMode}
							options={[
								{ value: "continuous", label: "All turns" },
								{ value: "single", label: "One turn" },
							]}
						/>
						<Segmented
							size="sm"
							label="Transcript format"
							value={raw ? "raw" : "rendered"}
							onChange={(value) => setRaw(value === "raw")}
							options={[
								{ value: "rendered", label: "Rendered" },
								{ value: "raw", label: "Raw" },
							]}
						/>
					</>
				)}
			</SubBar>
			<SubBar className="rv-phone">
				<Tabs
					stretch
					label="Review workspace"
					items={phoneItems}
					value={"rv-phone-" + (auxiliaryMode ? mobileTab === "review" ? "notes" : "transcript" : phoneTab)}
					onChange={(id) => {
						if (id === "rv-phone-transcript") changeCanvasMode("transcript");
						if (id === "rv-phone-notes") openDeskTab("notes");
						if (id === "rv-phone-rubric") openDeskTab("rubric");
					}}
				/>
			</SubBar>
			{auxiliaryMode && <strong className="rv-phone rv-mode-label">{auxiliaryMode}</strong>}
			<div
				className="rv-columns"
				data-rail={railOpen}
				data-desk={deskOpen}
				data-phone={mobileTab}
				onKeyDown={(event) => {
					if (
						event.key !== "Escape" ||
						event.defaultPrevented ||
						(event.target instanceof Element && event.target.closest("dialog[open]"))
					)
						return;
					if (data.annotationDraft) callbacks.onCancelAnnotation();
					else if (deskOpen) setDeskOpen(false);
					else if (railOpen) setRailOpen(false);
					else return;
					event.stopPropagation();
				}}
			>
				<div className="rv-outline-col" id="rv-phone-turns" aria-label="Turns">
					<TurnRail
						messages={data.messages}
						annotations={data.annotations}
						activeMessageId={activeMessage?.id}
						onSelect={selectTurn}
						collapsed={!railOpen}
						onToggle={() => setRailOpen(!railOpen)}
					/>
				</div>
				<div className="rv-document" id="rv-phone-transcript">
					<div className="rv-phone-page" id={canvasMode === "transcript" ? undefined : "rv-phone-" + canvasMode}>
						<TrajectoryCanvas
							messages={data.messages}
							artifacts={data.artifacts}
							annotations={data.annotations}
							activeMessageId={data.activeTurnId}
							activeArtifactId={data.activeArtifactId}
							activeAnnotationId={data.activeAnnotationId}
							mode={canvasMode}
							onModeChange={changeCanvasMode}
							transcript={transcriptMode}
							onTranscriptChange={setTranscriptMode}
							onActivateMessage={callbacks.onSelectTurn}
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
							onExpandAnnotation={
								passes && passCallbacks ? () => passCallbacks.onRunPass("annotation-expand") : undefined
							}
							isSavingAnnotation={data.busy?.saving}
							isExpandingAnnotation={passes?.running === "annotation-expand"}
							hideControls
							raw={raw}
							renderArtifact={renderArtifact}
							candidateCount={
								data.candidates.filter((candidate) => candidate.targetKey === data.activeTargetKey).length
							}
							candidatePanel={renderCandidates()}
							className="rv-canvas"
						/>
					</div>
				</div>
				<aside className="rv-margin" aria-label="The Margin">
					<ReviewDesk
						data={data}
						callbacks={callbacks}
						activeTarget={activeTarget}
						passes={passes}
						passCallbacks={
							passCallbacks && {
								...passCallbacks,
								onRevealProposal: (proposal) => {
									if (!proposal.messageId) return;
									passCallbacks.onRevealProposal?.(proposal);
									setTranscriptMode("single");
									setCanvasMode("transcript");
									setMobileTab("session");
								},
							}
						}
						tab={deskTab}
						onTabChange={setDeskTab}
						rewrites={renderCandidates(true)}
						onCollapse={() => setDeskOpen(false)}
						onOpenCandidates={() => changeCanvasMode("candidates")}
					/>
				</aside>
				{!deskOpen && (
					<aside data-glyph-host className="rv-desk-spine">
						<IconButton label="Open review desk" glyph="panelr" onClick={() => setDeskOpen(true)} />
						<span title={"Verdict: " + verdictLabel(data.review.verdict)}>
							<KeatingGlyph size={15} label={verdictLabel(data.review.verdict)} name={data.review.verdict === "accepted" ? "check"
								: data.review.verdict === "rejected" ? "x"
								: data.review.verdict === "review" ? "alert" : "ring"} />
						</span>
						<span title="Rubric dimensions scored">{scoredCount}/6</span>
						<span title="Rewrites">{candidateCount}<KeatingGlyph name="layers" size={15} /></span>
						{passes?.rubric && <span title="A rubric proposal is waiting"><KeatingGlyph name="ruler" size={15} /></span>}
					</aside>
				)}
			</div>
			<footer className="rv-phone rv-bottom">
				<IconButton
					label="Turn list"
					glyph="route"
					onClick={() => setMobileTab(mobileTab === "turns" ? "session" : "turns")}
				/>
				<IconButton label="Previous turn" glyph="left" disabled={activeIndex <= 0} onClick={() => step(-1)} />
				<span>{data.messages.length ? `Turn ${activeIndex + 1} of ${data.messages.length}` : "No turns"}</span>
				<IconButton
					label="Next turn"
					glyph="right"
					disabled={activeIndex >= data.messages.length - 1}
					onClick={() => step(1)}
				/>
				<IconButton label="Add note" glyph="note" onClick={() => beginAnnotation(activeTarget)} />
			</footer>
		</main>
	);
}
