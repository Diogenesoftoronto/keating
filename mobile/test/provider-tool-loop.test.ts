import { describe, expect, it } from "bun:test";
import { settingsForProvider } from "../src/lib/provider-config";
import type { ProviderRound } from "../src/lib/provider-client";
import {
  MAX_PROVIDER_CALLS_PER_ROUND,
  applyMobileToolArtifactEffects,
  runMobileToolLoop,
} from "../src/lib/provider-tool-loop";
import type { ChatMessage } from "../src/lib/types";

const messages: ChatMessage[] = [{ id: "user-1", role: "user", content: "Make a recursion plan", createdAt: 1 }];

function openAiRound(overrides: Partial<ProviderRound>): ProviderRound {
  return {
    text: "",
    calls: [],
    usage: null,
    assistantTurn: { provider: "openai", previousResponseId: "resp-1" },
    ...overrides,
  };
}

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("runMobileToolLoop", () => {
  it("commits a deterministic effect before continuing to the final teaching answer", async () => {
    const rounds = [
      openAiRound({
        text: "I will build a plan first.",
        calls: [{ id: "native-call-1", name: "generate_study_plan", arguments: { topic: "recursion" } }],
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }),
      openAiRound({
        text: "Your plan is ready. Which part should we test first?",
        assistantTurn: null,
        usage: { inputTokens: 14, outputTokens: 8, totalTokens: 22 },
      }),
    ];
    const committed: any[] = [];
    const continuations: unknown[] = [];
    const intermediate: string[] = [];
    const observedUsage: number[] = [];
    const result = await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1",
      triggeringMessageId: "user-1",
      createdAt: 100,
      onIntermediateText: (text) => intermediate.push(text),
      onUsage: (usage) => observedUsage.push(usage.totalTokens),
      commitToolCall: async (entry) => { committed.push(entry); },
      requestRound: async (_settings, _key, _messages, options) => {
        continuations.push(options.continuation);
        return rounds.shift()!;
      },
    });
    expect(intermediate).toEqual(["I will build a plan first."]);
    expect(observedUsage).toEqual([12, 34]);
    expect(committed).toHaveLength(1);
    expect(committed[0].execution.effects[0].artifact.id).toMatch(/^tool-artifact-/);
    expect(continuations[0]).toBeUndefined();
    expect(continuations[1]).toMatchObject({
      provider: "openai",
      previousResponseId: "resp-1",
      results: [{ callId: "native-call-1", output: { ok: true } }],
    });
    expect(result).toEqual({
      text: "I will build a plan first.\n\nYour plan is ready. Which part should we test first?",
      usage: { inputTokens: 24, outputTokens: 10, totalTokens: 34 },
      rounds: 2,
      toolCalls: 1,
    });
  });

  it("streams text, commits the tool, and then streams continuation text in wire order", async () => {
    const order: string[] = [];
    const requests: any[] = [];
    const responses = [
      sseResponse([
        'data: {"type":"response.created","response":{"id":"resp-1"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"I will make a plan."}\n\n',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"generate_study_plan","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item-1","delta":"{\\"topic\\":\\"recursion\\"}"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"generate_study_plan","arguments":"{\\"topic\\":\\"recursion\\"}"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp-1","status":"completed","output":[{"type":"function_call","call_id":"call-1","name":"generate_study_plan","arguments":"{\\"topic\\":\\"recursion\\"}"}],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}\n\n',
      ]),
      sseResponse([
        'data: {"type":"response.created","response":{"id":"resp-2"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"The plan is ready."}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp-2","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"The plan is ready."}]}],"usage":{"input_tokens":4,"output_tokens":3,"total_tokens":7}}}\n\n',
      ]),
    ];
    const result = await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1",
      triggeringMessageId: "user-1",
      createdAt: 100,
      onTextDelta: (delta) => order.push(`text:${delta}`),
      onToolCall: () => order.push("tool-call"),
      commitToolCall: async () => { order.push("tool-commit"); },
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return responses.shift()!;
      },
    });
    expect(order).toEqual([
      "text:I will make a plan.",
      "tool-call",
      "tool-commit",
      "text:The plan is ready.",
    ]);
    expect(requests[1]).toMatchObject({
      previous_response_id: "resp-1",
      input: [{ type: "function_call_output", call_id: "call-1" }],
    });
    expect(result.text).toBe("I will make a plan.\n\nThe plan is ready.");
    expect(result.usage?.totalTokens).toBe(14);
  });

  it("upserts a retried artifact instead of duplicating its effect", async () => {
    let execution: any;
    const rounds = [
      openAiRound({ calls: [{ id: "call-1", name: "generate_study_plan", arguments: { topic: "recursion" } }] }),
      openAiRound({ text: "Ready.", assistantTurn: null }),
    ];
    await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async (entry) => { execution = entry.execution; },
      requestRound: async () => rounds.shift()!,
    });
    const once = applyMobileToolArtifactEffects([], execution);
    const twice = applyMobileToolArtifactEffects(once, execution);
    expect(once).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it("returns unknown tools as errors to the provider without applying effects", async () => {
    const rounds = [
      openAiRound({ calls: [{ id: "stale-1", name: "workspace_change", arguments: { topic: "x" } }] }),
      openAiRound({ text: "That workspace capability is unavailable on mobile.", assistantTurn: null }),
    ];
    const committed: any[] = [];
    let continuation: any;
    await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async (entry) => { committed.push(entry); },
      requestRound: async (_settings, _key, _messages, options) => {
        if (options.continuation) continuation = options.continuation;
        return rounds.shift()!;
      },
    });
    expect(committed[0].execution).toMatchObject({ ok: false, code: "unknown_tool", effects: [] });
    expect(continuation.results[0]).toMatchObject({
      callId: "stale-1",
      isError: true,
      output: { ok: false, code: "unknown_tool", retryable: false },
    });
  });

  it("reuses a repeated semantic result without applying the effect twice", async () => {
    const call = { id: "call-1", name: "generate_practice_quiz", arguments: { topic: "recursion" } };
    const rounds = [
      openAiRound({ calls: [call] }),
      openAiRound({ calls: [{ ...call, id: "call-2" }], assistantTurn: { provider: "openai", previousResponseId: "resp-2" } }),
      openAiRound({ text: "The existing quiz is ready.", assistantTurn: null }),
    ];
    let commits = 0;
    let repeatedContinuation: any;
    const result = await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async () => { commits += 1; },
      requestRound: async (_settings, _key, _messages, options) => {
        if ((options.continuation as any)?.previousResponseId === "resp-2") repeatedContinuation = options.continuation;
        return rounds.shift()!;
      },
    });
    expect(commits).toBe(1);
    expect(repeatedContinuation.results[0]).toMatchObject({ callId: "call-2", output: { ok: true } });
    expect(result.toolCalls).toBe(2);
  });

  it("uses a durable receipt on retry and marks the trace commit as replayed", async () => {
    const rounds = [
      openAiRound({ calls: [{ id: "retry-call", name: "generate_study_plan", arguments: { topic: "recursion" } }] }),
      openAiRound({ text: "The previously created plan is ready.", assistantTurn: null }),
    ];
    let committed: any;
    let lookups = 0;
    const result = await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      lookupToolReceipt: async (idempotencyKey) => {
        lookups += 1;
        return {
          ok: true,
          toolName: "generate_study_plan",
          idempotencyKey,
          output: { artifactId: "existing-artifact" },
          effects: [],
        };
      },
      commitToolCall: async (entry) => { committed = entry; },
      requestRound: async () => rounds.shift()!,
    });
    expect(lookups).toBe(1);
    expect(committed).toMatchObject({ replayed: true, execution: { effects: [] } });
    expect(result.text).toBe("The previously created plan is ready.");
  });

  it("returns malformed streamed arguments as a truthful tool error before continuing", async () => {
    const responses = [
      sseResponse([
        'data: {"type":"response.created","response":{"id":"resp-bad"}}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"item-bad","call_id":"call-bad","type":"function_call","name":"generate_study_plan","arguments":"{bad json"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp-bad","status":"completed","output":[{"type":"function_call","call_id":"call-bad","name":"generate_study_plan","arguments":"{bad json"}]}}\n\n',
      ]),
      sseResponse([
        'data: {"type":"response.created","response":{"id":"resp-final"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"I could not use that malformed request."}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp-final","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"I could not use that malformed request."}]}]}}\n\n',
      ]),
    ];
    let committed: any;
    let continuation: any;
    await runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async (entry) => { committed = entry; },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.previous_response_id) continuation = body;
        return responses.shift()!;
      },
    });
    expect(committed.execution).toMatchObject({ ok: false, code: "invalid_arguments", effects: [] });
    expect(JSON.parse(continuation.input[0].output)).toMatchObject({ ok: false, code: "invalid_arguments" });
  });

  it("rejects provider call floods before executing any tool", async () => {
    const calls = Array.from({ length: MAX_PROVIDER_CALLS_PER_ROUND + 1 }, (_, index) => ({
      id: `call-${index}`,
      name: "generate_study_plan",
      arguments: { topic: `topic-${index}` },
    }));
    let commits = 0;
    await expect(runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async () => { commits += 1; },
      requestRound: async () => openAiRound({ calls }),
    })).rejects.toThrow("mobile safety limit");
    expect(commits).toBe(0);
  });

  it("rejects deeply nested arguments before persisting or executing a call", async () => {
    let nested: any = "leaf";
    for (let index = 0; index < 10; index += 1) nested = { child: nested };
    let commits = 0;
    await expect(runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async () => { commits += 1; },
      requestRound: async () => openAiRound({
        calls: [{ id: "call-deep", name: "generate_study_plan", arguments: { topic: "x", nested } }],
      }),
    })).rejects.toThrow("trace safety bounds");
    expect(commits).toBe(0);
  });

  it("honors cancellation before a provider round", async () => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    await expect(runMobileToolLoop(settingsForProvider("openai"), "key", messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      signal: controller.signal,
      commitToolCall: async () => undefined,
      requestRound: async () => { requests += 1; return openAiRound({ text: "never", assistantTurn: null }); },
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toBe(0);
  });

  it("does not advertise tools to an unverified custom-compatible endpoint", async () => {
    let advertised: unknown;
    const result = await runMobileToolLoop(settingsForProvider("custom"), null, messages, {
      sessionId: "session-1", triggeringMessageId: "user-1", createdAt: 100,
      commitToolCall: async () => undefined,
      requestRound: async (_settings, _key, _messages, options) => {
        advertised = options.tools;
        return openAiRound({ text: "Plain compatible response.", assistantTurn: null });
      },
    });
    expect(advertised).toEqual([]);
    expect(result.text).toBe("Plain compatible response.");
  });
});
