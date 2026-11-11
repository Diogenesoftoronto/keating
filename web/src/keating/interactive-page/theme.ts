import type { InteractivePageContext } from "./protocol";

/** App tokens a page may use. Values are read live from the app root so the frame matches the current theme. */
export const INTERACTIVE_PAGE_THEME_VARIABLES = [
	"--background",
	"--foreground",
	"--card",
	"--card-foreground",
	"--popover",
	"--popover-foreground",
	"--primary",
	"--primary-foreground",
	"--secondary",
	"--secondary-foreground",
	"--muted",
	"--muted-foreground",
	"--accent",
	"--accent-foreground",
	"--destructive",
	"--destructive-foreground",
	"--border",
	"--input",
	"--ring",
	"--chart-1",
	"--chart-2",
	"--chart-3",
	"--chart-4",
	"--chart-5",
	"--radius",
	"--font-sans",
	"--font-mono",
] as const;

const FALLBACK: Record<"light" | "dark", Record<string, string>> = {
	light: {
		"--background": "#f1ece0",
		"--foreground": "#1c211b",
		"--card": "#f6f2e8",
		"--card-foreground": "#1c211b",
		"--popover": "#f6f2e8",
		"--popover-foreground": "#1c211b",
		"--primary": "#1e9b50",
		"--primary-foreground": "#ffffff",
		"--secondary": "#e9e2d2",
		"--secondary-foreground": "#1c211b",
		"--muted": "#e9e2d2",
		"--muted-foreground": "#4a5247",
		"--accent": "#ddebdd",
		"--accent-foreground": "#14743c",
		"--destructive": "#b84332",
		"--destructive-foreground": "#ffffff",
		"--border": "rgba(28, 33, 27, 0.22)",
		"--input": "rgba(28, 33, 27, 0.22)",
		"--ring": "#1e9b50",
		"--chart-1": "#1e9b50",
		"--chart-2": "#d97706",
		"--chart-3": "#2563eb",
		"--chart-4": "#be185d",
		"--chart-5": "#7c3aed",
	},
	dark: {
		"--background": "#0c1510",
		"--foreground": "#dcefe0",
		"--card": "#11201a",
		"--card-foreground": "#dcefe0",
		"--popover": "#11201a",
		"--popover-foreground": "#dcefe0",
		"--primary": "#4be388",
		"--primary-foreground": "#0c1510",
		"--secondary": "#1b2a1f",
		"--secondary-foreground": "#dcefe0",
		"--muted": "#1b2a1f",
		"--muted-foreground": "#9dbfa8",
		"--accent": "rgba(75, 227, 136, 0.12)",
		"--accent-foreground": "#4be388",
		"--destructive": "#f07a66",
		"--destructive-foreground": "#0c1510",
		"--border": "rgba(75, 227, 136, 0.28)",
		"--input": "rgba(75, 227, 136, 0.28)",
		"--ring": "#4be388",
		"--chart-1": "#4be388",
		"--chart-2": "#fbbf24",
		"--chart-3": "#60a5fa",
		"--chart-4": "#f472b6",
		"--chart-5": "#c084fc",
	},
};

const SHARED_FALLBACK: Record<string, string> = {
	"--radius": "0.25rem",
	"--font-sans": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
	"--font-mono": "\"JetBrains Mono\", ui-monospace, Menlo, Consolas, monospace",
};

/** Strips characters that could close the declaration or the style element. */
export function sanitizeCssValue(value: string): string {
	return value.replace(/[;{}<>\\]/g, "").trim().slice(0, 200);
}

export function fallbackThemeVariables(appearance: "light" | "dark"): Record<string, string> {
	return { ...FALLBACK[appearance], ...SHARED_FALLBACK };
}

export interface ThemeSource {
	isDark(): boolean;
	reducedMotion(): boolean;
	readVariable(name: string): string;
}

export function browserThemeSource(): ThemeSource | null {
	if (typeof window === "undefined" || typeof document === "undefined") return null;
	const root = document.documentElement;
	return {
		isDark: () => root.classList.contains("dark") || (!root.classList.contains("light") && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true),
		reducedMotion: () => root.dataset.reduceMotion === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
		readVariable: (name) => getComputedStyle(root).getPropertyValue(name),
	};
}

/** Live app context for the frame; any token the app does not resolve falls back to Keating's palette. */
export function readInteractivePageContext(source: ThemeSource | null): InteractivePageContext {
	const appearance = source?.isDark() ? "dark" : "light";
	const fallback = fallbackThemeVariables(appearance);
	const variables: Record<string, string> = {};
	for (const name of INTERACTIVE_PAGE_THEME_VARIABLES) {
		const live = source ? sanitizeCssValue(source.readVariable(name) ?? "") : "";
		variables[name] = live || fallback[name] || "";
	}
	return { appearance, variables, reducedMotion: source?.reducedMotion() ?? false };
}

export function contextsEqual(left: InteractivePageContext, right: InteractivePageContext): boolean {
	if (left.appearance !== right.appearance || left.reducedMotion !== right.reducedMotion) return false;
	const keys = Object.keys(left.variables);
	return keys.length === Object.keys(right.variables).length && keys.every((key) => left.variables[key] === right.variables[key]);
}

/**
 * Calls `onChange` when the app theme or motion preference changes: the `dark`
 * class or `data-reduce-motion` on <html>, or the OS colour/motion settings.
 */
export function watchAppContext(onChange: () => void): () => void {
	if (typeof window === "undefined" || typeof document === "undefined") return () => {};
	const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(onChange);
	observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-reduce-motion"] });
	const queries = ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"].map((query) => window.matchMedia?.(query)).filter(Boolean) as MediaQueryList[];
	for (const query of queries) query.addEventListener?.("change", onChange);
	return () => {
		observer?.disconnect();
		for (const query of queries) query.removeEventListener?.("change", onChange);
	};
}
