import { StateGrid, useChartTooltip } from "../../design-system/charts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { animate, stagger } from "motion";
import { AnimatePresence, motion } from "motion/react";
import { Button, EmptyState, IconButton, Segmented, Sheet, Tabs, TabPanel } from "../../design-system/kit";
import { DURATION, EASE, SPRING, useMotionAllowed } from "../../design-system/motion";
import {
	PEDAGOGY_RUBRIC_KEYS,
	type ReviewRating,
	type TrajectoryReview,
	type TrajectoryReviewTarget,
} from "../../keating/trajectory-review";
import { AnnotationEditor } from "./AnnotationEditor";
import { ModelPoolEditor } from "./ModelPoolEditor";
import { CritiqueProposals, RubricProposal } from "./MarginProposals";
import {
	RUBRIC_HINTS,
	RUBRIC_LABELS,
	annotationKindLabel,
	orderReviewNotes,
	ratingLabel,
	reviewTargetLabel,
	severityLabel,
	verdictLabel,
} from "./review-vocabulary";
import { SocraticPass, type SocraticPassOption } from "./SocraticPass";
import type {
	TrajectoryPassCallbacks,
	TrajectoryPassState,
	TrajectoryReviewWorkspaceCallbacks,
	TrajectoryReviewWorkspaceData,
} from "./types";

export type DeskTab = "notes" | "rubric" | "rewrites";

const PASS_OPTIONS: SocraticPassOption[] = [
	{
		kind: "critique-sweep",
		label: "Read the session",
		blurb: "Marks the moments an examiner would flag — strengths included — each quoting the line it is about.",
		icon: "sweep",
	},
	{
		kind: "rubric-score",
		label: "Score the rubric",
		blurb:
			"Uses Judgement settings to estimate supported dimensions with citations; uncertain dimensions stay unscored.",
		icon: "measure",
	},
];

export interface ReviewDeskProps {
	data: TrajectoryReviewWorkspaceData;
	callbacks: TrajectoryReviewWorkspaceCallbacks;
	activeTarget: TrajectoryReviewTarget;
	passes?: TrajectoryPassState;
	passCallbacks?: TrajectoryPassCallbacks;
	tab?: DeskTab;
	onTabChange?: (tab: DeskTab) => void;
	onOpenCandidates?: () => void;
	onCollapse?: () => void;
	rewrites?: ReactNode;
	className?: string;
}

function Rating({
	name,
	label,
	hint,
	value,
	proposed,
	onChange,
}: {
	name: string;
	label: string;
	hint?: string;
	value?: ReviewRating;
	proposed?: ReviewRating;
	onChange: (value: ReviewRating) => void;
}) {
	const tip = useChartTooltip();
	return (
		<fieldset className="rv-desk-rating">
			<legend>{label}</legend>
			{hint && <small>{hint}</small>}
			<div>
				{([1, 2, 3, 4, 5] as const).map((rating) => (
					<label key={rating}>
						<input
							{...tip.bind(ratingLabel(rating))} tabIndex={undefined}
							type="radio"
							name={name}
							checked={rating === value}
							aria-label={`${rating} · ${ratingLabel(rating)}${proposed === rating ? " · proposed" : ""}`}
							onChange={() => onChange(rating)}
						/>
						<span data-proposed={rating === proposed || undefined}>{rating}</span>
					</label>
				))}
			</div>
			{tip.tooltip}
			{value && <small>{ratingLabel(value)}</small>}
		</fieldset>
	);
}

