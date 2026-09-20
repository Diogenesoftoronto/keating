import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { turnAnalysisQuestions, type JudgementResponse, type JudgementOutcome } from "@keating/learner-contracts";
import { createTeachingAdjustmentController, withTeachingAdjustment } from "../keating/judgement/teaching-adjustment";
import { createReplyJudgementObserver } from "../keating/judgement/reply-review";
import { configureJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { JudgementDiagnostics } from "../components/JudgementDiagnostics";
import { FlueConversation } from "../keating/flue/conversation";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

function review(): JudgementResponse {
  const questions = turnAnalysisQuestions();
  const choices = { move: "explanation", need: "room_to_reason", fit: "overhelp" };
  return { backend: { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null }, answers: Object.fromEntries(Object.entries(choices).map(([id, choice]) => {
    const question = questions[id]!;
    if (question.type !== "choice") throw new Error("Expected a choice question");
    const labels = Object.keys(question.criteria);
    return [id, { type: "choice", choice, confidence: .9, probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? .9 : .1 / (labels.length - 1)])) }];
  })) } as JudgementResponse;
}
const history = () => [{ role: "user", content: "Help me start", timestamp: 1 }, { role: "assistant", content: "The full solution", timestamp: 2 }];
function fixture() {
  const live = { messages: history(), current: true, streaming: false, model: "teacher-one" };
  let clock = 0;
  let invalidate!: () => void;
  const controller = createTeachingAdjustmentController({ sessionId: "s", source: () => live, enabled: () => true, now: () => clock,
    subscribeInvalidation: [listener => { invalidate = listener; return () => {}; }] });
  const offer = () => controller.offer(review(), structuredClone(live.messages), "reply-1");
  const start = () => { live.messages.push({ role: "user", content: "Let me try", timestamp: 3 }); live.streaming = true; controller.startRun(live.messages); };
  return { live, controller, offer, start, invalidate, expire: () => { clock = 900_000; } };
}
afterEach(() => configureJudgementDiagnostics({ enabled: false, reviewReplies: false }));

test("a proposal cannot alter the teacher until explicitly accepted; instruction lasts only its next run", () => {
  const f = fixture(); f.offer();
  expect(f.controller.getSnapshot().status).toBe("review");
  expect(f.controller.instruction()).toBeUndefined();
  expect(f.controller.accept("reply-1")).toBe(true);
  f.start();
  expect(f.controller.instruction()).toContain("Give the learner room to reason");
  f.live.messages.push({ role: "toolResult", content: "result", timestamp: 4 });
  expect(f.controller.instruction()).toBeDefined();
  f.controller.finishRun();
  expect(f.controller.instruction()).toBeUndefined();
  f.controller.startRun(f.live.messages);
  expect(f.controller.instruction()).toBeUndefined();
  f.controller.dispose();
});

test("source edit, switched session, teacher model and expired evidence reject acceptance", () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.live.messages[0]!.content = "edited"; },
    (f: ReturnType<typeof fixture>) => { f.live.messages[1]!.content = "edited assistant"; },
    (f: ReturnType<typeof fixture>) => { f.live.current = false; },
    (f: ReturnType<typeof fixture>) => { f.live.model = "changed"; },
    (f: ReturnType<typeof fixture>) => f.expire()]) {
    const f = fixture(); f.offer(); mutate(f);
    expect(f.controller.accept("reply-1")).toBe(false);
    expect(f.controller.getSnapshot().status).toBe("empty"); f.controller.dispose();
  }
});

test("uncaptured or multiple learner turns cannot consume a queued adjustment", () => {
  for (const next of [[], [{ role: "toolResult", content: "x", timestamp: 3 }],
    [{ role: "user", content: "one", timestamp: 3 }, { role: "user", content: "two", timestamp: 4 }]]) {
    const f = fixture(); f.offer(); f.controller.accept("reply-1");
    f.live.messages.push(...next); f.live.streaming = true; f.controller.startRun(f.live.messages);
    expect(f.controller.instruction()).toBeUndefined(); f.controller.dispose();
  }
});

