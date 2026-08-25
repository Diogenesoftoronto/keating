import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { css, cx } from "../../../styled-system/css";
import { placeAgainstAnchor, toHostBox, type PreferredSide } from "./anchor-position";

/**
 * The shell every floating review surface sits in.
 *
 * Hovercards, the selection toolbar, and the annotation popover all need the same
 * thing: measure yourself, place against a rect, stay inside the workspace. Doing
 * that once here keeps the placement rules in `anchor-position.ts` and out of three
 * separate components.
 *
 * The surface is absolutely positioned inside the host, so the host must be a
 * positioned element.
 */

export interface FloatingSurfaceProps {
	/** Anchor rectangle in viewport coordinates, from `getBoundingClientRect()`. */
	anchorRect: DOMRect | null;
	hostRef: RefObject<HTMLElement | null>;
	preferred?: PreferredSide;
	role?: string;
	label: string;
	className?: string;
	children: ReactNode;
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
}

const surfaceClass = css({
	position: "absolute",
	zIndex: 40,
	borderRadius: "0.375rem",
	border: "1px solid var(--ink)",
	background: "var(--card)",
	boxShadow: "3px 3px 0 var(--line), 0 14px 30px -20px rgba(0, 0, 0, 0.55)",
});

export function FloatingSurface({
	anchorRect,
	hostRef,
	preferred = "below",
	role = "dialog",
	label,
	className,
	children,
	onPointerEnter,
	onPointerLeave,
}: FloatingSurfaceProps) {
	const surfaceRef = useRef<HTMLDivElement | null>(null);
	const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

	useLayoutEffect(() => {
		const host = hostRef.current;
		const surface = surfaceRef.current;
		if (!host || !surface || !anchorRect) {
			setPlacement(null);
			return;
		}
		const hostRect = host.getBoundingClientRect();
		const next = placeAgainstAnchor(
			toHostBox(anchorRect, hostRect),
			{ width: surface.offsetWidth, height: surface.offsetHeight },
			{ width: host.clientWidth, height: host.clientHeight },
			{ preferred },
		);
		setPlacement({ left: next.left, top: next.top });
	}, [anchorRect, hostRef, preferred]);

	if (!anchorRect) return null;

	return (
		<div
			ref={surfaceRef}
			role={role}
			aria-label={label}
			className={cx(surfaceClass, className)}
			// Measured before it is placed, so it renders once invisibly rather than
			// flashing in the wrong corner first.
			style={{
				left: placement?.left ?? 0,
				top: placement?.top ?? 0,
				visibility: placement ? "visible" : "hidden",
			}}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
		>
			{children}
		</div>
	);
}
