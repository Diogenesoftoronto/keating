import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { memoryAdmissionQuestions, questionDigest, thresholdKey, type JudgementCaller, type NeedleSearchResult } from "@keating/learner-contracts";
import { createAsyncStorageMobileMemoryStore, createMobileMemoryAdmission, mobileMemoryCandidates } from "../src/lib/judgement/memory-admission";
import { mobileNeedleSources } from "../src/lib/needle-retrieval";
import type { ChatSession } from "../src/lib/types";
import type { MobileJudgementRuntime } from "../src/lib/judgement/runtime";

const hash = async (value: string) => createHash("sha256").update(value).digest("hex");
const backend = { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
const calibration = { entries: Object.fromEntries(Object.values(memoryAdmissionQuestions()).map(question =>
  [thresholdKey(backend, questionDigest(question)), { deferBelow: 0.7, actAtOrAbove: 0.9 }])) };
const answer: JudgementCaller = async () => ({ ok: true, response: { backend, answers: {
  worth: { type: "noul", noul: 0.96 }, category: { type: "choice", choice: "interest", confidence: 0.95,
    probabilities: Object.fromEntries(Object.keys(memoryAdmissionQuestions().category.criteria).map(key => [key, key === "interest" ? 1 : 0])) },
} } });
function fixture(timeoutMs = 1000) {
  let sessions: ChatSession[] = [{ id: "past", title: "Old work", createdAt: 0, updatedAt: 1,
    messages: [{ id: "learner", role: "user", content: "I enjoy astronomy.", createdAt: 1 }] }];
  let scope: string | null = "account-a", enabled = true, valid = true, request = "turn-a", retrieval = true, calls = 0, fitted = true;
  let call: JudgementCaller = answer, changed = () => {};
  const items = new Map<string, string>();
  const rawStorage = { async getItem(key: string) { return items.get(key) ?? null; },
    async setItem(key: string, value: string) { items.set(key, value); }, async removeItem(key: string) { items.delete(key); } };
  const store = createAsyncStorageMobileMemoryStore(rawStorage, hash);
  const runtime = async (): Promise<MobileJudgementRuntime> => ({ enabled: true, hostedEnabled: true,
    policy: { calibration: fitted ? calibration : { entries: {} }, tiers: [{ key: backend, call }] },
    call: (request, signal) => { calls++; return call(request, signal); } });
  const controller = createMobileMemoryAdmission({ sessions: () => sessions, scope: () => scope, enabled: () => enabled,
    current: () => valid, requestIdentity: () => request, runtime, store, hash, timeoutMs,
    subscribe(listener) { changed = listener; return () => {}; } });
  const result = (): NeedleSearchResult => ({ model: "needle-pinned", considered: 1,
    matches: mobileNeedleSources(sessions, { sessionId: "current", messageId: "now", createdAt: 10, query: "astronomy" })
      .slice(0, 4).map(source => ({ source, relativeScore: 1, marginToNext: null })) });
  return { controller, store, rawStorage, items, result, sessions: () => sessions,
    review: async () => { controller.review(result(), () => retrieval); await controller.settled(); },
    calls: () => calls, setCall: (value: JudgementCaller) => { call = value; },
    replace: (value: ChatSession[]) => { sessions = value; },
    sourceEdit: () => { sessions = structuredClone(sessions); sessions[0].messages[0].content = "I dislike astronomy."; },
    setScope: (value: string | null) => { scope = value; }, setRequest: (value: string) => { request = value; },
    revoke: () => { enabled = false; changed(); }, invalidate: () => { valid = false; changed(); },
    setRetrieval: (value: boolean) => { retrieval = value; }, unfitted: () => { fitted = false; } };
}

test("mobile candidates bind actual Needle windows to exact complete saved user messages", async () => {
  const f = fixture();
  const candidates = await mobileMemoryCandidates(f.result(), f.sessions(), hash);
  expect(candidates).toHaveLength(1);
  expect(candidates[0].message).toBe("I enjoy astronomy.");
  expect(candidates[0].message.slice(candidates[0].start, candidates[0].end)).toBe(candidates[0].evidence);
  const result = f.result(); result.matches[0].source.text = "invented quote";
  expect(await mobileMemoryCandidates(result, f.sessions(), hash)).toEqual([]);
  const changed = structuredClone(f.sessions()); changed[0].messages[0].role = "assistant"; f.replace(changed);
  expect(await mobileMemoryCandidates(f.result(), f.sessions(), hash)).toEqual([]);
  f.controller.dispose();
});

test("mid-sentence shortlist boundaries never become fabricated standalone memory", async () => {
  const f = fixture(), sessions = structuredClone(f.sessions());
  sessions[0].messages[0].content = "Someone else says I enjoy astronomy."; f.replace(sessions);
  const result = f.result(); result.matches[0].source.start = 18; result.matches[0].source.text = sessions[0].messages[0].content.slice(18);
  expect(await mobileMemoryCandidates(result, sessions, hash)).toEqual([]); f.controller.dispose();
});

test("durable bank is account scoped, retains raw receipts, and reloads source before prompting", async () => {
  const f = fixture(); await f.review();
  const record = await f.store.read("account-a");
  expect(record.bank).toHaveLength(1); expect(record.reviews[0].decisions[0].answers?.worth.noul).toBe(0.96);
  expect(await f.controller.prompt()).toContain('"confidence":0.65');
  expect(await f.controller.prompt()).toContain("I enjoy astronomy.");
  expect((await f.store.read("account-b")).bank).toEqual([]);
  expect([...f.items.keys()][0]).not.toContain("account-a");
  const captured = f.controller.captureRequest(); f.setRequest("later"); expect(f.controller.requestCurrent(captured)).toBe(false);
  f.sourceEdit(); expect(await f.controller.prompt()).toBe(""); f.controller.dispose();
});

test("off and unknown account do not start background inference", async () => {
  const f = fixture(); f.revoke(); await f.review();
  expect(f.calls()).toBe(0); expect(f.items.size).toBe(0); expect(await f.controller.prompt()).toBe(""); f.controller.dispose();
  const unknown = fixture(); unknown.setScope(null); await unknown.review();
  expect(unknown.calls()).toBe(0); expect(unknown.items.size).toBe(0); unknown.controller.dispose();
});

test("uncalibrated estimates remain diagnostic receipts with an empty bank", async () => {
  const f = fixture(); f.unfitted(); await f.review();
  const record = await f.store.read("account-a");
  expect(record.bank).toEqual([]); expect(record.reviews[0].decisions[0].reason).toBe("uncalibrated");
  expect(await f.controller.prompt()).toBe(""); f.controller.dispose();
});

test("changed source, account, turn, config, retrieval and opt-in prevent late admission", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => f.sourceEdit(),
    (f: ReturnType<typeof fixture>) => f.setScope("account-b"), (f: ReturnType<typeof fixture>) => f.setRequest("later"),
    (f: ReturnType<typeof fixture>) => f.invalidate(), (f: ReturnType<typeof fixture>) => f.setRetrieval(false),
    (f: ReturnType<typeof fixture>) => f.revoke()]) {
    const f = fixture();
    f.setCall(async (request, signal) => { change(f); return answer(request, signal); });
    await f.review(); expect((await f.store.read("account-a")).bank).toEqual([]); f.controller.dispose();
  }
});

