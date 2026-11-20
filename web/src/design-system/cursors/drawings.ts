/**
 * Keating cursors. Each is a 32px drawing in the glyph language: straight segments, butt caps, mitre joins.
 * A keyline in the ground colour sits under every part so the cursor reads on any surface.
 * Board: docs/design/2026-11-20-cursor-mockups/cursor-mockups.html (K2).
 */
export type CursorTheme = "paper" | "term";
export type CursorName =
	| "arrow" | "press" | "hand" | "out" | "text" | "mark" | "grab" | "grabbing"
	| "no" | "cross" | "col" | "row" | "ew" | "zoom" | "help" | "copy" | "wait";

type PartKind = "solid" | "dim" | "shape" | "line" | "acc" | "accf" | "red" | "redl" | "chip";
type Part = readonly [kind: PartKind, d: string, width?: number];
interface Drawing { hot: readonly [number, number]; fallback: string; parts: readonly Part[] }

const THEMES: Record<CursorTheme, { ink: string; key: string; light: string; acc: string; red: string; amber: string }> = {
	paper: { ink: "#1c211b", key: "#f6f2e8", light: "#f6f2e8", acc: "#1e9b50", red: "#b9432e", amber: "#e8a33d" },
	term: { ink: "#4be388", key: "#060b08", light: "#0c1510", acc: "#dcefe0", red: "#e0705c", amber: "#e8a33d" },
};
const ARROW: Part = ["solid", "M4 3v16l4.2-3.8 3 6.8 3-1.3-2.9-6.6h5.8z"];
const HAND: Part = ["shape", "M10 3h4v8h8v7l-2.5 3v4h-10v-4L5 16.5V13h5z"];
const KNUCKLES: Part = ["line", "M16.7 11v3.5M19.3 11v3.5", 1.4];

export const CURSORS: Record<CursorName, Drawing> = {
	arrow: { hot: [4, 3], fallback: "default", parts: [ARROW] },
	press: { hot: [8, 8], fallback: "default", parts: [["solid", "M8 8v14.4l3.8-3.4 2.7 6.1 2.7-1.2-2.6-5.9h5.2z"], ["acc", "M8 1.5V5M1.5 8H5M3.2 3.2l2.5 2.5"]] },
	hand: { hot: [12, 3], fallback: "pointer", parts: [HAND, KNUCKLES] },
	out: { hot: [12, 3], fallback: "pointer", parts: [HAND, KNUCKLES, ["acc", "M23.5 2.5h6V8.5M29.5 2.5l-6 6"]] },
	text: { hot: [16, 16], fallback: "text", parts: [["line", "M11.5 6.5h9M16 6.5v19M11.5 25.5h9"]] },
	mark: { hot: [13, 16], fallback: "text", parts: [["line", "M8.5 6.5h9M13 6.5v19M8.5 25.5h9"], ["chip", "M18.5 17.5h8v6h-8z"]] },
	grab: { hot: [16, 13], fallback: "grab", parts: [["shape", "M12.8 26.2v-4.8L8 16.6V13h3.6V5.8h10.8v12l-3.6 3.6v4.8z"], ["line", "M15.2 5.8V13M18.8 5.8V13", 1.4]] },
	grabbing: { hot: [16, 13], fallback: "grabbing", parts: [["shape", "M12.8 26.2v-4.8l-3.6-3.6V13h2.4v-2.4h10.8v7.2l-3.6 3.6v4.8z"], ["line", "M15.2 10.6v3.6M18.8 10.6v3.6", 1.4]] },
	no: { hot: [16, 16], fallback: "not-allowed", parts: [["red", "M12.3 7h7.4l5.3 5.3v7.4L19.7 25h-7.4L7 19.7v-7.4z"], ["redl", "M10.4 10.4l11.2 11.2"]] },
	cross: { hot: [16, 16], fallback: "crosshair", parts: [["line", "M16 5v8M16 19v8M5 16h8M19 16h8"], ["accf", "M14.5 14.5h3v3h-3z"]] },
	col: { hot: [16, 16], fallback: "col-resize", parts: [["line", "M16 7v18M12 12l-4 4 4 4M20 12l4 4-4 4"]] },
	row: { hot: [16, 16], fallback: "row-resize", parts: [["line", "M7 16h18M12 12l4-4 4 4M12 20l4 4 4-4"]] },
	ew: { hot: [16, 16], fallback: "ew-resize", parts: [["line", "M7 16h18M11.5 11.5L7 16l4.5 4.5M20.5 11.5L25 16l-4.5 4.5"]] },
	zoom: { hot: [13, 13], fallback: "zoom-in", parts: [["shape", "M6 6h14v14H6z"], ["line", "M20 20l6.5 6.5", 3], ["acc", "M9.5 13h7M13 9.5v7"]] },
	help: { hot: [4, 3], fallback: "help", parts: [ARROW, ["line", "M20.5 17h6v4.2h-3v2"], ["accf", "M22.5 25.4h2v2h-2z"]] },
	copy: { hot: [4, 3], fallback: "copy", parts: [ARROW, ["shape", "M18.5 15.5H25V22h-6.5z"], ["shape", "M21.5 18.5H28V25h-6.5z"]] },
	wait: { hot: [4, 3], fallback: "progress", parts: [ARROW, ["accf", "M19.5 16.5H23V20h-3.5z"], ["dim", "M25 16.5h3.5V20H25z"], ["dim", "M25 22h3.5v3.5H25z"], ["dim", "M19.5 22H23v3.5h-3.5z"]] },
};
export const CURSOR_NAMES = Object.keys(CURSORS) as CursorName[];

