import { expect, test } from "bun:test";
import { decided, abstained, questionDigest, routeJudgement, thresholdKey, type RoutedQuestion } from "@keating/learner-contracts";
import { JULIA_BROWSER_MODEL_ID, JULIA_MODEL_ID, JULIA_MOBILE_MODEL_ID } from "../../../shared/julia/manifest.js";
import { createDesktopJuliaScorer } from "../keating/judgement/julia-scorer";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import type { DesktopOfflineBridge } from "../lib/desktop-offline";

const question: RoutedQuestion<boolean> = {
  key: "independent", question: { type: "noul", instructions: "Did the learner work independently?", criteria: { false: "Required direct help", true: "Solved without help" } }, baseline: false,
  read: (answer, thresholds, provenance) => answer.type === "noul" && answer.noul >= thresholds.actAtOrAbove
    ? decided(true, null, provenance) : abstained("below-confidence-floor", provenance),
};
const backend = { backend: "local" as const, model: JULIA_MODEL_ID, calibrationSha256: "a".repeat(64) };
const calibration = { backend, table: { entries: { [thresholdKey(backend, questionDigest(question.question))]: { deferBelow: .5, actAtOrAbove: .9 } } } };

test("Julia passes the complete evidence and descriptive poles through its separate native capability", async () => {
  const evidence = { answer: "I solved it without help.", history: ["Earlier attempt"] };
  const bridge = { supportedJudgementModels: [JULIA_MODEL_ID], scoreLabels: async (request: Record<string, unknown>) => {
    expect(request.modelId).toBe(JULIA_MODEL_ID);
    expect(request.state).toBe(evidence);
    expect(request.question).toBe(question.question.instructions);
    expect(request.options).toEqual(["Required direct help", "Solved without help"]);
    expect(request.type).toBe("noul");
    expect(request.prompt).toBeUndefined();
    return { modelId: JULIA_MODEL_ID, weights: [.01, .99] };
  } } as unknown as DesktopOfflineBridge;
  const runtime = createWebJudgementRuntime({ settings: { backend: "local", localModelId: JULIA_MODEL_ID, gatewayPath: "/api/judgement" }, desktopBridge: bridge, calibration: { local: calibration } });
  expect((await routeJudgement(evidence, question, runtime.policy)).value).toBe(true);
});

test("installing Julia cannot authorize automatic decisions without matching calibration", async () => {
  let calls = 0;
  const bridge = { supportedJudgementModels: [JULIA_MODEL_ID], scoreLabels: async () => { calls++; return { modelId: JULIA_MODEL_ID, weights: [0, 1] }; } } as unknown as DesktopOfflineBridge;
  for (const local of [undefined, { ...calibration, backend: { ...backend, model: JULIA_BROWSER_MODEL_ID } }, { ...calibration, backend: { ...backend, model: JULIA_MOBILE_MODEL_ID } }]) {
    const runtime = createWebJudgementRuntime({ settings: { backend: "local", localModelId: JULIA_MODEL_ID, gatewayPath: "/api/judgement" }, desktopBridge: bridge, calibration: { local } });
    const result = await routeJudgement("work", question, runtime.policy);
    expect(result.value).toBe(false);
    expect(result.attempts[0].outcome).toBe("skipped-uncalibrated");
  }
  expect(calls).toBe(0);
});

test("Julia cancellation discards a late answer and cancels the exact native request", async () => {
  const controller = new AbortController(); let requested = "", cancelled = "";
  const bridge = { supportedJudgementModels: [JULIA_MODEL_ID],
    cancelScoring: async (id: string) => { cancelled = id; },
    scoreLabels: async (request: { requestId: string }) => { requested = request.requestId; controller.abort(); return { modelId: JULIA_MODEL_ID, weights: [.01, .99] }; },
  } as unknown as DesktopOfflineBridge;
  expect(await createDesktopJuliaScorer(bridge)({ state: "work", question: question.question, instructions: question.question.instructions, labels: ["false", "true"], signal: controller.signal })).toBeNull();
  expect(cancelled).toBe(requested);
  expect(requested.length).toBeGreaterThan(0);
});

test("Julia rejects a foreign runtime result and malformed label weights", async () => {
  for (const result of [{ modelId: JULIA_BROWSER_MODEL_ID, weights: [.1, .9] }, { modelId: JULIA_MODEL_ID, weights: [.9] }, { modelId: JULIA_MODEL_ID, weights: [NaN, .9] }, { modelId: JULIA_MODEL_ID, weights: [-.1, 1.1] }]) {
    const bridge = { supportedJudgementModels: [JULIA_MODEL_ID], scoreLabels: async () => result } as unknown as DesktopOfflineBridge;
    expect(await createDesktopJuliaScorer(bridge)({ state: "work", question: question.question, instructions: question.question.instructions, labels: ["false", "true"] })).toBeNull();
  }
});