test("a hung caller cannot build a queue of background reviews or delay the prompt", async () => {
  const f = fixture(5); let release!: () => void;
  f.setCall(async (request, signal) => { await new Promise<void>(resolve => { release = resolve; }); return answer(request, signal); });
  await f.review(); expect(f.calls()).toBe(1);
  await f.review(); expect(f.calls()).toBe(1); expect(await f.controller.prompt()).toBe("");
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  f.setCall(answer); await f.review(); expect(f.calls()).toBe(2); f.controller.dispose();
});

test("serialized storage rejects conflicting revisions and rolls back a stale async write", async () => {
  const f = fixture(); await f.review();
  const before = await f.store.read("account-a"), receipt = before.reviews[0];
  const commits = await Promise.all([f.store.commit("account-a", before.revision, before.bank, receipt, () => true),
    f.store.commit("account-a", before.revision, before.bank, receipt, () => true)]);
  expect(commits.filter(Boolean)).toHaveLength(1);
  const rawBefore = [...f.items.values()][0], revised = await f.store.read("account-a");
  let valid = true;
  f.rawStorage.setItem = async (key, value) => { f.items.set(key, value); valid = false; };
  expect(await f.store.commit("account-a", revised.revision, revised.bank, receipt, () => valid)).toBe(false);
  expect([...f.items.values()][0]).toBe(rawBefore); f.controller.dispose();
});

test("corrupt storage and write failures cannot produce prompt memory", async () => {
  const f = fixture(); f.rawStorage.setItem = async () => {};
  await f.review(); expect(await f.controller.prompt()).toBe("");
  f.items.set(`keating:proxy-memory:v1:${await hash("account-a")}`, '{"revision":1,"bank":[{}],"reviews":[]}');
  expect(await f.controller.prompt()).toBe(""); f.controller.dispose();
});
