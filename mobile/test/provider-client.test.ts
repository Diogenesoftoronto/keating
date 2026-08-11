import { describe, expect, it } from "bun:test";
import { settingsForProvider } from "../src/lib/provider-config";
import { buildProviderRequest, continueProviderTurn, requestCompletion, requestProviderRound } from "../src/lib/provider-client";
import type { ChatMessage } from "../src/lib/types";

const messages: ChatMessage[] = [
  { id: "user-1", role: "user", content: "Teach me closures", createdAt: 1 },
  { id: "assistant-1", role: "assistant", content: "What do you think a closure retains?", createdAt: 2 },
];

const attachmentMessage: ChatMessage = {
  id: "user-attachments",
  role: "user",
  content: "Compare these sources",
  createdAt: 3,
  attachments: [
    {
      id: "image-1",
      kind: "image",
      name: "diagram.png",
      mimeType: "image/png",
      size: 3,
      uri: "file:///diagram.png",
      encoding: "base64",
      data: "aW1n",
    },
    {
      id: "document-1",
      kind: "document",
      name: "notes.md",
      mimeType: "text/markdown",
      size: 5,
      uri: "file:///notes.md",
      encoding: "text",
      data: "# Notes",
    },
    {
      id: "pdf-1",
      kind: "document",
      name: "paper.pdf",
      mimeType: "application/pdf",
      size: 7,
      uri: "file:///paper.pdf",
      encoding: "base64",
      data: "cGRm",
    },
  ],
};

const tool = {
  name: "create_study_plan",
  description: "Create a deterministic local study plan.",
  parameters: {
    type: "object",
    properties: { topic: { type: "string" } },
    required: ["topic"],
    additionalProperties: false,
  },
};

const result = {
  callId: "call-1",
  name: tool.name,
  output: { ok: true, artifactId: "artifact-1" },
};

const historyWithTool: ChatMessage[] = [
  { id: "history-user", role: "user", content: "Make a closure plan", createdAt: 1 },
  {
    id: "history-assistant",
    role: "assistant",
    content: "I will make the plan.\n\nThe plan is ready.",
    createdAt: 2,
    agentEvents: [
      { id: "history-event-1", occurredAt: "2026-08-10T00:00:00.000Z", type: "text-delta", turnId: "history-turn", sequence: 0, text: "I will make the plan." },
      { id: "history-event-2", occurredAt: "2026-08-10T00:00:01.000Z", type: "tool-call", turnId: "history-turn", sequence: 1, call: { id: "history-call", name: tool.name, arguments: { topic: "closures" }, idempotencyKey: "history-tool-key" } },
      { id: "history-event-3", occurredAt: "2026-08-10T00:00:02.000Z", type: "tool-result", turnId: "history-turn", sequence: 2, result: { toolCallId: "history-call", idempotencyKey: "history-tool-key", status: "success", text: JSON.stringify({ artifactId: "artifact-1" }) } },
      { id: "history-event-4", occurredAt: "2026-08-10T00:00:03.000Z", type: "text-delta", turnId: "history-turn", sequence: 3, text: "The plan is ready." },
      { id: "history-event-5", occurredAt: "2026-08-10T00:00:04.000Z", type: "completed", turnId: "history-turn", sequence: 4 },
    ],
  },
  { id: "history-next-user", role: "user", content: "Test step one", createdAt: 3 },
];

