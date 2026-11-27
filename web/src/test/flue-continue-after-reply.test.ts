import { describe, expect, it } from "bun:test";
import { FlueConversation } from "../keating/flue/conversation";

const settled = { role: "assistant", content: [{ type: "text", text: "Fast answer." }], api: "openai-completions", provider: "openai", model: "fixture",
  stopReason: "stop", timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };

function fixture(messages: any[]) {
  const chat = new FlueConversation({ streamFn: () => { throw new Error("unused"); },
    initialState: { model: { id: "fixture", provider: "openai", api: "openai-completions" } as any, messages } }, "unused");
  const state = chat as any;
  const sent: any[] = [];
  state.native = { messages: [] };
  state.bridge = { legacyMessages: [], configure() {}, async beginTurn() {}, async checkpointSettled() {}, async close() {} };
  state.bridgeReady = Promise.resolve();
  state.client = { async send({ message }: any) { sent.push(message); return {}; }, async read() {}, async history() { return state.native; }, async abort() {} };
  return { chat, sent };
}

describe("continuing after a settled reply", () => {
  it("sends a hidden resume signal, never a learner message", async () => {
    const { chat, sent } = fixture([{ role: "user", content: "hi", timestamp: 1 }, settled]);
    await chat.continueAfterReply();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "signal", type: "resume" });
    expect(chat.context.messages.filter(message => message.role === "user")).toHaveLength(1);
    await chat.dispose();
  });

  it("refuses when the last message is not a settled reply", async () => {
    const { chat, sent } = fixture([{ role: "user", content: "hi", timestamp: 1 }]);
    await expect(chat.continueAfterReply()).rejects.toThrow("No settled reply");
    const failed = fixture([{ role: "user", content: "hi", timestamp: 1 }, { ...settled, stopReason: "error" }]);
    await expect(failed.chat.continueAfterReply()).rejects.toThrow("No settled reply");
    expect(sent).toHaveLength(0);
    await chat.dispose();
    await failed.chat.dispose();
  });
});
