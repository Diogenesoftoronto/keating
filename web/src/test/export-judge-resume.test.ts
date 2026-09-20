import { expect, it } from "bun:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import type { JudgementBackendKey, JudgementCaller, JudgementOutcome, ScoreAnswer } from "@keating/learner-contracts";
import {
	JUDGE_DIMENSIONS,
	createResumableExportJudge,
	judgeCheckpointKey,
	judgeScorerLadder,
	type JudgeCheckpoint,
	type JudgeProgress,
	type JudgeScorerConfig,
} from "../keating/export-judge";
import type { RewardedTurn } from "../keating/reward";

const LEVELS: Record<string, number> = { masteryGain: 4, retention: 3, engagement: 3, transfer: 2, confusion: 4 };
/** What those levels project to: index/4, with confusion inverted. */
const score = { masteryGain: 1, retention: 0.75, engagement: 0.75, transfer: 0.5, confusion: 0 };

function atLevel(level: number, confidence = 0.9): ScoreAnswer {
	const probabilities: Record<string, number> = {};
	const legend: Record<string, string> = {};
	for (let index = 0; index < 5; index += 1) {
		probabilities[String(index)] = index === level ? 1 : 0;
		legend[String(index)] = `level ${index}`;
	}
	return { type: "score", score: level, legend, probabilities, confidence };
}

const BACKEND: JudgementBackendKey = { backend: "system-one", model: "jev-latest", calibrationSha256: null };

function scored(backend: JudgementBackendKey = BACKEND): JudgementOutcome {
	return {
		ok: true,
		response: {
			answers: Object.fromEntries(JUDGE_DIMENSIONS.map((dimension) => [dimension, atLevel(LEVELS[dimension])])),
			backend,
		},
	};
}

const unusable: JudgementOutcome = { ok: false, error: { code: "response-malformed", retryable: false } };

const config: JudgeScorerConfig = { model: getModel("google", "gemini-3-flash-preview"), thinkingLevel: "minimal", maxTokens: 512, temperature: 0, timeoutMs: 1000, retries: 1 };
const turn = (completion: string): RewardedTurn => ({ context: [{ role: "user", content: "Explain fractions" }], completion } as RewardedTurn);
const cache = () => {
	const values = new Map<string, JudgeCheckpoint>();
	return { values, get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: JudgeCheckpoint) => { values.set(key, value); } };
};

