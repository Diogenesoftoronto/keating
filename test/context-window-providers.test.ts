import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";
import {
  createReferenceProvider, createSystemOneProvider, loadCredential,
  type BenchmarkFetch, type SystemOneProviderConfig,
} from "../scripts/context-window/providers.js";

const request: JudgementRequest = {
  state: { source: "A seedling grew two leaves.", reply: "It grew two leaves." },
  questions: {
    supported: { type: "noul", instructions: "Is the reply supported by the source?" },
    evidence: { type: "choice", instructions: "Select the evidence.", criteria: { a: "Two leaves grew.", none: "No supporting evidence." } },
    quality: { type: "score", instructions: "Rate support.", criteria: ["Absent", "Partial", "Complete"] },
  },
};
const valid = () => ({
  model: "jev-1.13.0",
  answers: {
    supported: { type: "noul", noul: 0.8 },
    evidence: { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.9, none: 0.1 } },
    quality: { type: "score", score: 1.1, confidence: 0.25,
      probabilities: { "0": 0.2, "1": 0.5, "2": 0.3 }, legend: { "0": "Absent", "1": "Partial", "2": "Complete" } },
  },
  usage: { input_tokens: 100, output_tokens: 0 },
});
const response = (body: unknown): BenchmarkFetch => async () => Response.json(body);
const provider = (body: unknown, overrides: Partial<SystemOneProviderConfig> = {}) => createSystemOneProvider({
  id: "jev", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", expectedModel: "jev-1.13.0",
  fetch: response(body), ...overrides,
});
const refResponse = (answers: unknown, override: Record<string, unknown> = {}) => ({
  model: "gpt-6-astra", status: "completed", usage: { input_tokens: 100, output_tokens: 25 },
  output: [{ type: "reasoning" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ answers }) }] }],
  ...override,
});

