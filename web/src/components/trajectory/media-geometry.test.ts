import { describe, expect, test } from "bun:test";
import { containedMediaRect, normalizedContainedMediaPoint } from "./media-geometry";

describe("contained media geometry", () => {
	test("centers a wide intrinsic image inside a square frame", () => {
		expect(containedMediaRect(
			{ x: 0, y: 0, width: 200, height: 200 },
			{ width: 400, height: 200 },
		)).toEqual({ x: 0, y: 50, width: 200, height: 100 });
	});

	test("rejects pointer starts in letterboxing", () => {
		expect(normalizedContainedMediaPoint(
			{ x: 100, y: 25 },
			{ x: 0, y: 0, width: 200, height: 200 },
			{ width: 400, height: 200 },
		)).toBeNull();
	});

	test("normalizes against the contained image rather than its frame", () => {
		expect(normalizedContainedMediaPoint(
			{ x: 100, y: 100 },
			{ x: 0, y: 0, width: 200, height: 200 },
			{ width: 400, height: 200 },
		)).toEqual({ x: 0.5, y: 0.5 });
	});

	test("clamps an active drag to the intrinsic image edge", () => {
		expect(normalizedContainedMediaPoint(
			{ x: 250, y: 25 },
			{ x: 0, y: 0, width: 200, height: 200 },
			{ width: 400, height: 200 },
			true,
		)).toEqual({ x: 1, y: 0 });
	});
});