describe("buildProviderRequest", () => {
  it("builds an OpenAI Responses request matching the web catalog transport", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "sk-test", messages);
    const body = JSON.parse(String(request.init.body));

    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect((request.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(body.instructions).toContain("hyperteacher");
    expect(body.input.at(-1)).toEqual({ role: "assistant", content: messages[1].content });
    expect(body.temperature).toBeUndefined();
  });

  it("only sends Responses temperature when the selected model advertises it", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "sk-test", messages, {
      supportsTemperature: true,
    });
    expect(JSON.parse(String(request.init.body)).temperature).toBe(settingsForProvider("openai").temperature);
  });

  it("uses OpenRouter's nested reasoning effort shape", () => {
    const request = buildProviderRequest(settingsForProvider("openrouter"), "key", messages, {
      reasoningLevel: "xhigh",
    });
    const body = JSON.parse(String(request.init.body));
    expect(body.reasoning).toEqual({ effort: "max" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("maps image, text, and PDF attachments to OpenAI Responses content", () => {
    const body = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openai"),
      "key",
      [attachmentMessage],
    ).init.body));

    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "Compare these sources" },
      { type: "input_image", image_url: "data:image/png;base64,aW1n", detail: "auto" },
      { type: "input_text", text: '<attachment name="notes.md" type="text/markdown">\n# Notes\n</attachment>' },
      { type: "input_file", filename: "paper.pdf", file_data: "data:application/pdf;base64,cGRm" },
    ]);
  });

  it("maps attachments to Anthropic content blocks", () => {
    const body = JSON.parse(String(buildProviderRequest(
      settingsForProvider("anthropic"),
      "key",
      [attachmentMessage],
    ).init.body));

    expect(body.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aW1n" },
    });
    expect(body.messages[0].content[2]).toEqual({
      type: "document",
      title: "paper.pdf",
      source: { type: "base64", media_type: "application/pdf", data: "cGRm" },
    });
  });

  it("maps attachments to Gemini inline data and OpenRouter file parts", () => {
    const geminiBody = JSON.parse(String(buildProviderRequest(
      settingsForProvider("google"),
      "key",
      [attachmentMessage],
    ).init.body));
    expect(geminiBody.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "aW1n" } });
    expect(geminiBody.contents[0].parts[3]).toEqual({ inlineData: { mimeType: "application/pdf", data: "cGRm" } });

    const openRouterBody = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openrouter"),
      "key",
      [attachmentMessage],
    ).init.body));
    expect(openRouterBody.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,aW1n" },
    });
    expect(openRouterBody.messages[1].content[3]).toEqual({
      type: "file",
      file: { filename: "paper.pdf", file_data: "data:application/pdf;base64,cGRm" },
    });
  });

  it("fails closed when an attachment was not hydrated", () => {
    const unprepared = {
      ...attachmentMessage,
      attachments: attachmentMessage.attachments?.map(({ data: _data, encoding: _encoding, ...attachment }) => attachment),
    };
    expect(() => buildProviderRequest(settingsForProvider("openai"), "key", [unprepared])).toThrow(
      "diagram.png was not prepared",
    );
  });

  it("does not pretend a custom OpenAI-compatible endpoint supports PDF file parts", () => {
    expect(() => buildProviderRequest(settingsForProvider("custom"), null, [attachmentMessage])).toThrow(
      "PDF attachments are not portable",
    );
  });

  it("uses the Anthropic messages shape", () => {
    const request = buildProviderRequest(settingsForProvider("anthropic"), "anthropic-key", messages);
    const body = JSON.parse(String(request.init.body));
    const headers = request.init.headers as Record<string, string>;

    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe("anthropic-key");
    expect(body.system).toContain("hyperteacher");
    expect(body.messages[0]).toEqual({ role: "user", content: messages[0].content });
  });

  it("maps assistant messages to Gemini's model role", () => {
    const request = buildProviderRequest(settingsForProvider("google"), "google-key", messages);
    const body = JSON.parse(String(request.init.body));

    expect(request.url).toContain("gemini-3.5-flash:generateContent?key=google-key");
    expect(body.contents[1].role).toBe("model");
  });


  it("keeps truncated provider history user-started for Anthropic and Gemini", () => {
    const longConversation: ChatMessage[] = Array.from({ length: 41 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn ${index}`,
      createdAt: index,
    }));

    const anthropic = buildProviderRequest(settingsForProvider("anthropic"), "anthropic-key", longConversation);
    const anthropicBody = JSON.parse(String(anthropic.init.body));
    expect(anthropicBody.messages).toHaveLength(39);
    expect(anthropicBody.messages[0]).toEqual({ role: "user", content: "turn 2" });
    expect(anthropicBody.messages.at(-1)).toEqual({ role: "user", content: "turn 40" });

    const google = buildProviderRequest(settingsForProvider("google"), "google-key", longConversation);
    const googleBody = JSON.parse(String(google.init.body));
    expect(googleBody.contents).toHaveLength(39);
    expect(googleBody.contents[0]).toEqual({ role: "user", parts: [{ text: "turn 2" }] });
    expect(googleBody.contents.at(-1)).toEqual({ role: "user", parts: [{ text: "turn 40" }] });
  });

  it("normalizes a custom base URL without duplicating v1", () => {
    const settings = { ...settingsForProvider("custom"), baseUrl: "http://10.0.2.2:11434/v1/" };
    const request = buildProviderRequest(settings, null, messages);
    expect(request.url).toBe("http://10.0.2.2:11434/v1/chat/completions");
  });

  it("declares and continues an OpenAI Responses tool call", () => {
    const initial = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openai"), "key", messages, { tools: [tool] },
    ).init.body));
    expect(initial.tools).toEqual([{ type: "function", ...tool, strict: true }]);

    const continued = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openai"), "key", messages, {
        tools: [tool],
        continuation: { provider: "openai", previousResponseId: "resp-1", results: [result] },
      },
    ).init.body));
    expect(continued.previous_response_id).toBe("resp-1");
    expect(continued.input).toEqual([{
      type: "function_call_output",
      call_id: "call-1",
      output: JSON.stringify(result.output),
    }]);
  });

  it("declares and continues an Anthropic tool call with adjacent result blocks", () => {
    const assistantContent = [{ type: "tool_use", id: "call-1", name: tool.name, input: { topic: "closures" } }];
    const body = JSON.parse(String(buildProviderRequest(
      settingsForProvider("anthropic"), "key", messages, {
        tools: [tool],
        continuation: { provider: "anthropic", exchanges: [{ assistantContent, results: [{ ...result, isError: true }] }] },
      },
    ).init.body));
    expect(body.tools[0]).toEqual({ name: tool.name, description: tool.description, input_schema: tool.parameters });
    expect(body.messages.slice(-2)).toEqual([
      { role: "assistant", content: assistantContent },
      { role: "user", content: [{
        type: "tool_result",
        tool_use_id: "call-1",
        content: JSON.stringify(result.output),
        is_error: true,
      }] },
    ]);
  });

  it("declares and continues a Gemini function call while preserving model content", () => {
    const modelContent = {
      role: "model",
      parts: [{ functionCall: { id: "call-1", name: tool.name, args: { topic: "closures" } }, thoughtSignature: "sig" }],
    };
    const body = JSON.parse(String(buildProviderRequest(
      settingsForProvider("google"), "key", messages, {
        tools: [tool],
        continuation: { provider: "google", exchanges: [{ modelContent, results: [{ ...result, nativeCallId: "call-1" }] }] },
      },
    ).init.body));
    expect(body.tools[0].functionDeclarations[0]).toEqual(tool);
    expect(body.contents.slice(-2)).toEqual([
      modelContent,
      { role: "user", parts: [{ functionResponse: {
        name: tool.name,
        id: "call-1",
        response: { result: result.output },
      } }] },
    ]);
  });

  it("declares and continues OpenAI-compatible tool calls", () => {
    const assistantMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: tool.name, arguments: '{"topic":"closures"}' } }],
    };
    const body = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openrouter"), "key", messages, {
        tools: [tool],
        continuation: { provider: "openrouter", exchanges: [{ assistantMessage, results: [result] }] },
      },
    ).init.body));
    expect(body.tools[0]).toEqual({ type: "function", function: tool });
    expect(body.messages.slice(-2)).toEqual([
      assistantMessage,
      { role: "tool", tool_call_id: "call-1", content: JSON.stringify(result.output) },
    ]);
  });

  it("retains every stateless-provider exchange across three model rounds", () => {
    const first = continueProviderTurn(
      { provider: "anthropic", assistantContent: [{ type: "tool_use", id: "call-1", name: tool.name, input: { topic: "one" } }] },
      [result],
    );
    const second = continueProviderTurn(
      { provider: "anthropic", assistantContent: [{ type: "tool_use", id: "call-2", name: tool.name, input: { topic: "two" } }] },
      [{ ...result, callId: "call-2" }],
      first,
    );
    const body = JSON.parse(String(buildProviderRequest(
      settingsForProvider("anthropic"), "key", messages, { tools: [tool], continuation: second },
    ).init.body));
    expect(body.messages.slice(-4).map((message: any) => message.role)).toEqual(["assistant", "user", "assistant", "user"]);
    expect(body.messages.at(-1).content[0].tool_use_id).toBe("call-2");
  });

  it("reconstructs durable historical tool exchanges in each provider-native protocol", () => {
    const openAi = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openai"), "key", historyWithTool, { tools: [tool] },
    ).init.body));
    expect(openAi.input.map((item: any) => item.type ?? item.role)).toEqual([
      "user", "assistant", "function_call", "function_call_output", "assistant", "user",
    ]);
    expect(openAi.input[3]).toMatchObject({ call_id: "history-call" });
    expect(JSON.parse(openAi.input[3].output)).toEqual({ artifactId: "artifact-1", ok: true });

    const anthropic = JSON.parse(String(buildProviderRequest(
      settingsForProvider("anthropic"), "key", historyWithTool, { tools: [tool] },
    ).init.body));
    expect(anthropic.messages.map((message: any) => message.role)).toEqual([
      "user", "assistant", "user", "assistant", "user",
    ]);
    expect(anthropic.messages[1].content[1]).toMatchObject({ type: "tool_use", id: "history-call" });
    expect(anthropic.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "history-call" });

    const google = JSON.parse(String(buildProviderRequest(
      settingsForProvider("google"), "key", historyWithTool, { tools: [tool] },
    ).init.body));
    expect(google.contents.map((content: any) => content.role)).toEqual([
      "user", "model", "user", "model", "user",
    ]);
    expect(google.contents[1].parts[1].functionCall.id).toBe("history-call");
    expect(google.contents[2].parts[0].functionResponse.id).toBe("history-call");

    const compatible = JSON.parse(String(buildProviderRequest(
      settingsForProvider("openrouter"), "key", historyWithTool, { tools: [tool] },
    ).init.body));
    expect(compatible.messages.map((message: any) => message.role)).toEqual([
      "system", "user", "assistant", "tool", "assistant", "user",
    ]);
    expect(compatible.messages[2].tool_calls[0].id).toBe("history-call");
    expect(compatible.messages[3].tool_call_id).toBe("history-call");
  });
});

describe("requestCompletion", () => {
  it("extracts response text from supported provider payloads", async () => {
    const openAi = await requestCompletion(
      settingsForProvider("openai"),
      "key",
      messages,
      undefined,
      async () => new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "A closure retains lexical bindings." }] }],
      })),
    );
    const anthropic = await requestCompletion(
      settingsForProvider("anthropic"),
      "key",
      messages,
      undefined,
      async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Let us test that idea." }] })),
    );
    const google = await requestCompletion(
      settingsForProvider("google"),
      "key",
      messages,
      undefined,
      async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Predict the output first." }] } }] })),
    );

    expect(openAi).toContain("lexical bindings");
    expect(anthropic).toBe("Let us test that idea.");
    expect(google).toBe("Predict the output first.");
  });

  it("surfaces the provider's error message", async () => {
    await expect(requestCompletion(
      settingsForProvider("openai"),
      "bad-key",
      messages,
      undefined,
      async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    )).rejects.toThrow("Invalid API key");
  });

  it("preserves a bounded plain-text provider error", async () => {
    await expect(requestCompletion(
      settingsForProvider("openai"),
      "bad-key",
      messages,
      undefined,
      async () => new Response("upstream gateway refused this model", { status: 502 }),
    )).rejects.toThrow("upstream gateway refused this model");
  });
});

describe("requestProviderRound", () => {
  it("accepts an OpenAI tool-only turn and retains the continuation id", async () => {
    const round = await requestProviderRound(settingsForProvider("openai"), "key", messages, {
      tools: [tool],
      fetchImpl: async () => new Response(JSON.stringify({
        id: "resp-1",
        status: "completed",
        output: [{ type: "function_call", call_id: "call-1", name: tool.name, arguments: '{"topic":"closures"}' }],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      })),
    });
    expect(round.text).toBe("");
    expect(round.calls).toEqual([{ id: "call-1", nativeId: "call-1", name: tool.name, arguments: { topic: "closures" } }]);
    expect(round.assistantTurn).toEqual({ provider: "openai", previousResponseId: "resp-1" });
    expect(round.usage?.totalTokens).toBe(14);
  });

  it("retains Anthropic assistant blocks for a mixed text and tool turn", async () => {
    const content = [
      { type: "text", text: "I will make a plan." },
      { type: "tool_use", id: "call-1", name: tool.name, input: { topic: "closures" } },
    ];
    const round = await requestProviderRound(settingsForProvider("anthropic"), "key", messages, {
      tools: [tool],
      fetchImpl: async () => new Response(JSON.stringify({ content, stop_reason: "tool_use" })),
    });
    expect(round.text).toBe("I will make a plan.");
    expect(round.calls).toHaveLength(1);
    expect(round.assistantTurn).toEqual({ provider: "anthropic", assistantContent: content });
  });

  it("retains Gemini function-call parts including thought signatures", async () => {
    const content = {
      role: "model",
      parts: [{ functionCall: { id: "call-1", name: tool.name, args: { topic: "closures" } }, thoughtSignature: "sig" }],
    };
    const round = await requestProviderRound(settingsForProvider("google"), "key", messages, {
      tools: [tool],
      fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content, finishReason: "STOP" }] })),
    });
    expect(round.calls[0]).toEqual({ id: "call-1", nativeId: "call-1", name: tool.name, arguments: { topic: "closures" } });
    expect(round.assistantTurn).toEqual({ provider: "google", modelContent: content });
  });

  it("retains an OpenAI-compatible assistant tool-call message", async () => {
    const message = {
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: tool.name, arguments: '{"topic":"closures"}' } }],
    };
    const round = await requestProviderRound(settingsForProvider("openrouter"), "key", messages, {
      tools: [tool],
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message, finish_reason: "tool_calls" }] })),
    });
    expect(round.calls).toHaveLength(1);
    expect(round.assistantTurn).toEqual({ provider: "openrouter", assistantMessage: { role: "assistant", ...message } });
  });

  it("supports Gemini's optional function-call id without inventing a provider correlation id", async () => {
    const round = await requestProviderRound(settingsForProvider("google"), "key", messages, {
      tools: [tool],
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ functionCall: { name: tool.name, args: { topic: "closures" } } }] } }],
      })),
    });
    expect(round.calls[0]).toEqual({ id: "google-call-0", name: tool.name, arguments: { topic: "closures" } });
  });
});
