import { describe, expect, test } from "bun:test";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEvent, type Context, type Model } from "@earendil-works/pi-ai";
import type { JudgementCaller, JudgementRequest, TeachingDraftSnapshot } from "@keating/learner-contracts";
import { FAST_REPLY_PROMPT, withTeachingDraftGate, type TeachingDraftGateOptions, type TeachingFollowUpTurn } from "../keating/judgement/draft-gate";
import { DEFAULT_TEACHER_PERSONA } from "../keating/persona";
import operationalProtocolMarkdown from "../keating/prompts/operational-protocol.md?raw";
import { answerDraftGateReview } from "./helpers/teaching-draft-judge";

type StreamFn = NonNullable<AgentOptions["streamFn"]>;
type Release = Parameters<NonNullable<TeachingDraftGateOptions["onReleasedReply"]>>[0];
const MODEL = { id: "fixture-actor", name: "Fixture", provider: "fixture", api: "openai-completions", baseUrl: "https://unused.test",
  reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000 } as Model<Api>;
const SLOW = { ...MODEL, id: "fixture-slow" } as Model<Api>;
const BASE = DEFAULT_TEACHER_PERSONA + "\n\n" + operationalProtocolMarkdown.trim();
const QUIZ_TOOL = { name: "quiz", description: "Quiz", parameters: { type: "object", properties: {} } } as unknown as NonNullable<Context["tools"]>[number];
const context = (text: string, earlier: Context["messages"] = []): Context => ({ systemPrompt: BASE + "\n\nLIVE",
  messages: [...earlier, { role: "user", content: text, timestamp: 1 }], tools: [QUIZ_TOOL] });

const reply = (text: string, timestamp = 2): AssistantMessage => ({ role: "assistant", api: MODEL.api, provider: MODEL.provider, model: MODEL.id,
  content: [{ type: "text", text }], stopReason: "stop", timestamp,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const streamed = (value: AssistantMessage) => {
  const stream = createAssistantMessageEventStream();
  const text = (value.content[0] as { text: string }).text;
  stream.push({ type: "start", partial: { ...value, content: [] } });
  stream.push({ type: "text_start", contentIndex: 0, partial: value });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: value });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: value });
  stream.push({ type: "done", reason: "stop", message: value });
  stream.end(value);
  return stream;
};

function recordingJudge(calls: JudgementRequest[]): JudgementCaller {
  return async request => { calls.push(request); return answerDraftGateReview(request); };
}

function harness(text: string, options: Partial<TeachingDraftGateOptions> = {}) {
  const calls: JudgementRequest[] = [];
  const actor: { model: Model<Api>; context: Context; options: Record<string, unknown> }[] = [];
  const progress: TeachingDraftSnapshot[] = [];
  const releases: Release[] = [];
  const gate = withTeachingDraftGate(((model, ctx, opts) => {
    actor.push({ model, context: ctx, options: (opts ?? {}) as Record<string, unknown> });
    return streamed(reply(text));
  }) as StreamFn, {
    sessionId: `fast-slow-${crypto.randomUUID()}`, basePrompt: () => BASE, makeCaller: () => recordingJudge(calls), maxReasoning: "high", maxAttempts: 1,
    onProgress: snapshot => progress.push(snapshot), onReleasedReply: release => releases.push(release),
    pacing: () => ({ mode: "fast-slow", slowReasoning: "medium" }),
    ...options,
  });
  return { gate, calls, actor, progress, releases };
}

async function drain(stream: Awaited<ReturnType<StreamFn>>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, result: await stream.result() };
}

