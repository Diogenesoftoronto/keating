import type { UiCodingChallengeNode, UiMusicLabNode } from "@keating/learner-contracts";

export const TWO_SUM_CHALLENGE: UiCodingChallengeNode = {
	type: "coding-challenge", id: "two-sum", title: "Find the pair", language: "javascript",
	prompt: "Return the **indices** of two numbers that add up to `target`. Use each index once. Exactly one pair exists; return the smaller index first.",
	entrypoint: "twoSum",
	starterCode: "function twoSum(nums, target) {\n  // Find two different indices.\n  return [];\n}",
	tests: [
		{ id: "neighbors", label: "A pair near the start", args: [[2, 7, 11, 15], 9], expected: [0, 1] },
		{ id: "middle", label: "Look beyond the first number", args: [[3, 2, 4], 6], expected: [1, 2] },
		{ id: "duplicates", label: "Same value, different indices", args: [[3, 3], 6], expected: [0, 1] },
	],
	hint: "For each number, ask which other value would complete the target. A map can remember values you have already seen.",
};

/** Based on the listening operations in docs/artifact-atlas.html Signal Lab. */
export const MUSIC_LAB_EXAMPLES: Record<"polyrhythm" | "intervals" | "timbre", UiMusicLabNode> = {
	polyrhythm: {
		type: "music-lab", id: "three-against-four", title: "Three against four",
		brief: "Two rhythms, one loop. Change either pulse count and find where they meet.",
		visualization: "pianoroll",
		controls: [
			{ id: "tempo", label: "Tempo", min: 48, max: 160, step: 1, value: 96, unit: "BPM" },
			{ id: "lowPulses", label: "Low pulses", min: 1, max: 8, step: 1, value: 3 },
			{ id: "highPulses", label: "High pulses", min: 1, max: 8, step: 1, value: 4 },
		],
		code: 'setcpm(controls.tempo / 4)\nstack(\n  note("c3").fast(controls.lowPulses).s("sine").gain(0.18),\n  note("g4").fast(controls.highPulses).s("triangle").gain(0.08)\n).attack(0.005).decay(0.08).sustain(0).release(0.04)',
	},
	intervals: {
		type: "music-lab", id: "hear-the-distance", title: "Hear the distance",
		brief: "Move from a minor third (3) to a fifth (7) or octave (12). Hear the distance change.",
		visualization: "pianoroll",
		controls: [
			{ id: "tempo", label: "Tempo", min: 48, max: 140, step: 1, value: 80, unit: "BPM" },
			{ id: "root", label: "Starting note", min: 48, max: 72, step: 1, value: 60, unit: "MIDI" },
			{ id: "interval", label: "Interval", min: 0, max: 12, step: 1, value: 3, unit: "semitones" },
		],
		code: 'setcpm(controls.tempo / 4)\nnote(controls.root + \' \' + (controls.root + controls.interval))\n  .s("sine").attack(0.015).release(0.12)\n  .gain(0.16)',
	},
	timbre: {
		type: "music-lab", id: "build-a-timbre", title: "Build a timbre",
		brief: "Add harmonics to a sine wave. Watch the shape change, then soften it with the filter.",
		visualization: "scope",
		controls: [
			{ id: "frequency", label: "Fundamental", min: 110, max: 440, step: 1, value: 220, unit: "Hz" },
			{ id: "second", label: "Second harmonic", min: 0, max: 100, step: 1, value: 50, unit: "%" },
			{ id: "third", label: "Third harmonic", min: 0, max: 100, step: 1, value: 33, unit: "%" },
			{ id: "cutoff", label: "Filter cutoff", min: 120, max: 3000, step: 10, value: 2000, unit: "Hz" },
		],
		code: 'setcps(1)\nstack(\n  freq(controls.frequency).gain(0.12),\n  freq(controls.frequency * 2).gain(controls.second * 0.0012),\n  freq(controls.frequency * 3).gain(controls.third * 0.0012)\n).s("sine").lpf(controls.cutoff)\n .attack(0.03).decay(0).sustain(1).release(0.05)',
	},
};
