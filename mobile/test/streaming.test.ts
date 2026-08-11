import { describe, expect, it } from "bun:test";
import { settingsForProvider } from "../src/lib/provider-config";
import {
  buildProviderRequest,
  createProviderStreamSignalParser,
  createSseParser,
  extractProviderUsage,
  extractStreamDelta,
  requestProviderRound,
  streamCompletion,
} from "../src/lib/provider-client";
import {
  composeSystemPrompt,
  KEATING_TEACHING_PROTOCOL,
  PLAIN_TEXT_INTERACTION_PROTOCOL,
} from "../src/lib/system-prompt";
import { DEFAULT_TEACHER_PERSONA, isDefaultPersona, normalizePersona } from "../src/lib/persona";
import type { ChatMessage } from "../src/lib/types";

const messages: ChatMessage[] = [
  { id: "user-1", role: "user", content: "Teach me closures", createdAt: 1 },
];

/** Serves the given SSE frames as a streaming Response body. */
function sseResponse(frames: string[], init?: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" }, ...init });
}

describe("buildProviderRequest streaming", () => {
  it("asks the OpenAI Responses endpoint for a token stream", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "sk-test", messages, { stream: true });
    const body = JSON.parse(String(request.init.body));
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(body.stream).toBe(true);
    expect((request.init.headers as Record<string, string>).Accept).toBe("text/event-stream");
  });

  it("switches Gemini to the SSE streaming method", () => {
    const request = buildProviderRequest(settingsForProvider("google"), "google-key", messages, { stream: true });
    expect(request.url).toContain(":streamGenerateContent");
    expect(request.url).toContain("alt=sse");
    expect(request.url).toContain("key=google-key");
  });

  it("sets the Anthropic stream flag", () => {
    const request = buildProviderRequest(settingsForProvider("anthropic"), "key", messages, { stream: true });
    expect(JSON.parse(String(request.init.body)).stream).toBe(true);
  });

  it("omits the stream flag by default", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "key", messages);
    expect(JSON.parse(String(request.init.body)).stream).toBeUndefined();
  });

  it("sends a caller-supplied system prompt", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "key", messages, {
      systemPrompt: "You are a stoic geometry tutor.",
    });
    expect(JSON.parse(String(request.init.body)).instructions).toBe("You are a stoic geometry tutor.");
  });
});

describe("createSseParser", () => {
  it("reassembles events split across chunk boundaries", () => {
    const parse = createSseParser();
    expect(parse("data: {\"a\":")).toEqual([]);
    expect(parse("1}\n\ndata: {\"b\":2}\n\n")).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("handles CRLF frames and ignores comment keep-alives", () => {
    const parse = createSseParser();
    expect(parse(": ping\r\n\r\ndata: hello\r\n\r\n")).toEqual(["hello"]);
  });

  it("flushes a final provider event without a trailing blank line", () => {
    const parse = createSseParser();
    expect(parse('data: {"last":true}')).toEqual([]);
    expect(parse.flush()).toEqual(['{"last":true}']);
    expect(parse.flush()).toEqual([]);
  });
});

describe("extractStreamDelta", () => {
  it("reads OpenAI, Anthropic, and Gemini chunk shapes", () => {
    expect(extractStreamDelta(
      settingsForProvider("openai"),
      JSON.stringify({ type: "response.output_text.delta", delta: "clo" }),
    )).toBe("clo");
    expect(extractStreamDelta(
      settingsForProvider("anthropic"),
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "sure" } }),
    )).toBe("sure");
    expect(extractStreamDelta(
      settingsForProvider("google"),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "predict" }] } }] }),
    )).toBe("predict");
  });

  it("ignores terminators, keep-alives, and non-text events", () => {
    const openai = settingsForProvider("openai");
    expect(extractStreamDelta(openai, "[DONE]")).toBe("");
    expect(extractStreamDelta(openai, "not json")).toBe("");
    expect(extractStreamDelta(
      settingsForProvider("anthropic"),
      JSON.stringify({ type: "message_start", message: {} }),
    )).toBe("");
  });

  it("throws when the stream carries a provider error", () => {
    expect(() => extractStreamDelta(
      settingsForProvider("openai"),
      JSON.stringify({ error: { message: "context length exceeded" } }),
    )).toThrow("context length exceeded");
  });

  it("surfaces the nested error from an OpenAI response.failed event", () => {
    expect(() => extractStreamDelta(
      settingsForProvider("openai"),
      JSON.stringify({
        type: "response.failed",
        response: { error: { message: "reasoning tier not supported" } },
      }),
    )).toThrow("reasoning tier not supported");
  });
});

