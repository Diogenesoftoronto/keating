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
    // Planning may start alongside triage, but nothing is drafted or reviewed.
    expect(calls.filter(request => "draft_needed" in request.questions)).toHaveLength(1);
    expect(calls.some(request => "reply" in (request.state as object))).toBe(false);
    expect(actorOptions).toHaveLength(1);
    expect((actorOptions[0] as { reasoning?: string }).reasoning).toBeUndefined();
    expect(result.stopReason).toBe("stop");
    expect(events.some(event => event.type === "text_delta" && event.delta === "You're welcome!")).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: "released", reason: "direct-reply", reasoning: "off" });
  });

  test("an empty finished reply on the direct path is a retryable failure, not a blank turn", async () => {
    const empty = { ...reply(""), content: [] };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: empty });
    stream.push({ type: "done", reason: "stop", message: empty });
    stream.end(empty);
    const gate = withTeachingDraftGate((() => stream) as StreamFn, {
      sessionId: "triage-empty", basePrompt: () => BASE, makeCaller: () => triageJudge(0.02, 0, []), maxReasoning: "high",
    });
    const result = await (await gate(MODEL, context("thanks!"))).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("The tutor provider returned an empty reply.");
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

  test("a tool round reuses the turn's plan instead of planning again", async () => {
    const calls: JudgementRequest[] = [];
    let round = 0;
    const toolCall = { type: "toolCall" as const, id: "call-1", name: "lookup", arguments: { q: "x" } };
    const first: AssistantMessage = { ...reply("Let me check."), content: [{ type: "text", text: "Let me check." }, toolCall], stopReason: "toolUse" };
    const gate = withTeachingDraftGate((() => streamed(round++ === 0 ? first : reply("Here it is."))) as StreamFn, {
      sessionId: "triage-tool-round", basePrompt: () => BASE, makeCaller: () => triageJudge(0.9, 2, calls),
    });
    const tools = [{ name: "lookup", description: "Look something up", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }];
    const start: Context = { ...context("Look up the boiling point of ethanol and explain it."), tools: tools as Context["tools"] };
    const firstResult = await (await gate(MODEL, start)).result();
    expect(firstResult.stopReason).toBe("toolUse");
    const planned = calls.filter(request => "draft_standard" in request.questions).length;
    expect(planned).toBe(1);
    const next: Context = { ...start, messages: [...start.messages, firstResult,
      { role: "toolResult", toolCallId: "call-1", toolName: "lookup", content: [{ type: "text", text: "78.37 °C" }], isError: false, timestamp: 3 }] };
    const second = await (await gate(MODEL, next)).result();
    expect(second.stopReason).toBe("stop");
    expect(calls.filter(request => "draft_standard" in request.questions)).toHaveLength(planned);
    expect(calls.filter(request => "draft_needed" in request.questions)).toHaveLength(1);
  });

  test("a tool round after a grade plans again instead of reusing the pre-grade plan", async () => {
    const calls: JudgementRequest[] = [];
    let round = 0;
    const grade = { type: "toolCall" as const, id: "grade-1", name: "grade_question_checks", arguments: { checks: [{ id: "c1", correct: false }] } };
    const first: AssistantMessage = { ...reply("Let me check your answer."), content: [{ type: "text", text: "Let me check your answer." }, grade], stopReason: "toolUse" };
    const gate = withTeachingDraftGate((() => streamed(round++ === 0 ? first : reply("Not quite: plants take in carbon dioxide."))) as StreamFn, {
      sessionId: "triage-grade-round", basePrompt: () => BASE, makeCaller: () => triageJudge(0.9, 2, calls),
      evidence: async () => ({ pendingSubmissions: [{ kind: "comprehension", id: "c1", questionIds: ["c1"] }] }),
    });
    const tools = [{ name: "grade_question_checks", description: "Grade saved checks", parameters: { type: "object", properties: { checks: { type: "array" } }, required: ["checks"] } }];
    const start: Context = { ...context("oxygen?"), tools: tools as Context["tools"] };
    const firstResult = await (await gate(MODEL, start)).result();
    const next: Context = { ...start, messages: [...start.messages, firstResult,
      { role: "toolResult", toolCallId: "grade-1", toolName: "grade_question_checks", content: [{ type: "text", text: "Saved: incorrect." }], isError: false, timestamp: 3 }] };
    await (await gate(MODEL, next)).result();
    // Without the grade rule the second round would reuse the first plan (one planning request).
    expect(calls.filter(request => "draft_standard" in request.questions)).toHaveLength(2);
  });
});
