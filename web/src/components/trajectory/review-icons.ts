/**
 * Semantic icon vocabulary for the review surface.
 *
 * Every review concept resolves through this table rather than importing a
 * glyph at the call site, so the metaphor stays consistent: the session is a
 * marked-up book, the teacher works in its margin, and the AI passes are
 * drafting instruments (a nib, a rule, a compass, a telescope) rather than
 * generic "sparkles".
 */
import { createElement } from "react";
import { KeatingGlyph, type GlyphName, type KeatingGlyphProps } from "../../design-system/glyphs";

export const reviewIcon = {
	// --- the three columns -------------------------------------------------
	/** Turn rail: the route the lesson actually took. */
	contents: "route",
	/** Canvas: the page under review. */
	page: "book",
	/** Desk: the margin the teacher writes in. */
	margin: "pen",

	// --- transcript roles ---------------------------------------------------
	teacher: "bot",
	learner: "person",
	tool: "tool",
	message: "message",

	// --- review verbs -------------------------------------------------------
	annotate: "pen",
	quote: "quote",
	rubric: "ruler",
	category: "hash",
	verdict: "checklist",
	save: "save",
	discard: "trash",
	dismiss: "x",
	accept: "check",
	add: "plus",
	retry: "refresh",
	export: "export",
	copy: "copy",
	search: "search",
	inspect: "eye",
	settings: "gear",
	back: "left",
	locked: "lock",
	problem: "alert",
	alternatives: "layers",

	// --- AI passes: each pass gets an instrument ---------------------------
	/** The pass affordance itself — Keating's pen. */
	pass: "feather",
	/** Critique sweep: reads the session and proposes notes. */
	sweep: "bulb",
	/** Rubric scoring: measuring against a fixed scale. */
	measure: "ruler",
	/** Annotation expansion: finding the way from a terse note to a full one. */
	expand: "compass",
	/** Cross-session digest: looking across many sessions at once. */
	digest: "pattern",
} as const satisfies Record<string, GlyphName>;

export type ReviewIconName = keyof typeof reviewIcon;

export function ReviewIcon({ icon, ...props }: Omit<KeatingGlyphProps, "name"> & { icon: GlyphName }) {
	return createElement(KeatingGlyph, { name: icon, ...props });
}
