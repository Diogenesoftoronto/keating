import { expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { learnerTimeNote, toModelMessages, toModelMessagesWithTime, type SavedAttachmentMessage } from "../keating/flue/model-messages";

test("saved attachments remain usable by Flue without mutating session history", () => {
  const saved: SavedAttachmentMessage = {
    role: "user-with-attachments", timestamp: 42, content: "Explain these",
    attachments: [
      { type: "image", content: "aW1hZ2U=", mimeType: "image/png", fileName: "diagram.png" },
      { type: "document", content: "", mimeType: "text/plain", fileName: "notes.txt", extractedText: "My notes" },
      { type: "document", content: "", mimeType: "application/pdf", fileName: "empty.pdf" },
    ],
  };
  const before = structuredClone(saved);
  expect(toModelMessages([saved])).toEqual([{
    role: "user", timestamp: 42, content: [
      { type: "text", text: "Explain these" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
      { type: "text", text: "\n\n[Document: notes.txt]\nMy notes" },
    ],
  }]);
  expect(saved).toEqual(before);
});

test("provider messages pass through while UI-only records are excluded", () => {
  const messages: Message[] = [
    { role: "user", content: "Hello", timestamp: 1 },
    { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "file" }], isError: false, timestamp: 2 },
  ];
  const history = [...messages, { role: "artifact", action: "create", filename: "notes.md", timestamp: "3" } as const];
  expect(toModelMessages(history)).toEqual(messages);
  expect(toModelMessages(history)[0]).toBe(messages[0]);
});

test("live tutor input carries time notes for openings and notable pauses only", () => {
  const start = Date.UTC(2026, 8, 28, 14, 5);
  const history = [
    { role: "user", content: "Teach me limits", timestamp: start },
    { role: "assistant", content: [{ type: "text", text: "Sure" }], timestamp: start + 60_000 },
    { role: "user", content: [{ type: "text", text: "And continuity?" }], timestamp: start + 5 * 60_000 },
    { role: "user", content: "I'm back", timestamp: start + 21 * 86_400_000 },
  ] as any[];
  const before = structuredClone(history);
  const converted = toModelMessagesWithTime(history, "UTC");
  const text = (index: number) => (converted[index]!.content as { text: string }[])[0]!.text;
  expect(text(0)).toBe("[Keating time note: sent Monday, September 28, 2026 at 2:05 PM UTC; first message in this conversation.]");
  expect(converted[2]!.content).toEqual([{ type: "text", text: "And continuity?" }]);
  expect(text(3)).toContain("3 weeks after the previous message");
  expect((converted[3]!.content as { text: string }[])[1]!.text).toBe("I'm back");
  expect(history).toEqual(before);
});

test("time notes ignore placeholder timestamps and are stable per message", () => {
  expect(toModelMessagesWithTime([{ role: "user", content: "Hello", timestamp: 1 } as any])).toEqual([{ role: "user", content: "Hello", timestamp: 1 }]);
  const at = Date.UTC(2026, 0, 1);
  expect(learnerTimeNote(at + 10 * 60_000, at, "UTC")).toBeNull();
  expect(learnerTimeNote(at + 3 * 3_600_000, at, "UTC")).toContain("3 hours after");
});

test("review notices never reach the model", () => {
  const converted = toModelMessages([{ role: "assistant", content: [{ type: "text", text: "<!--keating:review=unverified-->\nBest effort" }], timestamp: 3 } as any]);
  expect((converted[0]!.content as { text: string }[])[0]!.text).toBe("Best effort");
});

test("withheld review notices never reach the model, and a resend replaces the turn it retried", () => {
  const withheld = (at: number, reason = "Keating couldn't verify a reply. Blocking checks: checkpoint_continued.") =>
    ({ role: "assistant", content: [{ type: "text", text: `<!--keating:review=withheld-->\n${reason}` }], stopReason: "stop", timestamp: at } as unknown as Message);
  const user = (text: string, at: number) => ({ role: "user", content: text, timestamp: at } as Message);
  const reply = (text: string, at: number) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: at } as unknown as Message);
  const converted = toModelMessages([
    user("Explain the Riemann hypothesis", 1), withheld(2), user("Explain the Riemann hypothesis", 3), withheld(4),
    user("hi", 5), reply("<!--keating:review=unverified-->\nHere is an explanation.", 6),
    user("A", 7), withheld(8), user("A", 9), withheld(10), user("A", 11), reply("Correct.", 12),
  ]);
  // Notices are gone; identical resends collapse; a different message ("hi") is kept as its own turn.
  expect(converted.map(message => [message.role, typeof message.content === "string" ? message.content
    : message.content.map(part => part.type === "text" ? part.text : part.type).join("")])).toEqual([
    ["user", "Explain the Riemann hypothesis"], ["user", "hi"], ["assistant", "Here is an explanation."],
    ["user", "A"], ["assistant", "Correct."],
  ]);
  // An unverified reply is real tutor speech and stays; a withheld notice with a tool call is not a notice.
  const toolCall = { role: "assistant", content: [{ type: "text", text: "<!--keating:review=withheld-->\nx" }, { type: "toolCall", id: "t", name: "read", arguments: {} }],
    stopReason: "toolUse", timestamp: 1 } as unknown as Message;
  expect(toModelMessages([toolCall])).toHaveLength(1);
  // Timing notes differ per send, but the learner's own words decide whether a resend is a retry.
  const timed = toModelMessagesWithTime([user("A", Date.UTC(2026, 10, 26, 7, 18)), withheld(Date.UTC(2026, 10, 26, 7, 19)),
    user("A", Date.UTC(2026, 10, 26, 7, 30))], "UTC");
  expect(timed.filter(message => message.role === "user")).toHaveLength(1);
});