describe("provider-neutral stream signals", () => {
  it("ignores Gemini private thoughts while keeping visible text", () => {
    const parse = createProviderStreamSignalParser(settingsForProvider("google"));
    expect(parse(JSON.stringify({ candidates: [{ content: { parts: [
      { thought: true, text: "Check assumptions." },
      { text: "What changes first?" },
    ] } }] }))).toEqual([
      { type: "text-delta", text: "What changes first?" },
    ]);
  });

  it("keeps only provider-designated reasoning summaries", () => {
    const anthropic = createProviderStreamSignalParser(settingsForProvider("anthropic"));
    expect(anthropic(JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "private Anthropic thought" },
    }))).toEqual([]);

    const openai = createProviderStreamSignalParser(settingsForProvider("openai"));
    expect(openai(JSON.stringify({ type: "response.reasoning_text.delta", delta: "private OpenAI thought" }))).toEqual([]);
    expect(openai(JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "Checked the assumptions." }))).toEqual([
      { type: "reasoning-delta", text: "Checked the assumptions." },
    ]);

    const compatible = createProviderStreamSignalParser(settingsForProvider("openrouter"));
    expect(compatible(JSON.stringify({ choices: [{ delta: { reasoning_content: "private compatible thought" } }] }))).toEqual([]);
  });

  it("reassembles fragmented Anthropic tool arguments", () => {
    const parse = createProviderStreamSignalParser(settingsForProvider("anthropic"));
    expect(parse(JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call-1", name: "quiz" } }))).toEqual([]);
    expect(parse(JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"topic":' } }))).toEqual([]);
    expect(parse(JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Bayes"}' } }))).toEqual([]);
    expect(parse(JSON.stringify({ type: "content_block_stop", index: 1 }))).toEqual([
      { type: "tool-call", call: { id: "call-1", nativeId: "call-1", name: "quiz", arguments: { topic: "Bayes" } } },
    ]);
  });

  it("streams reasoning and tool calls through the completion callbacks", async () => {
    const reasoning: string[] = [];
    const calls: unknown[] = [];
    const text = await streamCompletion(settingsForProvider("openai"), "key", messages, {
      fetchImpl: async () => sseResponse([
        'data: {"type":"response.reasoning_summary_text.delta","delta":"Inspect."}\n\n',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"quiz","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item-1","delta":"{\\"topic\\":\\"Bayes\\"}"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"quiz","arguments":"{\\"topic\\":\\"Bayes\\"}"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"Try this."}\n\n',
      ]),
      onReasoningDelta: (delta) => reasoning.push(delta),
      onToolCall: (call) => calls.push(call),
    });
    expect(text).toBe("Try this.");
    expect(reasoning).toEqual(["Inspect."]);
    expect(calls).toEqual([{ id: "call-1", nativeId: "call-1", name: "quiz", arguments: { topic: "Bayes" } }]);
  });
});

describe("requestProviderRound streaming", () => {
  it("retains an OpenAI response id while streaming text and a fragmented call", async () => {
    const signals: string[] = [];
    const round = await requestProviderRound(settingsForProvider("openai"), "key", messages, {
      stream: true,
      fetchImpl: async () => sseResponse([
        'data: {"type":"response.created","response":{"id":"resp-stream-1"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"I will check it."}\n\n',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"generate_practice_quiz","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item-1","delta":"{\\"topic\\":\\"Bayes\\"}"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"generate_practice_quiz","arguments":"{\\"topic\\":\\"Bayes\\"}"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp-stream-1","status":"completed","output":[{"type":"function_call","call_id":"call-1","name":"generate_practice_quiz","arguments":"{\\"topic\\":\\"Bayes\\"}"}],"usage":{"input_tokens":9,"output_tokens":3,"total_tokens":12}}}\n\n',
      ]),
      onTextDelta: (delta) => signals.push(`text:${delta}`),
      onToolCall: (call) => signals.push(`tool:${call.name}`),
    });
    expect(signals).toEqual(["text:I will check it.", "tool:generate_practice_quiz"]);
    expect(round.text).toBe("I will check it.");
    expect(round.calls).toEqual([{ id: "call-1", nativeId: "call-1", name: "generate_practice_quiz", arguments: { topic: "Bayes" } }]);
    expect(round.assistantTurn).toEqual({ provider: "openai", previousResponseId: "resp-stream-1" });
    expect(round.usage?.totalTokens).toBe(12);
  });

  it("reconstructs Anthropic assistant blocks exactly enough for continuation", async () => {
    const round = await requestProviderRound(settingsForProvider("anthropic"), "key", messages, {
      stream: true,
      fetchImpl: async () => sseResponse([
        'data: {"type":"message_start","message":{"id":"msg-1","role":"assistant","usage":{"input_tokens":7,"output_tokens":0}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"private analysis"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-thought"}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"First, a plan."}}\n\n',
        'data: {"type":"content_block_stop","index":1}\n\n',
        'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu-1","name":"generate_study_plan","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"topic\\":\\"Bayes\\"}"}}\n\n',
        'data: {"type":"content_block_stop","index":2}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
    });
    expect(round.assistantTurn).toEqual({ provider: "anthropic", assistantContent: [
      { type: "thinking", thinking: "private analysis", signature: "signed-thought" },
      { type: "text", text: "First, a plan." },
      { type: "tool_use", id: "toolu-1", name: "generate_study_plan", input: { topic: "Bayes" } },
    ] });
    expect(round.calls[0]).toMatchObject({ id: "toolu-1", nativeId: "toolu-1", arguments: { topic: "Bayes" } });
    expect(round.usage).toEqual({ inputTokens: 7, outputTokens: 4, totalTokens: 11 });
  });

  it("preserves Gemini thought signatures but never emits private thought as learner text", async () => {
    const visible: string[] = [];
    const round = await requestProviderRound(settingsForProvider("google"), "key", messages, {
      stream: true,
      fetchImpl: async () => sseResponse([
        'data: {"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"private","thoughtSignature":"sig"},{"text":"I will map it."}]}}]}\n\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"generate_concept_map","args":{"topic":"Bayes"}},"thoughtSignature":"call-sig"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":6,"candidatesTokenCount":2,"totalTokenCount":8}}\n\n',
      ]),
      onTextDelta: (delta) => visible.push(delta),
    });
    expect(visible).toEqual(["I will map it."]);
    expect(round.text).toBe("I will map it.");
    expect(round.assistantTurn).toMatchObject({ provider: "google", modelContent: { parts: [
      { thought: true, text: "private", thoughtSignature: "sig" },
      { text: "I will map it." },
      { functionCall: { name: "generate_concept_map", args: { topic: "Bayes" } }, thoughtSignature: "call-sig" },
    ] } });
    expect(round.calls[0].nativeId).toBeUndefined();
  });

  it("reconstructs compatible assistant tool_calls from fragmented deltas", async () => {
    const round = await requestProviderRound(settingsForProvider("openrouter"), "key", messages, {
      stream: true,
      fetchImpl: async () => sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant","content":"Let me check. "},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"generate_practice_quiz","arguments":"{\\"topic\\":"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Bayes\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    expect(round.text).toBe("Let me check.");
    expect(round.calls[0]).toEqual({ id: "call-1", nativeId: "call-1", name: "generate_practice_quiz", arguments: { topic: "Bayes" } });
    expect(round.assistantTurn).toEqual({ provider: "openrouter", assistantMessage: {
      role: "assistant",
      content: "Let me check. ",
      tool_calls: [{ id: "call-1", type: "function", function: { name: "generate_practice_quiz", arguments: '{"topic":"Bayes"}' } }],
    } });
  });

  it("fails closed when a streamed OpenAI call has no response id for continuation", async () => {
    await expect(requestProviderRound(settingsForProvider("openai"), "key", messages, {
      stream: true,
      fetchImpl: async () => sseResponse([
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"item-1","call_id":"call-1","type":"function_call","name":"generate_study_plan","arguments":"{\\"topic\\":\\"Bayes\\"}"}}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call","call_id":"call-1","name":"generate_study_plan","arguments":"{\\"topic\\":\\"Bayes\\"}"}]}}\n\n',
      ]),
    })).rejects.toThrow("response id required");
  });

  it("preserves the last visible delta when cancellation interrupts a stream", async () => {
    const controller = new AbortController();
    const visible: string[] = [];
    let pull = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (pull++ === 0) {
          stream.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Keep this"}\n\n'));
          return;
        }
        controller.abort();
        stream.error(new DOMException("The response was cancelled.", "AbortError"));
      },
    });
    await expect(requestProviderRound(settingsForProvider("openai"), "key", messages, {
      stream: true,
      signal: controller.signal,
      fetchImpl: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      onTextDelta: (delta) => visible.push(delta),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(visible).toEqual(["Keep this"]);
  });
});

describe("provider usage", () => {
  it("normalizes token usage from each native transport", () => {
    expect(extractProviderUsage(settingsForProvider("openai"), {
      response: { usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } },
    })).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
    expect(extractProviderUsage(settingsForProvider("anthropic"), {
      usage: { input_tokens: 8, output_tokens: 3 },
    })).toEqual({ inputTokens: 8, outputTokens: 3, totalTokens: 11 });
    expect(extractProviderUsage(settingsForProvider("google"), {
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
    })).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9 });
  });
});

describe("streamCompletion", () => {
  it("emits incremental deltas and resolves with the joined text", async () => {
    const deltas: string[] = [];
    const usages: unknown[] = [];
    const text = await streamCompletion(settingsForProvider("openai"), "key", messages, {
      fetchImpl: async () => sseResponse([
        'data: {"type":"response.output_text.delta","delta":"A closure "}\n\n',
        'data: {"type":"response.output_text.delta","delta":"retains bindings."}\n\n',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":5,"total_tokens":17}}}\n\n',
        "data: [DONE]\n\n",
      ]),
      onDelta: (delta) => deltas.push(delta),
      onUsage: (usage) => usages.push(usage),
    });

    expect(deltas).toEqual(["A closure ", "retains bindings."]);
    expect(text).toBe("A closure retains bindings.");
    expect(usages).toEqual([{ inputTokens: 12, outputTokens: 5, totalTokens: 17 }]);
  });

  it("falls back to a whole-payload read when there is no stream body", async () => {
    const text = await streamCompletion(settingsForProvider("openai"), "key", messages, {
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "No stream here." })),
    });
    expect(text).toBe("No stream here.");
  });

  it("surfaces the provider error message on a failed request", async () => {
    await expect(streamCompletion(settingsForProvider("openai"), "bad", messages, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    })).rejects.toThrow("Invalid API key");
  });

  it("rejects when the stream carries no readable text", async () => {
    await expect(streamCompletion(settingsForProvider("openai"), "key", messages, {
      fetchImpl: async () => sseResponse(["data: [DONE]\n\n"]),
    })).rejects.toThrow("without readable text");
  });
});

