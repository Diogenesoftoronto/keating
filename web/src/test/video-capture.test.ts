import { describe, expect, test } from "bun:test";
import {
	computeCaptureSize,
	framesAreSimilar,
	histogramDistance,
	lumaHistogram,
	normalizeCaptureOptions,
	shouldSkipFrame,
	DEFAULT_MAX_EDGE,
	MIN_FRAME_INTERVAL_MS,
} from "../keating/video-capture";

/** Build RGBA pixel data of a single flat colour. */
function solid(pixels: number, value: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(pixels * 4);
	for (let i = 0; i < pixels; i += 1) {
		data[i * 4] = value;
		data[i * 4 + 1] = value;
		data[i * 4 + 2] = value;
		data[i * 4 + 3] = 255;
	}
	return data;
}

describe("capture options", () => {
	test("floors the interval to one frame per second", () => {
		// Both providers cap video at 1 fps; asking for more must not be honoured.
		expect(normalizeCaptureOptions({ intervalMs: 100 }).intervalMs).toBe(MIN_FRAME_INTERVAL_MS);
		expect(normalizeCaptureOptions({ intervalMs: 0 }).intervalMs).toBe(MIN_FRAME_INTERVAL_MS);
		expect(normalizeCaptureOptions({ intervalMs: -5000 }).intervalMs).toBe(MIN_FRAME_INTERVAL_MS);
	});

	test("keeps intervals slower than the floor", () => {
		expect(normalizeCaptureOptions({ intervalMs: 5000 }).intervalMs).toBe(5000);
	});

	test("defaults to a downscaled camera capture", () => {
		const config = normalizeCaptureOptions();
		expect(config.source).toBe("camera");
		expect(config.maxEdge).toBe(DEFAULT_MAX_EDGE);
		expect(config.intervalMs).toBe(MIN_FRAME_INTERVAL_MS);
	});

	test("clamps jpeg quality into a sane range", () => {
		expect(normalizeCaptureOptions({ jpegQuality: 9 }).jpegQuality).toBe(1);
		expect(normalizeCaptureOptions({ jpegQuality: 0 }).jpegQuality).toBe(0.1);
	});

	test("rejects unknown sources rather than passing them through", () => {
		expect(normalizeCaptureOptions({ source: "hologram" as never }).source).toBe("camera");
	});
});

describe("downscale math", () => {
	test("scales the longest edge down to the budget, preserving aspect ratio", () => {
		expect(computeCaptureSize(1920, 1080, 768)).toEqual({ width: 768, height: 432 });
		expect(computeCaptureSize(1080, 1920, 768)).toEqual({ width: 432, height: 768 });
	});

	test("leaves frames already within budget alone", () => {
		// Upscaling would cost tokens without adding any detail.
		expect(computeCaptureSize(640, 480, 768)).toEqual({ width: 640, height: 480 });
	});

	test("never collapses a dimension to zero", () => {
		const size = computeCaptureSize(4000, 3, 768);
		expect(size.width).toBe(768);
		expect(size.height).toBeGreaterThanOrEqual(1);
	});

	test("handles a video element that has not reported dimensions yet", () => {
		expect(computeCaptureSize(0, 0, 768)).toEqual({ width: 0, height: 0 });
	});
});

describe("frame similarity", () => {
	test("a normalized histogram sums to one", () => {
		const histogram = lumaHistogram(solid(100, 128));
		const total = Array.from(histogram).reduce((sum, value) => sum + value, 0);
		expect(total).toBeCloseTo(1, 10);
	});

	test("identical frames are maximally similar", () => {
		expect(histogramDistance(lumaHistogram(solid(64, 100)), lumaHistogram(solid(64, 100)))).toBe(0);
	});

	test("a black frame and a white frame are maximally different", () => {
		expect(histogramDistance(lumaHistogram(solid(64, 0)), lumaHistogram(solid(64, 255)))).toBeCloseTo(1, 10);
	});

	test("skips a frame indistinguishable from the last one sent", () => {
		const previous = lumaHistogram(solid(64, 120));
		const next = lumaHistogram(solid(64, 120));
		expect(framesAreSimilar(previous, next, 0.02)).toBe(true);
	});

	test("emits a frame once the scene actually changes", () => {
		const previous = lumaHistogram(solid(64, 20));
		const next = lumaHistogram(solid(64, 200));
		expect(framesAreSimilar(previous, next, 0.02)).toBe(false);
	});

	test("always emits the first frame of a session", () => {
		expect(framesAreSimilar(null, lumaHistogram(solid(64, 120)), 0.02)).toBe(false);
	});

	test("a zero threshold disables skipping entirely", () => {
		const histogram = lumaHistogram(solid(64, 120));
		expect(framesAreSimilar(histogram, histogram, 0)).toBe(false);
	});
});

describe("frame skip policy", () => {
	const changed = lumaHistogram(solid(64, 200));
	const unchanged = lumaHistogram(solid(64, 20));

	test("suppresses frames while the tab is hidden", () => {
		// A backgrounded tab must not keep billing the user for frames.
		expect(shouldSkipFrame({
			documentHidden: true,
			previousHistogram: unchanged,
			nextHistogram: changed,
			similarityThreshold: 0.02,
		})).toBe(true);
	});

	test("sends a changed frame while the tab is visible", () => {
		expect(shouldSkipFrame({
			documentHidden: false,
			previousHistogram: unchanged,
			nextHistogram: changed,
			similarityThreshold: 0.02,
		})).toBe(false);
	});

	test("suppresses a static scene while the tab is visible", () => {
		expect(shouldSkipFrame({
			documentHidden: false,
			previousHistogram: unchanged,
			nextHistogram: unchanged,
			similarityThreshold: 0.02,
		})).toBe(true);
	});
});
