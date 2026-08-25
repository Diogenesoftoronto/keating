import { forwardRef, type ComponentType } from "react";
import type { IconProps } from "reicon-react";
import { cx } from "../../styled-system/css";
import { duoIcon } from "../../styled-system/recipes";

/** Any Reicon icon component (`reicon-react` exports these per icon). */
export type ReiconIcon = ComponentType<IconProps>;

export interface KeatingIconProps {
	icon: ReiconIcon;
	/** Edge length in px. Reicon renders on a 24x24 viewBox. */
	size?: number;
	/**
	 * Force the Filled weight. Leave undefined to let the surrounding
	 * button/tab drive it on hover, focus, or `aria-selected` — see the
	 * ancestor rule in the `duoIcon` recipe.
	 */
	active?: boolean;
	/**
	 * Accessible name. Provide it only when the icon is the sole carrier of
	 * meaning; icons sitting beside a visible label must stay unlabelled so
	 * screen readers do not announce the same thing twice.
	 */
	label?: string;
	strokeWidth?: number;
	className?: string;
}

/**
 * Renders a Reicon glyph in both weights, stacked in one grid cell, and
 * cross-fades between them in CSS.
 *
 * Swapping weight is what makes the review surface feel responsive without
 * anything moving: the outline thickens into a solid as you reach for a
 * control. Doing it with two stacked SVGs rather than a React hover state
 * means the transition also fires on `:focus-visible` and on the selected
 * tab, costs no re-render, and collapses cleanly under
 * `prefers-reduced-motion`.
 */
export const KeatingIcon = forwardRef<HTMLSpanElement, KeatingIconProps>(function KeatingIcon(
	{ icon: Icon, size = 15, active, label, strokeWidth, className },
	ref,
) {
	const labelled = label
		? ({ role: "img" as const, "aria-label": label })
		: ({ "aria-hidden": true as const });

	return (
		<span ref={ref} className={cx(duoIcon({ active }), className)} {...labelled}>
			<Icon data-weight="Outline" weight="Outline" size={size} strokeWidth={strokeWidth} aria-hidden />
			<Icon data-weight="Filled" weight="Filled" size={size} strokeWidth={strokeWidth} aria-hidden />
		</span>
	);
});
