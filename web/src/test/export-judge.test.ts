import { expect, it } from "bun:test";
import { getModel, type Api, type Context, type Model } from "@earendil-works/pi-ai/compat";
import { createKeatingExportJudge, parseJudgeScore } from "../keating/export-judge";
import type { RewardedTurn } from "../keating/reward";

const valid = { masteryGain: 0.8, retention: 0.6, engagement: 0.7, transfer: 0.5, confusion: 0.1 };

it("scores every response without a cap and forwards the selected thinking level", async () => {
	const seen: any[] = [];
	const judge = createKeatingExportJudge({
		maxExamples: Number.POSITIVE_INFINITY,
		thinkingLevel: "high",
		streamFn: (async (_model: unknown, _context: unknown, options: unknown) => {
			seen.push(options);
			return { result: async () => ({ content: [{ type: "text", text: JSON.stringify(valid) }] }) };
		}) as any,
	});
	const turn = { context: [{ role: "user", content: "Explain fractions" }], completion: "Equal parts of a whole." } as RewardedTurn;
	expect(await judge(Array.from({ length: 201 }, () => turn))).toHaveLength(201);
	expect(seen).toHaveLength(201);
	expect(seen.every(options => options.reasoning === "high" && options.maxTokens > 160)).toBe(true);
});

it("does not turn null, strings, or missing rubric values into scores", () => {
	expect(parseJudgeScore(JSON.stringify(valid))).toEqual(valid);
	for (const bad of [null, {}, { ...valid, masteryGain: null }, { ...valid, retention: "0.6" }]) {
		expect(parseJudgeScore(JSON.stringify(bad))).toBeNull();
	}
});

it("uses the selected model, limits requests, and leaves failed or skipped scores missing", async () => {
	const model = getModel("google", "gemini-3-flash-preview");
	const seen: unknown[] = [];
	const judge = createKeatingExportJudge({
		model,
		maxExamples: 2,
		streamFn: (async (selected: Model<Api>, context: Context) => {
			seen.push(selected);
			expect(JSON.stringify(context)).not.toContain("baseReward");
			if (seen.length === 2) throw new Error("Simulated provider failure");
			return { result: async () => ({ content: [{ type: "text", text: JSON.stringify(valid) }] }) };
		}) as any,
	});
	const turn = { context: [{ role: "user", content: "Explain fractions" }], completion: "Divide a whole into equal parts.", reward: 0.5 } as RewardedTurn;
	expect(await judge([turn, turn, turn])).toEqual([valid, null, null]);
	expect(seen).toEqual([model, model]);
});
