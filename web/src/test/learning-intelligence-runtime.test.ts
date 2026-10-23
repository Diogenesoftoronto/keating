import { expect, test } from "bun:test";
import { createLearningIntelligence, withLearningIntelligence } from "../keating/learning-intelligence/runtime";
import { buildLearningForecastBatch, readLearningForecasts } from "../keating/learning-intelligence/forecasts";
import type { ExtractionRequest, ExtractionOutcome } from "../keating/learning-intelligence/provider";
import type { LearningHistory } from "../keating/learning-intelligence/forecasts";
import type { LearningDiagnosticInput } from "../keating/learning-intelligence/diagnostics";
import type { MemoryAdmissionCandidate } from "@keating/learner-contracts";
import type { AgentOptions } from "@earendil-works/pi-agent-core";

const time = Date.parse("2026-10-23T12:00:00Z");
function history(): LearningHistory {
  return { checks: Array.from({ length: 8 }, (_, index) => ({ id: `check-${index}`, topic: "fractions", question: "Explain a half", answer: "a part",
    score: index % 2, grading: "model" as const, createdAt: time - (8 - index) * 86_400_000, sessionId: "lesson" })), reviews: [], decks: [] };
}
function fixture() {
  let messages: unknown[] = [{ id: "learner", role: "user", content: "I enjoy astronomy.", timestamp: 1 },
    { id: "teacher", role: "assistant", content: "A half is one of two equal parts. Why must the parts be equal?", timestamp: 2 }];
  let scope = `account-${crypto.randomUUID()}`, enabled = true, live = true, calls = 0, invalidate = () => {}, mutate: (request: ExtractionRequest) => void = () => {};
  let currentHistory = history(), currentTime = time, deleted = false;
  let beforeSourceRead = async () => {};
  const data = new Map<string, string>(), diagnostics: LearningDiagnosticInput[] = [], memories: MemoryAdmissionCandidate[] = [];
  const request = async (body: ExtractionRequest): Promise<ExtractionOutcome> => {
    calls++; mutate(body);
    return { ok: true, model: "extraction-clairic/clairic-v1", truncated: false, answers: Object.fromEntries(Object.entries(body.fields).map(([id, field]) => {
      if (field.type === "forecast") return [id, { type: "forecast", value: [.5], median: [.4], p10: [.1], p90: [.9] }];
      const value = id === "memory" ? "I enjoy astronomy." : id === "fact_1" ? "A half is one of two equal parts." : null;
      const start = value ? body.state.indexOf(value) : -1;
      return [id, { type: "text", value: start >= 0 ? value : null, p_null: start >= 0 ? .01 : .99,
        ...(start >= 0 ? { span: [start, start + value!.length] } : {}) }];
    })) };
  };
  const runtime = createLearningIntelligence({ sessionId: "lesson", sessions: { getAllMetadata: async () => [], loadSession: async () => { await beforeSourceRead(); return deleted ? null : ({ id: "lesson", messages }); } },
    messages: () => messages, current: () => live, history: async () => currentHistory, account: () => ({ scope, authorized: true, configured: true }),
    enabled: () => enabled, subscribe: listener => { invalidate = listener; return () => {}; }, now: () => currentTime,
    request, diagnostic: event => diagnostics.push(event), reviewMemory: candidates => memories.push(...candidates),
    storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } } });
  return { runtime, diagnostics, memories, data, calls: () => calls, change: (fn: (request: ExtractionRequest) => void) => { mutate = fn; },
    deferSourceRead: () => {
      let release!: () => void, entered!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
      beforeSourceRead = async () => { entered(); await waiting; };
      return { started, release };
    },
    edit: () => { messages = [{ id: "learner", role: "user", content: "I dislike astronomy.", timestamp: 1 }]; },
    switchAccount: () => { scope = "account-b"; }, off: () => { enabled = false; invalidate(); }, samePreferenceEvent: () => invalidate(),
    leave: () => { live = false; }, advance: () => { currentTime += 60_001; }, deleteSource: () => { deleted = true; },
    changeHistory: () => { currentHistory = { ...currentHistory, checks: [...currentHistory.checks, { ...currentHistory.checks[0]!, id: "new-check", createdAt: time - 1, score: 1 }] }; } };
}

