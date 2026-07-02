import { describe, expect, it } from "bun:test";

import { isStaleBuildError } from "../lib/stale-build-recovery";

describe("stale build recovery", () => {
	it("recognizes dynamic import chunk failures", () => {
		expect(isStaleBuildError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
		expect(isStaleBuildError(new Error("ChunkLoadError: Loading chunk Chat failed"))).toBe(true);
	});

	it("recognizes module MIME fallback failures", () => {
		expect(
			isStaleBuildError(
				new Error(
					'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
				),
			),
		).toBe(true);
	});

	it("ignores unrelated runtime errors", () => {
		expect(isStaleBuildError(new Error("Provider API key is missing"))).toBe(false);
	});
});
