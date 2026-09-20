import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { memoryAdmissionQuestions, questionDigest, thresholdKey, type JudgementCaller, type NeedleSearchResult } from "@keating/learner-contracts";
import { createIndexedDbWebMemoryStore, createWebMemoryAdmission, createWebMemoryAccount, webMemoryCandidates, withWebMemoryBank } from "../keating/judgement/memory-admission";
import { desktopNeedleSources, type NeedleSessionStore } from "../keating/needle-retrieval";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import type { AgentOptions } from "@earendil-works/pi-agent-core";

const backend = { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
const calibration = { entries: Object.fromEntries(Object.values(memoryAdmissionQuestions()).map(question => [thresholdKey(backend, questionDigest(question)), { deferBelow: 0.7, actAtOrAbove: 0.9 }])) };
const answer: JudgementCaller = async () => ({ ok: true, response: { backend, answers: {
  worth: { type: "noul", noul: 0.96 }, category: { type: "choice", choice: "interest", confidence: 0.95,
    probabilities: Object.fromEntries(Object.keys(memoryAdmissionQuestions().category.criteria).map(key => [key, key === "interest" ? 1 : 0])) },
} } });
function fixture(timeoutMs = 1000) {
  let messages: Array<Record<string, unknown>> = [{ id: "learner", role: "user", content: "I enjoy astronomy.", timestamp: 1 }];
  const sessions: NeedleSessionStore = { async getAllMetadata() { return [{ id: "past" }]; }, async loadSession(id) { return id === "past" ? { id, messages: structuredClone(messages) } : null; } };
  const store = createIndexedDbWebMemoryStore(new IDBFactory());
  let scope = "account-a", enabled = true, valid = true, request = "turn-a", retrieval = true, calls = 0, fitted = true;
  let call: JudgementCaller = answer, invalidation = () => {};
  const runtime = (): WebJudgementRuntime => ({ settings: { backend: "hosted", localModelId: "local-model", gatewayPath: "/api/judgement" },
    policy: { calibration: fitted ? calibration : { entries: {} }, tiers: [{ key: backend, call: (request, signal) => { calls++; return call(request, signal); } }] } });
  const controller = createWebMemoryAdmission({ sessions, store, timeoutMs, enabled: () => enabled, current: () => true, requestIdentity: () => request,
    account: { current: () => scope, refresh: async () => {} }, runtime: async () => ({ runtime: runtime(), current: () => valid }),
    subscribe(listener) { invalidation = listener; return () => {}; } });
  const result = async (): Promise<NeedleSearchResult> => ({ model: "needle-pinned", considered: 1,
    matches: (await desktopNeedleSources(sessions, 10)).map(source => ({ source, relativeScore: 1, marginToNext: null })) });
  return { controller, store, sessions, result, review: async () => { controller.review(await result(), () => retrieval); await controller.settled(); },
    calls: () => calls, replace: (value: typeof messages) => { messages = value; }, setCall: (value: JudgementCaller) => { call = value; },
    setScope: (value: string) => { scope = value; }, setRequest: (value: string) => { request = value; },
    revoke: () => { enabled = false; invalidation(); }, invalidate: () => { valid = false; }, setRetrieval: (value: boolean) => { retrieval = value; }, unfitted: () => { fitted = false; } };
}

test("extracts intact quotes with complete multi-block learner context and exact translated offsets", async () => {
  const f = fixture();
  f.replace([{ role: "assistant", content: "not learner evidence", timestamp: 1 }, { id: "learner", role: "user", timestamp: 2,
    content: [{ type: "text", text: "Some context." }, { type: "image", data: "private" }, { type: "text", text: "I enjoy astronomy." }] }]);
  const candidates = await webMemoryCandidates(await f.result(), f.sessions);
  const astronomy = candidates.find(row => row.evidence === "I enjoy astronomy.")!;
  expect(astronomy.message).toBe("Some context.\n\nI enjoy astronomy.");
  expect(astronomy.message.slice(astronomy.start, astronomy.end)).toBe(astronomy.evidence);
  expect(JSON.stringify(candidates)).not.toContain("private"); expect(JSON.stringify(candidates)).not.toContain("not learner evidence");
  f.replace([{ id: "learner", role: "user", content: "x".repeat(4001), timestamp: 1 }]);
  expect(await webMemoryCandidates(await f.result(), f.sessions)).toEqual([]); f.controller.dispose();
});

test("review writes account-scoped raw receipts and prompt rereads original learner evidence", async () => {
  const f = fixture(); await f.review();
  const saved = await f.store.read("account-a");
  expect(saved.bank).toHaveLength(1); expect(saved.reviews).toHaveLength(1);
  expect(saved.bank[0]!.answers!.worth.noul).toBe(0.96);
  expect(await f.controller.prompt()).toContain('"confidence":0.65');
  expect(await f.controller.prompt()).toContain("I enjoy astronomy.");
  expect((await f.store.read("account-b")).bank).toEqual([]);
  f.replace([{ id: "learner", role: "user", content: "I dislike astronomy.", timestamp: 1 }]);
  expect(await f.controller.prompt()).toBe(""); f.controller.dispose();
});

test("uncalibrated reviews stay receipts and cannot create durable proxy memories", async () => {
  const f = fixture(); f.unfitted(); await f.review();
  const saved = await f.store.read("account-a");
  expect(saved.bank).toEqual([]); expect(saved.reviews[0]!.decisions[0]!.reason).toBe("uncalibrated");
  expect(await f.controller.prompt()).toBe(""); f.controller.dispose();
});

test("source, account, turn, calibration, retrieval and opt-in changes reject late writes", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.replace([{ id: "learner", role: "user", content: "Edited source", timestamp: 1 }]),
    (f: ReturnType<typeof fixture>) => f.setScope("account-b"),
    (f: ReturnType<typeof fixture>) => f.setRequest("turn-b"),
    (f: ReturnType<typeof fixture>) => f.invalidate(),
    (f: ReturnType<typeof fixture>) => f.setRetrieval(false),
    (f: ReturnType<typeof fixture>) => f.revoke(),
  ]) {
    const f = fixture();
    f.setCall(async (request, signal) => { change(f); return answer(request, signal); });
    await f.review(); expect((await f.store.read("account-a")).bank).toEqual([]); f.controller.dispose();
  }
});

