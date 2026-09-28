import { expect, test } from "bun:test";
import { GEMMA_OFFLINE_MODEL, OFFLINE_MODEL, assertOfflineModelMedia, offlineMultimodalMessages } from "../src/lib/offline-model-contract";
import { attachmentEncoding, validateComposerAttachment } from "../src/lib/composer-attachment-contract";
import { requestOfflineRound, type OfflineRuntime } from "../src/lib/offline-inference";
import type { ChatMessage } from "../src/lib/types";
const message: ChatMessage = { id: "g", role: "user", content: "Describe these", createdAt: 1, attachments: [
  { id: "i", kind: "image", name: "photo.png", mimeType: "image/png", size: 4, encoding: "base64", data: "aW1n" },
  { id: "a", kind: "document", name: "voice.wav", mimeType: "audio/wav", size: 4, encoding: "base64", data: "d2F2" },
] };
test("Gemma forwards image and WAV bytes while MiniCPM rejects them", () => {
  expect(offlineMultimodalMessages([message])[0]!.content).toEqual([
    { type: "text", text: "Describe these" }, { type: "image", blob: "aW1n" }, { type: "audio", blob: "d2F2" },
  ]);
  expect(() => assertOfflineModelMedia([message], OFFLINE_MODEL.id)).toThrow("vision model");
  expect(() => offlineMultimodalMessages([{ ...message, attachments: [{ ...message.attachments![0]!, data: undefined }] }])).toThrow("Reattach");
});
test("WAV picking is opt-in and hydration uses binary encoding", () => {
  const file = { name: "voice.wav", type: "audio/wav", size: 4 };
  expect(() => validateComposerAttachment(file, "document")).toThrow("readable");
  expect(validateComposerAttachment(file, "document", true).mimeType).toBe("audio/wav");
  expect(attachmentEncoding({ kind: "document", name: file.name, mimeType: file.type })).toBe("base64");
});
test("Gemma inference reaches native runtime with complete media history", async () => {
  let sent = false;
  const runtime: OfflineRuntime = {
    addListener() { return { remove() {} }; }, cancelGeneration() {},
    async generateAsync(_id, _uri, _system, json) { sent = true; expect(JSON.parse(json)).toEqual(offlineMultimodalMessages([message])); return "A photo and a recording"; },
  };
  const result = await requestOfflineRound({ provider: "litert", model: GEMMA_OFFLINE_MODEL.id, baseUrl: "", temperature: 0.7 }, [message], {}, use => use("file:///gemma", runtime));
  expect(sent).toBe(true); expect(result.text).toBe("A photo and a recording"); expect(result.usage).toBeNull();
});
test("Phone context overflow refuses before native inference instead of silently dropping turns", async () => {
  let leased = false;
  await expect(requestOfflineRound({ provider: "litert", model: GEMMA_OFFLINE_MODEL.id, baseUrl: "", temperature: 0.7 }, [{ ...message, content: "x".repeat(11_000), attachments: [] }], {}, async () => { leased = true; throw new Error("must not run"); })).rejects.toThrow("too long");
  expect(leased).toBe(false);
});

test("Phone media limits apply across the complete history before hydrating files", () => {
  const large = { ...message, attachments: [{ ...message.attachments![0]!, size: 9 * 1024 * 1024, data: undefined }] };
  expect(() => assertOfflineModelMedia([large, large], GEMMA_OFFLINE_MODEL.id)).toThrow("in total");
  expect(() => assertOfflineModelMedia([message, message, message], GEMMA_OFFLINE_MODEL.id)).toThrow("in total");
  expect(() => assertOfflineModelMedia([{ ...message, attachments: [{ ...message.attachments![0]!, size: 1, data: "aaaaaaaa" }] }], GEMMA_OFFLINE_MODEL.id)).toThrow("saved size");
});