describe("fast/slow reply pacing in the draft gate", () => {
  test("an eligible turn streams the fast reply at once: no triage, planning or review", async () => {
    const h = harness("The chain rule multiplies the outer derivative by the inner one.");
    const { events, result } = await drain(await h.gate(MODEL, context("Can you explain the chain rule?")));
    expect(result.stopReason).toBe("stop");
    expect(events.some(event => event.type === "text_delta")).toBe(true);
    // Nothing judged in front of the reply.
    expect(h.calls).toHaveLength(0);
    expect(h.actor).toHaveLength(1);
    expect(h.actor[0]!.options.reasoning).toBe("low");
    expect(h.actor[0]!.options.hostedWebSearch).toBe(false);
    expect(h.actor[0]!.context.tools).toEqual([]);
    expect(h.actor[0]!.context.systemPrompt).toContain(FAST_REPLY_PROMPT);
    expect(h.progress.at(-1)).toMatchObject({ phase: "released", reason: "fast-reply" });
    // The background check gets the reply, the projected turn and a judge, as soon as the reply is complete.
    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]!.fast?.turn.learnerMessage).toBe("Can you explain the chain rule?");
    expect(h.releases[0]!.fast?.snapshot.reason).toBe("fast-reply");
    expect(typeof h.releases[0]!.fast?.judge).toBe("function");
  });

  test("the fast model's thinking never exceeds the learner's ceiling", async () => {
    const h = harness("Hi!", { maxReasoning: "off" });
    await drain(await h.gate(MODEL, context("hello")));
    expect(h.actor[0]!.options.reasoning).toBeUndefined();
  });

  test("a turn the rules keep reviewed stays on the reviewed pipeline", async () => {
    const h = harness("Good try: what makes you think so?", { evidence: async () => ({ assessment: "practice" as const }) });
    await drain(await h.gate(MODEL, context("Is it oxygen?")));
    expect(h.releases.some(release => release.fast)).toBe(false);
    expect(h.calls.some(request => "reply" in (request.state as object))).toBe(true);
    expect(h.progress.some(snapshot => snapshot.reason === "fast-reply")).toBe(false);
  });

  test("an answer to the tutor's question stays reviewed", async () => {
    const h = harness("Close! Oxygen is right.");
    await drain(await h.gate(MODEL, context("oxygen?", [{ role: "user", content: "Quiz me", timestamp: 0 }, reply("Which gas do plants release?", 0.5)])));
    expect(h.releases.some(release => release.fast)).toBe(false);
    expect(h.calls.some(request => "reply" in (request.state as object))).toBe(true);
  });

  test("reviewed pacing keeps today's triage-first pipeline", async () => {
    const h = harness("Hi!", { pacing: () => ({ mode: "reviewed" }) });
    await drain(await h.gate(MODEL, context("hello")));
    expect(h.calls.some(request => "draft_needed" in request.questions)).toBe(true);
    expect(h.releases.some(release => release.fast)).toBe(false);
  });

  test("a quick follow-up round: the fast model writes it from the hidden note, text only, unreviewed", async () => {
    let pending: TeachingFollowUpTurn | undefined = { kind: "quick", note: "PRIVATE NOTE: give the held-back help." };
    const h = harness("One more thing: multiply by 3.", { takeFollowUp: () => { const next = pending; pending = undefined; return next; } });
    const ctx = context("Explain the chain rule");
    ctx.messages.push(reply("Fast answer."));
    const { result } = await drain(await h.gate(MODEL, ctx));
    expect(result.stopReason).toBe("stop");
    expect(h.calls).toHaveLength(0);
    expect(h.actor).toHaveLength(1);
    expect(h.actor[0]!.context.tools).toEqual([]);
    const last = h.actor[0]!.context.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toBe("PRIVATE NOTE: give the held-back help.");
    expect(h.progress.at(-1)?.reason).toBe("follow-up-quick");
    // A follow-up is never itself a fast reply, so it cannot start another follow-up.
    expect(h.releases.some(release => release.fast)).toBe(false);
    // The note is private context: the published reply does not carry it.
    expect(JSON.stringify(result)).not.toContain("PRIVATE NOTE");
  });

  test("a work follow-up round runs the reviewed pipeline with the slow model and the note", async () => {
    let pending: TeachingFollowUpTurn | undefined = { kind: "work", note: "PRIVATE NOTE: offer a quiz." };
    const h = harness("Here is a quick check.", {
      takeFollowUp: () => { const next = pending; pending = undefined; return next; },
      pacing: () => ({ mode: "fast-slow", slowReasoning: "medium", slowModel: SLOW }),
    });
    const ctx = context("Explain the chain rule");
    ctx.messages.push(reply("Fast answer."));
    const { result } = await drain(await h.gate(MODEL, ctx));
    expect(result.stopReason).toBe("stop");
    // Reviewed, but no triage in front of it.
    expect(h.calls.some(request => "draft_needed" in request.questions)).toBe(false);
    expect(h.calls.some(request => "reply" in (request.state as object))).toBe(true);
    expect(h.actor.length).toBeGreaterThan(0);
    for (const call of h.actor) {
      expect(call.model.id).toBe("fixture-slow");
      expect(call.context.messages.some(message => message.content === "PRIVATE NOTE: offer a quiz.")).toBe(true);
    }
    expect(["medium", "low", undefined]).toContain(h.actor[0]!.options.reasoning as string | undefined);
    expect(h.releases.some(release => release.fast)).toBe(false);
  });

  test("a work follow-up after a newer exchange is reviewed against the reply it follows up, not the newest question", async () => {
    const earlier = { learnerMessage: "What's the newest approved CRISPR therapy?", conversation: [], learnerEvidence: [], availableTools: [],
      toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "science" } as const;
    let pending: TeachingFollowUpTurn | undefined = { kind: "work", note: "PRIVATE NOTE: correct the approval date.", turn: earlier };
    const h = harness("Following up on my earlier reply about Casgevy: it was approved in 2023.", {
      takeFollowUp: () => { const next = pending; pending = undefined; return next; },
    });
    const ctx = context("Is CRISPR the same thing as gene therapy?", [
      { role: "user", content: earlier.learnerMessage, timestamp: 0 }, reply("Casgevy.", 0.5)]);
    ctx.messages.push(reply("Not exactly: CRISPR is one tool among gene therapies."));
    await drain(await h.gate(MODEL, ctx));
    const reviews = h.calls.filter(request => "reply" in (request.state as object));
    expect(reviews.length).toBeGreaterThan(0);
    for (const request of reviews) {
      const state = JSON.stringify(request.state);
      expect(state).toContain("newest approved CRISPR therapy");
      expect(state).not.toContain("same thing as gene therapy");
    }
  });

  test("a round after a settled reply with no queued follow-up does not invent one", async () => {
    const h = harness("Continuing.", { takeFollowUp: () => undefined });
    const ctx = context("Explain the chain rule");
    ctx.messages.push(reply("Fast answer."));
    await drain(await h.gate(MODEL, ctx));
    expect(h.actor.every(call => !call.context.messages.some(message => typeof message.content === "string" && message.content.includes("PRIVATE NOTE")))).toBe(true);
    expect(h.progress.some(snapshot => snapshot.reason === "follow-up-quick" || snapshot.reason === "fast-reply")).toBe(false);
  });
});
