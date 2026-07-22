import { describe, expect, it } from "bun:test";
import { settingsForProvider } from "../src/lib/provider-config";
import {
  buildProviderRequest,
  createSseParser,
  extractStreamDelta,
  streamCompletion,
} from "../src/lib/provider-client";
import { composeSystemPrompt, KEATING_TEACHING_PROTOCOL } from "../src/lib/system-prompt";
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
  it("asks OpenAI-compatible endpoints for a token stream", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "sk-test", messages, { stream: true });
    const body = JSON.parse(String(request.init.body));
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
    expect(JSON.parse(String(request.init.body)).messages[0].content).toBe("You are a stoic geometry tutor.");
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
});

describe("extractStreamDelta", () => {
  it("reads OpenAI, Anthropic, and Gemini chunk shapes", () => {
    expect(extractStreamDelta(
      settingsForProvider("openai"),
      JSON.stringify({ choices: [{ delta: { content: "clo" } }] }),
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
});

describe("streamCompletion", () => {
  it("emits incremental deltas and resolves with the joined text", async () => {
    const deltas: string[] = [];
    const text = await streamCompletion(settingsForProvider("openai"), "key", messages, {
      fetchImpl: async () => sseResponse([
        'data: {"choices":[{"delta":{"content":"A closure "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"retains bindings."}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["A closure ", "retains bindings."]);
    expect(text).toBe("A closure retains bindings.");
  });

  it("falls back to a whole-payload read when there is no stream body", async () => {
    const text = await streamCompletion(settingsForProvider("openai"), "key", messages, {
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "No stream here." } }] })),
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
});
