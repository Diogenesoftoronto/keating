import { Select } from "../Select";
import { useState } from "react";
import {
	PEDAGOGY_RUBRIC_KEYS,
	type PedagogyRubricKey,
	type ReviewRating,
	type TrajectoryReview,
	type TrajectoryReviewTarget,
} from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { eyebrow, marginNote, reviewPanel } from "../../../styled-system/recipes";
import { KeatingIcon } from "../KeatingIcon";
import { AnnotationEditor } from "./AnnotationEditor";
import { ModelPoolEditor } from "./ModelPoolEditor";
import { CritiqueProposals, RubricProposal } from "./MarginProposals";
import { reviewIcon } from "./review-icons";
import { RUBRIC_HINTS, RUBRIC_LABELS, ratingLabel, reviewTargetLabel, verdictLabel } from "./review-vocabulary";
import { SocraticPass, type SocraticPassOption } from "./SocraticPass";
import { compactButtonClass, iconButtonClass, inputClass, metaTextClass, primaryButtonClass, textareaClass } from "./styles";
import type {
	TrajectoryPassCallbacks,
	TrajectoryPassState,
	TrajectoryReviewWorkspaceCallbacks,
	TrajectoryReviewWorkspaceData,
} from "./types";

/**
 * Three sections, not four.
 *
 * The desk used to carry a fourth tab for model pools, which put provider
 * configuration at the same level as the teacher's own judgement. Pools now
 * live inside Alternatives, where they belong — they are settings for
 * generation, not a thing a reviewer reads. That leaves the strip reading as
 * the three questions a review actually answers: what did I notice, how good
 * was it, and what would have been better.
 */
type DeskTab = "margin" | "assessment" | "alternatives";


/** The four passes, in the order a review usually wants them. */
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
		blurb: "Proposes a score for all six dimensions with a reason and a citation for each.",
		icon: "measure",
	},
];

const PASS_OPTIONS_WITH_DRAFT: SocraticPassOption[] = [
	{
		kind: "annotation-expand",
		label: "Finish this note",
		blurb: "Takes the note you are writing and fills in its impact and a concrete alternative.",
		icon: "expand",
	},
	...PASS_OPTIONS,
];

const PANEL = css({ padding: "0.75rem" });

const deskSectionHeading = css({
	fontFamily: "var(--mono-body)",
	fontSize: "0.6875rem",
	fontWeight: 700,
	letterSpacing: "0.09em",
	textTransform: "uppercase",
	color: "var(--ink-soft)",
});

const fieldLabel = css({ fontSize: "0.6875rem", fontWeight: 650, color: "var(--ink)" });

function nextReview(review: TrajectoryReview, patch: Partial<TrajectoryReview>): TrajectoryReview {
	return { ...review, ...patch, updatedAt: Date.now() };
}

