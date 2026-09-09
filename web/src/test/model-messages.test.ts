import { expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { toModelMessages, type SavedAttachmentMessage } from "../keating/flue/model-messages";

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
