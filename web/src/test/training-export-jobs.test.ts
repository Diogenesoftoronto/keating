import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import type { JudgementCaller, ScoreAnswer } from "@keating/learner-contracts";
import { JUDGE_DIMENSIONS, createResumableExportJudge } from "../keating/export-judge";
import { loadTrainingExportJob, saveTrainingExportJob, trainingScoreCache } from "../keating/training-export-jobs";
import { buildWebFineTuneExportFromSources } from "../keating/export";
import type { RewardedTurn } from "../keating/reward";

let originalIndexedDB: PropertyDescriptor | undefined;
beforeEach(() => {
	originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
	Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
});
afterEach(() => {
	if (originalIndexedDB) Object.defineProperty(globalThis, "indexedDB", originalIndexedDB);
	else Reflect.deleteProperty(globalThis, "indexedDB");
});

it("restores a saved dataset and reuses durable scores in a new scoring run", async () => {
	const primary = { model: getModel("google", "gemini-3-flash-preview"), thinkingLevel: "minimal" as const, maxTokens: 512, temperature: 0, retries: 0, timeoutMs: 1000 };
	const options = { source: "all" as const, format: "both" as const, redact: true, minAssistantChars: 1 };
	const bundle = await buildWebFineTuneExportFromSources({}, options);
	await saveTrainingExportJob({ version: 1, sources: {}, options, primary, scoring: true, maxExamples: null, bundle, updatedAt: 123 });
	expect((await loadTrainingExportJob())?.bundle.manifestJson).toBe(bundle.manifestJson);
	let calls = 0;
	// Level 3 of 5 projects to 0.75; confusion is a harm, so it reads inverted.
	const level3: ScoreAnswer = {
		type: "score",
		score: 3,
		legend: { 0: "a", 1: "b", 2: "c", 3: "d", 4: "e" },
		probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 },
		confidence: 0.9,
	};
	const score = { masteryGain: .75, retention: .75, engagement: .75, transfer: .75, confusion: .25 };
	const caller: JudgementCaller = async () => {
		calls++;
		return {
			ok: true,
			response: {
				answers: Object.fromEntries(JUDGE_DIMENSIONS.map((dimension) => [dimension, level3])),
				backend: { backend: "fixture", model: "test", calibrationSha256: null },
			},
		};
	};
	const example = { context: [{ role: "user", content: "Durable job fixture" }], completion: "A completed score survives a new scorer instance." } as RewardedTurn;
	const first = createResumableExportJudge({ primary, cache: trainingScoreCache, caller });
	expect(await first([example])).toEqual([score]);
	const restored = await loadTrainingExportJob();
	const resumed = createResumableExportJudge({ primary: restored!.primary, cache: trainingScoreCache, caller });
	expect(await resumed([example])).toEqual([score]);
	expect(calls).toBe(1);
});
