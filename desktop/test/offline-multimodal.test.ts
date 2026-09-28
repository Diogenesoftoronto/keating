import { expect, test } from "bun:test";
import { offlineMessages, offlineRequest } from "../src/offline-contract.js";

test("native media contract refuses renderer paths, invalid bytes and unsupported codecs", () => {
  const media = { turn: 0, type: "image", data: "aGk=", mimeType: "image/png" };
  expect(offlineRequest({ prompt: "describe", media: [media] }).media).toEqual([media]);
  for (const change of [{ path: "/etc/passwd" }, { data: "not base64" }, { turn: -1 }, { type: "audio" }, { mimeType: "audio/mp3" }]) {
    expect(() => offlineRequest({ prompt: "describe", media: [{ ...media, ...change }] })).toThrow();
  }
});

test("native media paths reach their exact user turn and never replace conversation text", () => {
  const prompt = JSON.stringify({ conversation: [{ role: "user", content: "first" }, { role: "assistant", content: "reply" }, { role: "user", content: "describe this" }] });
  const media = [{ turn: 2, type: "image" as const, path: "/private/attachment.png" }];
  const frames = offlineMessages(prompt, media).split("\n").map(JSON.parse);
  expect(frames[1][0].content).toEqual([{ type: "text", text: "first" }]);
  expect(frames[2].content).toEqual([{ type: "text", text: "describe this" }, { type: "image", path: "/private/attachment.png" }]);
  expect(() => offlineMessages(prompt, [{ ...media[0]!, turn: 1 }])).toThrow("user turn");
  expect(() => offlineMessages(prompt, [{ ...media[0]!, turn: 3 }])).toThrow("conversation turn");
});