test("completed turns ground lesson and memory evidence, and forecast numeric history separately", async () => {
  const f = fixture(); await f.runtime.update();
  expect(f.calls()).toBe(3);
  expect(f.memories).toHaveLength(1);
  expect(f.memories[0]!.message.slice(f.memories[0]!.start, f.memories[0]!.end)).toBe("I enjoy astronomy.");
  const prompt = await f.runtime.prompt();
  expect(prompt).toContain("I enjoy astronomy."); expect(prompt).toContain("lesson-fact"); expect(prompt).toContain("unvalidated-model-proposal");
  const forecasts = f.diagnostics.find(event => event.kind === "forecast")!;
  expect(forecasts.forecast?.[0]?.observedCount).toBe(8); expect(forecasts.forecast?.[0]?.median).toBe(.4);
  expect(forecasts.reasons.join(" ")).toContain("spaced repetition due dates remain authoritative");
  await f.runtime.update(); expect(f.calls()).toBe(3);
  f.samePreferenceEvent(); expect(await f.runtime.prompt()).toBe(prompt);
  f.runtime.dispose();
});

test("source changes, account switches, opt-out and disposed conversations reject late extraction", async () => {
  for (const change of ["edit", "switchAccount", "off", "leave"] as const) {
    const f = fixture(); f.change(() => f[change]()); await f.runtime.update();
    expect(f.memories).toEqual([]); expect(f.data.size).toBe(0); expect(await f.runtime.prompt()).toBe(""); f.runtime.dispose();
  }
});

test("edited source is removed from future context and disabling erases the derived local cache", async () => {
  const f = fixture(); await f.runtime.update(); f.edit();
  expect(await f.runtime.prompt()).not.toContain("I enjoy astronomy."); f.off();
  expect(f.data.size).toBe(0); expect(await f.runtime.prompt()).toBe(""); f.runtime.dispose();
});

test("unchanged outcome history does not repeat a forecast on each minute or focus event", async () => {
  const f = fixture(); await f.runtime.update(); f.advance(); f.samePreferenceEvent(); await f.runtime.update();
  expect(f.calls()).toBe(3); f.runtime.dispose();
});

test("a changed assessment history rejects a late forecast and old forecasts are not reused", async () => {
  const f = fixture();
  f.change(body => { if (Object.values(body.fields).some(field => field.type === "forecast")) f.changeHistory(); });
  await f.runtime.update();
  expect(f.diagnostics.some(event => event.kind === "forecast" && event.status === "abstained" && event.reasons.some(reason => reason.includes("stale")))).toBe(true);
  expect(await f.runtime.prompt()).not.toContain("unvalidated-model-proposal"); f.runtime.dispose();
  const fresh = fixture(); await fresh.runtime.update(); fresh.changeHistory();
  expect(await fresh.runtime.prompt()).not.toContain("unvalidated-model-proposal"); fresh.runtime.dispose();
});

test("deleted source sessions cannot contribute cached extraction context", async () => {
  const f = fixture(); await f.runtime.update(); f.deleteSource();
  expect(await f.runtime.prompt()).not.toContain("I enjoy astronomy."); f.runtime.dispose();
});

