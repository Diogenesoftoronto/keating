import { describe, expect, test } from "bun:test";
import { resolveTranscriptionCredential, transcribeAudioUri } from "../src/lib/speech-to-text";

describe("mobile speech to text", () => {
  test("prefers the active supported provider and falls back without exposing keys", async () => {
    const keys = { openai: "open-key", google: "google-key" } as Record<string, string>;
    const readKey = async (provider: string) => keys[provider] ?? null;
    expect(await resolveTranscriptionCredential("google", readKey)).toEqual({ provider: "google", apiKey: "google-key" });
    expect(await resolveTranscriptionCredential("anthropic", readKey)).toEqual({ provider: "openai", apiKey: "open-key" });
  });

  test("transcribes Google audio and returns provider errors", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "A spoken question" }] } }] }), { status: 200 });
    }) as typeof fetch;
    const text = await transcribeAudioUri("file:///speech.m4a", "audio/mp4", "google", {
      fetchImpl,
      readKey: async (provider) => provider === "google" ? "secret" : null,
      readBase64: async () => "YXVkaW8=",
    });
    expect(text).toBe("A spoken question");
    expect(requests[0]?.url).toContain("gemini-2.5-flash:generateContent");
    expect(requests[0]?.init?.body).toContain("YXVkaW8=");
  });
});