test("revocation, queued followups, source changes and disposal stop instruction immediately", () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.invalidate(),
    (f: ReturnType<typeof fixture>) => { f.live.messages.push({ role: "user", content: "different request", timestamp: 4 }); },
    (f: ReturnType<typeof fixture>) => { f.live.messages[0]!.content = "changed"; },
    (f: ReturnType<typeof fixture>) => { f.live.model = "another"; },
    (f: ReturnType<typeof fixture>) => { f.live.current = false; },
    (f: ReturnType<typeof fixture>) => f.controller.dispose()]) {
    const f = fixture(); f.offer(); f.controller.accept("reply-1"); f.start(); mutate(f);
    expect(f.controller.instruction()).toBeUndefined(); f.controller.dispose();
  }
});

test("provider wrapper uses a detached ephemeral system instruction and forwards original messages", async () => {
  const f = fixture(); f.offer(); f.controller.accept("reply-1"); f.start();
  const calls: any[] = [];
  const stream = withTeachingAdjustment((_model, context) => { calls.push(context); return createAssistantMessageEventStream(); }, f.controller);
  const original = { systemPrompt: "Authored base", messages: [] };
  stream({} as any, original); stream({} as any, original);
  expect(calls[0].systemPrompt).toContain("Authored base");
  expect(calls[0].systemPrompt).toContain("Give the learner room");
  expect(calls[0].messages).toBe(original.messages);
  expect(original.systemPrompt).toBe("Authored base");
  f.controller.finishRun(); stream({} as any, original);
  expect(calls[2]).toBe(original); f.controller.dispose();
});

test("only successful final observer results become proposals; late cancelled results cannot", async () => {
  configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
  const f = fixture(); let finish!: (result: JudgementOutcome) => void;
  const observer = createReplyJudgementObserver("s", () => () => new Promise(resolve => { finish = resolve; }), {
    onReview: (response, messages, id) => f.controller.offer(response, messages, id),
  });
  observer.start(); observer.finish(f.live.messages);
  finish({ ok: true, response: review() }); await Promise.resolve(); await Promise.resolve();
  expect(f.controller.getSnapshot().status).toBe("review");
  f.controller.cancel(); observer.start(); observer.finish(f.live.messages);
  observer.start(f.live.messages.length); finish({ ok: true, response: review() }); await Promise.resolve();
  expect(f.controller.getSnapshot().status).toBe("empty");
  observer.finish(f.live.messages); observer.start(); observer.finish(f.live.messages);
  finish({ ok: false, error: { code: "backend-unavailable", retryable: false } }); await Promise.resolve();
  expect(f.controller.getSnapshot().status).toBe("empty"); observer.dispose(); f.controller.dispose();
});

test("Chat inspector alone offers accept/dismiss and names uncertainty and raw distributions", () => {
  configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
  const f = fixture(); f.offer();
  const html = renderToStaticMarkup(<JudgementDiagnostics sessionId="s" teachingAdjustment={f.controller} />);
  expect(html).toContain("Apply to next reply"); expect(html).toContain("Uncalibrated suggestion"); expect(html).toContain("0.9000");
  expect(renderToStaticMarkup(<JudgementDiagnostics controls sessionId="s" teachingAdjustment={f.controller} />)).not.toContain("Apply to next reply");
  expect(renderToStaticMarkup(<JudgementDiagnostics sessionId="other" teachingAdjustment={f.controller} />)).not.toContain("Apply to next reply");
  f.controller.accept("reply-1"); expect(renderToStaticMarkup(<JudgementDiagnostics sessionId="s" teachingAdjustment={f.controller} />)).toContain("Queued for your next message");
  f.controller.dispose();
});

