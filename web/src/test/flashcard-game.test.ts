import { describe, expect, it } from "bun:test";

import {
	DEFAULT_FLASHCARD_SHADER_PRESET,
	FLASHCARD_SHADER_OPTIONS,
	normalizeFlashcardShaderPreset,
	recallRunRank,
	reviewPoints,
} from "../components/flashcards/game";

describe("flashcard recall run", () => {
	it("ships six visually animated shader presets plus a still option", () => {
		const animated = FLASHCARD_SHADER_OPTIONS.filter((option) => option.id !== "still");
		expect(animated).toHaveLength(6);
		expect(new Set(FLASHCARD_SHADER_OPTIONS.map((option) => option.id)).size).toBe(
			FLASHCARD_SHADER_OPTIONS.length,
		);
		expect(FLASHCARD_SHADER_OPTIONS.every((option) => option.label && option.description)).toBe(true);
	});

	it("normalizes missing and retired shader values to the default", () => {
		expect(normalizeFlashcardShaderPreset("contour")).toBe("contour");
		expect(normalizeFlashcardShaderPreset("old-noise")).toBe(DEFAULT_FLASHCARD_SHADER_PRESET);
		expect(normalizeFlashcardShaderPreset(null)).toBe(DEFAULT_FLASHCARD_SHADER_PRESET);
	});

	it("awards cosmetic combo bonuses without rewarding a miss", () => {
		expect(reviewPoints(0, 8)).toBe(0);
		expect(reviewPoints(1, 8)).toBe(35);
		expect(reviewPoints(2, 1)).toBe(100);
		expect(reviewPoints(2, 4)).toBeGreaterThan(reviewPoints(2, 1));
		expect(reviewPoints(3, 50)).toBe(reviewPoints(3, 10));
	});

	it("describes clean, mixed, and calibration runs without changing SRS outcomes", () => {
		expect(recallRunRank({ reviewed: 6, lapses: 0, bestCombo: 6 }).label).toBe("Clean circuit");
		expect(recallRunRank({ reviewed: 10, lapses: 2, bestCombo: 3 }).label).toBe("Bright signal");
		expect(recallRunRank({ reviewed: 10, lapses: 7, bestCombo: 1 }).label).toBe("Calibration run");
		expect(recallRunRank({ reviewed: 0, lapses: 0, bestCombo: 0 }).label).toBe("Ready signal");
	});
});
