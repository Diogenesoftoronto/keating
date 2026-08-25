import type { TrajectoryAnnotation } from "../../keating/trajectory-review";
import { isRevisionAnnotation } from "../../keating/trajectory-review";
import { authorshipLabel } from "../../keating/annotation-provenance";
import { css, cx } from "../../../styled-system/css";
import { eyebrow } from "../../../styled-system/recipes";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { annotationKindColor, annotationKindLabel, severityLabel } from "./review-vocabulary";
import { metaTextClass } from "./styles";

/**
 * What a marked span says when you hover it.
 *
 * This replaces the native `title=` tooltip the canvas used to carry, which could
 * hold no structure, no actions, and no provenance. Hover is the primary reading
 * layer on this surface, so it holds real weight: the note, who wrote it, and — for
 * a revision — the contrast that is the whole point of recording one.
 */

export interface AnnotationHoverCardProps {
	annotations: TrajectoryAnnotation[];
	readOnly?: boolean;
	onEdit?: (annotationId: string) => void;
	onDelete?: (annotationId: string) => void;
}

const actionClass = css({
	display: "inline-flex",
	alignItems: "center",
	gap: "0.25rem",
	borderRadius: "0.25rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
	paddingInline: "0.35rem",
	paddingBlock: "0.1rem",
	fontSize: "0.6875rem",
	fontWeight: 600,
	color: "var(--foreground)",
	_hover: { borderColor: "var(--ink)", background: "var(--muted)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});

export function AnnotationHoverCard({
	annotations,
	readOnly = false,
	onEdit,
	onDelete,
}: AnnotationHoverCardProps) {
	if (annotations.length === 0) return null;

	return (
		<div className={css({ display: "flex", flexDirection: "column", width: "22rem", maxWidth: "84vw" })}>
			{annotations.map((annotation, index) => {
				const tone = annotationKindColor(annotation.kind);
				const revision = isRevisionAnnotation(annotation) ? annotation.revision : undefined;
				return (
					<article
						key={annotation.id}
						className={css({
							padding: "0.625rem 0.75rem",
							borderTop: index === 0 ? "none" : "1px solid var(--line-soft)",
						})}
					>
						<div className={css({ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.35rem" })}>
							<span
								aria-hidden="true"
								className={css({ width: "0.5rem", height: "0.5rem", flex: "0 0 auto", borderRadius: "9999px" })}
								style={{ background: tone }}
							/>
							<span
								className={css({ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" })}
								style={{ color: tone }}
							>
								{annotationKindLabel(annotation.kind)}
							</span>
							{annotation.category ? <span className={metaTextClass}>· {annotation.category}</span> : null}
							{annotation.severity ? (
								<span
									title={severityLabel(annotation.severity)}
									className={css({
										marginLeft: "auto",
										borderRadius: "9999px",
										border: "1px solid var(--border)",
										paddingInline: "0.4rem",
										fontSize: "0.625rem",
										fontWeight: 700,
										color: "var(--muted-foreground)",
										fontVariantNumeric: "tabular-nums",
									})}
								>
									sev {annotation.severity}
								</span>
							) : null}
						</div>

						<p className={css({ margin: 0, fontSize: "0.78rem", lineHeight: 1.5, color: "var(--foreground)" })}>
							{annotation.note}
						</p>

						{revision && annotation.suggestedAlternative ? (
							<div className={css({ display: "grid", gap: "0.2rem", marginTop: "0.5rem", fontSize: "0.74rem" })}>
								<span
									className={css({
										borderRadius: "0.25rem",
										background: "color-mix(in srgb, var(--destructive) 12%, transparent)",
										padding: "0.25rem 0.4rem",
										color: "var(--muted-foreground)",
										textDecoration: "line-through",
										textDecorationColor: "var(--destructive)",
									})}
								>
									{revision.original}
								</span>
								<span
									className={css({
										borderRadius: "0.25rem",
										background: "color-mix(in srgb, var(--accent-green) 14%, transparent)",
										padding: "0.25rem 0.4rem",
										color: "var(--foreground)",
									})}
								>
									{annotation.suggestedAlternative}
								</span>
							</div>
						) : null}

						<div
							className={css({
								display: "flex",
								alignItems: "center",
								gap: "0.3rem",
								marginTop: "0.5rem",
								borderTop: "1px solid var(--line-soft)",
								paddingTop: "0.45rem",
							})}
						>
							{readOnly ? null : (
								<>
									<button type="button" className={actionClass} onClick={() => onEdit?.(annotation.id)}>
										<KeatingIcon icon={reviewIcon.annotate} size={12} />
										Edit
									</button>
									<button
										type="button"
										className={cx(actionClass, css({ borderColor: "transparent", color: "var(--muted-foreground)" }))}
										onClick={() => onDelete?.(annotation.id)}
									>
										<KeatingIcon icon={reviewIcon.discard} size={12} />
										Delete
									</button>
								</>
							)}
							{/* Provenance is the reason this data can be trained on at all, so it
							    stays visible rather than hiding behind the editor. */}
							<span className={cx(eyebrow(), css({ marginLeft: "auto", fontSize: "9px" }))}>
								{authorshipLabel(annotation)}
							</span>
						</div>
					</article>
				);
			})}
		</div>
	);
}

export default AnnotationHoverCard;
