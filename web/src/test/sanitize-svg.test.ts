import { describe, expect, it } from "bun:test";

import { isForbiddenSvgElement } from "../lib/sanitize-svg";

describe("SVG sanitizer policy", () => {
	it("blocks foreignObject by default for stored or imported SVG", () => {
		expect(isForbiddenSvgElement("foreignObject")).toBe(true);
	});

	it("allows an explicit Mermaid-only foreignObject exception", () => {
		expect(isForbiddenSvgElement("foreignObject", { allowForeignObject: true })).toBe(false);
	});

	it("never permits executable embedding elements", () => {
		for (const tag of ["script", "iframe", "object", "embed", "link", "meta", "base"]) {
			expect(isForbiddenSvgElement(tag, { allowForeignObject: true })).toBe(true);
		}
	});
});