test("hung backend keeps its lease after deadline and cannot accumulate background calls", async () => {
  const f = fixture(5); let release!: () => void;
  f.setCall(async (request, signal) => { await new Promise<void>(resolve => { release = resolve; }); return answer(request, signal); });
  await f.review(); expect(f.calls()).toBe(1);
  await f.review(); expect(f.calls()).toBe(1);
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  f.setCall(answer); await f.review(); expect(f.calls()).toBe(2); f.controller.dispose();
});

test("IndexedDB compare-and-swap prevents lost updates between controllers", async () => {
  const f = fixture(); await f.review(); const before = await f.store.read("account-a");
  const review = before.reviews[0]!;
  const results = await Promise.all([f.store.commit("account-a", before.revision, before.bank, review, () => true),
    f.store.commit("account-a", before.revision, before.bank, review, () => true)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await f.store.commit("account-a", before.revision + 1, before.bank, review, () => false)).toBe(false);
  expect((await f.store.read("account-a")).revision).toBe(before.revision + 1); f.controller.dispose();
});

test("provider wrapper preserves baseline synchronously when off, and never waits for judgement", async () => {
  const f = fixture(); f.revoke(); const context = { systemPrompt: "Explicit profile and session", messages: [] };
  const sentinel = {} as never; let received: unknown;
  const stream = ((_model, ctx) => { received = ctx; return sentinel; }) as NonNullable<AgentOptions["streamFn"]>;
  expect(withWebMemoryBank(stream, f.controller)({} as never, context)).toBe(sentinel); expect(received).toBe(context);
  f.controller.dispose();
  const live = fixture(); await live.review();
  await withWebMemoryBank(stream, live.controller)({} as never, context);
  expect((received as typeof context).systemPrompt).toStartWith(context.systemPrompt);
  expect((received as typeof context).systemPrompt).toContain("I enjoy astronomy.");
  expect(context.systemPrompt).toBe("Explicit profile and session"); live.controller.dispose();
});

test("provider dispatch rejects a tutor/question change during asynchronous memory loading", async () => {
  const f = fixture(); await f.review();
  const read = f.store.read;
  f.store.read = async scope => { const saved = await read(scope); f.setRequest("edited-question"); return saved; };
  let dispatched = false;
  const stream = (() => { dispatched = true; return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
  await expect(withWebMemoryBank(stream, f.controller)({} as never, { messages: [] })).rejects.toThrow("learner request changed");
  expect(dispatched).toBe(false); f.controller.dispose();
});

test("stable account cache permits offline reload without storing a token, and failures retry after backoff", async () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  let token = "secret-access-token", calls = 0, offline = false, now = 0;
  const client = () => ({ config: { issuer: "https://accounts.example" }, getSession: () => ({ accessToken: token }),
    request: async () => { calls++; if (offline) throw new Error("offline"); return Response.json({ id: "public-account-id" }); } }) as never;
  const first = createWebMemoryAccount({ client, storage, now: () => now });
  await first.refresh(); expect(first.current()).toBe(JSON.stringify(["https://accounts.example", "public-account-id"]));
  expect(JSON.stringify([...values.values()])).not.toContain("secret-access-token");
  offline = true;
  const reload = createWebMemoryAccount({ client, storage, now: () => now });
  await reload.refresh(); expect(reload.current()).toBe(first.current()); expect(calls).toBe(1);
  token = "new-secret-token"; expect(reload.current()).toBeNull();
  await reload.refresh(); expect(reload.current()).toBeNull(); expect(calls).toBe(2);
  await reload.refresh(); expect(calls).toBe(2);
  now = 5001; offline = false; await reload.refresh(); expect(calls).toBe(3);
  expect(reload.current()).toBe(JSON.stringify(["https://accounts.example", "public-account-id"]));
});
