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
