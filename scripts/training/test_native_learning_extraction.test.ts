import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai";
import { createNativeLearningExtractor, type NativeLearningExtractionContext, type NativeLearningExtractorOptions } from "./native_learning_extraction.js";
import { fieldsFor, type ExtractionRequest } from "../../packages/learner-contracts/src/learning-extraction-contract.js";
import { learningSourceHash } from "../../packages/learner-contracts/src/learning-intelligence.js";

const scope = "native-authorized-account-scope";
const userText = "😀 I study botany. I have an exam Friday. Why does water move?";
const tutorText = "Water follows a water potential gradient. What is the direction?";
function tutor(text = tutorText): PiAssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "test",
    model: "scripted-tutor", stopReason: "stop", timestamp: 20,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function context(text = userText): NativeLearningExtractionContext {
  return { systemPrompt: "Private evaluator state must not be extracted.",
    messages: [{ role: "user", id: "learner-message", content: text, timestamp: 10 }],
    tools: [{ name: "read", description: "Tool declarations are not learner evidence." }] };
}
function answer(state: string, quote: string) {
  const start = state.indexOf(quote);
  if (start < 0) throw new Error("Invalid test fixture quote");
  return { type: "text", value: quote, span: [start, start + quote.length], p_null: .1 };
}
function envelope(request: ExtractionRequest, answers: Record<string, unknown> = {}) {
  return { model: "extraction-clairic/clairic-v1", truncated: false,
    answers: { ...Object.fromEntries(Object.keys(request.fields).map(field => [field, { type: "text", value: null, p_null: .99 }])), ...answers },
    usage: { input_tokens: 30, output_tokens: 10 } };
}
function fixture(respond: (request: ExtractionRequest) => unknown = request => envelope(request), extra: Partial<NativeLearningExtractorOptions> = {}) {
  const calls: { body: string; scope: string; signal?: AbortSignal }[] = [];
  const extractor = createNativeLearningExtractor({ sessionId: "native-session", scope, now: () => Date.parse("2026-10-25T12:00:00Z"),
    request: async (body, requestScope, signal) => {
      calls.push({ body, scope: requestScope, signal });
      return Response.json(respond(JSON.parse(body)));
    }, ...extra });
  return { ...extractor, calls };
}

