import { describe, expect, it } from "bun:test";
import { FlueConversation } from "../keating/flue/conversation";
import { FlueApiError } from "@flue/sdk";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { prepareMessagesForRetry } from "../hooks/session-recovery";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(admissionGate?: Promise<void>, missingHistory = false, modelError?: string) {
  const chat = new FlueConversation({ streamFn: () => {
    const stream = createAssistantMessageEventStream();
    const response = (chat as any).errorMessage("error", modelError);
    stream.push({ type: "error", reason: "error", error: response });
    stream.end(response);
    return stream;
  }, initialState: { model: {
    id: "fixture", provider: "openai", api: "openai-completions",
  } as any } }, "unused");
  const state = chat as any;
  const native = { messages: [] as any[] };
  let calls = 0;
  state.native = native;
  const attach = () => {
    state.bridge = {
      legacyMessages: [], configure() {}, async beginTurn() {},
      async checkpointSettled() {}, async close() {},
    };
    state.bridgeReady = Promise.resolve();
    state.client = {
      async send({ message }: any) {
        calls++;
        await admissionGate;
        if (message.kind === "user") native.messages.push({ id: `user-${calls}`, role: "user", display: "visible", parts: [{ type: "text", text: message.body }] });
        state.acceptNative(native);
        state.notify();
        return {};
      },
      async read() {
        if (modelError) await state.modelTurn(() => {}, new AbortController().signal);
      }, async history() {
        if (missingHistory && calls === 0) throw new FlueApiError(404, { error: { type: "stream_not_found" } });
        return native;
      }, async abort() {},
    };
  };
  attach();
  return { chat, calls: () => calls, attach };
}
const message = (text = "Show this immediately") => ({ role: "user" as const, content: text, timestamp: Date.now() });

describe("immediate learner turns", () => {
  it("actually submits a resume after restoring a turn interrupted by sign-in", async () => {
    const { chat, calls } = fixture(undefined, true);
    const sent = message("Preserve this through sign-in");
    chat.context.messages = [sent];
    const gate = deferred();
    const pending = chat.resume(() => gate.promise);
    expect(calls()).toBe(0);
    gate.resolve();
    await pending;
    expect(calls()).toBe(1);
    expect(chat.context.messages.filter(item => item.role === "user")).toEqual([sent]);
    await chat.dispose();
  });
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

  it("keeps model authentication errors available to the local recovery UI even when the SDK read settles", async () => {
    const { chat } = fixture(undefined, false, "Authentication error: Not Organic session expired");
    await chat.send(message("hi"));
    expect(chat.localMessages).toHaveLength(1);
    expect(chat.localMessages[0]).toMatchObject({ role: "assistant", stopReason: "error", errorMessage: "Authentication error: Not Organic session expired" });
    expect(prepareMessagesForRetry(chat.context.messages)?.at(-1)).toMatchObject({ role: "user", content: "hi" });
    await chat.dispose();
  });

  it("does not redisplay admitted learner turns as unsent when retrying", async () => {
    const { chat } = fixture(undefined, false, "Provider unavailable");
    await chat.send(message("hi"));
    chat.context.messages = prepareMessagesForRetry(chat.context.messages)!;
    expect(chat.localMessages).toEqual([]);
    await chat.resume();
    expect(chat.getSnapshot().conversation?.messages.filter(item => item.role === "user")).toHaveLength(1);
    expect(chat.context.messages.filter(item => item.role === "user")).toHaveLength(1);
    expect(chat.localMessages.filter(item => item.role === "user")).toHaveLength(0);
    await chat.dispose();
  });

  it("publishes retry immediately and keeps the same turn retryable after another preparation failure", async () => {
    const { chat, calls, attach } = fixture();
    await chat.sendPrepared(message("hi"), async () => { throw new Error("Authentication unavailable"); });
    chat.context.messages = prepareMessagesForRetry(chat.context.messages)!;
    const gate = deferred();
    const pending = chat.resume(async () => { await gate.promise; throw new Error("Session storage unavailable"); });
    expect(chat.getSnapshot().running).toBe(true);
    expect(chat.context.messages).toHaveLength(1);
    gate.resolve();
    await pending;
    expect(chat.getSnapshot().running).toBe(false);
    expect(chat.context.errorMessage).toBe("Session storage unavailable");
    const retry = prepareMessagesForRetry(chat.context.messages);
    expect(retry).toHaveLength(1);
    expect(retry![0]).toMatchObject({ role: "user", content: "hi" });
    chat.context.messages = retry!;
    attach();
    await chat.resume();
    expect(calls()).toBe(1);
    expect(chat.context.errorMessage).toBeUndefined();
    expect(chat.context.messages.filter(item => item.role === "user")).toHaveLength(1);
    await chat.dispose();
  });

  it("resumes an unfinished learner turn when a context notice follows it", async () => {
    const { chat, calls } = fixture();
    chat.context.messages = [message("hi"), { role: "custom", content: "Session context loaded" } as any];
    await chat.resume();
    expect(calls()).toBe(1);
    expect(chat.context.messages).toHaveLength(2);
    expect(chat.context.errorMessage).toBeUndefined();
    await chat.dispose();
  });
});
