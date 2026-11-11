/**
 * Tracks the document selection and reports it when it lies inside exactly
 * one quote source. Works for mouse, touch (the selection handles fire
 * `selectionchange`) and keyboard selections alike.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { captureSelectionQuote, type CapturedQuote } from "./quote-dom";

export interface PassageSelection extends CapturedQuote {
	rect: { top: number; bottom: number; left: number; right: number; width: number; height: number };
}

let lastSelection: { captured: CapturedQuote; at: number } | null = null;

/**
 * The most recent valid selection inside `source`, for actions that run
 * after focus has moved (a per-message Quote button on a phone collapses the
 * selection before its click fires).
 */
export function recentSelectionIn(source: Element, maxAgeMs = 30_000): CapturedQuote | null {
	if (!lastSelection || Date.now() - lastSelection.at > maxAgeMs) return null;
	return lastSelection.captured.source === source && source.isConnected ? lastSelection.captured : null;
}

export function forgetRecentSelection(): void {
	lastSelection = null;
}

function readSelection(): PassageSelection | null {
	const selection = typeof window === "undefined" ? null : window.getSelection();
	const captured = captureSelectionQuote(selection);
	if (!captured || !selection) return null;
	lastSelection = { captured, at: Date.now() };
	const range = selection.getRangeAt(0);
	const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
	const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
	const last = rects.at(-1);
	const rect = box && (box.width || box.height)
		? { top: box.top, bottom: Math.max(box.bottom, last?.bottom ?? 0), left: box.left, right: box.right, width: box.width, height: box.height }
		: { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
	return { ...captured, rect };
}

/**
 * `keepWhile` lets a control hold on to the last selection while it has
 * focus (moving focus to a button can collapse the selection).
 */
export function usePassageSelection(keepWhile?: () => boolean): { selection: PassageSelection | null; clear: () => void } {
	const [selection, setSelection] = useState<PassageSelection | null>(null);
	const frame = useRef<number | null>(null);
	const keepRef = useRef(keepWhile);
	keepRef.current = keepWhile;

	const update = useCallback(() => {
		if (frame.current !== null) return;
		const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback: () => void) => setTimeout(callback, 0) as unknown as number;
		frame.current = schedule(() => {
			frame.current = null;
			const next = readSelection();
			if (!next && keepRef.current?.()) return;
			setSelection(next);
		});
	}, []);

	useEffect(() => {
		document.addEventListener("selectionchange", update);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			document.removeEventListener("selectionchange", update);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
			if (frame.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current);
		};
	}, [update]);

	const clear = useCallback(() => setSelection(null), []);
	return { selection, clear };
}
