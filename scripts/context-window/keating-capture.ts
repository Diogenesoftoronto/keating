import { runTeachingDrafts } from "../../packages/learner-contracts/src/judgement/teaching-drafts.js";
import type { JudgementAnswer, JudgementRequest } from "../../packages/learner-contracts/src/judgement/contracts.js";
import type { KeatingScenario } from "./keating-types.js";

/** Stage-control doubles only. These outputs never become benchmark answers or gold labels. */
function harnessAnswers(request: JudgementRequest, standard: string): Record<string, JudgementAnswer> {
  return Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { type: "noul", noul: id.startsWith("quality_") ? 1 : 0 }];
    if (question.type === "choice") {
      const choice = id === "draft_standard" ? standard : Object.keys(question.criteria)[0]!;
      return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) }];
    }
    return [id, { type: "score", score: 0, confidence: 1, probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(index === 0)])), legend: Object.fromEntries(question.criteria.map((value, index) => [String(index), value])) }];
  }));
}

/** Run the actual private-draft orchestration with local doubles to capture its exact judge boundary. */
export async function captureKeatingRequests(scenario: KeatingScenario): Promise<JudgementRequest[]> {
  if (scenario.stage === "grading" || scenario.stage === "turn-analysis") {
    if (!scenario.request) throw Error("production-grading-request-required");
    return [structuredClone(scenario.request)];
  }
  if (scenario.stage === "adherence" && !scenario.reply) throw Error("draft-reply-required");
  const captured: JudgementRequest[] = [];
  let phase = "planning";
  await runTeachingDrafts({ turn: structuredClone(scenario.turn), maxAttempts: 1, maxReasoning: "off", random: () => 0, now: () => 0,
    judgementModel: { id: "capture-only", requestTokens: 64_000, stateQuestionTokens: 32_000 },
    onProgress(snapshot) { phase = snapshot.phase; },
    judge: async request => {
      if (phase === (scenario.stage === "planning" ? "planning" : "checking")) captured.push(structuredClone(request));
      return { ok: true, response: { backend: { backend: "fixture", model: "not-an-evaluated-model", calibrationSha256: null }, answers: harnessAnswers(request, scenario.standard ?? "supported") } };
    },
    generate: async () => ({ reply: structuredClone(scenario.reply ?? { text: "Fixture response for request capture only.", toolCalls: [] }), value: null }),
  });
  if (!captured.length) throw Error(`no-production-request-captured:${scenario.id}`);
  const allKeys = captured.flatMap(request => Object.keys(request.questions));
  if (new Set(allKeys).size !== allKeys.length) throw Error("duplicate-captured-question");
  if (Object.keys(scenario.expected).some(key => !allKeys.includes(key))) throw Error(`gold-question-not-in-production-batch:${scenario.id}`);
  return captured;
}