function part([kind, d, width = 1.8]: Part, t: (typeof THEMES)[CursorTheme]): string {
	if (kind === "solid" || kind === "dim") return `<path d="${d}" fill="${t.ink}"/>`;
	if (kind === "accf") return `<path d="${d}" fill="${t.acc}"/>`;
	if (kind === "shape") return `<path d="${d}" fill="${t.light}" stroke="${t.ink}" stroke-width="${width}"/>`;
	if (kind === "chip") return `<path d="${d}" fill="${t.amber}" stroke="${t.ink}" stroke-width="1.6"/>`;
	if (kind === "red") return `<path d="${d}" fill="${t.light}" stroke="${t.red}" stroke-width="2"/>`;
	const colour = kind === "acc" ? t.acc : kind === "redl" ? t.red : t.ink;
	return `<path d="${d}" stroke="${colour}" stroke-width="${kind === "redl" ? 2 : width}"/>`;
}
function keyline([kind, d, width = 1.8]: Part, t: (typeof THEMES)[CursorTheme]): string {
	const stroked = kind === "line" || kind === "acc" || kind === "redl";
	const filledOnly = kind === "solid" || kind === "dim" || kind === "accf";
	return `<path d="${d}" fill="${stroked ? "none" : t.key}" stroke="${t.key}" stroke-width="${filledOnly ? 2.6 : width + 2.6}" stroke-linecap="square"/>`;
}

export function cursorSvg(name: CursorName, theme: CursorTheme, size = 32): string {
	const drawing = CURSORS[name], t = THEMES[theme];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3">${
		drawing.parts.map(p => keyline(p, t)).join("")}${drawing.parts.map(p => part(p, t)).join("")}</svg>`;
}
/** A complete `cursor` value: the drawing, its hot spot, then the system cursor it stands in for. */
export function cursorValue(name: CursorName, theme: CursorTheme): string {
	const { hot, fallback } = CURSORS[name];
	return `url("data:image/svg+xml,${encodeURIComponent(cursorSvg(name, theme))}") ${hot[0]} ${hot[1]}, ${fallback}`;
}
/** The custom properties that cursors.css and the rewritten `cursor` declarations read. */
export function cursorVariables(theme: CursorTheme): string {
	return CURSOR_NAMES.map(name => `--kc-${name}:${cursorValue(name, theme)}`).join(";");
}
