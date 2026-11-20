import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/jev-boundary-proof";
import { runFlueCase } from "../scripts/jev-boundary-flue";
import { CASES, calibratedCase, digest, REVIEW_MODEL, TUTOR_MODEL } from "../scripts/jev-boundary-cases";
import { liveModels, MAX_CALLS, MAX_MICROUSD, MAX_TUTOR_OUTPUT, offlineModels, openingWireOverlap, ProofLedger, relayOrigin } from "../scripts/jev-boundary-transport";

const sealedPayload = (content: string) => ({ model: TUTOR_MODEL, stream: true, stream_options: { include_usage: true },
  max_tokens: MAX_TUTOR_OUTPUT, messages: [{ role: "user", content }] });

test("Flue preserves the complete accepted input across the estimated boundary and withholds only genuine provider or wire overflow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-boundary-proof-"));
  try {
    expect(await main(["--out", dir])).toBe(true);
    const read = (name: string) => JSON.parse(readFileSync(join(dir, name + ".json"), "utf8"));
    expect(read("ledger").dispatched).toBe(0);
    expect(CASES.filter(kind => kind !== "wire").map(kind => read(kind).full.estimatedStateQuestionTokens)).toEqual([31_999, 32_000, 32_001, 32_001, 18_104, 18_104]);
    expect(read("at").requests.some((request: { phase: string }) => request.phase === "selecting")).toBe(true);
    for (const fit of ["under", "at", "over", "current-fit"]) {
      const row = read(fit);
      expect(row.final.slides).toEqual([]);
      expect(row.requests.every((request: { ok: boolean; droppedMessages: number; prefixHashes: string[] }) =>
        request.ok && request.droppedMessages === 0 && request.prefixHashes.length === 0)).toBe(true);
      expect(row.delivered.correct).toBe(true);
    }
    expect(read("current").requests.map((request: { questionCount: number; code: string }) => [request.questionCount, request.code]))
      .toEqual([[39, "context-limit-exceeded"], [1, "context-limit-exceeded"]]);
    expect(read("current").tutorResponses).toHaveLength(0);
    expect(read("current").final.reason).toBe("context-limit-exceeded");
    expect(read("current").delivered.suggestsShorterRequest).toBe(true);
    expect(read("wire").requests).toHaveLength(0);
    expect(read("wire").tutorResponses).toHaveLength(0);
    for (const kind of CASES) {
      const receipt = read(kind);
      expect(receipt.delivered.textHash).toBe(receipt.returned.textHash);
      expect(receipt.delivered.textHash).toBe(receipt.flueReadHash);
      if (kind === "wire") expect(receipt.full.stateCharacters).toBe(96_001);
      else expect(receipt.full.stateCharacters).toBeLessThan(96_000);
      expect(JSON.stringify(receipt)).not.toMatch(/AMBER-42|Reference notes|直角四边形|What is the perimeter/i);
    }
    await expect(main(["--out", dir])).rejects.toThrow("fresh");
  } finally { rmSync(dir, { recursive: true }); }
});

test("an explicit provider overflow on dense history is visible in Flue before the compact retry, reviews and selected answer", async () => {
  const fixture = calibratedCase("dense");
  const receipt = await runFlueCase(fixture, offlineModels(fixture.full.stateHash));
  expect(receipt.passed).toBe(true);
  expect(receipt.final?.slides.some(slide => slide.reason === "provider-context-limit" && slide.turnsDropped === 1)).toBe(true);
  expect(receipt.requests.some(call => call.stateHash === fixture.full.stateHash && call.code === "context-limit-exceeded")).toBe(true);
  expect(receipt.checked.twoCandidatesReviewed && receipt.checked.selectedBetweenBoth).toBe(true);
  expect(receipt.delivered.correct).toBe(true);
});

