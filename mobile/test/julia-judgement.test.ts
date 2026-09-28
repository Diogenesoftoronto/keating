import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { JudgementQuestion } from "@keating/learner-contracts";
import { configuredMobileJudgementRuntime, createMobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { MobileJudgementCalibrationStore } from "../src/lib/judgement/calibration";
import { MOBILE_JULIA_MODEL } from "../src/lib/judgement/julia-contract";
import { MOBILE_LOCAL_JUDGEMENT_MODEL } from "../src/lib/judgement/local-scorer";
import { normalizeUiSettings } from "../src/lib/ui-settings";
import { createJuliaLabelScorer } from "../../shared/julia/scorer";

const question: JudgementQuestion = { type: "choice", instructions: "Which answer matches the evidence?", criteria: { supported: "Fully supported by the saved work", other: "Missing supporting work" } };
const hash = async (text: string) => createHash("sha256").update(text).digest("hex");
const disk = () => { const values = new Map<string, string>(); return { getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } }; };

test("Julia local selection pins the Android encoder/runtime identity, stays independent of hosted permission, and cancels on model change", async () => {
  let selected = "julia-1", hostedCalls = 0;
  const runtime = await configuredMobileJudgementRuntime({ loadSettings: async () => ({ judgementHosted: false, judgementLocalModel: selected }),
    localCalibrationStore: new MobileJudgementCalibrationStore(disk(), hash, "local", MOBILE_JULIA_MODEL),
    localScorer: async () => [0.9, 0.1], request: async () => { hostedCalls++; throw Error("Unexpected hosted request"); } });
  const result = await runtime.call({ state: "Saved explanation", questions: { q: question } });
  expect(result.ok && result.response.backend).toEqual({ backend: "local", model: MOBILE_JULIA_MODEL, calibrationSha256: null });
  expect(runtime.policy.tiers[0]!.key.model).not.toBe(MOBILE_LOCAL_JUDGEMENT_MODEL);
  expect(Object.keys(runtime.policy.calibration.entries)).toHaveLength(0);
  expect(hostedCalls).toBe(0);
  selected = "minicpm5-2b-int4";
  expect(await runtime.call({ state: "Saved explanation", questions: { q: question } })).toMatchObject({ ok: false, error: { code: "cancelled" } });
  expect(normalizeUiSettings({ judgementLocalModel: "julia-1" }).judgementHosted).toBe(false);
  expect(normalizeUiSettings({ judgementLocalModel: "julia-1" }).judgementLocalModel).toBe("julia-1");
});

test("Julia receives descriptive option poles and preserves returned option ordering", async () => {
  const scoreLabels = createJuliaLabelScorer({ weights: async rows => {
    expect(rows).toEqual([{ state: "work", question: question.instructions, type: "choice", options: ["Fully supported by the saved work", "Missing supporting work"] }]);
    return [[0.25, 0.75]];
  } });
  const runtime = createMobileJudgementRuntime({ hostedEnabled: false, localEnabled: true, localModel: MOBILE_JULIA_MODEL, localScorer: scoreLabels });
  const result = await runtime.call({ state: "work", questions: { q: question } });
  expect(result.ok && result.response.answers.q).toMatchObject({ type: "choice", choice: "other", probabilities: { supported: 0.25, other: 0.75 } });
});

test("MiniCPM calibration cannot authorize a Julia action or dispatch its scorer", async () => {
  let calls = 0;
  const runtime = createMobileJudgementRuntime({ hostedEnabled: false, localEnabled: true, localModel: MOBILE_JULIA_MODEL,
    localCalibration: { backend: { backend: "local", model: MOBILE_LOCAL_JUDGEMENT_MODEL, calibrationSha256: "a".repeat(64) },
      table: { entries: {} }, fileSha256: "b".repeat(64), questionCount: 1 }, localScorer: async () => { calls++; return [1, 0]; } });
  expect(await runtime.call({ state: "work", questions: { q: question } })).toMatchObject({ ok: false, error: { code: "backend-unavailable" } });
  expect(calls).toBe(0);
});
