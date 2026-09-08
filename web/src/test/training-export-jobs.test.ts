import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createResumableExportJudge } from "../keating/export-judge";
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
	const score = { masteryGain: .7, retention: .7, engagement: .7, transfer: .7, confusion: .2 };
	const streamFn = (async () => { calls++; return { result: async () => ({ content: [{ type: "text", text: JSON.stringify(score) }] }) }; }) as any;
	const example = { context: [{ role: "user", content: "Durable job fixture" }], completion: "A completed score survives a new scorer instance." } as RewardedTurn;
	const first = createResumableExportJudge({ primary, cache: trainingScoreCache, streamFn });
	expect(await first([example])).toEqual([score]);
	const restored = await loadTrainingExportJob();
	const resumed = createResumableExportJudge({ primary: restored!.primary, cache: trainingScoreCache, streamFn });
	expect(await resumed([example])).toEqual([score]);
	expect(calls).toBe(1);
});