describe("System One benchmark adapter", () => {
  test("preserves production Noul thresholds, exact Choice, and modal Score rather than weighted score", async () => {
    const result = await provider(valid()).evaluate(request);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.answers.supported).toEqual({ value: true, probabilities: { false: 0.19999999999999996, true: 0.8 }, confidence: null });
    expect(result.answers.evidence!.value).toBe("a");
    expect(result.answers.quality!.value).toBe(1);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 0 });
    expect(result.raw).toEqual(valid());
    for (const [noul, expected] of [[0.2, false], [0.200001, null], [0.799999, null], [0.8, true]] as const) {
      const body = valid(); body.answers.supported.noul = noul;
      const outcome = await provider(body).evaluate(request);
      expect(outcome.status === "ok" && outcome.answers.supported!.value).toBe(expected);
    }
  });

  test("sends identical state and complete question rubrics and refuses redirects", async () => {
    let sent: RequestInit | undefined;
    const result = await provider(valid(), { fetch: async (_url, init) => { sent = init; return Response.json(valid()); } }).evaluate(request);
    expect(result.status).toBe("ok");
    expect(JSON.parse(String(sent!.body))).toEqual({ state: request.state, questions: request.questions, model: "jev-latest" });
    expect(sent!.redirect).toBe("error");
    expect(sent!.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    { a: 0.9 }, { a: 0.9, none: 0.1, extra: 0 }, { a: 0.9, none: 0.9 },
    { a: -0.1, none: 1.1 }, { a: "0.9", none: 0.1 }, null,
  ])("rejects malformed or incomplete probability distributions %j", async probabilities => {
    const body = valid();
    const modified = { ...body, answers: { ...body.answers, evidence: { ...body.answers.evidence, probabilities } } };
    expect(await provider(modified).evaluate(request)).toMatchObject({ status: "error", error: "response-answer-malformed" });
  });

  test("rejects selected labels that are not modal and score means inconsistent with the distribution", async () => {
    const badChoice = valid(); badChoice.answers.evidence.choice = "none";
    expect((await provider(badChoice).evaluate(request)).status).toBe("error");
    const badScore = valid(); badScore.answers.quality.score = 2;
    expect((await provider(badScore).evaluate(request)).status).toBe("error");
    const badLegend = valid(); badLegend.answers.quality.legend["2"] = "Poor";
    expect((await provider(badLegend).evaluate(request)).status).toBe("error");
  });

  test("accepts independently rounded Jev probabilities and score without rewriting either", async () => {
    const fourLevelRequest: JudgementRequest = {
      state: "An authored calibration fixture.",
      questions: { quality: { type: "score", instructions: "Select the level.", criteria: ["None", "One", "Two", "Three"] } },
    };
    // Exact numeric shapes observed in the one diagnostic replay. Each output
    // is rounded independently to .01, so the displayed sum/mean need not match.
    for (const [probabilities, score] of [
      [{ "0": 0.09, "1": 0.58, "2": 0.33, "3": 0 }, 1.25],
      [{ "0": 0.2, "1": 0.6, "2": 0.07, "3": 0.13 }, 1.12],
      [{ "0": 0.56, "1": 0.33, "2": 0.04, "3": 0.06 }, 0.61],
    ] as const) {
      const body = { model: "jev-1.13.0", answers: { quality: { type: "score", score,
        probabilities, confidence: 0.58, legend: { "0": "None", "1": "One", "2": "Two", "3": "Three" } } } };
      const result = await provider(body).evaluate(fourLevelRequest);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      expect(result.answers.quality!.probabilities).toEqual(probabilities);
      expect((result.raw as typeof body).answers.quality.score).toBe(score);
    }
  });

  test("rejects distributions and scores outside feasible hundredth-rounding intervals", async () => {
    const single: JudgementRequest = { state: "fixture", questions: { q: {
      type: "score", instructions: "Select a level.", criteria: ["None", "Partial", "Full"],
    } } };
    for (const [probabilities, score] of [
      // Sum .98 cannot round from a normalized three-level distribution.
      [{ "0": 0.32, "1": 0.33, "2": 0.33 }, 1.0],
      // Sum and mean deviations separately look small; jointly they are
      // impossible once normalization constrains the rounding intervals.
      [{ "0": 0.33, "1": 0.33, "2": 0.33 }, 0.98],
      [{ "0": 0.2, "1": 0.5, "2": 0.3 }, 1.13],
      // Off-grid probabilities keep the narrow floating-point tolerance.
      [{ "0": 0.20001, "1": 0.5, "2": 0.29001 }, 1.08],
    ] as const) {
      const body = { model: "jev-1.13.0", answers: { q: { type: "score", score, probabilities,
        confidence: 0.2, legend: { "0": "None", "1": "Partial", "2": "Full" } } } };
      expect(await provider(body).evaluate(single)).toMatchObject({ status: "error", error: "response-answer-malformed" });
    }
  });

  test("accepts feasible Kev four-decimal rounding but rejects impossible distributions and means", async () => {
    const single: JudgementRequest = { state: "fixture", questions: { q: {
      type: "score", instructions: "Select a level.", criteria: ["None", "Partial", "Full"],
    } } };
    for (const [probabilities, score, accepted] of [
      [{ "0": 0.3333, "1": 0.3333, "2": 0.3333 }, 1, true],
      [{ "0": 0.1235, "1": 0.5432, "2": 0.3333 }, 1.2099, true],
      [{ "0": 0.3332, "1": 0.3333, "2": 0.3333 }, 1, false],
      [{ "0": 0.3333, "1": 0.3333, "2": 0.3333 }, 0.9998, false],
    ] as const) {
      const body = { model: "jev-1.13.0", answers: { q: { type: "score", score, probabilities,
        confidence: 0.2, legend: { "0": "None", "1": "Partial", "2": "Full" } } } };
      const result = await provider(body).evaluate(single);
      expect(result.status).toBe(accepted ? "ok" : "error");
      if (result.status === "ok") expect(result.answers.q!.probabilities).toEqual(probabilities);
    }
  });

  test("rounding does not relax Choice selection beyond exact modal ties", async () => {
    const choiceRequest: JudgementRequest = { state: "fixture", questions: { q: {
      type: "choice", instructions: "Select an option.", criteria: { a: "First", b: "Second", c: "Third" },
    } } };
    const body = { model: "jev-1.13.0", answers: { q: { type: "choice", choice: "b",
      confidence: 0.01, probabilities: { a: 0.34, b: 0.33, c: 0.32 } } } };
    expect((await provider(body).evaluate(choiceRequest)).status).toBe("error");
    body.answers.q.probabilities = { a: 0.33, b: 0.33, c: 0.33 };
    const tied = await provider(body).evaluate(choiceRequest);
    expect(tied.status === "ok" && tied.answers.q!.value).toBe("b");
  });

  test("rejects wrong primitive, missing question, extra question, invalid Noul and confidence", async () => {
    const raw = valid();
    for (const answers of [
      { ...raw.answers, supported: { type: "choice", noul: 0.9 } },
      { ...raw.answers, supported: { type: "noul", noul: 1.1 } },
      { ...raw.answers, evidence: { ...raw.answers.evidence, confidence: -1 } },
      { evidence: raw.answers.evidence, quality: raw.answers.quality },
      { ...raw.answers, extra: raw.answers.supported },
    ]) expect((await provider({ ...raw, answers }).evaluate(request)).status).toBe("error");
  });

  test("requires returned identity to match the declared model exactly", async () => {
    for (const model of ["jev-latest", "jev-1.14.0", undefined]) {
      const result = await provider({ ...valid(), model }).evaluate(request);
      expect(result.status).toBe("error");
    }
  });

  test("does not echo errors, upstream bodies, or exception text containing a credential", async () => {
    const secret = "this-is-a-test-key";
    for (const fetch of [
      async () => new Response(secret, { status: 401 }),
      async () => { throw new Error(`request failed with Authorization: Bearer ${secret}`); },
      async () => new Response(secret, { status: 200 }),
      response({ ...valid(), model: secret }),
    ]) {
      const result = await provider(valid(), { key: secret, fetch }).evaluate(request);
      expect(result.status).toBe("error");
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  test("times out even when an injected fetch ignores abort", async () => {
    const result = await provider(valid(), { timeoutMs: 5, fetch: () => new Promise(() => {}) }).evaluate(request);
    expect(result).toMatchObject({ status: "error", error: "backend-timeout" });
  });

  test("pre-aborted requests do not dispatch", async () => {
    let calls = 0;
    const controller = new AbortController(); controller.abort();
    const result = await provider(valid(), { fetch: async () => { calls++; return Response.json(valid()); } }).evaluate(request, controller.signal);
    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: "error", error: "cancelled" });
  });

  test("rejects remote HTTP, embedded credentials, query parameters and invalid timeout", () => {
    for (const endpoint of ["http://example.com/v1/systemone", "https://user:secret@example.com", "https://example.com?key=secret", "file:///tmp/judge"]) {
      expect(() => provider(valid(), { endpoint })).toThrow("invalid-provider-endpoint");
    }
    expect(() => provider(valid(), { timeoutMs: Infinity })).toThrow("invalid-provider-timeout");
  });

  test("CLM requires separately pinned head and encoder revisions", async () => {
    const base = { id: "clm", endpoint: "http://127.0.0.1:8700/v1/systemone", model: "clm-latest", expectedModel: "clm-latest" };
    expect(() => createSystemOneProvider(base)).toThrow("clm-immutable-head-and-encoder-revisions-required");
    expect(() => createSystemOneProvider({ ...base, revisionManifest: { headRevision: "clm-latest", encoderRevision: "main" } })).toThrow();
    const clm = createSystemOneProvider({ ...base, revisionManifest: { headRevision: "sha256:abc123", encoderRevision: "revision-123" }, fetch: response({ ...valid(), model: "clm-latest" }) });
    expect((await clm.evaluate(request)).status).toBe("ok");
  });
});

