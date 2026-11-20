import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/jev-boundary-proof";
import { runFlueCase } from "../scripts/jev-boundary-flue";
import { CASES, calibratedCase, digest, REVIEW_MODEL, TUTOR_MODEL } from "../scripts/jev-boundary-cases";
import { liveModels, MAX_MICROUSD, MAX_TUTOR_OUTPUT, offlineModels, openingWireOverlap, ProofLedger, relayOrigin } from "../scripts/jev-boundary-transport";

test("Flue releases the three calibrated boundary cases, preserves history to the ceiling, and withholds the unshrinkable case", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-boundary-proof-"));
  try {
    expect(await main(["--out", dir, "--case", CASES.join(",")])).toBe(true);
    const read = (name: string) => JSON.parse(readFileSync(join(dir, name + ".json"), "utf8"));
    expect(read("ledger").dispatched).toBe(0);
    expect(CASES.map(kind => read(kind).full.estimatedStateQuestionTokens)).toEqual([31_999, 32_000, 32_001, 32_001, 18_104]);
    expect(read("at").requests.some((request: { phase: string }) => request.phase === "selecting")).toBe(true);
    expect(read("over").final.slides.find((slide: { phase: string }) => slide.phase === "planning").turnsDropped).toBe(1);
    expect(read("current").requests).toHaveLength(0);
    expect(read("current").tutorResponses).toHaveLength(0);
    expect(read("current").final.reason).toBe("context-limit-exceeded");
    expect(read("current").delivered.suggestsShorterRequest).toBe(true);
    for (const kind of CASES) {
      const receipt = read(kind);
      expect(receipt.delivered.textHash).toBe(receipt.returned.textHash);
      expect(receipt.delivered.textHash).toBe(receipt.flueReadHash);
      expect(receipt.full.stateCharacters).toBeLessThan(96_000);
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
  const bothDispatched = Promise.withResolvers<void>();
  const fixtureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), payload = await request.json();
    if (request.url.includes("googleapis.com")) {
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
  const contexts = ["synthetic A", "synthetic B"].map(content => ({ messages: [{ role: "user" as const, content, timestamp: 1 }] }));
  const answers = await Promise.all(contexts.map(context => models.tutor(context)));
  expect(answers.every(answer => answer.stopReason === "stop")).toBe(true);
  expect((await models.judge({ state: "ab", questions: { value: { type: "noul", instructions: "Does it contain a?" } } })).ok).toBe(true);
  expect(ledger.rows.map(row => [row.role, row.reportedModel, row.usage?.input, row.usage?.output, row.requestId])).toEqual([
    ["tutor", TUTOR_MODEL, 35, 4, null], ["tutor", TUTOR_MODEL, 35, 4, null], ["reviewer", REVIEW_MODEL, 65, 1, "synthetic-request-id"],
  ]);
  expect(openingWireOverlap(ledger.rows, contexts.map(digest))).toBeGreaterThan(0);
  expect(openingWireOverlap(ledger.rows.slice(1), contexts.map(digest))).toBeNull();
  const local = ledger.rows.at(-1)!;
  expect(local.endpoint).toBe("http://127.0.0.1:8800/api/judgement/typesafe");
  expect(local.responseSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(local.receivedMs).toBeGreaterThan(local.sentMs!);
  expect(JSON.stringify(ledger.rows)).not.toMatch(/unused-test-value|synthetic result|Does it contain/i);
});

test("the shared reservation is atomic across roles and preserves the cost of missing usage", () => {
  const ledger = new ProofLedger(530_000);
  const first = ledger.reserve("under", "tutor", "a");
  ledger.reserve("under", "tutor", "b");
  expect(() => ledger.reserve("under", "tutor", "c")).toThrow("reservation-denied");
  const review = ledger.reserve("under", "reviewer", "d");
  ledger.finish(review, null);
  expect(review.accountedMicrousd).toBe(review.reservedMicrousd);
  expect(() => ledger.reserve("under", "tutor", "e")).toThrow("reservation-denied");
  ledger.finish(first, TUTOR_MODEL, { input: 2000, output: 20 });
  expect(ledger.reserve("under", "tutor", "f").role).toBe("tutor");
  expect(() => new ProofLedger(MAX_MICROUSD + 1)).toThrow();
  expect(() => relayOrigin("https://chat.keating.help.evil.test")).toThrow();
  expect(() => relayOrigin("http://private@127.0.0.1:8800")).toThrow();
  expect(calibratedCase("dense").full.stateCharacters).toBeGreaterThan(50_000);
});
