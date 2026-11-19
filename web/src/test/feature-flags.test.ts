import { describe, expect, it } from "bun:test";
import { resolveCanvasFeatureEnabled } from "../lib/feature-flags";

describe("Materials panel exposure", () => {
	it("is available in ordinary production builds", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: false })).toBe(true);
		expect(resolveCanvasFeatureEnabled({})).toBe(true);
	});

	it("remains available during local development", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: true })).toBe(true);
	});

	it("stays on for an explicit opt-in or an unrecognised value", () => {
		expect(resolveCanvasFeatureEnabled({ DEV: false, VITE_KEATING_CANVAS_ENABLED: "true" })).toBe(true);
		expect(resolveCanvasFeatureEnabled({ DEV: false, VITE_KEATING_CANVAS_ENABLED: "maybe" })).toBe(true);
	});

	it("lets an explicit off switch turn it off in any build", () => {
		for (const value of ["off", "0", "false", "no", " OFF "]) {
			expect(resolveCanvasFeatureEnabled({ DEV: false, VITE_KEATING_CANVAS_ENABLED: value })).toBe(false);
			expect(resolveCanvasFeatureEnabled({ DEV: true, VITE_KEATING_CANVAS_ENABLED: value })).toBe(false);
		}
	});
});
