import { describe, expect, it } from "bun:test";
import { resolveCanvasFeatureEnabled } from "../lib/feature-flags";

describe("Canvas feature exposure", () => {
	it("is hidden from ordinary production builds", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: false })).toBe(false);
	});

	it("remains available during local development", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: true })).toBe(true);
	});

	it("allows an explicit deployment cohort to opt in", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: false, VITE_KEATING_CANVAS_ENABLED: "true" })).toBe(true);
	});

	it("lets an explicit off switch override development", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: true, VITE_KEATING_CANVAS_ENABLED: "off" })).toBe(false);
	});
});
