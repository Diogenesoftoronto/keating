import { useEffect, type RefObject } from "react";

/**
 * Closes a popover/menu/dropdown when the user clicks outside the referenced
 * element. Standardizes the pattern previously duplicated in SessionCard,
 * ForkMapCard, and SessionBrowserDesktop.
 *
 * The listener is only attached while `open` is true, so we never pay the
 * cost of a window-level handler when the popover is closed.
 *
 * Escape-to-close is intentionally NOT included — most call sites use it for
 * destructive confirmations and prefer explicit dismissal. Add a sibling hook
 * if you want it.
 */
export function useOutsideClick<T extends HTMLElement>(
	open: boolean,
	ref: RefObject<T | null>,
	onOutside: () => void,
): void {
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) onOutside();
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [open, ref, onOutside]);
}