test("real Flue run consumes after optimistic learner append, injects at model dispatch and clears at end", async () => {
  const requests: any[] = [];
  const controller = createTeachingAdjustmentController({ sessionId: "s", enabled: () => true, subscribeInvalidation: [],
    source: () => ({ messages: chat.context.messages, current: true, streaming: chat.context.isStreaming, model: "teacher" }) });
  const chat = new FlueConversation({ initialState: { systemPrompt: "Base teacher", messages: history() as any,
    model: { id: "fixture", provider: "openai", api: "openai-completions" } as any },
    streamFn: withTeachingAdjustment((_model, context) => {
      requests.push(context);
      const stream = createAssistantMessageEventStream();
      const response = (chat as any).errorMessage("error", "controlled terminal response");
      stream.push({ type: "error", reason: "error", error: response }); stream.end(response); return stream;
    }, controller),
  }, "unused");
  const internal = chat as any;
  internal.bridge = { legacyMessages: [], configure() {}, async beginTurn() {}, async checkpointSettled() {}, async close() {} };
  internal.bridgeReady = Promise.resolve();
  internal.client = { async history() { return { messages: [] }; }, async send() {},
    async read() { await internal.modelTurn(() => {}, new AbortController().signal); }, async abort() {} };
  chat.observeExecution(event => {
    if (event.type === "agent_start") controller.startRun(chat.context.messages);
    if (event.type === "agent_end") controller.finishRun();
  });
  controller.offer(review(), chat.context.messages, "r"); expect(controller.accept("r")).toBe(true);
  await chat.send({ role: "user", content: "My next attempt", timestamp: 3 });
  expect(requests).toHaveLength(1); expect(requests[0].systemPrompt).toContain("Give the learner room to reason");
  expect(chat.context.systemPrompt).toBe("Base teacher");
  expect(chat.context.messages.filter(message => message.role === "user")).toHaveLength(2);
  expect(controller.getSnapshot().status).toBe("empty"); controller.dispose(); await chat.dispose();
});


test("real capture revocation cancels an accepted active instruction", () => {
  configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
  const live = { messages: history(), current: true, streaming: false, model: "teacher" };
  const controller = createTeachingAdjustmentController({ sessionId: "s", source: () => live });
  controller.offer(review(), live.messages, "r"); expect(controller.accept("r")).toBe(true);
  live.messages.push({ role: "user", content: "Continue", timestamp: 3 }); live.streaming = true;
  controller.startRun(live.messages); expect(controller.instruction()).toBeDefined();
  configureJudgementDiagnostics({ reviewReplies: false });
  expect(controller.instruction()).toBeUndefined(); expect(controller.getSnapshot().status).toBe("empty"); controller.dispose();
});


test("a delayed idle handoff rechecks review and tutor-model validity after revocation", async () => {
  for (const invalidate of ["settings", "model"] as const) {
    configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
    const f = fixture(); let release!: () => void;
    const idle = new Promise<void>(resolve => { release = resolve; });
    const observer = createReplyJudgementObserver("s", () => async () => ({ ok: true, response: review() }), {
      captureSourceValidity: () => { const model = f.live.model; return () => f.live.model === model; },
      onReview: (response, messages, id, calibration, current) => { void idle.then(() => { if (current()) f.controller.offer(response, messages, id, calibration); }); },
    });
    observer.start(); observer.finish(f.live.messages); await Promise.resolve();
    if (invalidate === "settings") { configureJudgementDiagnostics({ reviewReplies: false }); configureJudgementDiagnostics({ reviewReplies: true }); }
    else f.live.model = "new teacher";
    release(); await Promise.resolve(); await Promise.resolve();
    expect(f.controller.getSnapshot().status).toBe("empty"); observer.dispose(); f.controller.dispose();
  }
});

test("throwing inspector subscribers cannot break runs and snapshots cannot alter accepted direction", () => {
  const f = fixture(); f.controller.subscribe(() => { throw new Error("broken view"); });
  expect(() => f.offer()).not.toThrow();
  const snapshot = f.controller.getSnapshot();
  expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.proposal)).toBe(true);
  expect(Object.isFrozen(snapshot.proposal!.answers.fit.probabilities)).toBe(true);
  expect(() => { snapshot.proposal!.adjustment = "explain-next-step"; }).toThrow();
  expect(f.controller.accept("reply-1")).toBe(true); expect(() => f.start()).not.toThrow();
  expect(f.controller.instruction()).toContain("Give the learner room");
  expect(() => f.controller.finishRun()).not.toThrow(); f.controller.dispose();
});


test("uncloneable tool metadata and throwing review adapters cannot break teacher completion", () => {
  configureJudgementDiagnostics({ enabled: true, reviewReplies: true });
  let calls = 0;
  const observer = createReplyJudgementObserver("s", () => { calls++; throw new Error("adapter unavailable"); });
  observer.start();
  expect(() => observer.finish([...history(), { role: "toolResult", content: "tool", metadata: () => {} } as any])).not.toThrow();
  expect(calls).toBe(0);
  observer.start(); expect(() => observer.finish(history())).not.toThrow(); expect(calls).toBe(1); observer.dispose();
});
