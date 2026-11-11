import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus management for the artifact surfaces: move focus to the surface
 * heading when it opens, give it back to whatever had it when it closes, and
 * close on Escape (unless another handler already consumed the key).
 */
export function useSurfaceFocus(open: boolean, onClose: () => void, container?: RefObject<HTMLElement | null>, trap = false, focusOnMount = trap) {
	const headingRef = useRef<HTMLHeadingElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	// A non-modal panel restored open on page load must not steal focus from the composer.
	const firstRun = useRef(true);

	useEffect(() => {
		const initial = firstRun.current;
		firstRun.current = false;
		if (!open || typeof document === "undefined") return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		// The heading renders after the first commit of the surface body.
		const frame = initial && !focusOnMount ? 0 : requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.key === "Escape") {
				closeRef.current();
				return;
			}
			if (!trap || event.key !== "Tab" || !container?.current) return;
			const focusable = [...container.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])")]
				.filter((element) => element.offsetParent !== null || element === document.activeElement);
			if (!focusable.length) return;
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			const active = document.activeElement;
			if (event.shiftKey && (active === first || !container.current.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !container.current.contains(active))) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener("keydown", onKeyDown);
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, [container, focusOnMount, open, trap]);

	return headingRef;
}
