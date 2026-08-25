/**
 * Positioning for the layered review surfaces.
 *
 * The review desk floats hovercards, a selection toolbar, and the annotation editor
 * against text in a scrolling canvas. None of the popover libraries are in this
 * project's dependency tree, and the placement rules here are narrow enough that a
 * pure function beats pulling one in: clamp inside the host, prefer one side, flip
 * when the preferred side does not fit.
 */

export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export type PreferredSide = "above" | "below";

export interface AnchorPlacement {
	left: number;
	top: number;
	/** Which side the surface actually landed on, after any flip. */
	side: PreferredSide;
}

export interface AnchorOptions {
	/** Gap between the anchor and the floating surface. */
	offset?: number;
	/** Minimum distance from the host's edges. */
	padding?: number;
	preferred?: PreferredSide;
}

/**
 * Places `surface` against `anchor`, both in host-relative coordinates.
 *
 * Horizontal: centred on the anchor, then clamped so the surface never leaves the
 * host. Vertical: the preferred side when it fits, otherwise the other side,
 * otherwise whichever side has more room — a surface taller than the host is
 * pinned rather than allowed to escape.
 */
export function placeAgainstAnchor(
	anchor: Box,
	surface: { width: number; height: number },
	host: { width: number; height: number },
	options: AnchorOptions = {},
): AnchorPlacement {
	const offset = options.offset ?? 8;
	const padding = options.padding ?? 8;
	const preferred = options.preferred ?? "below";

	const centred = anchor.left + anchor.width / 2 - surface.width / 2;
	const maxLeft = Math.max(padding, host.width - surface.width - padding);
	const left = Math.min(Math.max(centred, padding), maxLeft);

	const aboveTop = anchor.top - surface.height - offset;
	const belowTop = anchor.top + anchor.height + offset;
	const fitsAbove = aboveTop >= padding;
	const fitsBelow = belowTop + surface.height <= host.height - padding;

	let side: PreferredSide;
	if (preferred === "above") side = fitsAbove ? "above" : fitsBelow ? "below" : "above";
	else side = fitsBelow ? "below" : fitsAbove ? "above" : "below";

	const rawTop = side === "above" ? aboveTop : belowTop;
	const maxTop = Math.max(padding, host.height - surface.height - padding);
	return { left, top: Math.min(Math.max(rawTop, padding), maxTop), side };
}

/** Converts a viewport rect into coordinates relative to a host element's rect. */
export function toHostBox(rect: Box, hostRect: { left: number; top: number }): Box {
	return {
		left: rect.left - hostRect.left,
		top: rect.top - hostRect.top,
		width: rect.width,
		height: rect.height,
	};
}
