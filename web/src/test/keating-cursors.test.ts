import { describe, expect, test } from "bun:test";
import { CURSOR_NAMES, CURSORS, cursorSvg, cursorValue } from "../design-system/cursors/drawings";
import { cursorKeyword } from "../design-system/cursors/resolve";
import { readCursorPreference, saveCursorPreference } from "../design-system/cursors/preference";
// The PostCSS step is CommonJS because PostCSS loads its config that way.
import rewriteCursors from "../../scripts/postcss-keating-cursors.cjs";

const rewrite = rewriteCursors.rewrite;

describe("Keating cursor drawings", () => {
	test("every cursor keeps its hot spot inside the 32px image and names a system fallback", () => {
		for (const name of CURSOR_NAMES) {
			const { hot, fallback } = CURSORS[name];
			expect(hot[0]).toBeGreaterThanOrEqual(0);
			expect(hot[0]).toBeLessThan(32);
			expect(hot[1]).toBeGreaterThanOrEqual(0);
			expect(hot[1]).toBeLessThan(32);
			expect(fallback).toMatch(/^[a-z-]+$/);
		}
	});
	test("a cursor value is a 32px image, its hot spot, then the system cursor", () => {
		const value = cursorValue("hand", "paper");
		expect(value).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\) 12 3, pointer$/);
		expect(decodeURIComponent(value)).toContain('width="32" height="32"');
	});
	test("each ground gets its own colours and nothing is drawn rounded", () => {
		for (const name of CURSOR_NAMES) {
			const paper = cursorSvg(name, "paper"), term = cursorSvg(name, "term");
			expect(paper).not.toBe(term);
			expect(paper).toContain('stroke-linejoin="miter"');
			// Straight segments only: no arcs or curves in any path.
			for (const [, d] of CURSORS[name].parts) expect(d).not.toMatch(/[ACQSTacqst]/);
		}
	});
});

describe("cursor rewrite", () => {
	test("keywords point at the Keating cursor and keep themselves as the fallback", () => {
		expect(rewrite("pointer")).toBe("var(--kc-hand, pointer)");
		expect(rewrite("not-allowed !important")).toBe("var(--kc-no, not-allowed) !important");
		expect(rewrite("progress")).toBe("var(--kc-wait, progress)");
	});
	test("anything already specific is left alone", () => {
		expect(rewrite("inherit")).toBeUndefined();
		expect(rewrite("auto")).toBeUndefined();
		expect(rewrite("var(--kc-hand, pointer)")).toBeUndefined();
		expect(rewrite('url("x.svg") 2 2, pointer')).toBeUndefined();
	});
	test("every rewrite target is a cursor that exists", () => {
		for (const keyword of ["default", "pointer", "text", "grab", "grabbing", "not-allowed", "crosshair", "col-resize", "row-resize", "ew-resize", "zoom-in", "help", "copy", "wait", "progress"]) {
			const name = rewrite(keyword)?.match(/--kc-([a-z]+)/)?.[1];
			expect(CURSOR_NAMES as string[]).toContain(name as string);
		}
	});
});

describe("reading the resolved cursor", () => {
	test("the system keyword is whatever the value ends in", () => {
		expect(cursorKeyword('url("data:image/svg+xml,%3Csvg%2C") 12 3, pointer')).toBe("pointer");
		expect(cursorKeyword("text")).toBe("text");
		expect(cursorKeyword("")).toBe("auto");
	});
});

describe("cursor preference", () => {
	test("on unless this device chose the system cursors", () => {
		const values = new Map<string, string>();
		const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) };
		expect(readCursorPreference(store)).toBe(true);
		saveCursorPreference(false, store);
		expect(readCursorPreference(store)).toBe(false);
		saveCursorPreference(true, store);
		expect(readCursorPreference(store)).toBe(true);
	});
});
