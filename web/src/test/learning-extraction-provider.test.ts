import { describe, expect, it } from "bun:test";
import { createLearningExtractionProvider, type ExtractionRequest } from "../keating/learning-intelligence/provider";

const scope = '["https://account.test","learner-a"]';
const request: ExtractionRequest = { state: "😀 I have an exam Friday.", fields: { constraint: { type: "text" } } };
const textAnswer = { type: "text" as const, value: "an exam Friday", span: [10, 24] as [number, number], p_null: .01, confidence: .95 };
function envelope<T = { constraint: typeof textAnswer }>(answers: T = { constraint: textAnswer } as T) {
  return { model: "extraction-clairic/clairic", answers, truncated: false as const, usage: { input_tokens: 20, output_tokens: 10 } };
}
function provider(body: unknown, extra: Parameters<typeof createLearningExtractionProvider>[0] = {}) {
  return createLearningExtractionProvider({ enabled: () => true, account: () => ({ scope, authorized: true, configured: true }),
    request: async () => Response.json(body), subscribe: () => () => {}, ...extra });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
describe("learning extraction provider", () => {
  it("keeps exact UTF-16 evidence and bounded usage without upstream extras", async () => {
    const result = await provider(envelope())(request, scope);
    expect(result).toEqual({ ok: true, ...envelope() });
    expect(request.state.slice(...textAnswer.span as [number, number])).toBe(textAnswer.value);
  });
  it("accepts missing optional probabilities without inventing confidence", async () => {
    const { p_null: _, confidence: __, ...answer } = textAnswer;
    const result = await provider(envelope({ constraint: answer }))(request, scope);
    expect(result.ok && result.answers.constraint).toEqual(answer);
  });
  it("accepts nullable gateway usage without inventing token accounting", async () => {
    const { usage: _, ...body } = envelope();
    const result = await provider({ ...body, usage: null })(request, scope);
    expect(result).toEqual({ ok: true, ...body });
    expect(Object.hasOwn(result, "usage")).toBe(false);
  });
  it("preserves explicit abstention and never promotes its guess or span", async () => {
    const result = await provider(envelope({ constraint: { ...textAnswer, value: null, guess: "an exam Friday", p_null: .99 } }))(request, scope);
    expect(result.ok && result.answers.constraint).toEqual({ type: "text", value: null, p_null: .99, confidence: .95 });
  });
  const invalidAnswers = [
    { ...textAnswer, value: "exam Friday" },
    { ...textAnswer, span: [9, 23] }, // code-point offsets must not be guessed as UTF-16
    { ...textAnswer, span: [0, 1], value: "\ud83d" }, // split surrogate
    { ...textAnswer, span: [10, 99] },
    { ...textAnswer, span: [10, 10], value: "" },
    { ...textAnswer, p_null: 1 },
    { ...textAnswer, confidence: -1 },
    { ...textAnswer, p_null: "0.1" },
    { ...textAnswer, guess: "different evidence" },
    { ...textAnswer, type: "estimate" },
  ];
  for (const [index, answer] of invalidAnswers.entries()) it(`rejects malformed or ungrounded answer ${index}`, async () => {
    expect(await provider(envelope({ constraint: answer }))(request, scope)).toEqual({ ok: false, error: "invalid-response" });
  });
  for (const body of [envelope({}), envelope({ constraint: textAnswer, extra: textAnswer }),
    { ...envelope(), model: "clairic" }, { ...envelope(), truncated: true }, { ...envelope(), truncated: undefined },
    { ...envelope(), usage: { input_tokens: -1, output_tokens: 1 } }]) {
    it("rejects incompatible gateway envelopes", async () => {
      expect(await provider(body)(request, scope)).toEqual({ ok: false, error: "invalid-response" });
    });
  }
  const forecastRequest: ExtractionRequest = { state: "Observed correctness: 0.6, 0.7, 0.8", fields: {
    recall: { type: "forecast", horizon: 3, min: 0, max: 1, interval: "day" },
    success: { type: "estimate", min: 0, max: 1 },
  } };
  const forecast = { type: "forecast" as const, value: [.7, .6, .5], median: [.7, .6, .5], p10: [.5, .4, .3], p90: [.9, .8, .7] };
  const estimate = { type: "estimate" as const, value: .8, median: .8, p10: .6, p90: .9 };
  it("accepts complete ordered time series and estimates, with optional probabilities absent", async () => {
    const result = await provider(envelope({ recall: forecast, success: estimate }))(forecastRequest, scope);
    expect(result.ok && result.answers.recall).toEqual(forecast);
    expect(result.ok && result.answers.success).toEqual(estimate);
  });
  it("canonicalizes valid forecast steps to bounded parallel interval arrays", async () => {
    const steps = forecast.median.map((median, index) => ({ median, p10: forecast.p10[index], p90: forecast.p90[index] }));
    const result = await provider(envelope({ recall: { type: "forecast", value: forecast.value, steps }, success: estimate }))(forecastRequest, scope);
    expect(result.ok && result.answers.recall).toEqual(forecast);
  });
  it("preserves bounded model point estimates independently of medians", async () => {
    const independentForecast = { ...forecast, value: [.65, .55, .45] };
    const independentEstimate = { ...estimate, value: .75 };
    const result = await provider(envelope({ recall: independentForecast, success: independentEstimate }))(forecastRequest, scope);
    expect(result.ok && result.answers.recall).toEqual(independentForecast);
    expect(result.ok && result.answers.success).toEqual(independentEstimate);
  });
  for (const badForecast of [
    { ...forecast, value: [.7, .6] }, { ...forecast, p10: [.8, .4, .3] }, { ...forecast, p90: [.9, .8, 1.1] },
    { ...forecast, value: [.7, .6, -1] }, { ...forecast, mean: [.8, .6, null] },
    { ...forecast, steps: [{ median: .7, p10: .5, p90: .9 }] },
  ]) it("rejects incomplete, unordered, mismatched, or out-of-range forecasts", async () => {
    expect(await provider(envelope({ recall: badForecast, success: estimate }))(forecastRequest, scope)).toEqual({ ok: false, error: "invalid-response" });
  });
  it("rejects non-finite model values before they enter learner forecasts", async () => {
    const invalid = { ...envelope({ recall: forecast, success: estimate }) };
    const raw = JSON.stringify(invalid).replace('"median":0.8', '"median":1e999');
    const run = provider(null, { request: async () => new Response(raw) });
    expect(await run(forecastRequest, scope)).toEqual({ ok: false, error: "invalid-response" });
  });
  for (const [status, error] of [[401, "unauthorized"], [403, "unauthorized"], [402, "credit"], [429, "rate-limited"], [503, "unavailable"], [500, "provider"]] as const) {
    it(`maps HTTP ${status} without exposing raw account or upstream details`, async () => {
      const run = provider(null, { request: async () => new Response("secret error and request details", { status }) });
      expect(await run(request, scope)).toEqual({ ok: false, error });
    });
  }
  it("does no network work without local opt-in or matching authorized identity", async () => {
    let calls = 0;
    const dispatch = async () => { calls++; return Response.json(envelope()); };
    expect(await provider(null, { enabled: () => false, request: dispatch })(request, scope)).toEqual({ ok: false, error: "unavailable" });
    expect(await provider(null, { request: dispatch })(request, "different-account")).toEqual({ ok: false, error: "unauthorized" });
    expect(calls).toBe(0);
  });
  it("rejects oversized state and field fan-out before dispatch", async () => {
    let calls = 0;
    const run = provider(null, { request: async () => { calls++; return Response.json(envelope()); } });
    expect(await run({ ...request, state: "a".repeat(24_001) }, scope)).toEqual({ ok: false, error: "invalid-response" });
    expect(await run({ ...request, fields: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(i), { type: "text" }])) }, scope)).toEqual({ ok: false, error: "invalid-response" });
    expect(calls).toBe(0);
  });
  it("bounds response bytes even when content length is absent", async () => {
    expect(await provider(null, { request: async () => new Response("😀".repeat(33_000)) })(request, scope)).toEqual({ ok: false, error: "invalid-response" });
  });
  it("fails soft for malformed JSON and network exceptions", async () => {
    expect(await provider(null, { request: async () => new Response("bad json") })(request, scope)).toEqual({ ok: false, error: "invalid-response" });
    expect(await provider(null, { request: async () => { throw new Error("upstream bearer secret"); } })(request, scope)).toEqual({ ok: false, error: "provider" });
  });
  it("bounds a hanging request and body read even if the transport ignores cancellation", async () => {
    const never = new Promise<Response>(() => {});
    expect(await provider(null, { request: () => never, timeoutMs: 5 })(request, scope)).toEqual({ ok: false, error: "timeout" });
    const body = new ReadableStream<Uint8Array>({ start() {} });
    expect(await provider(null, { request: async () => new Response(body), timeoutMs: 5 })(request, scope)).toEqual({ ok: false, error: "timeout" });
  });
  it("cancels a hanging transport immediately when the caller aborts", async () => {
    const controller = new AbortController();
    const run = provider(null, { request: () => new Promise<Response>(() => {}) });
    const pending = run(request, scope, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: "cancelled" });
  });
  it("discards late results after an account switch or obsolete job", async () => {
    for (const change of ["account", "job"] as const) {
      const response = deferred<Response>();
      let accountScope = scope, current = true;
      const run = provider(null, { request: () => response.promise, account: () => ({ scope: accountScope, configured: true, authorized: true }) });
      const pending = run(request, scope, undefined, () => current);
      if (change === "account") accountScope = "other-account"; else current = false;
      response.resolve(Response.json(envelope()));
      expect(await pending).toEqual({ ok: false, error: change === "account" ? "unauthorized" : "cancelled" });
    }
  });
  it("snapshots source and fields before the refresh await", async () => {
    const response = deferred<Response>(), mutable = structuredClone(request);
    const run = provider(null, { request: () => response.promise });
    const pending = run(mutable, scope);
    mutable.state = "This source has changed.";
    response.resolve(Response.json(envelope()));
    expect((await pending).ok).toBe(true);
  });
});
