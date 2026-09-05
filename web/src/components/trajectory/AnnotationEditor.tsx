import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { AnnotationKind, ReviewSeverity, TrajectoryReviewTarget } from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { eyebrow } from "../../../styled-system/recipes";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { annotationKindColor, reviewTargetLabel } from "./review-vocabulary";
import { compactButtonClass, inputClass, metaTextClass, primaryButtonClass, sectionHeadingClass, textareaClass } from "./styles";
import type { TrajectoryAnnotationDraft } from "./types";

const KIND_OPTIONS: Array<{ value: AnnotationKind; label: string }> = [
	{ value: "problem", label: "Problem" },
	{ value: "strength", label: "Strength" },
	{ value: "suggestion", label: "Suggestion" },
];

const CATEGORY_SUGGESTIONS = [
	"Diagnosis",
	"Factual accuracy",
	"Scaffolding",
	"Adaptation",
	"Learner agency",
	"Verification",
	"Clarity",
	"Tool use",
	"Artifact quality",
	"Safety",
];

/** The four fields a note can grow, once the teacher has said why it matters. */
type OptionalField = "category" | "severity" | "impact" | "alternative";

const OPTIONAL_LABELS: Record<OptionalField, string> = {
	category: "category",
	severity: "severity",
	impact: "impact",
	alternative: "alternative",
};

function targetQuote(target: TrajectoryReviewTarget): string | undefined {
	if (target.kind === "message-span" || target.kind === "artifact-span") return target.anchor.quote;
	return undefined;
}

/** Fields that already carry text open on mount; the rest wait to be asked for. */
function initiallyOpen(draft: TrajectoryAnnotationDraft): OptionalField[] {
	const open: OptionalField[] = [];
	if (draft.category.trim()) open.push("category");
	if (draft.severity) open.push("severity");
	if (draft.pedagogicalImpact?.trim()) open.push("impact");
	if (draft.suggestedAlternative?.trim() || draft.revision) open.push("alternative");
	return open;
}

const fieldLabelClass = css({
	display: "block",
	marginBottom: "0.375rem",
	fontSize: "0.75rem",
	fontWeight: 650,
	color: "var(--foreground)",
});

const addChipClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.2rem",
	borderRadius: "0.25rem",
	border: "1px dashed var(--border)",
	background: "transparent",
	paddingInline: "0.4rem",
	paddingBlock: "0.15rem",
	fontSize: "0.6875rem",
	fontWeight: 600,
	color: "var(--muted-foreground)",
	_hover: { borderStyle: "solid", borderColor: "var(--ink)", color: "var(--foreground)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});

export interface AnnotationEditorProps {
	draft: TrajectoryAnnotationDraft;
	onChange: (draft: TrajectoryAnnotationDraft) => void;
	onSave: (draft: TrajectoryAnnotationDraft) => void;
	onCancel: () => void;
	isSaving?: boolean;
	/**
	 * Runs the annotation-expansion pass on the note as typed. Omitted when no
	 * model is configured, in which case the affordance does not render at all.
	 */
	onExpand?: () => void;
	isExpanding?: boolean;
	/** Focus the note on mount. Set when the editor opens as an anchored popover. */
	autoFocus?: boolean;
}

export function AnnotationEditor({
	draft,
	onChange,
	onSave,
	onCancel,
	isSaving,
	onExpand,
	isExpanding,
	autoFocus,
}: AnnotationEditorProps) {
	const fieldId = useId();
	const [opened, setOpened] = useState<OptionalField[]>(() => initiallyOpen(draft));
	// The note is the only field a teacher must supply. Category is inferable from
	// the note and defaulted on save; demanding it up front taxed every note for the
	// benefit of a field a model can fill.
	const canSave = draft.note.trim().length > 0 && !isSaving;
	const quote = targetQuote(draft.target);
	const revising = Boolean(draft.revision);

	const isOpen = (field: OptionalField) => opened.includes(field);
	const open = (field: OptionalField) => setOpened((current) => (current.includes(field) ? current : [...current, field]));
	const closed = (Object.keys(OPTIONAL_LABELS) as OptionalField[]).filter((field) => !isOpen(field));

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (canSave) onSave(draft);
	}

	function saveShortcut(event: KeyboardEvent<HTMLFormElement>) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSave) {
			event.preventDefault();
			onSave(draft);
		}
	}

	function optionalSection(field: OptionalField, content: ReactNode) {
		if (!isOpen(field)) return null;
		return <div key={field}>{content}</div>;
	}

	return (
		<form onSubmit={submit} onKeyDown={saveShortcut} className={css({ display: "flex", flexDirection: "column", gap: "0.75rem" })}>
			<div className={css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" })}>
				<div>
					<div className={sectionHeadingClass}>
						{draft.id ? "Edit annotation" : revising ? "Revise this text" : "New annotation"}
					</div>
				<div className={cx(metaTextClass, css({ marginTop: "0.125rem" }))}>{reviewTargetLabel(draft.target, "editor")}</div>
				</div>
				<button type="button" className={compactButtonClass} onClick={onCancel}>
					<KeatingIcon icon={reviewIcon.dismiss} size={13} /> Cancel
				</button>
			</div>

			{quote && !revising ? (
				<blockquote className={css({ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "0.5rem", borderLeft: "2px solid var(--accent-dim)", background: "var(--muted)", padding: "0.625rem", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--foreground)" })}>
					<KeatingIcon icon={reviewIcon.quote} size={13} className={css({ marginTop: "0.125rem", color: "var(--ink-soft)" })} />
					<span className={css({ display: "block", maxHeight: "4.4rem", overflow: "auto", whiteSpace: "pre-wrap" })}>{quote}</span>
				</blockquote>
			) : null}

			{/* A revision is only worth recording as a contrast, so the original stays
			    on screen next to the replacement rather than being written over. */}
			{revising && draft.revision ? (
				<div className={css({ display: "grid", gap: "0.25rem", fontSize: "0.75rem" })}>
					<span className={css({ borderRadius: "0.25rem", background: "color-mix(in srgb, var(--destructive) 12%, transparent)", padding: "0.3rem 0.45rem", color: "var(--muted-foreground)", textDecoration: "line-through", textDecorationColor: "var(--destructive)" })}>
						{draft.revision.original}
					</span>
				</div>
			) : null}

			<fieldset>
				<legend className={css({ marginBottom: "0.375rem", fontSize: "0.75rem", fontWeight: 650, color: "var(--foreground)" })}>Signal</legend>
				<div className={css({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.25rem" })}>
					{KIND_OPTIONS.map((option) => {
						const selected = draft.kind === option.value;
						return (
							<label
								key={option.value}
								className={css({
									cursor: "pointer",
									borderRadius: "0.375rem",
									border: "1px solid",
									borderColor: selected ? "var(--ink)" : "var(--border)",
									background: selected ? "var(--ink)" : "var(--background)",
									padding: "0.375rem 0.25rem",
									textAlign: "center",
									fontSize: "0.6875rem",
									fontWeight: 650,
									color: selected ? "var(--paper)" : "var(--foreground)",
									_focusWithin: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
								})}
								style={selected ? { borderColor: annotationKindColor(option.value) } : undefined}
							>
								<input
									type="radio"
									name="annotation-kind"
									value={option.value}
									checked={selected}
									className={css({ position: "absolute", opacity: 0, pointerEvents: "none" })}
									onChange={() => onChange({ ...draft, kind: option.value })}
								/>
								{option.label}
							</label>
						);
					})}
				</div>
			</fieldset>

			{/* The one field the record cannot do without. */}
			<div>
				<label htmlFor={`${fieldId}-note`} className={fieldLabelClass}>
					Why does this matter?
				</label>
				<textarea
					id={`${fieldId}-note`}
					value={draft.note}
					className={textareaClass}
					autoFocus={autoFocus}
					placeholder="Describe the evidence and why it matters."
					onChange={(event) => onChange({ ...draft, note: event.currentTarget.value })}
				/>
			</div>

			{optionalSection("category", (
				<>
					<label htmlFor={`${fieldId}-category`} className={fieldLabelClass}>Category</label>
					<input
						id={`${fieldId}-category`}
						list={`${fieldId}-categories`}
						value={draft.category}
						className={inputClass}
						placeholder="Choose or type a category"
						onChange={(event) => onChange({ ...draft, category: event.currentTarget.value })}
					/>
					<datalist id={`${fieldId}-categories`}>
						{CATEGORY_SUGGESTIONS.map((category) => <option key={category} value={category} />)}
					</datalist>
				</>
			))}

			{optionalSection("severity", (
				<fieldset>
					<legend className={cx(fieldLabelClass, css({ marginBottom: "0.375rem" }))}>Severity</legend>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
						{([1, 2, 3, 4] as ReviewSeverity[]).map((severity) => (
							<label key={severity} className={css({ cursor: "pointer" })}>
								<input
									type="radio"
									name="annotation-severity"
									value={severity}
									checked={draft.severity === severity}
									className={css({ position: "absolute", opacity: 0, pointerEvents: "none" })}
									onChange={() => onChange({ ...draft, severity })}
								/>
								<span className={css({ display: "inline-flex", width: "2rem", height: "2rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", border: "1px solid", borderColor: draft.severity === severity ? "var(--ink)" : "var(--border)", background: draft.severity === severity ? "var(--ink)" : "var(--background)", fontSize: "0.75rem", fontWeight: 700, color: draft.severity === severity ? "var(--paper)" : "var(--foreground)", _focusWithin: { outline: "3px solid var(--accent)", outlineOffset: "1px" } })}>
									{severity}
								</span>
							</label>
						))}
						{draft.severity ? (
							<button
								type="button"
								className={css({ marginLeft: "0.25rem", fontSize: "0.6875rem", color: "var(--muted-foreground)", textDecoration: "underline", _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } })}
								onClick={() => onChange({ ...draft, severity: undefined })}
							>
								Clear
							</button>
						) : null}
					</div>
				</fieldset>
			))}

			{optionalSection("impact", (
				<>
					<label htmlFor={`${fieldId}-impact`} className={fieldLabelClass}>Pedagogical impact</label>
					<textarea
						id={`${fieldId}-impact`}
						value={draft.pedagogicalImpact ?? ""}
						className={textareaClass}
						placeholder="How did this affect the learner?"
						onChange={(event) => onChange({ ...draft, pedagogicalImpact: event.currentTarget.value })}
					/>
				</>
			))}

			{optionalSection("alternative", (
				<>
					<label htmlFor={`${fieldId}-alternative`} className={fieldLabelClass}>
						{revising ? "Replacement text" : "Suggested alternative"}
					</label>
					<textarea
						id={`${fieldId}-alternative`}
						value={draft.suggestedAlternative ?? ""}
						className={textareaClass}
						placeholder="Write the teaching move or response that would help instead."
						onChange={(event) => onChange({ ...draft, suggestedAlternative: event.currentTarget.value })}
					/>
				</>
			))}

			{closed.length > 0 || onExpand ? (
				<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.3rem" })}>
					{closed.map((field) => (
						<button key={field} type="button" className={addChipClass} onClick={() => open(field)}>
							<KeatingIcon icon={reviewIcon.add} size={11} /> {OPTIONAL_LABELS[field]}
						</button>
					))}
					{/* Writing out the impact and the alternative is the tedious half of a
					    note. The pass drafts both from what has already been typed, keeping
					    the teacher's judgement and only filling in the prose. */}
					{onExpand ? (
						<button
							type="button"
							className={cx(compactButtonClass, css({ marginLeft: "auto", minHeight: "1.75rem" }))}
							disabled={isExpanding || draft.note.trim().length === 0}
							title={draft.note.trim().length === 0 ? "Write the note first." : undefined}
							onClick={() => {
								setOpened(["category", "severity", "impact", "alternative"]);
								onExpand();
							}}
						>
							<KeatingIcon icon={reviewIcon.expand} size={13} active={isExpanding} />
							{isExpanding ? "Drafting…" : "Finish this note"}
						</button>
					) : null}
				</div>
			) : null}

			<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" })}>
				<label className={css({ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
					Status
					<select value={draft.status} className={cx(inputClass, css({ width: "auto", minHeight: "2rem", paddingInline: "0.375rem" }))} onChange={(event) => onChange({ ...draft, status: event.currentTarget.value as TrajectoryAnnotationDraft["status"] })}>
						<option value="draft">Draft</option>
						<option value="final">Final</option>
					</select>
				</label>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					<span className={cx(eyebrow(), css({ fontSize: "9px" }))}>
						{draft.authorship === "pass-drafted" ? "pass · accepted" : draft.authorship === "pass-edited" ? "pass · edited" : "human"}
					</span>
					<button type="submit" className={primaryButtonClass} disabled={!canSave}>
						<KeatingIcon icon={reviewIcon.save} size={13} /> {isSaving ? "Saving..." : draft.id ? "Update" : "Add annotation"}
					</button>
				</div>
			</div>
			<div className={metaTextClass}>Tip: press Ctrl+Enter or Command+Enter to save.</div>
		</form>
	);
}

export default AnnotationEditor;
