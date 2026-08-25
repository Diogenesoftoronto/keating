import { css, cx } from "../../../styled-system/css";
import { eyebrow, marginNote } from "../../../styled-system/recipes";
import type { CritiqueProposal, RubricSweepProposal } from "../../keating/trajectory-passes";
import { PEDAGOGY_RUBRIC_KEYS } from "../../keating/trajectory-review";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { RUBRIC_LABELS, annotationKindLabel, ratingLabel, severityLabel, verdictLabel } from "./review-vocabulary";

const groupHead = css({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.5rem",
	marginBottom: "0.4rem",
});

const quiet = css({ fontSize: "0.7rem", lineHeight: 1.45, color: "var(--ink-soft)" });

const proposalActions = css({
	display: "flex",
	alignItems: "center",
	gap: "0.25rem",
	flexShrink: 0,
});

const ghostButton = css({
	display: "inline-flex",
	width: "1.75rem",
	height: "1.75rem",
	flexShrink: 0,
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "{radii.keating}",
	color: "var(--ink-soft)",
	cursor: "pointer",
	transitionProperty: "background-color, color",
	transitionDuration: "{durations.base}",
	_hover: { background: "color-mix(in srgb, var(--ink) 8%, transparent)", color: "var(--ink)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});

const textButton = css({
	fontFamily: "var(--mono-body)",
	fontSize: "10px",
	fontWeight: 600,
	letterSpacing: "0.09em",
	textTransform: "uppercase",
	color: "var(--ink-soft)",
	cursor: "pointer",
	_hover: { color: "var(--ink)", textDecoration: "underline" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
});

/** A quote the pass cited, or an honest admission that it could not cite one. */
function Citation({ quote, anchored }: { quote?: string; anchored: boolean }) {
	if (anchored && quote) {
		return (
			<blockquote className={css({
				marginTop: "0.35rem",
				borderInlineStart: "2px solid var(--line)",
				paddingInlineStart: "0.45rem",
				fontSize: "0.7rem",
				lineHeight: 1.45,
				fontStyle: "italic",
				color: "var(--ink-soft)",
			})}>
				{quote.length > 180 ? `${quote.slice(0, 177)}…` : quote}
			</blockquote>
		);
	}
	return (
		<p className={cx(quiet, css({ marginTop: "0.3rem", display: "flex", alignItems: "center", gap: "0.3rem" }))}>
			<KeatingIcon icon={reviewIcon.problem} size={12} />
			Unanchored — no matching quote in that turn.
		</p>
	);
}

export interface CritiqueProposalsProps {
	proposals: CritiqueProposal[];
	onAccept: (proposal: CritiqueProposal) => void;
	onDismiss: (id: string) => void;
	onDismissAll: () => void;
	onReveal?: (proposal: CritiqueProposal) => void;
	busy?: boolean;
}

/**
 * Draft marginalia from a critique sweep.
 *
 * Everything here is dashed and unaccepted: the pass may propose, but only a
 * teacher's click turns a proposal into a note on the record.
 */
export function CritiqueProposals({ proposals, onAccept, onDismiss, onDismissAll, onReveal, busy }: CritiqueProposalsProps) {
	if (proposals.length === 0) return null;

	return (
		<section aria-label="Proposed notes">
			<div className={groupHead}>
				<span className={eyebrow()}>Proposed · {proposals.length}</span>
				<button type="button" className={textButton} onClick={onDismissAll}>Dismiss all</button>
			</div>

			<ul className={css({ display: "grid", gap: "0.4rem" })}>
				{proposals.map((proposal) => (
					<li key={proposal.id} className={marginNote({ kind: proposal.kind, state: "proposed" })}>
						<div className={css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" })}>
							<div className={css({ minWidth: 0 })}>
								<span className={cx(eyebrow(), css({ fontSize: "10px" }))}>
									{annotationKindLabel(proposal.kind)}
									{proposal.severity ? ` · ${severityLabel(proposal.severity)}` : ""}
									{proposal.category ? ` · ${proposal.category}` : ""}
								</span>
								<p className={css({ marginTop: "0.2rem", color: "var(--ink)" })}>{proposal.note}</p>
							</div>
							<div className={proposalActions}>
								<button
									type="button"
									className={ghostButton}
									aria-label="Accept this note"
									disabled={busy}
									onClick={() => onAccept(proposal)}
								>
									<KeatingIcon icon={reviewIcon.accept} size={14} />
								</button>
								<button
									type="button"
									className={ghostButton}
									aria-label="Dismiss this note"
									onClick={() => onDismiss(proposal.id)}
								>
									<KeatingIcon icon={reviewIcon.dismiss} size={14} />
								</button>
							</div>
						</div>

						<Citation quote={proposal.anchor?.quote} anchored={proposal.anchored} />

						{proposal.pedagogicalImpact ? (
							<p className={cx(quiet, css({ marginTop: "0.35rem" }))}>
								<strong className={css({ color: "var(--ink)", fontWeight: 650 })}>Impact. </strong>
								{proposal.pedagogicalImpact}
							</p>
						) : null}

						{proposal.suggestedAlternative ? (
							<p className={cx(quiet, css({ marginTop: "0.25rem" }))}>
								<strong className={css({ color: "var(--ink)", fontWeight: 650 })}>Instead. </strong>
								{proposal.suggestedAlternative}
							</p>
						) : null}

						{onReveal && proposal.messageId ? (
							<button type="button" className={cx(textButton, css({ marginTop: "0.35rem" }))} onClick={() => onReveal(proposal)}>
								Show the turn
							</button>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

export interface RubricProposalProps {
	proposal: RubricSweepProposal;
	onApply: (proposal: RubricSweepProposal) => void;
	onDismiss: () => void;
	busy?: boolean;
}

/**
 * A proposed rubric card: every dimension scored, each with its reason and the
 * line that earned it. Applying it fills the teacher's own scoring controls
 * rather than saving anything, so the last word stays theirs.
 */
export function RubricProposal({ proposal, onApply, onDismiss, busy }: RubricProposalProps) {
	if (proposal.ratings.length === 0 && !proposal.summary) return null;
	const byKey = new Map(proposal.ratings.map((rating) => [rating.key, rating]));

	return (
		<section aria-label="Proposed rubric scores" className={marginNote({ state: "proposed" })}>
			<div className={groupHead}>
				<span className={eyebrow()}>Proposed scoring</span>
				<div className={proposalActions}>
					<button type="button" className={textButton} disabled={busy} onClick={() => onApply(proposal)}>Apply</button>
					<button type="button" className={ghostButton} aria-label="Dismiss proposed scoring" onClick={onDismiss}>
						<KeatingIcon icon={reviewIcon.dismiss} size={14} />
					</button>
				</div>
			</div>

			<dl className={css({ display: "grid", gap: "0.3rem" })}>
				{PEDAGOGY_RUBRIC_KEYS.map((key) => {
					const rating = byKey.get(key);
					if (!rating) return null;
					return (
						<div key={key}>
							<dt className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.72rem", fontWeight: 650, color: "var(--ink)" })}>
								<span>{RUBRIC_LABELS[key]}</span>
								<span className={css({ fontFamily: "var(--mono-body)", color: "var(--accent-dim)" })}>
									{rating.rating}/5 · {ratingLabel(rating.rating)}
								</span>
							</dt>
							<dd className={quiet}>{rating.justification}</dd>
							{rating.anchored && rating.anchor ? <Citation quote={rating.anchor.quote} anchored /> : null}
						</div>
					);
				})}
			</dl>

			{proposal.summary ? (
				<p className={cx(quiet, css({ marginTop: "0.45rem" }))}>
					<strong className={css({ color: "var(--ink)", fontWeight: 650 })}>Summary. </strong>
					{proposal.summary}
				</p>
			) : null}

			{proposal.overallRating || proposal.verdict ? (
				<p className={cx(eyebrow(), css({ marginTop: "0.4rem", fontSize: "10px" }))}>
					{proposal.overallRating ? `Overall ${proposal.overallRating}/5` : ""}
					{proposal.overallRating && proposal.verdict ? " · " : ""}
					{proposal.verdict ? verdictLabel(proposal.verdict) : ""}
				</p>
			) : null}
		</section>
	);
}