describe("independent reference adapter", () => {
  test("asks the same questions with high reasoning and hard labels, with no invented probabilities", async () => {
    let sent: Record<string, any> = {};
    const labels = { supported: true, evidence: "a", quality: 1 };
    const reference = createReferenceProvider({ key: "test-key", fetch: async (_url, init) => {
      sent = JSON.parse(String(init.body));
      expect(init.redirect).toBe("error");
      return Response.json(refResponse(labels));
    } });
    const result = await reference.evaluate(request);
    expect(sent.model).toBe("gpt-6-astra");
    expect(sent.reasoning).toEqual({ effort: "high" });
    expect(sent.store).toBe(false);
    expect(sent.max_output_tokens).toBe(4096);
    expect(JSON.parse(sent.input)).toEqual(request);
    expect(sent.text.format.strict).toBe(true);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    for (const [id, value] of Object.entries(labels)) expect(result.answers[id]).toEqual({ value, confidence: null, probabilities: null });
  });

  test("rejects invalid labels, incomplete runs, model substitutions and refusals", async () => {
    const good = { supported: true, evidence: "a", quality: 1 };
    for (const body of [
      refResponse({ ...good, supported: 0.9 }), refResponse({ ...good, evidence: "invented" }),
      refResponse({ ...good, quality: 1.5 }), refResponse({ ...good, extra: true }),
      refResponse(good, { model: "other-model" }), refResponse(good, { status: "incomplete" }),
      refResponse(good, { output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "No" }] }] }),
    ]) {
      expect((await createReferenceProvider({ key: "test-key", fetch: response(body) }).evaluate(request)).status).toBe("error");
    }
  });
});

const temporaryDirectories: string[] = [];
afterAll(async () => { await Promise.all(temporaryDirectories.map(path => rm(path, { recursive: true, force: true }))); });
test("credentials load only from an explicit environment name or private regular file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keating-benchmark-credential-test-"));
  temporaryDirectories.push(directory);
  const privatePath = join(directory, "key");
  await writeFile(privatePath, "fixture-only-key\n", { mode: 0o600 });
  expect(await loadCredential({ file: privatePath })).toBe("fixture-only-key");
  await symlink(privatePath, join(directory, "link"));
  await expect(loadCredential({ file: join(directory, "link") })).rejects.toThrow("credential-file-unavailable-or-not-private");
  await chmod(privatePath, 0o644);
  await expect(loadCredential({ file: privatePath })).rejects.toThrow("credential-file-unavailable-or-not-private");
  expect(await loadCredential({})).toBeUndefined();
  await expect(loadCredential({ env: "KEY", file: privatePath })).rejects.toThrow("credential-source-ambiguous");
  const name = "KEATING_BENCHMARK_PROVIDER_TEST_KEY";
  const prior = process.env[name];
  try {
    process.env[name] = "fixture-env-key";
    expect(await loadCredential({ env: name })).toBe("fixture-env-key");
    delete process.env[name];
    await expect(loadCredential({ env: name })).rejects.toThrow("credential-missing");
  } finally { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; }
});