describe("native production learning extraction", () => {
  it("grounds actual learner and tutor UTF-16 spans and preserves raw requests, responses, models and source hashes", async () => {
    const run = fixture(request => envelope(request, request.fields.memory
      ? { memory: answer(request.state, "I study botany."), constraint: answer(request.state, "I have an exam Friday.") }
      : { fact_1: answer(request.state, "Water follows a water potential gradient.") }));
    const input = context(), message = tutor(), before = JSON.stringify({ input, message });
    const receipt = await run.extract(input, message);
    expect(receipt.status).toBe("completed");
    expect(run.calls.map(call => JSON.parse(call.body).state)).toEqual([userText, tutorText]);
    expect(run.calls.every(call => call.scope === scope && call.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.stringify({ input, message })).toBe(before);
    const [learner, teacher] = receipt.sources;
    expect(learner!.rawRequest).toBe(run.calls[0]!.body);
    expect(learner!.rawResponse?.complete).toBe(true);
    expect(JSON.parse(learner!.rawResponse!.body).model).toBe("extraction-clairic/clairic-v1");
    expect(learner!.model).toBe("extraction-clairic/clairic-v1");
    expect(learner!.source?.sourceHash).toBe(learningSourceHash(userText));
    expect(learner!.grounded.items.find(item => item.kind === "memory")?.evidence).toEqual({
      sessionId: "native-session", messageId: "learner-message", sourceHash: learningSourceHash(userText),
      quote: "I study botany.", start: 3, end: 18,
    });
    expect(teacher!.source?.messageId).toBe("assistant-1-20");
    expect(teacher!.grounded.items[0]!.kind).toBe("lesson-fact");
    expect(receipt.extractedState.memoryCandidates).toHaveLength(1);
    expect(receipt.extractedState.persisted).toBe(false);
    expect(receipt.proofBoundary).toBe("native-extraction-receipt-only");
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    for (const [path, sha256] of Object.entries(receipt.contract.sourceHashes)) {
      expect(sha256).toBe(createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex"));
    }
  });

  it("uses the shared latest learner/tutor prompts, probability cutoff and date", async () => {
    const run = fixture();
    await run.extract(context(), tutor());
    for (const [index, learner] of [true, false].entries()) {
      const payload = JSON.parse(run.calls[index]!.body);
      expect(payload.fields).toEqual(Object.fromEntries(Object.entries(fieldsFor(learner)).map(([id, field]) =>
        [id, { type: "text", instructions: field.instructions, null_threshold: .25 }])));
      expect(payload.reference_date).toBe("2026-10-25");
      expect(Object.keys(payload).sort()).toEqual(["fields", "reference_date", "state"]);
    }
  });

  it("keeps explicit null answers as a valid abstention without promoting guesses", async () => {
    const run = fixture(request => envelope(request, request.fields.memory
      ? { memory: { type: "text", value: null, guess: "I study botany.", span: [3, 17], p_null: .99 } } : {}));
    const receipt = await run.extract(context(), tutor());
    expect(receipt.status).toBe("abstained");
    expect(receipt.extractedState.learner).toEqual([]);
    expect(receipt.extractedState.memoryCandidates).toEqual([]);
    expect(receipt.sources[0]!.fieldDecisions.every(item => item.status === "null")).toBe(true);
    expect(receipt.sources[0]!.rawResponse?.body).toContain('"guess":"I study botany."');
  });

  it("does not admit text without p_null even when the envelope is valid", async () => {
    const receipt = await fixture(request => {
      const field = Object.keys(request.fields)[0]!;
      const { p_null: _, ...withoutProbability } = answer(request.state, request.state);
      return envelope(request, { [field]: withoutProbability });
    }).extract(context(), tutor());
    expect(receipt.status).toBe("abstained");
    expect(receipt.sources[0]!.fieldDecisions.some(item => item.status === "missing-probability")).toBe(true);
  });

  it("accepts the exact 0.25 boundary", async () => {
    const receipt = await fixture(request => envelope(request, {
      [Object.keys(request.fields)[0]!]: { ...answer(request.state, request.state), p_null: .25 },
    })).extract(context(), tutor());
    expect(receipt.status).toBe("completed");
  });

  it("applies shared grounding limits after successful envelope validation", async () => {
    const text = "x".repeat(4_001);
    const receipt = await fixture(request => envelope(request, {
      [Object.keys(request.fields)[0]!]: answer(request.state, request.state),
    })).extract(context(text), tutor(text));
    expect(receipt.status).toBe("abstained");
    expect(receipt.sources[0]!.outcome?.ok).toBe(true);
    expect(receipt.sources[0]!.grounded.abstentions).toEqual([{ index: 0, kind: "answer-step", reason: "missing-passage" }]);
    expect(receipt.extractedState.learner).toEqual([]);
  });

  for (const [name, change] of [
    ["paraphrase", (value: ReturnType<typeof answer>) => ({ ...value, value: "A paraphrase that is absent." })],
    ["split surrogate", (_: ReturnType<typeof answer>) => ({ type: "text", value: "\ud83d", span: [0, 1], p_null: .1 })],
    ["missing span", (value: ReturnType<typeof answer>) => ({ ...value, span: undefined })],
    ["above probability threshold", (value: ReturnType<typeof answer>) => ({ ...value, p_null: .25001 })],
    ["invalid probability", (value: ReturnType<typeof answer>) => ({ ...value, p_null: -1 })],
  ] as const) it(`rejects ${name} without inventing an empty memory result`, async () => {
    const receipt = await fixture(request => envelope(request, { [Object.keys(request.fields)[0]!]: change(answer(request.state, request.state)) }))
      .extract(context(), tutor("😀 This is text."));
    expect(receipt.status).toBe("failed");
    expect(receipt.sources.every(item => item.outcome?.ok === false && item.outcome.error === "invalid-response")).toBe(true);
    expect(receipt.extractedState.learner).toBeNull();
    expect(receipt.extractedState.memoryCandidates).toBeNull();
    expect(receipt.sources[0]!.rawResponse?.complete).toBe(true);
  });

  for (const [name, change] of [
    ["missing model", (body: ReturnType<typeof envelope>) => ({ ...body, model: undefined })],
    ["wrong model", (body: ReturnType<typeof envelope>) => ({ ...body, model: "clairic" })],
    ["truncated", (body: ReturnType<typeof envelope>) => ({ ...body, truncated: true })],
    ["missing truncation flag", (body: ReturnType<typeof envelope>) => ({ ...body, truncated: undefined })],
    ["missing answers", (body: ReturnType<typeof envelope>) => ({ ...body, answers: {} })],
    ["extra answer", (body: ReturnType<typeof envelope>) => ({ ...body, answers: { ...body.answers, invented: { type: "text", value: null } } })],
    ["invalid usage", (body: ReturnType<typeof envelope>) => ({ ...body, usage: { input_tokens: -1, output_tokens: 3 } })],
  ] as const) it(`retains but rejects the ${name} envelope`, async () => {
    const receipt = await fixture(request => change(envelope(request))).extract(context(), tutor());
    expect(receipt.status).toBe("failed");
    expect(receipt.sources[0]!.model).toBeNull();
    expect(receipt.sources[0]!.rawResponse?.body).toBeTruthy();
    expect(receipt.extractedState.memoryCandidates).toBeNull();
  });

  it("reports unavailable without a transport and unauthorized without scope", async () => {
    const unavailable = await createNativeLearningExtractor({ sessionId: "offline" }).extract(context(), tutor());
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.sources.every(item => item.rawResponse === null && item.reasons[0] === "unavailable")).toBe(true);
    expect(unavailable.extractedState.memoryCandidates).toBeNull();
    const run = fixture(undefined, { scope: undefined });
    expect((await run.extract(context(), tutor())).status).toBe("unavailable");
    expect(run.calls).toHaveLength(0);
  });

  for (const [status, error] of [[401, "unauthorized"], [402, "credit"], [404, "unavailable"], [429, "rate-limited"], [503, "unavailable"], [500, "provider"]] as const) {
    it(`retains HTTP ${status} raw error bodies with the production failure category`, async () => {
      let calls = 0;
      const run = fixture(undefined, { request: async () => { calls++; return new Response("raw upstream detail", { status }); } });
      const receipt = await run.extract(context(), tutor());
      expect(receipt.sources[0]!.outcome).toEqual({ ok: false, error });
      expect(receipt.sources[0]!.rawResponse).toMatchObject({ body: "raw upstream detail", status, complete: true });
      expect(receipt.extractedState.memoryCandidates).toBeNull();
      expect(calls).toBe(status === 429 ? 1 : 2);
    });
  }

  it("blocks oversized sources without truncating or sending them", async () => {
    const run = fixture(), text = "x".repeat(12_001);
    const receipt = await run.extract(context(text), tutor(text));
    expect(receipt.status).toBe("blocked");
    expect(receipt.sources.map(item => item.reasons)).toEqual([["source-too-large"], ["source-too-large"]]);
    expect(receipt.sources[0]!.source?.text).toBe(text);
    expect(receipt.sources[0]!.source?.sourceHash).toBe(learningSourceHash(text));
    expect(run.calls).toHaveLength(0);
  });

  it("ignores imported context, tool results, thinking and private evaluator data", async () => {
    const input = context();
    input.messages = [...input.messages, { role: "user", content: "Imported learner claim",
      keatingPrivateFork: { version: 1, kind: "imported-context" } }, { role: "toolResult", content: "PRIVATE HINDSIGHT" }];
    const message = tutor();
    message.content.unshift({ type: "thinking", thinking: "PRIVATE CHAIN OF THOUGHT" });
    const run = fixture();
    const receipt = await run.extract(input, message);
    expect(run.calls.map(call => JSON.parse(call.body).state)).toEqual([userText, tutorText]);
    expect(receipt.sources[1]!.source?.excludedContentTypes).toEqual(["thinking"]);
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE HINDSIGHT");
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE CHAIN OF THOUGHT");
    expect(input.messages).toHaveLength(3);
  });

  it("uses full text-block source representation and rejects duplicate IDs", async () => {
    const input = context();
    input.messages = [{ role: "user", id: "multi", content: [{ type: "text", text: "First." }, { type: "text", text: "😀 Second." }] }];
    const run = fixture(request => envelope(request, { [Object.keys(request.fields)[0]!]: answer(request.state, request.state) }));
    const receipt = await run.extract(input, tutor());
    expect(receipt.sources[0]!.source?.text).toBe("First.\n\n😀 Second.");
    expect(receipt.sources[0]!.grounded.items[0]!.evidence.end).toBe(18);
    const duplicate = context(); duplicate.messages = [...duplicate.messages, ...duplicate.messages];
    const result = await fixture().extract(duplicate, tutor());
    expect(result.sources[0]!.reasons).toEqual(["ambiguous-source-identity"]);
    expect(result.sources[0]!.rawRequest).toBeNull();
    expect(result.status).toBe("partial");
  });

  it("keeps a captured source revision when caller context changes during dispatch", async () => {
    const input = context(), message = tutor();
    const originalTutor = message.content[0]!;
    const run = fixture(request => {
      (input.messages[0] as { content: string }).content = "Changed learner text";
      if (originalTutor.type === "text") originalTutor.text = "Changed tutor text";
      return envelope(request, { [Object.keys(request.fields)[0]!]: answer(request.state, request.state) });
    });
    const receipt = await run.extract(input, message);
    expect(run.calls.map(call => JSON.parse(call.body).state)).toEqual([userText, tutorText]);
    expect(receipt.sources.map(item => item.source?.sourceHash)).toEqual([learningSourceHash(userText), learningSourceHash(tutorText)]);
  });

  it("blocks partial tutor completions and returns independently available learner evidence", async () => {
    const message = tutor(); message.stopReason = "length";
    const receipt = await fixture().extract(context(), message);
    expect(receipt.status).toBe("partial");
    expect(receipt.sources[1]!.reasons).toEqual(["incomplete-tutor-message"]);
    expect(receipt.extractedState.tutor).toBeNull();
    expect(receipt.extractedState.learner).toEqual([]);
  });

  it("bounds raw responses and explicitly marks partial capture", async () => {
    const receipt = await fixture(undefined, { request: async () => new Response("x".repeat(128 * 1024 + 1)) }).extract(context(), tutor());
    expect(receipt.status).toBe("failed");
    expect(receipt.sources[0]!.rawResponse).toMatchObject({ complete: false, bytesRetained: 128 * 1024, bytesRead: 128 * 1024 + 1 });
    expect(receipt.sources[0]!.rawResponse!.body.length).toBe(128 * 1024);
  });

  it("retains malformed JSON and non-UTF8 bytes without trusting them", async () => {
    for (const body of ["malformed json", new Uint8Array([0xff])]) {
      const receipt = await fixture(undefined, { request: async () => new Response(body) }).extract(context(), tutor());
      expect(receipt.status).toBe("failed");
      expect(receipt.sources[0]!.rawResponse?.complete).toBe(true);
      if (typeof body !== "string") expect(receipt.sources[0]!.rawResponse?.bodyBase64).toBe("/w==");
    }
  });

  it("does not dispatch when already aborted", async () => {
    const abort = new AbortController(); abort.abort();
    const run = fixture();
    const receipt = await run.extract(context(), tutor(), abort.signal);
    expect(receipt.status).toBe("cancelled");
    expect(run.calls).toHaveLength(0);
    expect(receipt.extractedState.memoryCandidates).toBeNull();
  });

  it("cancels a transport that ignores abort and rejects its late response", async () => {
    const abort = new AbortController();
    let resolve!: (response: Response) => void, requestSignal: AbortSignal | undefined;
    const late = new Promise<Response>(done => { resolve = done; });
    const run = fixture(undefined, { request: (_body, _scope, signal) => { requestSignal = signal; return late; } });
    const pending = run.extract(context(), tutor(), abort.signal);
    abort.abort();
    const receipt = await pending, captured = JSON.stringify(receipt);
    expect(receipt.status).toBe("cancelled");
    expect(requestSignal?.aborted).toBe(true);
    resolve(Response.json({ model: "extraction-clairic/clairic", truncated: false, answers: {} }));
    await Promise.resolve(); await Promise.resolve();
    expect(JSON.stringify(receipt)).toBe(captured);
    expect(receipt.sources[0]!.rawResponse).toBeNull();
  });

  it("times out hung transports and body streams without fabricating evidence", async () => {
    for (const request of [() => new Promise<Response>(() => {}), async () => new Response(new ReadableStream<Uint8Array>())]) {
      const receipt = await fixture(undefined, { request, timeoutMs: 5 }).extract(context(), tutor());
      expect(receipt.status).toBe("failed");
      expect(receipt.sources.every(item => item.outcome?.ok === false && item.outcome.error === "timeout")).toBe(true);
      expect(receipt.extractedState.memoryCandidates).toBeNull();
    }
  });

  it("redacts thrown transport errors while preserving a provider failure", async () => {
    const receipt = await fixture(undefined, { request: async () => { throw new Error("SECRET TRANSPORT TOKEN"); } }).extract(context(), tutor());
    expect(receipt.status).toBe("failed");
    expect(receipt.sources[0]!.outcome).toEqual({ ok: false, error: "provider" });
    expect(JSON.stringify(receipt)).not.toContain("SECRET TRANSPORT TOKEN");
  });
});
