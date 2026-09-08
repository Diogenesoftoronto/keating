import { expect, it } from "bun:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createResumableExportJudge, type JudgeCheckpoint, type JudgeProgress, type JudgeScorerConfig } from "../keating/export-judge";
import type { RewardedTurn } from "../keating/reward";

const score = { masteryGain: 0.8, retention: 0.6, engagement: 0.7, transfer: 0.5, confusion: 0.1 };
const config: JudgeScorerConfig = { model: getModel("google", "gemini-3-flash-preview"), thinkingLevel: "minimal", maxTokens: 512, temperature: 0, timeoutMs: 1000, retries: 1 };
const turn = (completion: string): RewardedTurn => ({ context: [{ role: "user", content: "Explain fractions" }], completion } as RewardedTurn);
const response = (text = JSON.stringify(score)) => ({ result: async () => ({ content: [{ type: "text", text }] }) });
const cache = () => {
 const values = new Map<string, JudgeCheckpoint>();
 return { values, get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: JudgeCheckpoint) => { values.set(key, value); } };
};

it("checkpoints successes immediately and resumes without duplicate provider calls", async () => {
 const store = cache();
 let calls = 0;
 let latest: JudgeProgress | undefined;
 const judge = createResumableExportJudge({ primary: config, cache: store, onProgress: (value) => { latest = value; }, onPartial: (scores) => { if (scores[0]) expect(store.values.size).toBeGreaterThan(0); }, streamFn: (async () => { calls++; return response(); }) as any });
 expect(await judge([turn("One"), turn("One"), turn("Two")])).toEqual([score, score, score]);
 expect(calls).toBe(2);
 expect(latest).toMatchObject({ completed: 3, scored: 3, cached: 1, failed: 0 });
 expect([...store.values.keys()].every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
 expect(JSON.stringify([...store.values])).not.toContain("Explain fractions");
 const resume = createResumableExportJudge({ primary: { ...config, retries: 3, timeoutMs: 20 }, fallback: { ...config, thinkingLevel: "high" }, cache: store, streamFn: (async () => { calls++; return response(); }) as any });
 expect(await resume([turn("One"), turn("Two")])).toEqual([score, score]);
 expect(calls).toBe(2);
 const changed = createResumableExportJudge({ primary: { ...config, temperature: 0.5 }, cache: store, streamFn: (async () => { calls++; return response(); }) as any });
 await changed([turn("One")]);
 expect(calls).toBe(3);
});

it("retries malformed scores then records fallback provenance", async () => {
 const store = cache();
 let calls = 0;
 const fallback = { ...config, thinkingLevel: "high" as const, retries: 0 };
 let checkpoint: JudgeCheckpoint | undefined;
 const judge = createResumableExportJudge({ primary: config, fallback, cache: store, onCheckpoint: (_key, value) => { checkpoint = value; }, streamFn: (async (_model: unknown, _context: unknown, options: any) => { calls++; return options.reasoning === "high" ? response() : response("invalid JSON"); }) as any });
 expect(await judge([turn("One")])).toEqual([score]);
 expect(calls).toBe(3);
 expect(checkpoint).toMatchObject({ fallback: true, thinkingLevel: "high", provider: fallback.model.provider, model: fallback.model.id, score });
});

it("timeouts do not hang on noncooperative transport and retries are capped", async () => {
 let calls = 0;
 let latest: JudgeProgress | undefined;
 const judge = createResumableExportJudge({ primary: { ...config, timeoutMs: 2, retries: 100 }, cache: cache(), onProgress: (value) => { latest = value; }, streamFn: (() => { calls++; return new Promise(() => {}); }) as any });
 expect(await judge([turn("One")])).toEqual([null]);
 expect(calls).toBe(4);
 expect(latest).toMatchObject({ completed: 1, failed: 1, paused: false });
});

it("cancellation keeps aligned cached and completed scores without retry or fallback", async () => {
 const store = cache();
 await createResumableExportJudge({ primary: config, cache: store, streamFn: (async () => response()) as any })([turn("Cached later")]);
 const controller = new AbortController();
 let calls = 0;
 let latest: JudgeProgress | undefined;
 const judge = createResumableExportJudge({ primary: config, fallback: config, cache: store, signal: controller.signal, onProgress: (value) => { latest = value; }, streamFn: (async () => {
  calls++;
  if (calls === 1) return response();
  controller.abort();
  return new Promise(() => {});
 }) as any });
 expect(await judge([turn("First"), turn("Interrupted"), turn("Cached later")])).toEqual([score, null, score]);
 expect(calls).toBe(2);
 expect(latest).toMatchObject({ completed: 2, scored: 2, cached: 1, failed: 0, paused: true });
 expect(store.values.size).toBe(2);
});

it("propagates checkpoint storage failures instead of claiming durability", async () => {
 const judge = createResumableExportJudge({ primary: config, cache: { get: async () => null, set: async () => { throw new Error("Storage unavailable"); } }, streamFn: (async () => response()) as any });
 await expect(judge([turn("One")])).rejects.toThrow("Storage unavailable");
});
