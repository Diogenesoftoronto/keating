import { css, cx } from "../../styled-system/css";
import { eyebrow } from "../../styled-system/recipes";
import Eye from "reicon-react/icons/Eye";
import { KeatingIcon } from "./KeatingIcon";

export interface TutorialShotProps {
	/**
	 * Screenshot path under `public/`, e.g. `/tutorial/review-margin.png`.
	 * Leave unset to render the captioned placeholder — the frame keeps its
	 * final size and caption either way, so dropping the image in later moves
	 * nothing on the page.
	 */
	src?: string;
	alt: string;
	caption: string;
	/** Short label in the frame's slate, e.g. "STEP 02". */
	slate?: string;
	/** Aspect ratio of the eventual capture. Defaults to a 16:10 viewport. */
	ratio?: string;
	className?: string;
}

/**
 * A figure in the tutorial: a bordered frame, a slate, and a caption.
 *
 * The frame is deliberately the same whether or not the image exists yet, so a
 * tutorial written ahead of its screenshots reads as complete rather than
 * broken, and the capture pass is a one-line change per figure.
 */
export function TutorialShot({ src, alt, caption, slate, ratio = "16 / 10", className }: TutorialShotProps) {
	return (
		<figure className={cx(css({ marginBlock: "1.25rem" }), className)}>
			<div
				className={css({
					position: "relative",
					overflow: "hidden",
					border: "1.5px solid var(--ink)",
					borderRadius: "{radii.keating}",
					background: "var(--card)",
					boxShadow: "4px 4px 0 var(--ink)",
					transitionProperty: "transform, box-shadow",
					transitionDuration: "{durations.base}",
					transitionTimingFunction: "{easings.standard}",
					_hover: { transform: "translate(-2px, -2px)", boxShadow: "6px 6px 0 var(--ink)" },
				})}
			>
				{slate ? (
					<span
						className={cx(
							eyebrow(),
							css({
								position: "absolute",
								top: "0.5rem",
								left: "0.6rem",
								zIndex: 1,
								borderRadius: "{radii.keating}",
								background: "color-mix(in srgb, var(--ink) 82%, transparent)",
								color: "var(--paper)",
								paddingInline: "0.4rem",
								paddingBlock: "0.1rem",
								fontSize: "10px",
							}),
						)}
					>
						{slate}
					</span>
				) : null}

				{src ? (
					<img
						src={src}
						alt={alt}
						loading="lazy"
						decoding="async"
						className={css({ display: "block", width: "100%", height: "auto" })}
					/>
				) : (
					<div
						role="img"
						aria-label={`Screenshot pending: ${alt}`}
						className={css({
							display: "grid",
							placeItems: "center",
							aspectRatio: ratio,
							width: "100%",
							gap: "0.4rem",
							background:
								"repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink) 4%, transparent) 0 10px, transparent 10px 20px)",
							color: "var(--ink-soft)",
							textAlign: "center",
							padding: "1rem",
						})}
					>
						<KeatingIcon icon={Eye} size={22} />
						<span className={css({ fontSize: "0.75rem", maxWidth: "28rem", lineHeight: 1.5 })}>{alt}</span>
						<span className={cx(eyebrow(), css({ fontSize: "10px" }))}>Screenshot coming</span>
					</div>
				)}
			</div>
			<figcaption className={css({ marginTop: "0.5rem", fontSize: "0.8125rem", lineHeight: 1.55, color: "var(--ink-soft)" })}>
				{caption}
			</figcaption>
		</figure>
	);
}
