import { expect, test } from "bun:test";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { JudgementAnswer, JudgementCaller, TeachingDraftCandidateText } from "@keating/learner-contracts";
import { withTeachingDraftGate } from "../keating/judgement/draft-gate";
const model = { id: "fixture", name: "Fixture", provider: "fixture", api: "openai-completions", baseUrl: "https://unused.test", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000 } as Model<Api>;
const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
  content: [{ type: "thinking", thinking: "HIDDEN_REASONING" }, { type: "text", text: "ANSWER_TEXT" }],
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 };
const context = { systemPrompt: "", messages: [{ role: "user" as const, content: "Explain this.", timestamp: 1 }], tools: [] };
const stream = () => { const result = createAssistantMessageEventStream(); result.end(message); return result; };
const judge: JudgementCaller = async request => {
  const answers: Record<string, JudgementAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "choice") {
      const choice = id === "draft_standard" ? "supported" : Object.keys(question.criteria)[0]!;
      answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
    } else if (question.type === "score") {
      answers[id] = { type: "score", score: 0, legend: Object.fromEntries(question.criteria.map((text, index) => [String(index), text])), probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(index === 0)])), confidence: 1 };
    } else answers[id] = { type: "noul", noul: .01 };
  }
  return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers } };
};

test("web capture is absent by default and text-only when explicitly enabled", async () => {
  const captured: (TeachingDraftCandidateText | null)[] = [];
  const options = { sessionId: "test", basePrompt: () => "", makeCaller: () => judge, maxAttempts: 1, onDraftContent: (candidate: TeachingDraftCandidateText | null) => captured.push(candidate) };
  await (await withTeachingDraftGate(stream, options)(model, context)).result();
  expect(captured.filter(Boolean)).toEqual([]);
  captured.length = 0;
  await (await withTeachingDraftGate(stream, { ...options, captureDraftContent: () => true })(model, context)).result();
  expect(captured.filter(Boolean)).toEqual([{ attempt: 1, variant: "default", text: "ANSWER_TEXT" }]);
  expect(JSON.stringify(captured)).not.toContain("HIDDEN_REASONING");
});

test("disabling inspection while generation runs drops candidate content", async () => {
  let enabled = true;
  const captured: (TeachingDraftCandidateText | null)[] = [];
  const gate = withTeachingDraftGate(() => { enabled = false; return stream(); }, {
    sessionId: "test", basePrompt: () => "", makeCaller: () => judge, maxAttempts: 1,
    captureDraftContent: () => enabled, onDraftContent: candidate => captured.push(candidate),
  });
  const result = await (await gate(model, context)).result();
  expect(result.content.some(part => part.type === "text" && part.text === "ANSWER_TEXT")).toBe(true);
  expect(captured.filter(Boolean)).toEqual([]);
  expect(captured.at(-1)).toBeNull();
});
