import { expect, test } from "bun:test";
import { createLocalJudgementCaller, type JudgementQuestion, type LocalLabelScorer } from "@keating/learner-contracts";
import { createDesktopLocalLabelScorer } from "../keating/judgement/local-scorer";
import { DESKTOP_OFFLINE_MODEL, type DesktopOfflineBridge } from "../lib/desktop-offline";

const question: JudgementQuestion = { type: "choice", instructions: "Choose evidence.", criteria: { opaque_a: "independent solution", opaque_b: "needed help" } };
const input: Parameters<LocalLabelScorer>[0] = { state: { work: "independent solution" }, question, instructions: question.instructions, labels: ["opaque_a", "opaque_b"] };
const bridge = (scoreLabels: NonNullable<DesktopOfflineBridge["scoreLabels"]>, cancelScoring?: DesktopOfflineBridge["cancelScoring"]) => ({ scoreLabels, cancelScoring }) as DesktopOfflineBridge;

test("full semantics reach native scoring and NLL converts in the correct direction", async () => {
  const scorer = createDesktopLocalLabelScorer({ modelId: DESKTOP_OFFLINE_MODEL.id, bridge: bridge(async request => {
    expect(request.modelId).toBe(DESKTOP_OFFLINE_MODEL.id);
    expect(request.labelCount).toBe(2);
    const payload = JSON.parse(request.prompt.split("\n").at(-1)!);
    expect(payload.state).toEqual(input.state);
    expect(payload.question).toEqual(question);
    expect(payload.candidates).toEqual([
      { index: 0, label: "opaque_a", meaning: "independent solution" },
      { index: 1, label: "opaque_b", meaning: "needed help" },
    ]);
    return { modelId: request.modelId, negativeLogLikelihoods: [2, 2 + Math.log(3)] };
  }) });
  const result = await createLocalJudgementCaller({ model: DESKTOP_OFFLINE_MODEL.id, scoreLabels: scorer })({ state: input.state, questions: { selection: question } });
  if (!result.ok) throw Error("expected response");
  const answer = result.response.answers.selection;
  if (answer.type !== "choice") throw Error("expected Choice");
  expect(answer.choice).toBe("opaque_a");
  expect(answer.probabilities.opaque_a).toBeCloseTo(0.75, 10);
  expect(answer.probabilities.opaque_b).toBeCloseTo(0.25, 10);
  expect(result.response.backend.calibrationSha256).toBeNull();
});

test("Noul poles and ordered Score levels survive candidate remapping", async () => {
  for (const q of [
    { type: "noul", instructions: "Ready?", criteria: { false: "no independent work", true: "independent work" } },
    { type: "score", instructions: "Evidence?", criteria: ["absent", "present"] },
  ] satisfies JudgementQuestion[]) {
    const scorer = createDesktopLocalLabelScorer({ modelId: DESKTOP_OFFLINE_MODEL.id, bridge: bridge(async request => {
      const payload = JSON.parse(request.prompt.split("\n").at(-1)!);
      expect(payload.candidates.map((candidate: { meaning: string }) => candidate.meaning)).toEqual(q.type === "noul" ? [q.criteria.false, q.criteria.true] : q.criteria);
      return { modelId: request.modelId, negativeLogLikelihoods: [1000, 1001] };
    }) });
    const scores = await scorer({ ...input, question: q, instructions: q.instructions, labels: q.type === "noul" ? ["no", "yes"] : ["0", "1"] });
    expect(scores![0]).toBe(1);
    expect(scores![1]).toBeCloseTo(Math.exp(-1), 10);
  }
});

test("absent capability, model mismatch and unusable scores abstain", async () => {
  expect(await createDesktopLocalLabelScorer({ modelId: DESKTOP_OFFLINE_MODEL.id, bridge: {} as DesktopOfflineBridge })(input)).toBeNull();
  let calls = 0;
  const runtime = bridge(async () => { calls++; return null; });
  expect(await createDesktopLocalLabelScorer({ modelId: "other-model", bridge: runtime })(input)).toBeNull();
  expect(calls).toBe(0);
  for (const result of [null, { modelId: "other", negativeLogLikelihoods: [1, 2] },
    { modelId: DESKTOP_OFFLINE_MODEL.id, negativeLogLikelihoods: [NaN, 1] },
    { modelId: DESKTOP_OFFLINE_MODEL.id, negativeLogLikelihoods: [-1, 1] },
    { modelId: DESKTOP_OFFLINE_MODEL.id, negativeLogLikelihoods: [1] }]) {
    expect(await createDesktopLocalLabelScorer({ modelId: DESKTOP_OFFLINE_MODEL.id, bridge: bridge(async () => result) })(input)).toBeNull();
  }
});

test("invalid labels and oversized input never reach the native process", async () => {
  let calls = 0;
  const scorer = createDesktopLocalLabelScorer({ modelId: DESKTOP_OFFLINE_MODEL.id, bridge: bridge(async () => { calls++; return null; }) });
  expect(await scorer({ ...input, labels: ["opaque_b", "opaque_a"] })).toBeNull();
  expect(await scorer({ ...input, state: "x".repeat(24001) })).toBeNull();
  expect(calls).toBe(0);
});

test("abort cancels only its native request and refuses late likelihoods", async () => {
  const controller = new AbortController();
  let requestId = "", cancelled = "";
  const scorer = createDesktopLocalLabelScorer({ modelId: DESKTOP_OFFLINE_MODEL.id, bridge: bridge(async request => {
    requestId = request.requestId;
    controller.abort();
    return { modelId: request.modelId, negativeLogLikelihoods: [0, 10] };
  }, async id => { cancelled = id; }) });
  expect(await scorer({ ...input, signal: controller.signal })).toBeNull();
  expect(cancelled).toBe(requestId);
  expect(requestId.length).toBeGreaterThan(0);
});
