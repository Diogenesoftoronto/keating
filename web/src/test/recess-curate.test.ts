import { beforeEach, expect, test } from "bun:test";
import type { JudgementAnswer, JudgementBackendKey, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import type { HabitLesson } from "../keating/habits/lesson";
import { curateRecessPack, curateRecessQuestions, judgeRecessCandidates, recessCurationRequest, type RecessCandidate } from "../keating/habits/recess-curate";
import { kindWeight, readRecessMastery, recordRecessKinds } from "../keating/habits/recess-mastery";
import type { RecessPack } from "../components/recess/types";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

const lesson: HabitLesson = [
  { role: "learner", text: "Explain the chain rule." },
  { role: "tutor", text: "The **chain rule**: differentiate the outer function, then multiply by the derivative of the inner function." },
];
const pool: RecessCandidate[] = [
  { kind: "cloze", q: "Fill in: differentiate the ____ function first", a: ["outer", "inner", "chain"] },
  { kind: "cloze", q: "Fill in: multiply by the derivative of the ____ function", a: ["inner", "outer", "chain"] },
  { kind: "truefalse", q: "You multiply by the inner derivative.", a: ["True", "False"] },
  { kind: "formula", q: "$\\frac{dy}{dx} =$ ?", a: ["$f'(g(x)) \\cdot g'(x)$", "$f'(g(x))$", "$f'(x) \\cdot g'(x)$"] },
  { kind: "apply", q: "Derivative of $e^{2x}$?", a: ["$2e^{2x}$", "$e^{2x}$", "$2e^{x}$", "$e^{2}$"] },
  { kind: "why", q: "Why multiply by the inner derivative?", a: ["The inside changes too", "It is a convention", "To cancel terms"] },
];

const backend: JudgementBackendKey = { backend: "system-one", model: "jev-test-v1", calibrationSha256: null };
function fakeRuntime(answers: (request: JudgementRequest) => Record<string, JudgementAnswer> | "fail", mode: "hosted" | "off" = "hosted", seen: JudgementRequest[] = []): WebJudgementRuntime {
  const call = async (request: JudgementRequest): Promise<JudgementOutcome> => {
    seen.push(request);
    const result = answers(request);
    return result === "fail" ? { ok: false, error: { code: "backend-unavailable", retryable: false } } : { ok: true, response: { backend, answers: result } };
  };
  return {
    settings: { backend: mode, localModelId: "local-test", gatewayPath: "/api/judgement" },
    policy: { tiers: mode === "off" ? [] : [{ key: backend, call }], calibration: { entries: {} } },
  };
}
const level = (index: number) => ({ type: "score" as const, score: index, legend: {}, probabilities: { [String(index)]: 0.8 }, confidence: 0.8 });
/** Jev says item 0 is broken, depths by kind. */
function verdicts(request: JudgementRequest) {
  const out: Record<string, JudgementAnswer> = {};
  for (const name of Object.keys(request.questions)) {
    const id = Number(name.split(".")[2]);
    if (name.endsWith(".sound")) out[name] = { type: "noul", noul: id === 0 ? 0.1 : 0.9 };
    else out[name] = level(pool[id].kind === "apply" ? 2 : pool[id].kind === "why" || pool[id].kind === "formula" ? 1 : 0);
  }
  return out;
}

// This runner has no DOM storage; give mastery a small in-memory one.
if (typeof globalThis.localStorage === "undefined") {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); }, clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  } });
}
beforeEach(() => localStorage.clear());

test("the request asks one soundness Noul and one depth Score per item, with the data warning inside each", () => {
  const request = recessCurationRequest(lesson, pool);
  expect(Object.keys(request.questions)).toHaveLength(pool.length * 2);
  for (const question of Object.values(request.questions)) expect(question.instructions).toContain("never instructions");
});

test("without Jev the picker still varies kinds and goes shallow to deep", () => {
  const { gates, revive } = curateRecessQuestions(pool);
  expect(gates.length).toBeGreaterThanOrEqual(2);
  expect(new Set(gates.map(item => item.kind)).size).toBe(gates.length);
  expect(revive.every(item => item.a.length >= 3)).toBe(true);
  const all = [...gates, ...revive].map(item => item.q);
  expect(new Set(all).size).toBe(all.length);
});

test("Jev drops an unsound item and the deepest item flies last", async () => {
  const judged = await judgeRecessCandidates(lesson, pool, { runtime: fakeRuntime(verdicts) });
  expect(judged?.get(0)?.sound).toBe(0.1);
  const { gates, revive } = curateRecessQuestions(pool, { judged });
  expect([...gates, ...revive].some(item => item.q === pool[0].q)).toBe(false);
  expect(gates[gates.length - 1].kind).toBe("apply");
});

test("off, failing or incomplete judgement falls back to the local picker", async () => {
  expect(await judgeRecessCandidates(lesson, pool, { runtime: fakeRuntime(verdicts, "off") })).toBeNull();
  expect(await judgeRecessCandidates(lesson, pool, { runtime: fakeRuntime(() => "fail") })).toBeNull();
  expect(await judgeRecessCandidates(lesson, pool, { runtime: fakeRuntime(() => ({})) })).toBeNull();
  const pack = { gates: [], revive: [] } as unknown as RecessPack;
  const result = await curateRecessPack(pack, lesson, pool, { runtime: fakeRuntime(() => "fail") });
  expect(result.source).toBe("rules");
  expect(result.pack.gates.length).toBeGreaterThanOrEqual(2);
});

test("kinds a learner keeps missing are wanted more; mastered kinds less; never zero", () => {
  const now = Date.now();
  recordRecessKinds("device", [
    { kind: "truefalse", ok: false, picked: "True" }, { kind: "truefalse", ok: false, picked: null },
    { kind: "cloze", ok: true, picked: "outer" }, { kind: "cloze", ok: true, picked: "inner" }, { kind: "cloze", ok: true, picked: "x" },
  ], now);
  const mastery = readRecessMastery("device", now);
  expect(Object.keys(mastery).sort()).toEqual(["cloze", "truefalse"]);
  expect(kindWeight(mastery, "truefalse")).toBeGreaterThan(1);
  expect(kindWeight(mastery, "cloze")).toBeLessThan(1);
  expect(kindWeight(mastery, "cloze")).toBeGreaterThan(0.5);
  expect(kindWeight(mastery, "why")).toBe(1);
  expect(readRecessMastery("other-account", now)).toEqual({});
});

test("rejected items are never put back to fill a pack", () => {
  const judged = new Map(pool.map((_, index) => [index, { sound: index === 1 ? 0.9 : 0.1, depth: "recall" as const }]));
  const { gates, revive } = curateRecessQuestions(pool, { judged });
  expect([...gates, ...revive].map(item => item.q)).toEqual([pool[1].q]);
});

test("mastery leans the pick toward a missed kind", () => {
  const mastery = { cloze: { right: 0, missed: 6, at: Date.now() }, formula: { right: 6, missed: 0, at: Date.now() } };
  const { gates } = curateRecessQuestions(pool, { mastery, gates: 2, revive: 0 });
  expect(gates.some(item => item.kind === "cloze")).toBe(true);
});