export function ReviewDesk({
	data,
	callbacks,
	activeTarget,
	passes,
	passCallbacks,
	tab,
	onTabChange,
	onCollapse,
	onOpenCandidates,
	rewrites,
	className = "",
}: ReviewDeskProps) {
	const { review, annotations, annotationDraft, candidates, modelPools, busy } = data;
	const [localTab, setLocalTab] = useState<DeskTab>("notes");
	const selectedTab = tab ?? localTab;
	const [phone, setPhone] = useState(false);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 767px)");
		const sync = () => setPhone(query.matches);
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);
	const allowMotion = useMotionAllowed();
	const root = useRef<HTMLElement>(null);
	const applied = useRef(false);
	const oldNotes = useRef(annotations.length);
	useEffect(() => {
		const count = root.current?.querySelector<HTMLElement>("#rv-notes-tab .k-count");
		if (count && allowMotion && annotations.length > oldNotes.current) animate(count, { scale: [1.55, 1] }, SPRING);
		oldNotes.current = annotations.length;
	}, [annotations.length, allowMotion]);
	useEffect(() => {
		if (!applied.current || passes?.rubric) return;
		applied.current = false;
		const scores = root.current?.querySelectorAll<HTMLElement>(".rv-desk-rating input:checked + span");
		if (allowMotion && scores?.length) {
			const animation = animate(
				Array.from(scores),
				{ scale: [0.65, 1], opacity: [0.4, 1] },
				{ ...SPRING, delay: stagger(0.09) },
			);
			return () => animation.stop();
		}
	}, [passes?.rubric, allowMotion]);

	const ordered = orderReviewNotes(annotations, data.messages);
	const turnNumbers = new Map(data.messages.map((message) => [message.id, message.ordinal + 1]));
	const proposals = [...(passes?.critique ?? [])].sort(
		(a, b) =>
			(turnNumbers.get(a.messageId ?? "") ?? Infinity) - (turnNumbers.get(b.messageId ?? "") ?? Infinity) ||
			(a.anchor?.start ?? -1) - (b.anchor?.start ?? -1),
	);
	const rewriteCount = candidates.filter((c) => c.targetKey === data.activeTargetKey).length;
	const contrastRecords =
		annotations.filter((a) => a.note.trim()).length + Object.keys(review.selectedCandidateIds).length;
	const scored = PEDAGOGY_RUBRIC_KEYS.filter((key) => review.ratings[key]).length;
	const passOptions: SocraticPassOption[] = [
		...PASS_OPTIONS,
		{
			kind: "annotation-expand",
			label: "Finish this note",
			icon: "expand",
			blurb: "Takes the note you are writing and fills in its impact and a concrete alternative.",
			disabled: !annotationDraft?.note.trim(),
			disabledReason: annotationDraft ? "Write the note first." : "Open a note to use this.",
		},
	];
	const updateReview = (patch: Partial<TrajectoryReview>) =>
		callbacks.onReviewChange({ ...review, ...patch, updatedAt: Date.now() });
	const editor = annotationDraft && (
		<AnnotationEditor
			key={annotationDraft.id ?? annotationDraft.targetKey}
			draft={annotationDraft}
			turnNumber={"messageId" in annotationDraft.target ? turnNumbers.get(annotationDraft.target.messageId) : undefined}
			onChange={callbacks.onAnnotationDraftChange}
			onSave={callbacks.onSaveAnnotation}
			onCancel={callbacks.onCancelAnnotation}
			autoFocus
			isSaving={busy?.saving}
			isExpanding={passes?.running === "annotation-expand"}
			onExpand={passes && passCallbacks ? () => passCallbacks.onRunPass("annotation-expand") : undefined}
		/>
	);
	return (
		<aside ref={root} className={`rv-desk ${className}`} aria-label="Review Desk">
			<header className="rv-desk-heading k-halftone">
				<h2>The Margin</h2>
				{onCollapse && <IconButton label="Collapse review desk" glyph="panelr" size="sm" onClick={onCollapse} />}
			</header>
			<div className="rv-desk-scroll">
				<Tabs
					label="The Margin"
					className="rv-desk-tabs"
					stretch
					value={`rv-${selectedTab}`}
					items={[
						{ id: "rv-notes", label: "Notes", count: annotations.length },
						{ id: "rv-rubric", label: "Rubric", count: `${scored}/${PEDAGOGY_RUBRIC_KEYS.length}` },
						{ id: "rv-rewrites", label: "Rewrites", count: rewriteCount },
					]}
					onChange={(id) => {
						const next = id.slice(3) as DeskTab;
						setLocalTab(next);
						onTabChange?.(next);
					}}
				/>
				{passes && passCallbacks && (
					<SocraticPass
						options={passOptions}
						pools={modelPools}
						poolId={data.activeModelPoolId ?? modelPools[0]?.id ?? ""}
						onPoolChange={callbacks.onSelectModelPool}
						running={passes.running}
						onRun={passCallbacks.onRunPass}
						onCancel={passCallbacks.onCancelPass}
						footnote={passes.footnote}
					/>
				)}
				{passes?.error && (
					<div role="alert" className="rv-desk-error">
						{passes.error}
						<IconButton label="Dismiss pass error" size="sm" glyph="x" onClick={passCallbacks?.onDismissPassError} />
					</div>
				)}
				{data.error && (
					<div role="alert" className="rv-desk-error">
						{data.error}
					</div>
				)}
				<TabPanel id={phone ? "rv-phone-notes" : "rv-notes"} active={selectedTab === "notes"} className="rv-desk-panel">
					{editor && !phone && <div className="rv-desk-editor">{editor}</div>}
					<AnimatePresence initial={false}>{proposals.length > 0 && passCallbacks && (
						<motion.div key="critique-proposals" exit={allowMotion ? { opacity: 0, height: 0, overflow: "hidden" } : undefined} transition={{ duration: allowMotion ? .16 : 0 }}>
						<CritiqueProposals
							proposals={proposals}
							onAccept={passCallbacks.onAcceptProposal}
							onDismiss={passCallbacks.onDismissProposal}
							onDismissAll={passCallbacks.onDismissAllProposals}
							onReveal={passCallbacks.onRevealProposal}
							busy={busy?.saving}
						/>
						</motion.div>
					)}</AnimatePresence>
					<div className="rv-desk-line">
						<span>{annotations.length} on this session</span>
						{!annotationDraft && (
							<Button size="sm" variant="ghost" glyph="plus" onClick={() => callbacks.onStartAnnotation(activeTarget)}>
								Add note
							</Button>
						)}
					</div>
					<ul className="rv-desk-cards">
						{ordered.map((note, i) => {
							const current = note.id === data.activeAnnotationId;
							const turn = "messageId" in note.target && turnNumbers.get(note.target.messageId);
							return (
								<motion.li
									key={note.id}
									className="rv-desk-card"
									data-kind={note.kind}
									data-current={current || undefined}
									initial={false}
									animate={allowMotion ? { y: [5, 0] } : undefined}
									transition={{ duration: DURATION.quick, ease: EASE }}
								>
									<div className="rv-desk-line">
										<button
											type="button"
											className="rv-desk-card-title"
											aria-label={`Edit note ${i + 1}: ${annotationKindLabel(note.kind)}`}
											onClick={() => callbacks.onEditAnnotation(note)}
										>
											<span className="rv-desk-number">{i + 1}</span>
											<i className={`rv-kind rv-${note.kind}`} aria-hidden="true" />
											<b>{annotationKindLabel(note.kind)}</b>
										</button>
										<small>
											{[note.severity && severityLabel(note.severity), note.category, turn && `turn ${turn}`]
												.filter(Boolean)
												.join(" · ")}
										</small>
										{current && (
											<>
												<IconButton
													glyph="edit"
													size="sm"
													label={`Edit note ${i + 1}`}
													onClick={() => callbacks.onEditAnnotation(note)}
												/>
												<IconButton
													glyph="trash"
													size="sm"
													label={`Delete note ${i + 1}`}
													onClick={() => callbacks.onDeleteAnnotation(note.id)}
												/>
											</>
										)}
									</div>
									<button className="rv-desk-read" type="button" onClick={() => callbacks.onEditAnnotation(note)}>
										<q>{reviewTargetLabel(note.target).replace(/^“|”$/g, "")}</q>
										<span>{note.note}</span>
									</button>
								</motion.li>
							);
						})}
					</ul>
					{selectedTab === "notes" && !ordered.length && !proposals.length && !editor && (
						<EmptyState glyph="pen" heading="Select a line in the transcript, or add a note on the active target." />
					)}
				</TabPanel>
				<TabPanel
					id={phone ? "rv-phone-rubric" : "rv-rubric"}
					active={selectedTab === "rubric"}
					className="rv-desk-panel"
				>
					<div className="rv-desk-line">
						<b>Pedagogy rubric</b>
						<small>1 poor · 5 excellent</small>
					</div>
					<details data-glyph-host className="rv-desk-details"><summary>Rubric scoring status</summary>
						<StateGrid label="Rubric dimensions" states={{ ok: "Scored", warn: "Proposed", bad: "Unscored" }}
							columns={6} data={PEDAGOGY_RUBRIC_KEYS.map(key => ({ label: RUBRIC_LABELS[key],
								state: review.ratings[key] ? "ok" : passes?.rubric?.ratings.some(r => r.key === key) ? "warn" : "bad" }))}/>
					</details>
					{review.rubricJudgement && (
						<p>
							{review.rubricJudgement.calibrated ? "Applied model estimate" : "Applied uncalibrated estimate"}
							{` · ${review.rubricJudgement.backend.backend}/${review.rubricJudgement.backend.model}. Original evidence is retained; your edits remain separate from that estimate.`}
						</p>
					)}
					{passes?.rubric && passCallbacks && (
						<RubricProposal
							proposal={passes.rubric}
							busy={busy?.saving}
							onDismiss={passCallbacks.onDismissRubric}
							onApply={(proposal) => {
								applied.current = true;
								passCallbacks.onApplyRubric(proposal);
							}}
						/>
					)}
					{PEDAGOGY_RUBRIC_KEYS.map((key) => (
						<Rating
							key={key}
							name={`rubric-${key}`}
							label={RUBRIC_LABELS[key]}
							hint={RUBRIC_HINTS[key]}
							value={review.ratings[key]}
							proposed={passes?.rubric?.ratings.find((r) => r.key === key)?.rating}
							onChange={(rating) => updateReview({ ratings: { ...review.ratings, [key]: rating } })}
						/>
					))}
					<Rating
						name="rubric-overall"
						label="Overall"
						value={review.overallRating}
						proposed={passes?.rubric?.overallRating}
						onChange={(overallRating) => updateReview({ overallRating })}
					/>
					<div>
						<b>Verdict</b>
						<Segmented
							size="sm"
							label="Review verdict"
							value={review.verdict}
							options={(["accepted", "review", "rejected", "undecided"] as const).map((value) => ({
								value,
								label: verdictLabel(value),
							}))}
							onChange={(verdict) => updateReview({ verdict })}
						/>
					</div>
					<label className="rv-desk-summary">
						Review summary
						<textarea
							value={review.summary ?? ""}
							placeholder="What worked, what failed, and the next teaching move."
							onChange={(e) => updateReview({ summary: e.currentTarget.value })}
						/>
					</label>
					<p>
						Rubric scoring uses your independent{" "}
						<a href="/chat?settings=judgement" target="_blank" rel="noopener noreferrer">
							Judgement settings
						</a>
						.
					</p>
				</TabPanel>
				<TabPanel
					id={phone ? "rv-phone-rewrites" : "rv-rewrites"}
					aria-labelledby={phone ? "rv-phone-notes-tab" : "rv-rewrites-tab"}
					active={selectedTab === "rewrites"}
					className="rv-desk-panel"
				>
					{selectedTab === "rewrites" && <div className="rv-desk-rewrites">{rewrites}</div>}
					<Button variant="ghost" size="sm" glyph="right" onClick={onOpenCandidates}>
						Open side by side in Model results
					</Button>
					<details className="rv-desk-details">
						<summary>Edit pools ({modelPools.length})</summary>
						<ModelPoolEditor
							pools={modelPools}
							availableModels={data.availableModels}
							activePoolId={data.activeModelPoolId}
							onSelectPool={callbacks.onSelectModelPool}
							onChange={callbacks.onModelPoolChange}
							onAddModel={callbacks.onAddModel}
							onRemoveModel={callbacks.onRemoveModel}
							onCreatePool={callbacks.onCreateModelPool}
							onDeletePool={callbacks.onDeleteModelPool}
						/>
					</details>
				</TabPanel>
				<footer>{contrastRecords} contrast records produced this session</footer>
			</div>
			{editor &&
				phone &&
				createPortal(
					<Sheet
						open
						onClose={callbacks.onCancelAnnotation}
						title={`${annotationDraft?.id ? "Edit note" : "New note"}${annotationDraft && "messageId" in annotationDraft.target ? " · Turn " + turnNumbers.get(annotationDraft.target.messageId) : ""}`}
						side="bottom"
						className="rv-desk-sheet"
					>
						{editor}
					</Sheet>,
					document.body,
				)}
		</aside>
	);
}