it("checkpoints successes immediately and resumes without duplicate judgement calls", async () => {
	const store = cache();
	let calls = 0;
	let latest: JudgeProgress | undefined;
	const caller: JudgementCaller = async () => { calls++; return scored(); };
	const judge = createResumableExportJudge({ primary: config, backend: BACKEND, caller, cache: store, onProgress: (value) => { latest = value; }, onPartial: (scores) => { if (scores[0]) expect(store.values.size).toBeGreaterThan(0); } });
	expect(await judge([turn("One"), turn("One"), turn("Two")])).toEqual([score, score, score]);
	expect(calls).toBe(2);
	expect(latest).toMatchObject({ completed: 3, scored: 3, cached: 1, failed: 0 });
	expect([...store.values.keys()].every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
	expect(JSON.stringify([...store.values])).not.toContain("Explain fractions");
	const resume = createResumableExportJudge({ primary: { ...config, retries: 3, timeoutMs: 20 }, fallback: { ...config, thinkingLevel: "high" }, backend: BACKEND, caller, cache: store });
	expect(await resume([turn("One"), turn("Two")])).toEqual([score, score]);
	expect(calls).toBe(2);
	const changed = createResumableExportJudge({ primary: { ...config, temperature: 0.5 }, backend: BACKEND, caller, cache: store });
	await changed([turn("One")]);
	expect(calls).toBe(3);
});

it("gives a different checkpoint key to a different judgement backend", async () => {
	const example = turn("One");
	const base = await judgeCheckpointKey(example, config, BACKEND);
	const otherBackend = await judgeCheckpointKey(example, config, { ...BACKEND, backend: "local" });
	const otherModel = await judgeCheckpointKey(example, config, { ...BACKEND, model: "minicpm5-2b" });
	const otherCalibration = await judgeCheckpointKey(example, config, { ...BACKEND, calibrationSha256: "a".repeat(64) });
	expect(new Set([base, otherBackend, otherModel, otherCalibration]).size).toBe(4);
	expect(await judgeCheckpointKey(example, config, { ...BACKEND })).toBe(base);
});

it("never serves one backend's cached score to another", async () => {
	const store = cache();
	let calls = 0;
	const caller: JudgementCaller = async () => { calls++; return scored(); };
	const hosted = createResumableExportJudge({ primary: config, backend: BACKEND, caller, cache: store });
	expect(await hosted([turn("One")])).toEqual([score]);
	expect(calls).toBe(1);
	const local = createResumableExportJudge({ primary: config, backend: { backend: "local", model: "minicpm5-2b", calibrationSha256: null }, caller, cache: store });
	expect(await local([turn("One")])).toEqual([score]);
	// A cache hit would have left this at 1; the backend is part of the key.
	expect(calls).toBe(2);
	expect(store.values.size).toBe(2);
});

it("records which backend actually answered", async () => {
	let checkpoint: JudgeCheckpoint | undefined;
	const caller: JudgementCaller = async () => scored({ backend: "local", model: "minicpm5-2b", calibrationSha256: null });
	const judge = createResumableExportJudge({ primary: config, backend: BACKEND, caller, cache: cache(), onCheckpoint: (_key, value) => { checkpoint = value; } });
	await judge([turn("One")]);
	expect(checkpoint?.backend).toEqual({ backend: "local", model: "minicpm5-2b", calibrationSha256: null });
});

it("walks an N-tier ladder and records every rung past the first as a fallback", async () => {
	const third: JudgeScorerConfig = { ...config, thinkingLevel: "high", retries: 0 };
	const ladder = judgeScorerLadder({ primary: config, fallback: { ...config, retries: 0 }, tiers: [third] });
	expect(ladder.map(([, isFallback]) => isFallback)).toEqual([false, true, true]);

	const seen: number[] = [];
	let checkpoint: JudgeCheckpoint | undefined;
	const judge = createResumableExportJudge({
		primary: { ...config, retries: 0 },
		fallback: { ...config, retries: 0 },
		tiers: [third],
		backend: BACKEND,
		cache: cache(),
		onCheckpoint: (_key, value) => { checkpoint = value; },
		// Only the third rung can answer, so the cascade has to reach it.
		resolveCaller: (_config, index) => async () => { seen.push(index); return index === 2 ? scored() : unusable; },
	});
	expect(await judge([turn("One")])).toEqual([score]);
	expect(seen).toEqual([0, 1, 2]);
	expect(checkpoint).toMatchObject({ fallback: true, thinkingLevel: "high" });
});

it("retries an unusable answer then records fallback provenance", async () => {
	const store = cache();
	let calls = 0;
	const fallback = { ...config, thinkingLevel: "high" as const, retries: 0 };
	let checkpoint: JudgeCheckpoint | undefined;
	const judge = createResumableExportJudge({
		primary: config, fallback, backend: BACKEND, cache: store,
		onCheckpoint: (_key, value) => { checkpoint = value; },
		resolveCaller: (tierConfig) => async () => { calls++; return tierConfig.thinkingLevel === "high" ? scored() : unusable; },
	});
	expect(await judge([turn("One")])).toEqual([score]);
	expect(calls).toBe(3);
	expect(checkpoint).toMatchObject({ fallback: true, thinkingLevel: "high", provider: fallback.model.provider, model: fallback.model.id, score });
});

it("timeouts do not hang on noncooperative transport and retries are capped", async () => {
	let calls = 0;
	let latest: JudgeProgress | undefined;
	const judge = createResumableExportJudge({ primary: { ...config, timeoutMs: 2, retries: 100 }, backend: BACKEND, cache: cache(), onProgress: (value) => { latest = value; }, caller: (() => { calls++; return new Promise(() => {}); }) as JudgementCaller });
	expect(await judge([turn("One")])).toEqual([null]);
	expect(calls).toBe(4);
	expect(latest).toMatchObject({ completed: 1, failed: 1, paused: false });
});

it("cancellation keeps aligned cached and completed scores without retry or fallback", async () => {
	const store = cache();
	await createResumableExportJudge({ primary: config, backend: BACKEND, caller: async () => scored(), cache: store })([turn("Cached later")]);
	const controller = new AbortController();
	let calls = 0;
	let latest: JudgeProgress | undefined;
	const judge = createResumableExportJudge({
		primary: config, fallback: config, backend: BACKEND, cache: store, signal: controller.signal,
		onProgress: (value) => { latest = value; },
		caller: (async () => {
			calls++;
			if (calls === 1) return scored();
			controller.abort();
			return new Promise(() => {});
		}) as JudgementCaller,
	});
	expect(await judge([turn("First"), turn("Interrupted"), turn("Cached later")])).toEqual([score, null, score]);
	expect(calls).toBe(2);
	expect(latest).toMatchObject({ completed: 2, scored: 2, cached: 1, failed: 0, paused: true });
	expect(store.values.size).toBe(2);
});

it("propagates checkpoint storage failures instead of claiming durability", async () => {
	const judge = createResumableExportJudge({ primary: config, backend: BACKEND, caller: async () => scored(), cache: { get: async () => null, set: async () => { throw new Error("Storage unavailable"); } } });
	await expect(judge([turn("One")])).rejects.toThrow("Storage unavailable");
});

it("scores nothing, and throws nothing, when no judgement backend is wired", async () => {
	const store = cache();
	const judge = createResumableExportJudge({ primary: config, cache: store });
	expect(await judge([turn("One")])).toEqual([null]);
	expect(store.values.size).toBe(0);
});
