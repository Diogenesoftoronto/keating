import { describe, expect, it } from "bun:test";
import { settingsForProvider } from "../src/lib/provider-config";
import { buildProviderRequest, requestCompletion } from "../src/lib/provider-client";
import type { ChatMessage } from "../src/lib/types";

const messages: ChatMessage[] = [
  { id: "user-1", role: "user", content: "Teach me closures", createdAt: 1 },
  { id: "assistant-1", role: "assistant", content: "What do you think a closure retains?", createdAt: 2 },
];

describe("buildProviderRequest", () => {
  it("builds an OpenAI-compatible chat request with the teaching prompt", () => {
    const request = buildProviderRequest(settingsForProvider("openai"), "sk-test", messages);
    const body = JSON.parse(String(request.init.body));

    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((request.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages.at(-1)).toEqual({ role: "assistant", content: messages[1].content });
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
});

describe("requestCompletion", () => {
  it("extracts response text from supported provider payloads", async () => {
    const openAi = await requestCompletion(
      settingsForProvider("openai"),
      "key",
      messages,
      undefined,
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "A closure retains lexical bindings." } }] })),
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
});