test("wire adapter verifies Google and relay model identities, usage and request ids without contacting either service", async () => {
  const ledger = new ProofLedger();
  let tutorCount = 0;
  const wireLengths: number[] = [];
  const bothDispatched = Promise.withResolvers<void>();
  const fixtureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), body = await request.text(), payload = JSON.parse(body);
    if (request.url.includes("googleapis.com")) {
      wireLengths.push(Buffer.byteLength(body));
      if (++tutorCount === 2) bothDispatched.resolve();
      await bothDispatched.promise;
      expect(payload.max_tokens).toBe(MAX_TUTOR_OUTPUT);
      expect(payload.model).toBe(TUTOR_MODEL);
      const chunk = { id: "response-synthetic", object: "chat.completion.chunk", created: 1, model: TUTOR_MODEL,
        choices: [{ index: 0, delta: { role: "assistant", content: "Synthetic result." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 35, completion_tokens: 4, total_tokens: 39 } };
      return new Response("data: " + JSON.stringify(chunk) + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }
    expect(request.url).toBe("http://127.0.0.1:8800/api/judgement/typesafe");
    expect(payload.model).toBe(REVIEW_MODEL);
    return Response.json({ model: REVIEW_MODEL, answers: { value: { type: "noul", noul: .9 } }, usage: { input_tokens: 65, output_tokens: 1 } },
      { headers: { "x-railway-request-id": "synthetic-request-id" } });
  }) as typeof fetch;
  const models = liveModels("under", ledger, "relay", "http://127.0.0.1:8800", { fetch: fixtureFetch,
    keys: { GEMINI_API_KEY: "unused-test-value", TYPESAFE_API_KEY: "unused-test-value" } });
  const contexts = ["synthetic A", "synthetic B 密🙂"].map(content => ({ messages: [{ role: "user" as const, content, timestamp: 1 }] }));
  const answers = await Promise.all(contexts.map(context => models.tutor(context)));
  expect(answers.every(answer => answer.stopReason === "stop")).toBe(true);
  expect((await models.judge({ state: "ab", questions: { value: { type: "noul", instructions: "Does it contain a?" } } })).ok).toBe(true);
  expect(ledger.rows.map(row => [row.role, row.reportedModel, row.usage?.input, row.usage?.output, row.requestId])).toEqual([
    ["tutor", TUTOR_MODEL, 35, 4, null], ["tutor", TUTOR_MODEL, 35, 4, null], ["reviewer", REVIEW_MODEL, 65, 1, "synthetic-request-id"],
  ]);
  expect(ledger.rows.slice(0, 2).map(row => row.requestUtf8Bytes)).toEqual(wireLengths);
  expect(ledger.rows.slice(0, 2).map(row => row.reservedInput)).toEqual(wireLengths.map(bytes => bytes + 4_096));
  expect(openingWireOverlap(ledger.rows, contexts.map(digest))).toBeGreaterThan(0);
  expect(openingWireOverlap(ledger.rows.slice(1), contexts.map(digest))).toBeNull();
  const local = ledger.rows.at(-1)!;
  expect(local.endpoint).toBe("http://127.0.0.1:8800/api/judgement/typesafe");
  expect(local.responseSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(local.receivedMs).toBeGreaterThan(local.sentMs!);
  expect(JSON.stringify(ledger.rows)).not.toMatch(/unused-test-value|synthetic result|Does it contain/i);
});

test("the shared reservation is atomic across roles and preserves the cost of missing usage", () => {
  const body = JSON.stringify(sealedPayload("x".repeat(12_000)));
  const perTutor = Math.ceil((Buffer.byteLength(body) + 4_096) * .25 + MAX_TUTOR_OUTPUT * 1.5);
  const ledger = new ProofLedger(2 * perTutor + Math.ceil(64_000 * .042) + 700);
  const first = ledger.reserve("under", "tutor", body);
  ledger.reserve("under", "tutor", body);
  expect(() => ledger.reserve("under", "tutor", body)).toThrow("reservation-denied");
  const review = ledger.reserve("under", "reviewer", "d");
  ledger.finish(review, null);
  expect(review.accountedMicrousd).toBe(review.reservedMicrousd);
  expect(review.usageMicrousd).toBeNull();
  expect(() => ledger.reserve("under", "tutor", body)).toThrow("reservation-denied");
  ledger.finish(first, TUTOR_MODEL, { input: 2000, output: 20 });
  expect(ledger.reserve("under", "tutor", body).role).toBe("tutor");
  expect(() => new ProofLedger(MAX_MICROUSD + 1)).toThrow();
  const calls = new ProofLedger();
  for (let index = 0; index < MAX_CALLS; index++) calls.finish(calls.reserve("at", "reviewer", "a"), REVIEW_MODEL, { input: 1, output: 1 });
  expect(calls.rows).toHaveLength(64);
  expect(() => calls.reserve("at", "reviewer", "b")).toThrow("reservation-denied");
  expect(() => relayOrigin("https://chat.keating.help.evil.test")).toThrow();
  expect(() => relayOrigin("http://private@127.0.0.1:8800")).toThrow();
  expect(calibratedCase("dense").full.stateCharacters).toBeGreaterThan(50_000);
});

test("sealed Gemini input reserves UTF-8 bytes plus framing, caps at the model window and rejects expanded payloads", () => {
  const ledger = new ProofLedger();
  const sample = sealedPayload("密🙂");
  const actual = JSON.stringify(sample);
  const row = ledger.reserve("dense", "tutor", actual);
  expect(row.reservedInput).toBe(Buffer.byteLength(actual) + 4_096);
  expect(row.reservedInput).toBeGreaterThan(actual.length + 4_096);
  expect(ledger.reserve("dense", "tutor", JSON.stringify(sealedPayload("x".repeat(1_048_576)))).reservedInput).toBe(1_048_576);
  for (const unsafe of [{ ...sample, tools: [{ type: "function" }] }, { ...sample, modalities: ["audio"] },
    { ...sample, max_tokens: MAX_TUTOR_OUTPUT + 1 }, { ...sample, n: 2 },
    { ...sample, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://invalid.test/" } }] }] },
    { ...sample, messages: [{ role: "assistant", tool_calls: [{}], content: "result" }] }]) {
    expect(() => ledger.reserve("dense", "tutor", JSON.stringify(unsafe))).toThrow();
  }
  expect(ledger.rows).toHaveLength(2);
});

test("a Gemini overrun keeps its actual usage, invalidates the run and prevents another dispatch", () => {
  const body = JSON.stringify(sealedPayload("fixture"));
  for (const dimension of ["cached input", "output"]) {
    const ledger = new ProofLedger();
    const row = ledger.reserve("dense", "tutor", body);
    const usage = dimension === "output" ? { input: 35, output: row.reservedOutput + 1 }
      : { input: row.reservedInput, cached: 1, output: 1 };
    expect(() => ledger.finish(row, TUTOR_MODEL, usage)).toThrow("provider-reported-usage-above-reservation");
    expect(row.reservationExceeded).toBe(true);
    expect(row.usage).toEqual(usage);
    expect(row.usageMicrousd).toBeGreaterThan(0);
    expect(row.accountedMicrousd).toBeGreaterThanOrEqual(row.reservedMicrousd);
    expect(() => ledger.reserve("dense", "reviewer", "{}")).toThrow("proof-reservation-denied");
  }
});
