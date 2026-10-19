import { expect, test } from "bun:test";
import { createAssistantMessageEventStream, type AssistantMessage, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import type { JudgementAnswer, JudgementCaller } from "@keating/learner-contracts";
import { withTeachingDraftGate, type TeachingDraftReceipt } from "../keating/judgement/draft-gate";
import { withReviewNotice } from "../keating/judgement/review-notice";

const model = { id: "selected-teacher", api: "openai-completions", provider: "fixture", name: "Fixture", reasoning: false,
  input: ["text"], contextWindow: 32000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>;
const context: Context = { systemPrompt: "Preserve original context.", messages: [{ role: "user", timestamp: 1, content: "What is four factorial?" }],
  tools: [{ name: "workspace_inspect", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }] };
const judge: JudgementCaller = async request => {
  const answers: Record<string, JudgementAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "choice") {
      const choice = id === "draft_reasoning" ? "off" : id === "draft_standard" ? "concise" : Object.keys(question.criteria).find(key => key !== "no_match")!;
      answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
    } else if (question.type === "noul") answers[id] = { type: "noul", noul: id.startsWith("quality_") ? 1 : id === "identity_invented" ? 1 : Number(["direct_answer_requested", "learning_task"].includes(id)) };
  }
  return { ok: true, response: { backend: { backend: "fixture", model: "judge", calibrationSha256: null }, answers } };
};
function complete(recovery: boolean) {
  const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
    stopReason: recovery ? "stop" : "toolUse", content: recovery ? [{ type: "text", text: "Four factorial is 4 × 3 × 2 × 1 = 24." }]
      : [{ type: "toolCall", id: "invalid", name: "workspace_inspect", arguments: { wrong: true } }],
    usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: recovery ? "stop" : "toolUse", message }); stream.end(message); return stream;
}

test("final reserved generation recovers a visible answer with tools disabled and an honest receipt", async () => {
  const seen: Context[] = [], receipts: TeachingDraftReceipt[] = [];
  const original = structuredClone(context);
  const gated = withTeachingDraftGate((selected, next) => {
    expect(selected).toBe(model); seen.push(structuredClone(next));
    return complete(next.tools?.length === 0);
  }, { sessionId: "recovery", basePrompt: () => "", makeCaller: () => judge, maxAttempts: 10, onReceipt: receipt => receipts.push(receipt) });
  const stream = await gated(model, context);
  const events = []; for await (const event of stream) events.push(event);
  const result = await stream.result();
  expect(seen).toHaveLength(3);
  expect(seen.slice(0, 2).every(next => next.tools?.length === 1)).toBe(true);
  expect(seen[2]!.tools).toEqual([]);
  expect(seen[2]!.systemPrompt).toContain("Do not call tools or claim");
  expect(seen[2]!.messages[0]).toEqual(original.messages[0]);
  expect(result.content).toEqual([{ type: "text", text: withReviewNotice("unverified", "Four factorial is 4 × 3 × 2 × 1 = 24.") }]);
  expect(events.map(event => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
  expect(receipts[0]!.snapshot.reason).toBe("best-effort-draft");
  expect(receipts[0]!.snapshot.attempts[2]!.status).toBe("fail");
  expect(context).toEqual(original);
});

test("cancelling the reserved recovery publishes no late answer or receipt", async () => {
  const controller = new AbortController(); let calls = 0, entered!: () => void;
  const recoveryStarted = new Promise<void>(resolve => { entered = resolve; });
  const receipts: TeachingDraftReceipt[] = [];
  const gated = withTeachingDraftGate((_selected, next) => {
    calls++;
    if (next.tools?.length === 0) { entered(); return createAssistantMessageEventStream(); }
    return complete(false);
  }, { sessionId: "cancel-recovery", basePrompt: () => "", makeCaller: () => judge, maxAttempts: 10, onReceipt: receipt => receipts.push(receipt) });
  const stream = await gated(model, context, { signal: controller.signal });
  await recoveryStarted; controller.abort();
  const events = []; for await (const event of stream) events.push(event);
  const result = await stream.result();
  expect(calls).toBe(3); expect(result.stopReason).toBe("aborted"); expect(result.content).toEqual([]);
  expect(events.map(event => event.type)).toEqual(["error"]); expect(receipts).toEqual([]);
});
