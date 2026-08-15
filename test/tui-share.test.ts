import { describe, expect, test } from "bun:test";

import { publishTuiSession, sanitizeTuiMessagesForShare } from "../src/tui/share.js";

describe("TUI session sharing", () => {
  test("publishes the same text-only message shape consumed by the web share renderer", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const result = await publishTuiSession([
      { role: "user", content: "Teach me Bayes", timestamp: 1 },
      { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "Start with a prior." }], timestamp: 2 },
      { role: "toolResult", content: "secret tool output" },
    ], {
      origin: "https://learn.example.test/path",
      model: "anthropic/claude-sonnet-4-6",
      thinking: "high",
      now: () => new Date("2026-08-14T12:00:00.000Z"),
      fetch: async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ id: "AbCdEfGh1234" }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    expect(result).toEqual({ id: "AbCdEfGh1234", url: "https://learn.example.test/s/AbCdEfGh1234", messageCount: 2 });
    expect(requests[0]?.url).toBe("https://learn.example.test/api/share");
    expect(requests[0]?.body).toMatchObject({
      title: "Teach me Bayes",
      model: { provider: "anthropic", id: "claude-sonnet-4-6" },
      thinkingLevel: "high",
      messageCount: 2,
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("private");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("secret tool output");
  });

  test("rejects empty sessions and preserves only public conversational text", async () => {
    expect(sanitizeTuiMessagesForShare([{ role: "system", content: "hidden" }, { role: "assistant", content: [] }])).toEqual([]);
    await expect(publishTuiSession([], { fetch: async () => new Response() })).rejects.toThrow("no user or assistant text");
  });
});
