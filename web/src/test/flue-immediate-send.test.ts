import { describe, expect, it } from "bun:test";
import { FlueConversation } from "../keating/flue/conversation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(admissionGate?: Promise<void>) {
  const chat = new FlueConversation({ streamFn: () => { throw new Error("Fixture must not invoke hosted inference"); }, initialState: { model: {
    id: "fixture", provider: "openai", api: "openai-completions",
  } as any } }, "unused");
  const state = chat as any;
  const native = { messages: [] as any[] };
  let calls = 0;
  state.native = native;
  state.bridge = {
    legacyMessages: [], configure() {}, async beginTurn() {},
    async checkpointSettled() {}, async close() {},
  };
  state.bridgeReady = Promise.resolve();
  state.client = {
    async send({ message }: any) {
      calls++;
      await admissionGate;
      native.messages.push({ id: `user-${calls}`, role: "user", display: "visible", parts: [{ type: "text", text: message.body }] });
      state.acceptNative(native);
      state.notify();
      return {};
    },
    async read() {}, async history() { return native; }, async abort() {},
  };
  return { chat, calls: () => calls };
}
const message = (text = "Show this immediately") => ({ role: "user" as const, content: text, timestamp: Date.now() });

describe("immediate learner turns", () => {
  it("publishes the turn with running state before delayed preparation, then reconciles once", async () => {
    const { chat, calls } = fixture();
    const gate = deferred();
    const snapshots: any[] = [];
    chat.subscribe(() => snapshots.push({ running: chat.getSnapshot().running, local: [...chat.localMessages] }));
    const sent = message();
    const pending = chat.sendPrepared(sent, () => gate.promise);
    expect(snapshots[0]).toEqual({ running: true, local: [sent] });
    expect(chat.context.messages).toEqual([sent]);
    expect(calls()).toBe(0);
    gate.resolve();
    await pending;
    expect(calls()).toBe(1);
    expect(chat.localMessages).toEqual([]);
    expect(chat.getSnapshot().conversation?.messages).toHaveLength(1);
    expect(chat.context.messages).toEqual([sent]);
    await chat.dispose();
  });

  it("keeps the local turn visible while native admission is delayed", async () => {
    const gate = deferred();
    const { chat, calls } = fixture(gate.promise);
    const sent = message();
    const pending = chat.send(sent);
    for (let turn = 0; calls() === 0 && turn < 30; turn++) await Promise.resolve();
    expect(calls()).toBe(1);
    expect(chat.localMessages).toEqual([sent]);
    expect(chat.getSnapshot().conversation?.messages).toHaveLength(0);
    gate.resolve();
    await pending;
    expect(chat.localMessages).toHaveLength(0);
    expect(chat.getSnapshot().conversation?.messages).toHaveLength(1);
    expect(chat.context.messages).toEqual([sent]);
    await chat.dispose();
  });

  it("keeps repeated text as separate learner turns when preparation fails", async () => {
    const { chat, calls } = fixture();
    const fail = async () => { throw new Error("Authentication unavailable"); };
    await chat.sendPrepared(message("Again"), fail);
    await chat.sendPrepared(message("Again"), fail);
    expect(chat.context.messages.filter(item => item.role === "user")).toHaveLength(2);
    expect(chat.localMessages.filter(item => item.role === "user")).toHaveLength(2);
    expect(chat.context.errorMessage).toBe("Authentication unavailable");
    expect(calls()).toBe(0);
    await chat.dispose();
  });

  it("stops during pending preparation without dropping the turn or sending later", async () => {
    const { chat, calls } = fixture();
    const gate = deferred();
    const entered = deferred();
    const pending = chat.sendPrepared(message(), () => { entered.resolve(); return gate.promise; });
    await entered.promise;
    chat.cancel();
    await pending;
    expect(chat.getSnapshot().running).toBe(false);
    expect(chat.context.errorMessage).toBe("Response stopped");
    expect(chat.localMessages.filter(item => item.role === "user")).toHaveLength(1);
    gate.resolve();
    await Promise.resolve();
    expect(calls()).toBe(0);
    await chat.dispose();
  });
});
