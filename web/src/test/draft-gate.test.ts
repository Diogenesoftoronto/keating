import { afterEach, describe, expect, test } from "bun:test";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type Api,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  JudgementAnswer,
  JudgementBackendKey,
  JudgementCaller,
  JudgementOutcome,
  JudgementRequest,
  TeachingDraftSnapshot,
  TeachingPolicyTurn,
  UiDocument,
} from "@keating/learner-contracts";
import { projectActiveWork } from "@keating/learner-contracts";
import { createDraftGateJudgementCaller, withTeachingDraftGate, type TeachingDraftReceipt } from "../keating/judgement/draft-gate";
import { DEFAULT_TEACHER_PERSONA } from "../keating/persona";
import operationalProtocolMarkdown from "../keating/prompts/operational-protocol.md?raw";
import { configureJudgementDiagnostics, getJudgementDiagnostics, observeJudgementCaller } from "../keating/judgement/diagnostics";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

type StreamFn = NonNullable<AgentOptions["streamFn"]>;
const MODEL = {
  id: "fixture-actor", name: "Fixture actor", provider: "fixture", api: "openai-completions", baseUrl: "https://unused.test",
  reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000,
} as Model<Api>;
const JUDGE: JudgementBackendKey = { backend: "fixture", model: "fixture-judge-v1", calibrationSha256: null };
const BASE = DEFAULT_TEACHER_PERSONA + "\n\n" + operationalProtocolMarkdown.trim();
const context = (text = "What is 4 factorial?"): Context => ({
  systemPrompt: BASE + "\n\nOPENUI GRAMMAR\nLIVE CAPABILITIES\nRECALL CONTEXT",
  messages: [{ role: "user", content: text, timestamp: 1 }],
  tools: [],
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function message(text: string, tool = false): AssistantMessage {
  return {
    role: "assistant", api: MODEL.api, provider: MODEL.provider, model: MODEL.id,
    content: [
      { type: "thinking", thinking: "PRIVATE THINKING", thinkingSignature: "PRIVATE SIGNATURE" },
      { type: "text", text },
      ...(tool ? [{ type: "toolCall" as const, id: "tool-1", name: "workspace_inspect", arguments: { path: "notes.md" } }] : []),
    ],
    usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18, reasoning: 2,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
    stopReason: tool ? "toolUse" : "stop", timestamp: 2,
  };
}

function streamOf(value: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: value });
  stream.push({ type: "thinking_delta", contentIndex: 0, delta: "PRIVATE THINKING", partial: value });
  stream.push({ type: "text_delta", contentIndex: 1, delta: "PRIVATE STREAM FRAGMENT", partial: value });
  if (value.stopReason === "error" || value.stopReason === "aborted") stream.push({ type: "error", reason: value.stopReason, error: value });
  else stream.push({ type: "done", reason: value.stopReason === "toolUse" ? "toolUse" : "stop", message: value });
  stream.end(value);
  return stream;
}

function answer(request: JudgementRequest, options: { violation?: number; noMatch?: boolean; standard?: "concise" | "supported" } = {}): JudgementOutcome {
  const state = request.state as { reply?: { text: string } };
  const answers: Record<string, JudgementAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "choice") {
      const choice = id === "draft_reasoning" ? "high"
        : id === "draft_standard" ? options.standard ?? "concise"
          : options.noMatch ? "no_match" : Object.keys(question.criteria).find((key) => key !== "no_match")!;
      answers[id] = { type: "choice", choice, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === choice ? 1 : 0])) };
    } else if (question.type === "noul") {
      const violation = options.violation ?? (state.reply?.text.includes("REJECTED") ? 1 : 0);
      answers[id] = { type: "noul", noul: id.startsWith("quality_") ? 1 : state.reply ? (id === "identity_invented" ? violation : 0)
        : ["direct_answer_requested", "learning_task"].includes(id) ? 1 : 0 };
    }
  }
  return { ok: true, response: { backend: JUDGE, answers, usage: { inputTokens: 10, outputTokens: 1 } } };
}

