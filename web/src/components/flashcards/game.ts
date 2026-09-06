import type { SrsRating } from "../../keating/srs";

export type FlashcardShaderPreset =
	| "phosphor"
	| "solar"
	| "orbit"
	| "prism"
	| "current"
	| "contour"
	| "still";

export interface FlashcardShaderOption {
	id: FlashcardShaderPreset;
	label: string;
	description: string;
}

export const FLASHCARD_SHADER_OPTIONS: readonly FlashcardShaderOption[] = [
	{
		id: "phosphor",
		label: "Phosphor",
		description: "A drifting CRT dot field with a slow refresh sweep.",
	},
	{
		id: "solar",
		label: "Solar",
		description: "Amber and coral energy rings that react like a warm arcade cabinet.",
	},
	{
		id: "orbit",
		label: "Orbit",
		description: "A quiet star map with rotating instrument rings.",
	},
	{
		id: "prism",
		label: "Prism",
		description: "Mirrored angular light shards with a sharp arcade rhythm.",
	},
	{
		id: "current",
		label: "Current",
		description: "Electric interference filaments that stream across the arena.",
	},
	{
		id: "contour",
		label: "Contour",
		description: "A drifting topographic field drawn as luminous elevation lines.",
	},
	{
		id: "still",
		label: "Still",
		description: "A static low-power backdrop with no animated shader.",
	},
] as const;

export const DEFAULT_FLASHCARD_SHADER_PRESET: FlashcardShaderPreset = "phosphor";

export function normalizeFlashcardShaderPreset(value: unknown): FlashcardShaderPreset {
	return FLASHCARD_SHADER_OPTIONS.some((option) => option.id === value)
		? value as FlashcardShaderPreset
		: DEFAULT_FLASHCARD_SHADER_PRESET;
}

const BASE_REVIEW_POINTS: Record<SrsRating, number> = {
	0: 0,
	1: 35,
	2: 100,
	3: 140,
};

/**
 * Cosmetic run score. The spaced-repetition outcome remains authoritative;
 * points only make the practice loop easier to read and more satisfying.
 */
export function reviewPoints(rating: SrsRating, comboAfterReview: number): number {
	const base = BASE_REVIEW_POINTS[rating];
	if (rating < 2) return base;
	const combo = Number.isFinite(comboAfterReview)
		? Math.max(1, Math.floor(comboAfterReview))
		: 1;
	const bonusSteps = Math.min(9, combo - 1);
	return base + bonusSteps * (rating === 3 ? 18 : 12);
}

export interface RecallRunRank {
	label: string;
	detail: string;
}

export function recallRunRank(input: {
	reviewed: number;
	lapses: number;
	bestCombo: number;
}): RecallRunRank {
	const reviewed = Math.max(0, Math.floor(input.reviewed));
	const lapses = Math.min(reviewed, Math.max(0, Math.floor(input.lapses)));
	const bestCombo = Math.max(0, Math.floor(input.bestCombo));
	if (reviewed === 0) {
		return {
			label: "Ready signal",
			detail: "Reveal a card to begin the run.",
		};
	}
	if (lapses === 0 && bestCombo >= Math.min(5, reviewed)) {
		return {
			label: "Clean circuit",
			detail: "No lapses, and the recall chain held.",
		};
	}
	const stableShare = (reviewed - lapses) / reviewed;
	if (stableShare >= 0.8) {
		return {
			label: "Bright signal",
			detail: "Most answers stayed available under retrieval.",
		};
	}
	if (stableShare >= 0.55) {
		return {
			label: "Signal found",
			detail: "The run exposed a useful mix of strong and weak recall.",
		};
	}
	return {
		label: "Calibration run",
		detail: "The difficult cards are now scheduled to return sooner.",
	};
}
