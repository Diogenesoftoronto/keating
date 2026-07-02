import { useEffect, useState } from "react";

/**
 * Reactively subscribe to a CSS media query. SSR-safe (returns `defaultValue`
 * when `window` is unavailable, then re-evaluates on mount).
 *
 * Replaces the small handful of ad-hoc `window.matchMedia(...).matches` blocks
 * scattered across layout components. Pair with a preset helper like
 * `useReducedMotion()` when the query is a known accessibility signal.
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
	const getInitial = (): boolean => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			return defaultValue;
		}
		return window.matchMedia(query).matches;
	};

	const [matches, setMatches] = useState<boolean>(getInitial);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			return;
		}
		const mq = window.matchMedia(query);
		// Sync state in case the media-query list changed between the initial
		// render (during SSR or before effect setup) and mount.
		setMatches(mq.matches);
		const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, [query]);

	return matches;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the user has asked the OS to minimize motion. */
export function useReducedMotion(defaultValue = false): boolean {
	return useMediaQuery(REDUCED_MOTION_QUERY, defaultValue);
}

const DARK_COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** True when the OS reports a dark color scheme preference. */
export function usePrefersDark(defaultValue = false): boolean {
	return useMediaQuery(DARK_COLOR_SCHEME_QUERY, defaultValue);
}