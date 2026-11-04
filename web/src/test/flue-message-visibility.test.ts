import { describe, expect, it } from "bun:test";
import type { FlueConversationMessage } from "@flue/sdk";
import { interleaveLocalRows, shouldRenderFlueMessage } from "../components/assistant-chat-messages";

function message(id: string, overrides: Partial<FlueConversationMessage> = {}): FlueConversationMessage {
  return { id, role: "assistant", purpose: "assistant", display: "visible", parts: [], ...overrides };
}

describe("dropped-request transcript rows", () => {
  it("hides repeated empty attempts before a successful reply without altering saved history", () => {
    const user = message("question", { role: "user", purpose: "user", parts: [{ type: "text", text: "hi", state: "done" }] });
    const answer = message("answer", { parts: [{ type: "text", text: "Hey, what do you want to work on?", state: "done" }] });
    const saved = [user, message("dropped-1"), message("dropped-2"), message("dropped-3"), answer];
    const before = JSON.stringify(saved);
    expect(saved.filter(shouldRenderFlueMessage)).toEqual([user, answer]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("omits whitespace, empty reasoning tags and unsupported data-only placeholders", () => {
    const attempts = [
      message("whitespace", { parts: [{ type: "text", text: " \n ", state: "done" }] }),
      message("tags", { parts: [{ type: "text", text: "<think> </think>", state: "done" }] }),
      message("reasoning", { parts: [{ type: "reasoning", text: " ", state: "done" }] }),
      message("data", { parts: [{ type: "data-usage", data: { output: 0 } }] }),
    ];
    expect(attempts.filter(shouldRenderFlueMessage)).toEqual([]);
  });

  it("shows the same streaming message as soon as its first content arrives", () => {
    const pending = message("stream");
    expect(shouldRenderFlueMessage(pending)).toBe(false);
    pending.parts.push({ type: "text", text: "Let's", state: "streaming" });
    expect(shouldRenderFlueMessage(pending)).toBe(true);
    expect(pending.id).toBe("stream");
  });

  it("keeps partial text, reasoning, tools and attachments when a request drops", () => {
    const partials = [
      message("partial", { parts: [{ type: "text", text: "Start by", state: "done" }] }),
      message("thinking", { parts: [{ type: "reasoning", text: "Checking the premise", state: "done" }] }),
      message("tool", { parts: [{ type: "dynamic-tool", toolCallId: "call-1", toolName: "read", state: "input-available", input: { path: "lesson.md" } }] }),
      message("image", { parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" }] }),
      message("audio", { parts: [{ type: "file", mediaType: "audio/wav", url: "blob:recording" }] }),
    ];
    expect(partials.filter(shouldRenderFlueMessage)).toEqual(partials);
  });

  it("preserves failure and cancellation notices while excluding runtime diagnostics", () => {
    for (const outcome of ["failed", "aborted"] as const) {
      expect(shouldRenderFlueMessage(message(outcome, {
        role: "system", purpose: "advisory", display: "diagnostic", settlement: { outcome },
        parts: [{ type: "text", text: "Response interrupted", state: "done" }],
      }))).toBe(true);
    }
    expect(shouldRenderFlueMessage(message("diagnostic", {
      display: "diagnostic", parts: [{ type: "text", text: "Internal state", state: "done" }],
    }))).toBe(false);
    expect(shouldRenderFlueMessage(message("hidden", { display: "hidden" }))).toBe(false);
  });

  it("does not remove learner turns, including attachments awaiting their URL", () => {
    const user = message("upload", { role: "user", purpose: "user", parts: [{ type: "file", mediaType: "image/png", id: "attachment" }] });
    expect(shouldRenderFlueMessage(user)).toBe(true);
  });
});

describe("native transcript order", () => {
  const time = (row: { at: number }) => row.at;

  it("keeps Flue array order when borrowed user timestamps are stale", () => {
    // The last learner turn borrowed an older local timestamp (t=1), which a
    // timestamp sort would lift above the three earlier replies.
    const native = [
      { id: "u1", at: 0 }, { id: "a1", at: 2 }, { id: "a2", at: 3 }, { id: "a3", at: 4 }, { id: "u2", at: 1 }, { id: "a4", at: 6 },
    ].map(row => ({ row, time: row.at }));
    expect(interleaveLocalRows(native, [], time).map(row => row.id)).toEqual(["u1", "a1", "a2", "a3", "u2", "a4"]);
  });

  it("slots local-only rows by time without reordering native rows", () => {
    const native = [{ id: "u1", at: 0 }, { id: "a1", at: 10 }, { id: "u2", at: 20 }].map(row => ({ row, time: row.at }));
    const local = [{ id: "failed", at: 15 }, { id: "pending", at: 30 }];
    expect(interleaveLocalRows(native, local, time).map(row => row.id)).toEqual(["u1", "a1", "failed", "u2", "pending"]);
  });
});
