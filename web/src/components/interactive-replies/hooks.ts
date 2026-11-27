import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Ends a drag the browser took away (pointercancel, or the window losing focus)
 * the same way in every manipulable: restore the cursor and run `cancel`, which
 * discards the preview. Does nothing while no gesture is active.
 */
export function useCancelGesture(active: boolean, cancel: () => void) {
	const ref = useRef({ active, cancel });
	ref.current = { active, cancel };
	useEffect(() => {
		const on = () => {
			if (!ref.current.active) return;
			document.body.style.cursor = "";
			ref.current.cancel();
		};
		document.addEventListener("pointercancel", on);
		window.addEventListener("blur", on);
		return () => {
			document.removeEventListener("pointercancel", on);
			window.removeEventListener("blur", on);
		};
	}, []);
}

/** Rounded width of `ref`'s element, kept current as it resizes; `fallback` until it has been measured. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 640) {
	const [width, setWidth] = useState(fallback);
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const read = () => {
			const next = Math.round(el.getBoundingClientRect().width);
			if (next > 0) setWidth(next);
		};
		const observer = new ResizeObserver(read);
		observer.observe(el);
		read();
		return () => observer.disconnect();
	}, [ref]);
	return width;
}
