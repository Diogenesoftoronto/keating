import { describe, expect, test } from "bun:test";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEvent, type Context, type Model } from "@earendil-works/pi-ai";
import type { JudgementCaller, JudgementOutcome, JudgementRequest, TeachingDraftSnapshot } from "@keating/learner-contracts";
import { withTeachingDraftGate } from "../keating/judgement/draft-gate";
import { DEFAULT_TEACHER_PERSONA } from "../keating/persona";
import operationalProtocolMarkdown from "../keating/prompts/operational-protocol.md?raw";
import { answerDraftGateReview, DRAFT_GATE_JUDGE } from "./helpers/teaching-draft-judge";

type StreamFn = NonNullable<AgentOptions["streamFn"]>;
const MODEL = { id: "fixture-actor", name: "Fixture", provider: "fixture", api: "openai-completions", baseUrl: "https://unused.test",
  reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000 } as Model<Api>;
const BASE = DEFAULT_TEACHER_PERSONA + "\n\n" + operationalProtocolMarkdown.trim();
const context = (text: string): Context => ({ systemPrompt: BASE + "\n\nLIVE", messages: [{ role: "user", content: text, timestamp: 1 }], tools: [] });

const reply = (text: string): AssistantMessage => ({ role: "assistant", api: MODEL.api, provider: MODEL.provider, model: MODEL.id,
  content: [{ type: "text", text }], stopReason: "stop", timestamp: 2,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const streamed = (value: AssistantMessage) => {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: { ...value, content: [] } });
  stream.push({ type: "text_start", contentIndex: 0, partial: value });
  stream.push({ type: "text_delta", contentIndex: 0, delta: (value.content[0] as { text: string }).text, partial: value });
  stream.push({ type: "text_end", contentIndex: 0, content: (value.content[0] as { text: string }).text, partial: value });
  stream.push({ type: "done", reason: "stop", message: value });
  stream.end(value);
  return stream;
};

function triageJudge(draftNeeded: number, level: number, calls: JudgementRequest[]): JudgementCaller {
  return async (request): Promise<JudgementOutcome> => {
    calls.push(request);
    const thinking = request.questions.thinking_level;
    if (!thinking || thinking.type !== "score") return answerDraftGateReview(request);
    return { ok: true, response: { backend: DRAFT_GATE_JUDGE, answers: {
      draft_needed: { type: "noul", noul: draftNeeded },
      thinking_level: { type: "score", score: level, confidence: 0.9,
        probabilities: Object.fromEntries(thinking.criteria.map((_, index) => [String(index), index === level ? 0.97 : 0.01])),
        legend: Object.fromEntries(thinking.criteria.map((criterion, index) => [String(index), criterion])) },
    } } };
  };
}

describe("draft triage route", () => {
  test("a simple turn streams the tutor's reply directly, with one judge call", async () => {
    const calls: JudgementRequest[] = [];
    const actorOptions: unknown[] = [];
    const progress: TeachingDraftSnapshot[] = [];
    const gate = withTeachingDraftGate(((_model, _context, options) => { actorOptions.push(options); return streamed(reply("You're welcome!")); }) as StreamFn, {
      sessionId: "triage", basePrompt: () => BASE, makeCaller: () => triageJudge(0.02, 0, calls), maxReasoning: "high",
      onProgress: snapshot => progress.push(snapshot),
    });
    const stream = await gate(MODEL, context("thanks!"));
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    expect(calls).toHaveLength(1);
    expect(actorOptions).toHaveLength(1);
    expect((actorOptions[0] as { reasoning?: string }).reasoning).toBeUndefined();
    expect(result.stopReason).toBe("stop");
    expect(events.some(event => event.type === "text_delta" && event.delta === "You're welcome!")).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: "released", reason: "direct-reply", reasoning: "off" });
  });

  test("a difficult turn drafts and reviews as before", async () => {
    const calls: JudgementRequest[] = [];
    const gate = withTeachingDraftGate((() => streamed(reply("Four factorial is 24."))) as StreamFn, {
      sessionId: "triage-hard", basePrompt: () => BASE, makeCaller: () => triageJudge(0.9, 2, calls), maxAttempts: 1,
    });
    await (await gate(MODEL, context("Derive the gamma function's reflection formula."))).result();
    expect(calls.length).toBeGreaterThan(1);
    expect(Object.keys(calls[0]!.questions)).toEqual(["draft_needed", "thinking_level"]);
  });

  test("triage can be switched off", async () => {
    const calls: JudgementRequest[] = [];
    const gate = withTeachingDraftGate((() => streamed(reply("Hi!"))) as StreamFn, {
      sessionId: "triage-off", basePrompt: () => BASE, makeCaller: () => triageJudge(0.02, 0, calls), triage: false, maxAttempts: 1,
    });
    await (await gate(MODEL, context("hi"))).result();
    expect(calls.every(request => !("draft_needed" in request.questions))).toBe(true);
  });
});
