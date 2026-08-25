import { useCallback, useEffect, useState } from "react";

/**
 * Remembers whether a workspace surface is expanded.
 *
 * Collapse state is a per-reader convenience, so it lives in `localStorage` rather
 * than on the review record — and every access is guarded, because the accessor
 * itself throws in private windows and under blocked site data.
 */

const PREFIX = "keating.trajectory.surface";

function read(key: string, fallback: boolean): boolean {
	try {
		const stored = globalThis.localStorage?.getItem(`${PREFIX}.${key}`);
		return stored === null || stored === undefined ? fallback : stored === "open";
	} catch {
		return fallback;
	}
}

function write(key: string, open: boolean): void {
	try {
		globalThis.localStorage?.setItem(`${PREFIX}.${key}`, open ? "open" : "closed");
	} catch {
		// A reader who cannot persist the preference still gets it for this session.
	}
}

export function useSurfaceCollapse(key: string, defaultOpen: boolean) {
	const [open, setOpen] = useState(defaultOpen);

	// Read after mount rather than during the initial state, so a server-rendered or
	// hydrated tree does not disagree with the browser about the first paint.
	useEffect(() => {
		setOpen(read(key, defaultOpen));
	}, [key, defaultOpen]);

	const set = useCallback((next: boolean) => {
		setOpen(next);
		write(key, next);
	}, [key]);

	const toggle = useCallback(() => set(!open), [open, set]);

	return { open, set, toggle };
}
