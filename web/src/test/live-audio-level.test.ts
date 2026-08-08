import { describe, expect, test } from "bun:test";
import { normalizeLevel, rmsFromTimeDomain, smoothLevel } from "../keating/live-audio-level";

/** A byte time-domain buffer holding a sine wave of the given amplitude. */
function tone(amplitude: number, samples = 512): Uint8Array {
	const buffer = new Uint8Array(samples);
	for (let i = 0; i < samples; i += 1) {
		buffer[i] = 128 + Math.round(Math.sin((i / samples) * Math.PI * 8) * 127 * amplitude);
	}
	return buffer;
}

describe("rms", () => {
	test("digital silence reads as zero", () => {
		// getByteTimeDomainData centres silence on 128, not on 0.
		expect(rmsFromTimeDomain(new Uint8Array(512).fill(128))).toBeCloseTo(0, 5);
	});

	test("an empty buffer does not divide by zero", () => {
		expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0);
	});

	test("rises with amplitude", () => {
		const quiet = rmsFromTimeDomain(tone(0.1));
		const loud = rmsFromTimeDomain(tone(0.8));
		expect(loud).toBeGreaterThan(quiet);
		expect(quiet).toBeGreaterThan(0);
	});

	test("stays within 0..1 even at full scale", () => {
		const level = rmsFromTimeDomain(tone(1));
		expect(level).toBeGreaterThan(0);
		expect(level).toBeLessThanOrEqual(1);
	});
});

describe("normalizing", () => {
	test("a quiet room sits at rest instead of shimmering", () => {
		expect(normalizeLevel(0.005)).toBe(0);
		expect(normalizeLevel(0)).toBe(0);
	});

	test("ordinary speech is clearly visible, not a nudge", () => {
		// ~0.08 RMS is a normal speaking voice; a linear map would render it as
		// almost nothing, which is the failure this curve exists to avoid.
		expect(normalizeLevel(0.08)).toBeGreaterThan(0.4);
	});

	test("shouting is clamped rather than overflowing the animation", () => {
		expect(normalizeLevel(0.9)).toBeLessThanOrEqual(1);
		expect(normalizeLevel(0.9)).toBeCloseTo(1, 5);
	});

	test("is monotonic across the speech range", () => {
		let previous = -1;
		for (let rms = 0; rms <= 0.4; rms += 0.02) {
			const level = normalizeLevel(rms);
			expect(level).toBeGreaterThanOrEqual(previous);
			previous = level;
		}
	});

	test("rejects non-finite input rather than propagating NaN into the canvas", () => {
		expect(normalizeLevel(Number.NaN)).toBe(0);
		expect(normalizeLevel(Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
	});
});

describe("smoothing", () => {
	test("answers the start of a word faster than it decays after one", () => {
		const rising = smoothLevel(0, 1);
		const falling = 1 - smoothLevel(1, 0);
		expect(rising).toBeGreaterThan(falling);
	});

	test("converges on a steady signal", () => {
		let level = 0;
		for (let i = 0; i < 60; i += 1) level = smoothLevel(level, 0.6);
		expect(level).toBeCloseTo(0.6, 2);
	});

	test("returns to rest once the room goes quiet", () => {
		let level = 1;
		for (let i = 0; i < 200; i += 1) level = smoothLevel(level, 0);
		expect(level).toBeLessThan(0.01);
	});

	test("never overshoots the target", () => {
		expect(smoothLevel(0, 1)).toBeLessThanOrEqual(1);
		expect(smoothLevel(1, 0)).toBeGreaterThanOrEqual(0);
	});
});