function RubricRating({
	name,
	label,
	hint,
	value,
	onChange,
}: {
	name: string;
	label: string;
	hint?: string;
	value?: ReviewRating;
	onChange: (rating: ReviewRating) => void;
}) {
	return (
		<fieldset
			title={hint}
			className={css({
				display: "grid",
				gridTemplateColumns: "minmax(6.5rem, 1fr) auto",
				alignItems: "center",
				gap: "0.5rem",
				borderBottom: "1px solid var(--line-soft)",
				paddingBlock: "0.5rem",
			})}
		>
			<legend className={css({ float: "left", fontSize: "0.75rem", fontWeight: 600, color: "var(--ink)" })}>{label}</legend>
			<div className={css({ display: "flex", gap: "0.2rem" })}>
				{([1, 2, 3, 4, 5] as ReviewRating[]).map((rating) => (
					<label key={rating} title={`${rating}: ${ratingLabel(rating)}`} className={css({ cursor: "pointer" })}>
						<input
							type="radio"
							name={name}
							value={rating}
							checked={value === rating}
							className={css({ position: "absolute", opacity: 0, pointerEvents: "none" })}
							onChange={() => onChange(rating)}
						/>
						<span
							className={css({
								display: "inline-flex",
								width: "1.65rem",
								height: "1.65rem",
								alignItems: "center",
								justifyContent: "center",
								borderRadius: "{radii.keating}",
								border: "1.5px solid",
								borderColor: value === rating ? "var(--ink)" : "var(--line)",
								background: value === rating ? "var(--ink)" : "var(--card)",
								boxShadow: value === rating ? "2px 2px 0 var(--ink-soft)" : "none",
								fontFamily: "var(--mono-body)",
								fontSize: "0.6875rem",
								fontWeight: 700,
								color: value === rating ? "var(--paper)" : "var(--ink-soft)",
								transitionProperty: "background-color, color, box-shadow, transform",
								transitionDuration: "{durations.fast}",
								_hover: { borderColor: "var(--ink)", transform: "translateY(-1px)" },
								_focusWithin: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
							})}
						>
							{rating}
						</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}

/**
 * A movement's header: the whole of it when collapsed.
 *
 * The summary carries live state, so the desk can answer "where is this review up
 * to" without being opened at all. That is what makes collapsing it safe rather than
 * a memory tax.
 */
function MovementHeader({
	id,
	controls,
	label,
	icon,
	state,
	badge,
	open,
	onToggle,
}: {
	id: string;
	controls: string;
	label: string;
	icon: keyof typeof reviewIcon;
	state: string;
	badge?: number;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			id={id}
			aria-controls={controls}
			aria-expanded={open}
			className={css({
				display: "flex",
				width: "100%",
				alignItems: "center",
				gap: "0.5rem",
				borderBottom: "1px solid var(--line-soft)",
				background: open ? "var(--muted)" : "transparent",
				padding: "0.55rem 0.7rem",
				fontSize: "0.75rem",
				fontWeight: 700,
				color: "var(--ink)",
				textAlign: "left",
				_hover: { background: "var(--muted)" },
				_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-2px" },
			})}
			onClick={onToggle}
		>
			<KeatingIcon icon={reviewIcon[icon]} size={14} />
			<span>{label}</span>
			{badge && badge > 0 ? (
				<span
					aria-label={`${badge} proposed`}
					className={css({
						minWidth: "1.05rem",
						borderRadius: "9999px",
						background: "var(--accent-dim)",
						paddingInline: "0.3rem",
						fontSize: "9px",
						fontWeight: 700,
						color: "var(--paper)",
						textAlign: "center",
					})}
				>
					{badge}
				</span>
			) : null}
			<span className={cx(metaTextClass, css({ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }))}>{state}</span>
		</button>
	);
}

export interface ReviewDeskProps {
	data: TrajectoryReviewWorkspaceData;
	callbacks: TrajectoryReviewWorkspaceCallbacks;
	activeTarget: TrajectoryReviewTarget;
	/** Omit to render the desk with no AI affordances at all. */
	passes?: TrajectoryPassState;
	passCallbacks?: TrajectoryPassCallbacks;
	/**
	 * True when the canvas is showing the draft anchored to its text. The desk still
	 * renders the editor for mobile, where there is no popover, but yields the
	 * desktop copy so the same form is never on screen twice.
	 */
	draftAnchored?: boolean;
	onOpenCandidates?: () => void;
	className?: string;
}

export function ReviewDesk({
	data,
	callbacks,
	activeTarget,
	passes,
	passCallbacks,
	draftAnchored,
	onOpenCandidates,
	className,
}: ReviewDeskProps) {
	// One movement open at a time. Nothing opens itself: the desk is normally
	// collapsed to its spine, and a panel that springs open while you are reading the
	// transcript is far more disruptive than one you have to ask for. What used to be
	// an auto-switch is a badge on the spine instead.
	const [openMovement, setOpenMovement] = useState<DeskTab | null>("margin");
	const { review, annotations, annotationDraft, candidates, modelPools, busy } = data;

	const orderedAnnotations = [...annotations].sort((left, right) => {
		const leftActive = left.targetKey === data.activeTargetKey ? 1 : 0;
		const rightActive = right.targetKey === data.activeTargetKey ? 1 : 0;
		return rightActive - leftActive || right.updatedAt - left.updatedAt;
	});

	const passOptions = annotationDraft?.note.trim() ? PASS_OPTIONS_WITH_DRAFT : PASS_OPTIONS;

	const scoredCount = PEDAGOGY_RUBRIC_KEYS.filter((key) => review.ratings[key]).length;
	const chosenCount = Object.keys(review.selectedCandidateIds).length;
	const marginState = annotations.length === 0 ? "empty" : `${annotations.length} note${annotations.length === 1 ? "" : "s"}`;
	const assessState = `${verdictLabel(review.verdict)} · ${scoredCount}/${PEDAGOGY_RUBRIC_KEYS.length}`;
	const rewriteState = candidates.length === 0
		? "none generated"
		: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} · ${chosenCount === 0 ? "none chosen" : `${chosenCount} chosen`}`;

	// Annotations, hand revisions, and chosen candidates are the same record in three
	// costumes: context, worse, better, why, who. Counting them together is the only
	// progress signal that reflects what this session actually produced for learning.
	const contrastRecords = annotations.filter((annotation) => annotation.note.trim().length > 0).length + chosenCount;
	const proposalCount = passes?.critique.length ?? 0;

	return (
		<aside className={cx(reviewPanel({ tone: "margin" }), css({ height: "100%" }), className)} aria-label="Review Desk">
			<header
				className={css({
					display: "flex",
					minHeight: "3.25rem",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "0.5rem",
					borderBottom: "1px solid var(--line)",
					paddingInline: "0.75rem",
				})}
			>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ fontFamily: "var(--mono-display)", fontSize: "0.8125rem", fontWeight: 700, letterSpacing: "0.01em", color: "var(--ink)" })}>
						The Margin
					</div>
					<div className={metaTextClass}>{review.status === "final" ? "Final review" : "Working draft"}</div>
				</div>
				<div className={css({ display: "flex", gap: "0.25rem" })}>
					<button
						type="button"
						className={iconButtonClass}
						aria-label={busy?.exporting ? "Exporting review" : "Export review"}
						disabled={busy?.exporting}
						onClick={callbacks.onExport}
					>
						<KeatingIcon icon={reviewIcon.export} size={15} />
					</button>
					<button type="button" className={primaryButtonClass} disabled={busy?.saving} onClick={callbacks.onSave}>
						<KeatingIcon icon={reviewIcon.save} size={14} /> {busy?.saving ? "Saving" : "Save"}
					</button>
				</div>
			</header>

			{passes && passCallbacks ? (
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
			) : null}

			{passes?.error ? (
				<div
					role="alert"
					className={css({
						display: "flex",
						alignItems: "flex-start",
						gap: "0.4rem",
						borderBottom: "1px solid color-mix(in srgb, var(--destructive) 35%, var(--line))",
						background: "color-mix(in srgb, var(--destructive) 8%, var(--paper))",
						padding: "0.55rem 0.75rem",
						fontSize: "0.72rem",
						lineHeight: 1.45,
						color: "var(--destructive)",
					})}
				>
					<KeatingIcon icon={reviewIcon.problem} size={14} className={css({ marginTop: "0.05rem" })} />
					<span className={css({ minWidth: 0, flex: 1 })}>{passes.error}</span>
					<button type="button" className={iconButtonClass} aria-label="Dismiss pass error" onClick={passCallbacks?.onDismissPassError}>
						<KeatingIcon icon={reviewIcon.dismiss} size={13} />
					</button>
				</div>
			) : null}

			{data.error ? (
				<div
					role="alert"
					className={css({
						borderBottom: "1px solid color-mix(in srgb, var(--destructive) 35%, var(--line))",
						background: "color-mix(in srgb, var(--destructive) 8%, var(--paper))",
						padding: "0.625rem 0.75rem",
						fontSize: "0.75rem",
						lineHeight: 1.4,
						color: "var(--destructive)",
					})}
				>
					{data.error}
				</div>
			) : null}

			<div className={css({ minHeight: 0, flex: 1, overflowY: "auto" })}>
				{/* ---------------------------------------------------------- Margin */}
				<MovementHeader
					id="trajectory-desk-margin-tab"
					controls="trajectory-desk-margin-panel"
					label="Margin"
					icon="annotate"
					state={marginState}
					badge={proposalCount}
					open={openMovement === "margin"}
					onToggle={() => setOpenMovement(openMovement === "margin" ? null : "margin")}
				/>
				<section
					id="trajectory-desk-margin-panel"
					role="region"
					aria-labelledby="trajectory-desk-margin-tab"
					hidden={openMovement !== "margin"}
					className={PANEL}
				>
					{annotationDraft ? (
						<div className={draftAnchored ? css({ md: { display: "none" } }) : undefined}>
							<AnnotationEditor
								draft={annotationDraft}
								onChange={callbacks.onAnnotationDraftChange}
								onSave={callbacks.onSaveAnnotation}
								onCancel={callbacks.onCancelAnnotation}
								isSaving={busy?.saving}
								onExpand={passes && passCallbacks ? () => passCallbacks.onRunPass("annotation-expand") : undefined}
								isExpanding={passes?.running === "annotation-expand"}
							/>
						</div>
					) : (
						<>
							<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
								<div>
									<div className={deskSectionHeading}>Marginalia</div>
									<div className={metaTextClass}>{annotations.length} on this session</div>
								</div>
								<button type="button" className={primaryButtonClass} onClick={() => callbacks.onStartAnnotation(activeTarget)}>
									<KeatingIcon icon={reviewIcon.add} size={13} /> Add
								</button>
							</div>

							{passes && passCallbacks && proposalCount > 0 ? (
								<div className={css({ marginTop: "0.75rem" })}>
									<CritiqueProposals
										proposals={passes.critique}
										onAccept={passCallbacks.onAcceptProposal}
										onDismiss={passCallbacks.onDismissProposal}
										onDismissAll={passCallbacks.onDismissAllProposals}
										onReveal={passCallbacks.onRevealProposal}
										busy={busy?.saving}
									/>
								</div>
							) : null}

							{orderedAnnotations.length > 0 ? (
								<ul className={css({ marginTop: "0.75rem", display: "grid", gap: "0.4rem" })}>
									{orderedAnnotations.map((annotation) => (
										<li
											key={annotation.id}
											className={cx(
												marginNote({ kind: annotation.kind, state: "saved" }),
												css({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "0.375rem", alignItems: "start" }),
											)}
										>
											<button
												type="button"
												aria-current={annotation.id === data.activeAnnotationId ? "true" : undefined}
												className={css({
													minWidth: 0,
													borderRadius: "{radii.keating}",
													textAlign: "left",
													cursor: "pointer",
													_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
												})}
												onClick={() => callbacks.onEditAnnotation(annotation)}
											>
												<span className={css({ display: "flex", alignItems: "center", gap: "0.375rem" })}>
													<span className={cx(eyebrow(), css({ fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }))}>
														{annotation.category}
													</span>
													{annotation.targetKey === data.activeTargetKey ? (
														<span className={css({ borderRadius: "9999px", background: "color-mix(in srgb, var(--ink) 10%, transparent)", padding: "0.1rem 0.35rem", fontSize: "0.5625rem", fontWeight: 700, color: "var(--ink-soft)" })}>
															Current
														</span>
													) : null}
												</span>
												<span className={css({ display: "block", marginTop: "0.2rem", maxHeight: "2.4rem", overflow: "hidden", fontSize: "0.72rem", lineHeight: 1.4, color: "var(--ink)" })}>
													{annotation.note}
												</span>
												<span className={cx(metaTextClass, css({ display: "block", marginTop: "0.2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }))}>
													{reviewTargetLabel(annotation.target)}
												</span>
											</button>
											<button
												type="button"
												className={iconButtonClass}
												aria-label={`Delete ${annotation.category} annotation`}
												onClick={() => callbacks.onDeleteAnnotation(annotation.id)}
											>
												<KeatingIcon icon={reviewIcon.discard} size={13} />
											</button>
										</li>
									))}
								</ul>
							) : proposalCount === 0 ? (
								<div className={css({ display: "grid", minHeight: "10rem", placeItems: "center", padding: "1rem", textAlign: "center", fontSize: "0.75rem", color: "var(--ink-soft)" })}>
									<div>
										<KeatingIcon icon={reviewIcon.quote} size={22} className={css({ marginInline: "auto", marginBottom: "0.5rem" })} />
										Select a line in the transcript, or add a note on the active target.
									</div>
								</div>
							) : null}
						</>
					)}
				</section>

				{/* ------------------------------------------------------ Assessment */}
				<MovementHeader
					id="trajectory-desk-assessment-tab"
					controls="trajectory-desk-assessment-panel"
					label="Assess"
					icon="rubric"
					state={assessState}
					open={openMovement === "assessment"}
					onToggle={() => setOpenMovement(openMovement === "assessment" ? null : "assessment")}
				/>
				<section
					id="trajectory-desk-assessment-panel"
					role="region"
					aria-labelledby="trajectory-desk-assessment-tab"
					hidden={openMovement !== "assessment"}
					className={PANEL}
				>
					{passes?.rubric && passCallbacks ? (
						<div className={css({ marginBottom: "0.85rem" })}>
							<RubricProposal
								proposal={passes.rubric}
								onApply={passCallbacks.onApplyRubric}
								onDismiss={passCallbacks.onDismissRubric}
								busy={busy?.saving}
							/>
						</div>
					) : null}

					<div className={css({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "0.5rem" })}>
						<label className={fieldLabel}>
							Verdict
							<Select aria-label="Review verdict"
								value={review.verdict}
								className={cx(inputClass, css({ marginTop: "0.25rem" }))}
								onValueChange={(value) => callbacks.onReviewChange(nextReview(review, { verdict: value as TrajectoryReview["verdict"] }))}
							>
								<option value="undecided">Undecided</option>
								<option value="accepted">Accepted</option>
								<option value="review">Needs revision</option>
								<option value="rejected">Rejected</option>
							</Select>
						</label>
						<label className={fieldLabel}>
							Status
							<Select aria-label="Review status"
								value={review.status}
								className={cx(inputClass, css({ marginTop: "0.25rem" }))}
								onValueChange={(value) => callbacks.onReviewChange(nextReview(review, { status: value as TrajectoryReview["status"] }))}
							>
								<option value="draft">Draft</option>
								<option value="final">Final</option>
							</Select>
						</label>
					</div>

					<div className={css({ marginTop: "1rem" })}>
						<div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between" })}>
							<div className={deskSectionHeading}>Pedagogy rubric</div>
							<div className={metaTextClass}>1 poor · 5 excellent</div>
						</div>
						<div className={css({ marginTop: "0.25rem" })}>
							{PEDAGOGY_RUBRIC_KEYS.map((key: PedagogyRubricKey) => (
								<RubricRating
									key={key}
									name={`rubric-${key}`}
									label={RUBRIC_LABELS[key]}
									hint={RUBRIC_HINTS[key]}
									value={review.ratings[key]}
									onChange={(rating) => callbacks.onReviewChange(nextReview(review, { ratings: { ...review.ratings, [key]: rating } }))}
								/>
							))}
							<RubricRating
								name="rubric-overall"
								label="Overall"
								value={review.overallRating}
								onChange={(rating) => callbacks.onReviewChange(nextReview(review, { overallRating: rating }))}
							/>
						</div>
					</div>

					<label className={cx(fieldLabel, css({ display: "block", marginTop: "1rem" }))}>
						Review summary
						<textarea
							value={review.summary ?? ""}
							className={cx(textareaClass, css({ marginTop: "0.375rem", minHeight: "7rem" }))}
							placeholder="What worked, what failed, and the next teaching move."
							onChange={(event) => callbacks.onReviewChange(nextReview(review, { summary: event.currentTarget.value }))}
						/>
					</label>
				</section>

				{/* ---------------------------------------------------- Alternatives */}
				<MovementHeader
					id="trajectory-desk-alternatives-tab"
					controls="trajectory-desk-alternatives-panel"
					label="Rewrite"
					icon="alternatives"
					state={rewriteState}
					open={openMovement === "alternatives"}
					onToggle={() => setOpenMovement(openMovement === "alternatives" ? null : "alternatives")}
				/>
				<section
					id="trajectory-desk-alternatives-panel"
					role="region"
					aria-labelledby="trajectory-desk-alternatives-tab"
					hidden={openMovement !== "alternatives"}
					className={PANEL}
				>
					<div className={css({ display: "grid", gap: "0.625rem", border: "1px solid var(--line)", borderRadius: "0.5rem", padding: "0.75rem" })}>
						<div>
							<div className={deskSectionHeading}>Model results</div>
							<div className={cx(metaTextClass, css({ marginTop: "0.2rem" }))}>{rewriteState}. Compare full responses in the main page.</div>
						</div>
						<button type="button" className={primaryButtonClass} onClick={onOpenCandidates}>
							<KeatingIcon icon={reviewIcon.alternatives} size={13} /> Open model results
						</button>
					</div>

					{/* Pools are settings for the panel above, so they fold away under it
					    rather than claiming a tab of their own. */}
					<details className={css({ marginTop: "1rem", borderTop: "1px solid var(--line)", paddingTop: "0.75rem" })}>
						<summary
							className={cx(
								compactButtonClass,
								css({ width: "100%", justifyContent: "space-between", cursor: "pointer", listStyle: "none", "&::-webkit-details-marker": { display: "none" } }),
							)}
						>
							<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.4rem" })}>
								<KeatingIcon icon={reviewIcon.settings} size={13} />
								Model pools
							</span>
							<span className={cx(eyebrow(), css({ fontSize: "10px" }))}>{modelPools.length}</span>
						</summary>
						<div className={css({ marginTop: "0.75rem" })}>
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
						</div>
					</details>
				</section>
			</div>

			<footer
				className={css({
					display: "flex",
					alignItems: "baseline",
					gap: "0.45rem",
					borderTop: "1px solid var(--line)",
					background: "var(--paper, var(--background))",
					padding: "0.55rem 0.7rem",
				})}
			>
				<span className={css({ fontFamily: "var(--mono-display, inherit)", fontSize: "1.35rem", fontWeight: 700, color: "var(--accent-dim)", fontVariantNumeric: "tabular-nums" })}>
					{contrastRecords}
				</span>
				<span className={cx(eyebrow(), css({ fontSize: "9px", lineHeight: 1.3 }))}>
					contrast records
					<br />
					produced this session
				</span>
			</footer>
		</aside>
	);
}
