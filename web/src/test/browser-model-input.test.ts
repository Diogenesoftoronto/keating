import { expect, test } from "bun:test";
import type { Context } from "@earendil-works/pi-ai";
import { browserInputMessages, browserTemplateMessages } from "../lib/browser-model-input";
const context = (parts: unknown[]): Context => ({ systemPrompt: "Tutor", messages: [{ role: "user", content: parts, timestamp: 1 }] as Context["messages"] });
const image = { type: "image" as const, data: "aW1n", mimeType: "image/png" };
const audio = { type: "audio" as const, data: "d2F2", mimeType: "audio/wav" };
test("Gemma processor input retains actual image/audio bytes and system context", () => {
  const input = browserInputMessages(context([{ type: "text", text: "Describe" }, image, audio]), true);
  expect(input[0]).toEqual({ role: "system", content: [{ type: "text", text: "Tutor" }] });
  expect(input[1]!.content).toEqual([{ type: "text", text: "Describe" }, image, audio]);
  expect(browserTemplateMessages(input, true)[1]!.content).toEqual([{ type: "text", text: "Describe" }, { type: "image" }, { type: "audio" }]);
});
test("Text models reject attachments before download instead of silently dropping them", () => {
  expect(() => browserInputMessages(context([image]), false)).toThrow("text only");
  expect(() => browserInputMessages(context([audio]), false)).toThrow("text only");
});
test("Gemma rejects multiple recordings because the pinned processor only extracts the first", () => {
  expect(() => browserInputMessages(context([audio, audio]), true)).toThrow("one recording");
  expect(browserInputMessages(context([{ ...audio, sendToModel: false }]), false)).toHaveLength(1);
});
test("Browser Gemma bounds all image history before decoding and retains assistant responses", () => {
  expect(() => browserInputMessages(context([image, image, image]), true)).toThrow("two images");
  const history = { ...context([{ type: "text", text: "Question" }]), messages: [
    { role: "user", content: "Earlier", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "Answer" }], timestamp: 2 },
    { role: "user", content: "Followup", timestamp: 3 },
  ] } as Context;
  expect(browserInputMessages(history, false).map(message => message.role)).toEqual(["system", "user", "assistant", "user"]);
});

test("Gemma Flue browser route preserves audio through model-request preparation", async () => {
  const { prepareAudioModelInput } = await import("../keating/flue/conversation");
  const messages = context([audio]).messages;
  const prepared = prepareAudioModelInput(messages, { api: "browser" as any, provider: "browser", id: "onnx-community/gemma-4-E4B-it-ONNX" });
  expect((prepared.messages[0] as { content: unknown }).content).toEqual([audio]);
});