describe("persona composition", () => {
  it("keeps the teaching protocol when a custom persona replaces the voice", () => {
    const prompt = composeSystemPrompt("You are a terse Socratic physicist.");
    expect(prompt.startsWith("You are a terse Socratic physicist.")).toBe(true);
    expect(prompt).toContain(KEATING_TEACHING_PROTOCOL);
  });

  it("falls back to John Keating for blank personas", () => {
    expect(normalizePersona("   ")).toBe(DEFAULT_TEACHER_PERSONA);
    expect(normalizePersona(null)).toBe(DEFAULT_TEACHER_PERSONA);
    expect(composeSystemPrompt("")).toContain("O Captain, my Captain");
  });

  it("detects an untouched default persona", () => {
    expect(isDefaultPersona(DEFAULT_TEACHER_PERSONA)).toBe(true);
    expect(isDefaultPersona("You are a pirate.")).toBe(false);
  });

  it("switches to a complete plain-text interaction protocol when cards are off", () => {
    const prompt = composeSystemPrompt(DEFAULT_TEACHER_PERSONA, "", false);
    expect(prompt).toContain(PLAIN_TEXT_INTERACTION_PROTOCOL);
    expect(prompt).toContain("Never emit a <keating-quiz>");
    expect(prompt).not.toContain("Say \"Quiz ready\" and stop");
  });
});
