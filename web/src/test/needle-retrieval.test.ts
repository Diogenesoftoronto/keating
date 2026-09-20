import { describe, expect, test } from "bun:test";
import { createDesktopNeedleRecall, desktopNeedleSources, desktopNeedleStatus, withDesktopNeedleRecall, type NeedleSessionStore } from "../keating/needle-retrieval";

test("desktop model status carries bounded durable-install progress", async () => {
  expect(await desktopNeedleStatus(async () => ({ available: false, model: null, installed: false, downloading: true,
    downloadedBytes: 1234, totalBytes: 36000000, managed: true }))).toEqual({ available: false, model: null,
    installed: false, downloading: true, downloadedBytes: 1234, totalBytes: 36000000, managed: true });
  expect(await desktopNeedleStatus(async () => ({ available: true, model: "pinned", downloadedBytes: NaN,
    totalBytes: -1, error: "x".repeat(201), managed: "yes" }))).toEqual({ available: true, model: "pinned" });
});
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { withTeachingAdjustment, type TeachingAdjustmentController } from "../keating/judgement/teaching-adjustment";

function fixture() {
  let sessions: Array<Record<string, unknown>> = [{ id: "past", messages: [
    { role: "system", content: "Do not retrieve me", timestamp: 1 },
    { role: "assistant", content: "Teacher answer", timestamp: 2 },
    { role: "user", content: [{ type: "image", data: "private bytes" }, { type: "text", text: "I confused area and perimeter." }], timestamp: 3 },
    { role: "user", content: "The current question", timestamp: 10 },
  ] }];
  const store: NeedleSessionStore = { async getAllMetadata() { return sessions.map(session => ({ id: session.id as string, lastModified: "2026-09-20" })); }, async loadSession(id) { return structuredClone(sessions.find(session => session.id === id)); } };
  let identity = "account-a", enabled = true, available = true, current = true;
  let requestIdentity = "tutor-a:question-a";
  let invalidation = () => {};
  const calls: Array<{ operation: string; payload: unknown }> = [];
  let embeddingHook: (() => void | Promise<void>) | undefined;
  let model = "needle-pinned";
  const execute = async (operation: string, payload: unknown) => {
    calls.push({ operation, payload });
    if (operation === "needle.status") return { available: true, model };
    await embeddingHook?.();
    return { model, dimensions: 3072, vectors: (payload as { texts: string[] }).texts.map(() => [1, ...Array(3071).fill(0)]) };
  };
  const recall = createDesktopNeedleRecall({ store, execute, identity: () => identity, requestIdentity: () => requestIdentity, enabled: () => enabled, available: () => available, current: () => current,
    subscribe: listener => { invalidation = listener; return () => {}; } });
  return { recall, store, calls, setIdentity: (value: string) => { identity = value; }, setEnabled: (value: boolean) => { enabled = value; invalidation(); },
    setAvailable: (value: boolean) => { available = value; }, setCurrent: (value: boolean) => { current = value; }, setModel: (value: string) => { model = value; },
    onEmbed: (hook: () => void | Promise<void>) => { embeddingHook = hook; }, setRequest: (value: string) => { requestIdentity = value; }, replace: (value: Array<Record<string, unknown>>) => { sessions = value; } };
}