test("next teacher call uses locally verified evidence without another hosted call", async () => {
  const f = fixture(); await f.runtime.update();
  let received = "";
  const stream = ((_model, context) => { received = context.systemPrompt ?? ""; return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
  await withLearningIntelligence(stream, f.runtime)({} as never, { messages: [], systemPrompt: "Base" });
  expect(received).toStartWith("Base"); expect(received).toContain("learning-evidence"); expect(f.calls()).toBe(3); f.runtime.dispose();
});

test("opting out during source loading still dispatches the tutor reply without extracted evidence", async () => {
  const f = fixture(); await f.runtime.update();
  const read = f.deferSourceRead(), context = { messages: [], systemPrompt: "Base" };
  let received: unknown;
  const stream = ((_model, nextContext) => { received = nextContext; return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
  const reply = withLearningIntelligence(stream, f.runtime)({} as never, context);
  await read.started;
  f.off(); read.release();
  await reply;
  expect(received).toBe(context); expect(f.data.size).toBe(0); expect(f.calls()).toBe(3);
  f.runtime.dispose();
});

test("account, source, conversation and cancellation changes during source loading still prevent dispatch", async () => {
  for (const change of ["switchAccount", "edit", "leave", "dispose", "abort"] as const) {
    const f = fixture(); await f.runtime.update();
    const read = f.deferSourceRead(), controller = new AbortController();
    let dispatched = false;
    const stream = (() => { dispatched = true; return {} as never; }) as NonNullable<AgentOptions["streamFn"]>;
    const reply = withLearningIntelligence(stream, f.runtime)({} as never, { messages: [], systemPrompt: "Base" }, { signal: controller.signal });
    await read.started;
    if (change === "dispose") f.runtime.dispose();
    else if (change === "abort") controller.abort();
    else f[change]();
    read.release();
    await expect(reply).rejects.toMatchObject({ name: "AbortError" });
    expect(dispatched).toBe(false);
    f.runtime.dispose();
  }
});

test("forecast history excludes pending, future and malformed grades and sends no answer text", () => {
  const data = history();
  const batch = buildLearningForecastBatch({ ...data, checks: [...data.checks,
    { ...data.checks[0]!, id: "pending", grading: "pending", score: 1 },
    { ...data.checks[0]!, id: "future", createdAt: time + 1 }, { ...data.checks[0]!, id: "invalid", score: NaN }] }, time, "lesson");
  expect(batch.targets[0]?.observedCount).toBe(8); expect(batch.request?.state).not.toContain("Explain a half"); expect(batch.request?.state).not.toContain("a part");
  expect(batch.request?.fields.series_0?.horizon).toBe(1);
  expect(readLearningForecasts(batch.targets)[0]?.status).toBe("abstained");
  const sparse = buildLearningForecastBatch({ ...data, checks: data.checks.slice(0, 7) }, time);
  expect(sparse.request).toBeNull(); expect(readLearningForecasts(sparse.targets)[0]?.status).toBe("insufficient-history");
});

test("card forecasts retain the exact SM-2 due date and original self-rating scale", () => {
  const dueAt = time + 86_400_000;
  const reviews = Array.from({ length: 8 }, (_, index) => ({ id: `review-${index}`, deckId: "deck", cardId: "card", topic: "fractions", slug: "fractions",
    rating: (index % 4) as 0 | 1 | 2 | 3, appliedIntervalDays: 1, previousIntervalDays: 1, easeAfter: 2.5, createdAt: time - (8 - index) * 86_400_000 }));
  const data: LearningHistory = { checks: [], reviews, decks: [{ id: "deck", topic: "fractions", slug: "fractions", title: "fractions", createdAt: time, updatedAt: time,
    cards: [{ id: "card", front: "half", back: "one of two equal parts", createdAt: time, updatedAt: time,
      srs: { ease: 2.5, intervalDays: 1, reps: 8, lapses: 2, dueAt, lastReviewedAt: time - 86_400_000, lastRating: 3 } }] }] };
  const before = JSON.stringify(data), batch = buildLearningForecastBatch(data, time);
  expect(batch.targets[0]?.dueAt).toBe(dueAt); expect(batch.targets[0]?.maximum).toBe(3); expect(batch.request?.state).toContain("reviewIntervals");
  expect(batch.request?.fields.series_0?.instructions).toContain("not an objective forgetting probability"); expect(JSON.stringify(data)).toBe(before);
  const firstReview = JSON.parse(batch.request!.state).series[0].reviewIntervals[1];
  expect(firstReview.elapsedDays).toBe(1); expect(firstReview.scheduledIntervalDays).toBe(1);
  const late = { ...data, reviews: data.reviews.map((row, index) => ({ ...row, createdAt: time - (8 - index) * 30 * 86_400_000, previousIntervalDays: 6 })) };
  const lateSeries = JSON.parse(buildLearningForecastBatch(late, time).request!.state).series[0];
  expect(lateSeries.reviewIntervals[1].elapsedDays).toBe(30); expect(lateSeries.reviewIntervals[1].scheduledIntervalDays).toBe(6);
  const shuffled = buildLearningForecastBatch({ ...data, reviews: [...data.reviews].reverse() }, time);
  expect(JSON.parse(shuffled.request!.state).series[0].observations.map((row: { at: string }) => row.at)).toEqual([...data.reviews].map(row => new Date(row.createdAt).toISOString()));
});
