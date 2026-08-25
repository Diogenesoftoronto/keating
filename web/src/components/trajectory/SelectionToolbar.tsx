import type { AnnotationKind } from "../../keating/trajectory-review";
import { css } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { annotationKindColor, annotationKindLabel } from "./review-vocabulary";

/**
 * The toolbar that meets a text selection.
 *
 * Selecting a span used to open the whole eight-field editor in the side panel. Here
 * the selection only has to answer one question — what kind of thing is this — and
 * the note follows in a single field. The expensive form is still available at L3;
 * it just stops being the price of marking anything at all.
 */

export interface SelectionToolbarProps {
	onPick: (kind: AnnotationKind) => void;
	onRewrite: () => void;
}

const KINDS: AnnotationKind[] = ["problem", "strength", "suggestion"];

const buttonClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.3rem",
	borderRadius: "0.25rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
	paddingInline: "0.45rem",
	paddingBlock: "0.2rem",
	fontSize: "0.6875rem",
	fontWeight: 650,
	color: "var(--foreground)",
	_hover: { borderColor: "var(--ink)", background: "var(--muted)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});

export function SelectionToolbar({ onPick, onRewrite }: SelectionToolbarProps) {
	return (
		<div
			className={css({ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem" })}
			// Keeping the selection alive matters: the toolbar acts on the range that is
			// still highlighted behind it.
			onMouseDown={(event) => event.preventDefault()}
		>
			<span
				className={css({
					paddingInline: "0.3rem",
					fontSize: "0.5625rem",
					fontWeight: 700,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					color: "var(--muted-foreground)",
				})}
			>
				Mark as
			</span>
			{KINDS.map((kind) => (
				<button key={kind} type="button" className={buttonClass} onClick={() => onPick(kind)}>
					<span
						aria-hidden="true"
						className={css({ width: "0.4rem", height: "0.4rem", borderRadius: "9999px" })}
						style={{ background: annotationKindColor(kind) }}
					/>
					{annotationKindLabel(kind)}
				</button>
			))}
			<button type="button" className={buttonClass} onClick={onRewrite}>
				<KeatingIcon icon={reviewIcon.alternatives} size={12} />
				Rewrite…
			</button>
		</div>
	);
}

export default SelectionToolbar;