describe("desktop Needle recall at the provider boundary", () => {
  test("uses exact prior learner text blocks with bounded provenance; excludes attachments and current answers", async () => {
    const f = fixture();
    const sources = await desktopNeedleSources(f.store, 10);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ sessionId: "past", text: "I confused area and perimeter.", start: 0, end: 30 });
    expect(sources[0]!.id).toContain(",1]");
    const prompt = await f.recall.prepare("Which measurement?", 10);
    expect(prompt).toContain("I confused area and perimeter.");
    expect(prompt).not.toContain("Teacher answer");
    expect(prompt).not.toContain("private bytes");
    expect(prompt).not.toContain("The current question");
    expect(prompt).not.toContain("account-a");
    f.recall.dispose();
  });
  test("browser-only, disabled and stale agent paths do not call native services", async () => {
    for (const disable of [(f: ReturnType<typeof fixture>) => f.setAvailable(false), (f: ReturnType<typeof fixture>) => f.setEnabled(false), (f: ReturnType<typeof fixture>) => f.setCurrent(false)]) {
      const f = fixture(); disable(f);
      expect(await f.recall.prepare("query", 10)).toBe(""); expect(f.calls).toHaveLength(0); f.recall.dispose();
    }
  });
  test("disabled or browser-only wrapper preserves the immediate baseline without account or store reads", () => {
    for (const mode of ["off", "browser"]) {
      let identityReads = 0, sourceReads = 0;
      const recall = createDesktopNeedleRecall({
        store: { async getAllMetadata() { sourceReads++; return []; }, async loadSession() { sourceReads++; return null; } },
        identity: () => `rotating-account-${++identityReads}`,
        current: () => true, enabled: () => mode !== "off", available: () => mode !== "browser", subscribe: () => () => {},
      });
      const initialReads = identityReads;
      const context = { messages: [{ role: "user" as const, content: "query", timestamp: 10 }] };
      const sentinel = {} as never;
      const downstream = ((_model, passed) => { expect(passed).toBe(context); return sentinel; }) as NonNullable<AgentOptions["streamFn"]>;
      expect(withDesktopNeedleRecall(downstream, recall)({} as never, context)).toBe(sentinel);
      expect(identityReads).toBe(initialReads); expect(sourceReads).toBe(0);
      recall.dispose();
    }
  });
  test("account/source changes during embedding cannot reach the prompt", async () => {
    const account = fixture(); account.onEmbed(() => account.setIdentity("account-b"));
    expect(await account.recall.prepare("query", 10)).toBe(""); account.recall.dispose();
    const source = fixture(); source.onEmbed(() => source.replace([{ id: "past", messages: [{ role: "user", content: "Edited source", timestamp: 3 }] }]));
    expect(await source.recall.prepare("query", 10)).toBe(""); source.recall.dispose();
  });
  test("preference revocation and abort discard noncooperative native results", async () => {
    const f = fixture(); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    f.onEmbed(async () => { entered(); await pending; });
    const controller = new AbortController(); const result = f.recall.prepare("query", 10, controller.signal);
    await started; controller.abort(); expect(await result).toBe("");
    f.setEnabled(false); release(); f.recall.dispose();
  });
  test("RAM cache is model scoped and rebuilt on account change", async () => {
    const f = fixture();
    await f.recall.prepare("query", 10);
    const embeddings = () => f.calls.filter(call => call.operation === "needle.embed").length;
    expect(embeddings()).toBe(2);
    await f.recall.prepare("query", 10); expect(embeddings()).toBe(3);
    f.setIdentity("account-b"); await f.recall.prepare("query", 10); expect(embeddings()).toBe(5);
    f.setModel("needle-replacement"); await f.recall.prepare("query", 10); expect(embeddings()).toBe(7);
    f.recall.dispose();
  });
  test("preserves session context and accepted teaching adjustment without mutating the base prompt", async () => {
    const f = fixture();
    const contexts: unknown[] = [];
    const downstream = ((_model, context) => { contexts.push(context); return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
    const wrapped = withDesktopNeedleRecall(downstream, f.recall);
    const context = { systemPrompt: "Base\nSession context\nAccepted teaching adjustment", messages: [{ role: "user" as const, content: "Which measurement?", timestamp: 10 }] };
    await wrapped({} as never, context);
    expect((contexts[0] as typeof context).systemPrompt).toStartWith(context.systemPrompt);
    expect((contexts[0] as typeof context).systemPrompt).toContain("<keating-local-recall>");
    expect(context.systemPrompt).not.toContain("<keating-local-recall>");
    f.recall.dispose();
  });
  test("checks accepted adjustment after asynchronous retrieval, so cancellation cannot leak into dispatch", async () => {
    const f = fixture(); let accepted = true; let sentPrompt = "";
    f.onEmbed(() => { accepted = false; });
    const downstream = ((_model, context) => { sentPrompt = context.systemPrompt ?? ""; return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
    const adjusted = withTeachingAdjustment(downstream, { instruction: () => accepted ? "CANCELLED_ADJUSTMENT" : undefined } as TeachingAdjustmentController);
    await withDesktopNeedleRecall(adjusted, f.recall)({} as never, { systemPrompt: "Base and session", messages: [{ role: "user", content: "query", timestamp: 10 }] });
    expect(sentPrompt).toContain("Base and session"); expect(sentPrompt).toContain("<keating-local-recall>"); expect(sentPrompt).not.toContain("CANCELLED_ADJUSTMENT"); f.recall.dispose();
  });
  test("edited latest question or switched tutor cancels the obsolete provider dispatch", async () => {
    for (const replacement of ["tutor-a:edited-question", "tutor-b:question-a"]) {
      const f = fixture(); let dispatched = false;
      f.onEmbed(() => f.setRequest(replacement));
      const downstream = (() => { dispatched = true; return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
      await expect(withDesktopNeedleRecall(downstream, f.recall)({} as never, { messages: [{ role: "user", content: "query", timestamp: 10 }] })).rejects.toThrow("learner request changed");
      expect(dispatched).toBe(false); f.recall.dispose();
    }
  });
  test("metadata loading has a deadline and failure stays optional", async () => {
    const recall = createDesktopNeedleRecall({ store: { async getAllMetadata() { return new Promise(() => {}); }, async loadSession() { return null; } }, identity: () => "local", current: () => true, available: () => true, enabled: () => true, subscribe: () => () => {}, timeoutMs: 2 });
    expect(await recall.prepare("query", 10)).toBe(""); recall.dispose();
    expect(await desktopNeedleStatus(async () => { throw new Error("not installed"); })).toEqual({ available: false, model: null });
  });
});


test("background admission receives detached matches and expires on the next request", async () => {
  const active: Array<() => boolean> = [];
  const recall = createDesktopNeedleRecall({
    store: { async getAllMetadata() { return [{ id: "past" }]; }, async loadSession() { return { id: "past", messages: [{ role: "user", content: "I confuse area and perimeter.", timestamp: 1 }] }; } },
    identity: () => "local", current: () => true, enabled: () => true, available: () => true, subscribe: () => () => {},
    execute: async (operation, payload) => operation === "needle.status" ? { available: true, model: "test" } : { model: "test", dimensions: 3072, vectors: (payload as { texts: string[] }).texts.map(() => [1, ...Array(3071).fill(0)]) },
    onRetrieved(result, current) { active.push(current); result.matches[0]!.source.text = "mutated"; throw new Error("optional observer failed"); },
  });
  expect(await recall.prepare("area", 10)).toContain("I confuse area and perimeter.");
  expect(active[0]!()).toBe(true);
  await recall.prepare("perimeter", 11);
  expect(active[0]!()).toBe(false);
  expect(active[1]!()).toBe(true);
  recall.dispose();
  expect(active[1]!()).toBe(false);
});