const caller: JudgementCaller = async (request) => answer(request);
const gate = (stream: StreamFn, options: Partial<Parameters<typeof withTeachingDraftGate>[1]> = {}) => withTeachingDraftGate(stream, {
  sessionId: "fixture-session", basePrompt: () => BASE, makeCaller: () => caller, ...options,
});
async function collect(stream: Awaited<ReturnType<StreamFn>>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, result: await stream.result() };
}
const text = (value: AssistantMessage) => value.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");

afterEach(() => configureJudgementDiagnostics({ enabled: false, details: false }));

describe("private teaching draft stream", () => {
  test("live executable tools are projected into inert provider schemas", async () => {
    const actual = { ...context(), tools: [{ name: "workspace_inspect", description: "Inspect workspace", parameters: { type: "object", properties: {} },
      execute: async () => { throw new Error("DO NOT EXECUTE"); }, prepareArguments: () => ({}) }] };
    let called = false;
    const { result } = await collect(await gate((_model, input) => {
      called = true;
      expect(Object.keys(input.tools![0]!)).toEqual(["name", "description", "parameters"]);
      return streamOf(message("24"));
    })(MODEL, actual));
    expect(called).toBe(true);
    expect(text(result)).toBe("24");
    expect(actual.tools[0]!.execute).toBeFunction();
  });

  test("unreviewable image or audio evidence cannot yield an approved response", async () => {
    for (const input of [
      { ...context(), messages: [{ role: "user" as const, timestamp: 1, content: [{ type: "image" as const, data: "fixture", mimeType: "image/png" }] }] },
      context("[keating-audio-1234]"),
    ]) {
      let called = false;
      const updates: TeachingDraftSnapshot[] = [];
      const { result } = await collect(await gate(() => { called = true; return streamOf(message("UNVERIFIED")); }, { onProgress: value => updates.push(value) })(MODEL, input));
      expect(called).toBe(false);
      expect(text(result)).toContain("transcript");
      expect(updates.at(-1)?.reason).toBe("unsupported-evidence");
    }
  });

  test("timeout during evidence loading ends the visible review", async () => {
    const updates: TeachingDraftSnapshot[] = [];
    const { result } = await collect(await gate(() => streamOf(message("UNVERIFIED")), { timeoutMs: 5,
      evidence: () => new Promise(() => {}), onProgress: value => updates.push(value) })(MODEL, context()));
    expect(text(result)).not.toContain("UNVERIFIED");
    expect(updates.at(-1)?.phase).toBe("withheld");
    expect(updates.at(-1)?.reason).toBe("time-budget");
  });
  test("emits no text, thinking, or proposed tool event before selection; only the approved terminal reply escapes", async () => {
    const checking = deferred();
    const release = deferred();
    const progress: TeachingDraftSnapshot[] = [];
    let calls = 0;
    const generate: StreamFn = () => streamOf(message(++calls === 1 ? "REJECTED PRIVATE DRAFT" : "4 factorial is 24.", calls === 1));
    const judge: JudgementCaller = async (request) => {
      if ((request.state as { reply?: unknown }).reply && calls === 1) { checking.resolve(); await release.promise; }
      return answer(request);
    };
    const output = await gate(generate, { makeCaller: () => judge, onProgress: (snapshot) => progress.push(snapshot) })(MODEL, context());
    const events: AssistantMessageEvent[] = [];
    const finished = (async () => { for await (const event of output) events.push(event); })();
    await checking.promise;
    expect(events).toEqual([]);
    release.resolve();
    await finished;
    const result = await output.result();
    expect(events.map((event) => event.type)).toEqual(["done"]);
    expect(text(result)).toBe("4 factorial is 24.");
    expect(result.content.map((part) => part.type)).toEqual(["text"]);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|REJECTED|thinking/);
    expect(JSON.stringify(progress)).not.toMatch(/PRIVATE|REJECTED|factorial|notes\.md/);
    expect(result.usage).toMatchObject({ input: 20, output: 10, totalTokens: 36, reasoning: 4 });
    expect(calls).toBe(2);
  });

  test.each(["fail", "unknown", "no-match"] as const)("withholds %s drafts without exposing their content", async (mode) => {
    const output = await gate(() => streamOf(message("NEVER DISPLAY THIS")), {
      maxAttempts: 1,
      makeCaller: () => async (request) => answer(request, { violation: mode === "fail" ? 1 : mode === "unknown" ? 0.5 : 0, noMatch: mode === "no-match" }),
    })(MODEL, context());
    const { events, result } = await collect(output);
    expect(events.map((event) => event.type)).toEqual(["done"]);
    expect(text(result)).toContain("couldn't verify");
    expect(JSON.stringify(events)).not.toMatch(/NEVER DISPLAY|PRIVATE THINKING|PRIVATE STREAM/);
  });

  test("missing judgement backend stops before generation and gives a setup action", async () => {
    let calls = 0;
    const { result } = await collect(await gate(() => { calls++; return streamOf(message("unreviewed")); }, {
      makeCaller: () => async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }),
    })(MODEL, context()));
    expect(calls).toBe(0);
    expect(text(result)).toContain("Settings");
    expect(text(result)).not.toContain("unreviewed");
  });

  test("abort and a stale learner turn cannot publish a previously generated draft", async () => {
    for (const cause of ["abort", "stale"] as const) {
      const checking = deferred();
      const release = deferred();
      const controller = new AbortController();
      const updates: TeachingDraftSnapshot[] = [];
      let current = true;
      const judge: JudgementCaller = async (request) => {
        if ((request.state as { reply?: unknown }).reply) { checking.resolve(); await release.promise; }
        return answer(request);
      };
      const output = await gate(() => streamOf(message("LATE PRIVATE DRAFT")), { makeCaller: () => judge, isCurrent: () => current, onProgress: value => updates.push(value) })(MODEL, context(), { signal: controller.signal });
      const finished = collect(output);
      await checking.promise;
      if (cause === "abort") controller.abort(); else current = false;
      release.resolve();
      const { events, result } = await finished;
      expect(events.map((event) => event.type)).toEqual(["error"]);
      expect(result.stopReason).toBe("aborted");
      expect(result.content).toEqual([]);
      expect(JSON.stringify(events)).not.toContain("LATE PRIVATE");
      if (cause === "abort") expect(updates.at(-1)?.phase).toBe("cancelled");
    }
  });

  test("throwing and terminal provider failures expose neither raw errors nor partial content", async () => {
    let calls = 0;
    const output = await gate(() => {
      if (++calls === 1) throw new Error("PRIVATE PROVIDER TOKEN");
      return streamOf({ ...message("PRIVATE PROVIDER PARTIAL"), stopReason: "error", errorMessage: "PRIVATE PROVIDER BODY" });
    }, { maxAttempts: 2 })(MODEL, context());
    const { events, result } = await collect(output);
    expect(calls).toBe(2);
    expect(text(result)).toContain("couldn't verify");
    expect(JSON.stringify(events)).not.toContain("PRIVATE");
  });

  test("keeps canonical context immutable, preserves custom persona and overlays, and sends only code repair directions", async () => {
    const customBase = "Use a calm, spare voice.\n\n" + operationalProtocolMarkdown.trim() + "\n\n## Evaluated teaching procedures\nACTIVE APPROVED PROCEDURE";
    const original = { ...context(), systemPrompt: customBase + "\n\nOPENUI GRAMMAR\nLIVE LEARNER EVIDENCE\nCAPABILITY OVERLAY" };
    const before = structuredClone(original);
    const seen: { context: Context; options?: SimpleStreamOptions }[] = [];
    const auth = { apiKey: "fixture-auth", headers: { "x-fixture": "kept" }, maxTokens: 321, reasoning: "low" as const };
    const output = await gate((_model, next, options) => {
      seen.push({ context: structuredClone(next), options });
      next.messages[0]!.content = "provider mutation";
      return streamOf(message(seen.length === 1 ? "REJECTED PRIVATE DRAFT" : "4 factorial is 24."));
    }, { basePrompt: () => customBase })(MODEL, original, auth);
    await collect(output);
    expect(original).toEqual(before);
    expect(seen).toHaveLength(2);
    for (const seenCall of seen) {
      expect(seenCall.context.systemPrompt).toContain("Use a calm, spare voice.");
      expect(seenCall.context.systemPrompt).toContain("OPENUI GRAMMAR");
      expect(seenCall.context.systemPrompt).toContain("LIVE LEARNER EVIDENCE");
      expect(seenCall.context.systemPrompt).toContain("CAPABILITY OVERLAY");
      expect(seenCall.context.systemPrompt).not.toContain(operationalProtocolMarkdown.trim());
      expect(seenCall.context.systemPrompt).toContain("ACTIVE APPROVED PROCEDURE");
      expect(seenCall.context.messages[0]!.content).toBe("What is 4 factorial?");
      expect(seenCall.options?.apiKey).toBe(auth.apiKey);
      expect(seenCall.options?.headers).toBe(auth.headers);
      expect(seenCall.options?.maxTokens).toBe(321);
      expect(seenCall.options?.reasoning).toBe("low");
    }
    expect(JSON.stringify(seen[1]!.context)).not.toContain("REJECTED PRIVATE DRAFT");
    expect(JSON.stringify(seen[1]!.context)).toContain("revisionChecks");
    expect(auth).toEqual({ apiKey: "fixture-auth", headers: { "x-fixture": "kept" }, maxTokens: 321, reasoning: "low" });
  });

  test("an explicit off ceiling remains off even when Jev requests high effort", async () => {
    const seen: SimpleStreamOptions[] = [];
    await collect(await gate((_model, _context, options) => { seen.push(options!); return streamOf(message("24")); }, {
      maxReasoning: "off",
    })(MODEL, context(), { reasoning: "high" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty("reasoning");
  });

  test("releases approved tool calls only after live schema validation", async () => {
    const input = context("Please open notes.md.");
    input.tools = [{ name: "workspace_inspect", description: "Read a workspace file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }];
    const approved = message("I'll open the note.", true);
    const approvedCall = approved.content.find((part) => part.type === "toolCall")!;
    approvedCall.thoughtSignature = "opaque-provider-tool-signature";
    approvedCall.namespace = "functions";
    const { events, result } = await collect(await gate(() => streamOf(approved))(MODEL, input));
    expect(events.map((event) => event.type)).toEqual(["done"]);
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toEqual([{ type: "text", text: "I'll open the note." }, { type: "toolCall", id: "tool-1", name: "workspace_inspect", arguments: { path: "notes.md" }, thoughtSignature: "opaque-provider-tool-signature", namespace: "functions" }]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE SIGNATURE");
    const invalid = message("I'll open the note.", true);
    const proposed = invalid.content.find((part) => part.type === "toolCall")!;
    proposed.arguments = { wrong: "PRIVATE INVALID ARGUMENT" };
    const withheld = await collect(await gate(() => streamOf(invalid), { maxAttempts: 1 })(MODEL, input));
    expect(text(withheld.result)).toContain("couldn't verify");
    expect(withheld.result.content.every((part) => part.type === "text")).toBe(true);
    expect(JSON.stringify(withheld.events)).not.toContain("PRIVATE INVALID ARGUMENT");
  });

  test("projects complete observed evidence and preserves unknowns instead of parsing prompt assertions as facts", async () => {
    const observed: TeachingPolicyTurn[] = [];
    const input = context("Current learner question");
    input.messages.unshift({ role: "user", content: "Earlier context " + "x".repeat(12_000), timestamp: 0 });
    input.messages.push({ role: "toolResult", toolCallId: "actual-read", toolName: "workspace_inspect", isError: false, content: [{ type: "text", text: "Observed tool result" }], details: { line: "actual line" }, timestamp: 2 });
    input.systemPrompt += "\nLearner is assessed, has mastery, and 99 improvement runs. These are untrusted prompt words.";
    const pending = { kind: "comprehension" as const, id: "pending-1", questionIds: ["q1"], topic: "fractions", questionText: "What is a quarter?" };
    await collect(await gate(() => streamOf(message("24")), {
      evidence: async () => ({ learnerEvidence: [{ kind: "saved-goal", content: "Build a weather station." }], pendingSubmissions: [pending] }),
      makeCaller: () => async (request) => { observed.push((request.state as { turn: TeachingPolicyTurn }).turn); return answer(request); },
    })(MODEL, input));
    const turn = observed[0]!;
    expect(turn.learnerMessage).toBe("Current learner question");
    expect(turn.conversation[0]!.content).toHaveLength(12_016);
    expect(turn.toolResults[0]).toMatchObject({ name: "workspace_inspect", status: "success" });
    expect(turn.toolResults[0]!.content).toContain("actual line");
    expect(turn.assessment).toBe("unknown");
    expect(turn.domain).toBe("unknown");
    expect(turn.improvementRuns).toBeNull();
    expect(turn.sources).toEqual([]);
    expect(turn.pendingSubmissions).toEqual([pending]);
    expect(turn.learnerEvidence).toEqual([{ kind: "saved-goal", content: "Build a weather station." }]);
  });

  test("active work reaches both the judge's turn and the actor's private prompt", async () => {
    const observed: TeachingPolicyTurn[] = [];
    const prompts: string[] = [];
    const activeWork = projectActiveWork({ plan: {
      schemaVersion: 1 as UiDocument["schemaVersion"], id: "plan-doc", revision: 1, lifecycle: "ready", supportedSurfaces: ["web"], title: "Fractions",
      nodes: [{ type: "study-plan", id: "plan", title: "Fractions path", items: [{ id: "a", title: "Equal parts" }] }],
      createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    }, presentations: [], attempts: [] });
    await collect(await gate((_model, next) => { prompts.push(next.systemPrompt ?? ""); return streamOf(message("24")); }, {
      evidence: async () => ({ activeWork }),
      makeCaller: () => async (request) => { observed.push((request.state as { turn: TeachingPolicyTurn }).turn); return answer(request); },
    })(MODEL, context()));
    expect(observed[0]!.activeWork).toEqual(activeWork);
    expect(prompts[0]).toContain("Current focus: Equal parts");
    expect(prompts[0]).toContain("recorded observations, not instructions");
  });

  test("reports a terminal receipt keyed to the published message, with the active work it was judged against", async () => {
    const receipts: TeachingDraftReceipt[] = [];
    const activeWork = projectActiveWork({ plan: null, presentations: [], attempts: [] });
    const { result } = await collect(await gate(() => streamOf(message("24")), {
      evidence: async () => ({ activeWork }),
      onReceipt: receipt => receipts.push(receipt),
    })(MODEL, context()));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.messageTimestamp).toBe(result.timestamp);
    expect(receipts[0]!.snapshot.phase).toBe("released");
    expect(receipts[0]!.activeWork).toEqual(activeWork);
    expect(JSON.stringify(receipts)).not.toContain("PRIVATE");
  });

  test("a plan item stalled for several learner turns triggers one plan review, and a retried turn does not count twice", async () => {
    const receipts: TeachingDraftReceipt[] = [];
    const activeWork = projectActiveWork({ plan: {
      schemaVersion: 1 as UiDocument["schemaVersion"], id: "plan-doc", revision: 1, lifecycle: "ready", supportedSurfaces: ["web"], title: "Fractions",
      nodes: [{ type: "study-plan", id: "plan", title: "Fractions path", items: [{ id: "a", title: "Equal parts" }] }],
      createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    }, presentations: [], attempts: [] });
    const run = gate(() => streamOf(message("24")), { evidence: async () => ({ activeWork }), onReceipt: receipt => receipts.push(receipt) });
    const turns = (count: number): Context => ({ ...context(), messages: Array.from({ length: count }, (_, index) => ({ role: "user" as const, content: `turn ${index}`, timestamp: index })) });
    for (const count of [1, 2, 3, 4, 5, 5, 6]) await collect(await run(MODEL, turns(count)));
    expect(receipts.map(({ snapshot }) => snapshot.planReview?.trigger ?? null)).toEqual([null, null, null, null, null, null, "stalled-focus"]);
    expect(receipts.at(-1)!.snapshot.planReview).toEqual({ trigger: "stalled-focus", action: "continue" });
  });

  test("oversized evidence abstains without silently clipping or calling the actor", async () => {
    let calls = 0;
    const { result } = await collect(await gate(() => { calls++; return streamOf(message("unreviewed")); })(MODEL, context("z".repeat(100_000))));
    expect(calls).toBe(0);
    expect(text(result)).toContain("couldn't verify");
    expect(text(result)).not.toContain("zzzz");
  });

  test("mutating a provider result during judgement cannot alter what was reviewed and released", async () => {
    const native = message("24");
    const judge: JudgementCaller = async (request) => {
      if ((request.state as { reply?: unknown }).reply) native.content = [{ type: "text", text: "UNREVIEWED MUTATION" }];
      return answer(request);
    };
    const { result } = await collect(await gate(() => streamOf(native), { makeCaller: () => judge })(MODEL, context()));
    expect(text(result)).toBe("24");
    expect(JSON.stringify(result)).not.toContain("UNREVIEWED MUTATION");
  });
});

describe("private judgement transport boundary", () => {
  const local: JudgementBackendKey = { backend: "local", model: "local-v1", calibrationSha256: null };
  const hosted: JudgementBackendKey = { backend: "system-one", model: "jev-v1", calibrationSha256: null };
  const request: JudgementRequest = { state: { privateDraft: "DO NOT CAPTURE" }, questions: { ready: { type: "noul", instructions: "Is it ready?" } } };
  const result = (backend: JudgementBackendKey): JudgementOutcome => ({ ok: true, response: { backend, answers: { ready: { type: "noul", noul: 1 } } } });
  const runtime = (tiers: WebJudgementRuntime["policy"]["tiers"], backend: "off" | "local" | "hosted"): WebJudgementRuntime => ({
    settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } },
  });

  test("honors off/local/hosted permissions without capturing drafts even when detailed diagnostics are enabled", async () => {
    configureJudgementDiagnostics({ enabled: true, details: true });
    const calls: string[] = [];
    const tiers = [
      { key: local, call: observeJudgementCaller(async () => { calls.push("local"); return { ok: false, error: { code: "backend-unavailable", retryable: false } }; }, local) },
      { key: hosted, call: observeJudgementCaller(async () => { calls.push("hosted"); return result(hosted); }, hosted) },
    ];
    expect((await createDraftGateJudgementCaller(runtime(tiers, "off"))(request)).ok).toBe(false);
    expect(calls).toEqual([]);
    expect((await createDraftGateJudgementCaller(runtime(tiers, "local"))(request)).ok).toBe(false);
    expect(calls).toEqual(["local"]);
    calls.length = 0;
    expect((await createDraftGateJudgementCaller(runtime(tiers, "hosted"))(request)).ok).toBe(true);
    expect(calls).toEqual(["local", "hosted"]);
    expect(getJudgementDiagnostics().events).toEqual([]);
  });

  test("pins the resolved judge identity and sanitizes adapter exceptions", async () => {
    let actual = hosted;
    const call = createDraftGateJudgementCaller(runtime([{ key: { ...hosted, model: "judgement" }, call: async () => result(actual) }], "hosted"));
    expect((await call(request)).ok).toBe(true);
    actual = { ...hosted, model: "changed-judge" };
    expect(await call(request)).toMatchObject({ ok: false, error: { code: "response-malformed" } });
    const thrown = await createDraftGateJudgementCaller(runtime([{ key: local, call: async () => { throw new Error("PRIVATE TRANSPORT ERROR"); } }], "local"))(request);
    expect(thrown).toMatchObject({ ok: false, error: { code: "backend-unavailable" } });
    expect(JSON.stringify(thrown)).not.toContain("PRIVATE");
  });
});
