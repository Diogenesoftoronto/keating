import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { MINIMAX_M31_FLASH_PROFILE } from "../../packages/runtime-config/src/index.ts";
import { createSystemOneCaller } from "../../packages/learner-contracts/src/judgement/system-one.ts";
import { createBenchmarkRegistry } from "../prompt-adherence/providers.ts";
import { credential, sanitizeMessage, save, sha, usd } from "../../docs/benchmarks/openui-audit-2026-11-18/final-review/study/common.mjs";

export const tutorId = "MiniMax-M2.7-highspeed";
export const flashTutorId = "MiniMax-M3.1-Flash";
export const judgeId = "jev-1.14.0";
export const phaseCapUsd = 1.25;
export const priorBoundUsd = 2.77319968;
export const globalCapUsd = 10;
const maxTokens = 3072;
const judgeUrl = "https://api.typesafe.ai/v1/systemone";
// Full 204,800-token MiniMax input at $0.60/M plus capped output at $2.40/M;
// Jev's 64k input window at $0.042/M. Unknown usage retains its entire reservation.
const prices = {
  tutor: {input:0.6, output:2.4, reserve:0.14},
  decision: {input:0.042, output:0, reserve:0.003},
};
// A 1,048,576-token input and 3,072-token output fit under this reservation.
// Count cached input at the full input rate when calculating the upper estimate.
const flashPrice = {input:0.15, output:0.60, reserve:0.16};
const price = (kind, model) => kind === "tutor" && model === flashTutorId ? flashPrice : prices[kind];
export const amount = (kind, usage, model = tutorId) => {
  const rate = price(kind, model);
  return usage ? usd((usage.input * rate.input + usage.output * rate.output) / 1e6) : rate.reserve;
};
export const cost = entries => usd(entries.reduce((sum, e) => sum + e.accountedUsd, 0));
const tokenCounts = (input, output) => [input, output].every(n => Number.isSafeInteger(n) && n >= 0)
  && input + output > 0 ? {input, output} : null;

export async function createProbeTransport(root, folder, source, budget = {priorBoundUsd, phaseCapUsd, globalCapUsd}, protocol, requestedTutor = tutorId) {
  assert([tutorId, flashTutorId].includes(requestedTutor));
  const useFlash = requestedTutor === flashTutorId;
  const registry = await createBenchmarkRegistry(join(root, ".keating/pi-config"));
  const model = useFlash ? MINIMAX_M31_FLASH_PROFILE : registry.find("minimax", requestedTutor);
  const baseUrl = useFlash ? "https://api.minimax.io/v1" : "https://api.minimax.io/anthropic";
  const tutorUrl = baseUrl + (useFlash ? "/chat/completions" : "/v1/messages");
  assert(model?.id === requestedTutor && model.baseUrl === baseUrl, "Configured MiniMax model unavailable");
  if (useFlash) assert(model.contextWindow > 0 && model.contextWindow <= 1_048_576);
  const auth = await registry.getApiKeyAndHeaders(model);
  const tutorKey = auth.apiKey || credential("MINIMAX_API_KEY", "minimax");
  const judgeKey = credential("TYPESAFE_API_KEY", "typesafe_api_key");
  assert(tutorKey && judgeKey, "Missing tutor or decision credential");
  const secrets = [tutorKey, judgeKey];
  const nativeFetch = globalThis.fetch;
  const scope = new AsyncLocalStorage();
  const wireFolder = join(folder, "wire");
  mkdirSync(wireFolder, {mode:0o700});
  assert(budget.priorBoundUsd >= 0 && budget.phaseCapUsd > 0 && budget.priorBoundUsd + budget.phaseCapUsd <= globalCapUsd);
  const ledger = {version:1, source, ...budget, ...(protocol ? {protocol} : {}), ...(requestedTutor === flashTutorId && {tutorModel:requestedTutor}), entries:[]};
  const persist = () => save(join(folder, "ledger.json"), ledger);
  persist();

  function reserve(cell, kind, stage, url, wire) {
    const reserveUsd = price(kind, requestedTutor).reserve;
    assert(!ledger.stop && cost(ledger.entries) + reserveUsd <= ledger.phaseCapUsd, "Paid probe closed or over budget");
    assert(!secrets.some(s => wire.includes(s)), "Credential appeared in a request body");
    const rows = ledger.entries.filter(e => e.cell === cell && e.kind === kind);
    assert(rows.length < (kind === "tutor" ? 4 : 8), "Turn request limit reached");
    const body = JSON.parse(wire);
    assert.equal(body.model, kind === "tutor" ? requestedTutor : judgeId);
    assert.equal(url, kind === "tutor" ? tutorUrl : judgeUrl);
    assert(Buffer.byteLength(wire) <= 200_000);
    if (kind === "tutor") {
      const limit = body.max_completion_tokens ?? body.max_tokens;
      assert(Number.isSafeInteger(limit) && limit > 0 && limit <= maxTokens);
    }
    const wireSha256 = sha(wire);
    const path = join(wireFolder, wireSha256 + ".json.gz");
    if (!existsSync(path)) writeFileSync(path, gzipSync(wire), {flag:"wx", mode:0o600});
    const entry = {cell, kind, stage, model:body.model, url, wireSha256, request:rows.length + 1,
      reservedUsd:reserveUsd, accountedUsd:reserveUsd, usage:null,
      reservedAt:Date.now(), sentAt:null, receivedAt:null, finishedAt:null, http:null, status:"reserved"};
    ledger.entries.push(entry);
    persist();
    return entry;
  }
  function settle(entry, usage, status) {
    if (entry.finishedAt !== null) return;
    entry.usage = usage;
    entry.status = status;
    entry.accountedUsd = amount(entry.kind, usage, requestedTutor);
    if (entry.accountedUsd > entry.reservedUsd || [401,402,403].includes(entry.http)) ledger.stop = status;
    entry.finishedAt = Date.now();
    persist();
  }
  const modelIds = raw => {
    const models = new Set();
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.startsWith("data:")) continue;
      try {
        const frame = JSON.parse(line.slice(5));
        const id = frame.message?.model ?? frame.model;
        if (typeof id === "string") models.add(id);
      } catch { /* Other SSE frames contain no JSON. */ }
    }
    return [...models];
  };
  // Pi builds the tutor HTTP body. Observe its exact dispatch and full stream
  // independently for each candidate, without putting credentials into evidence.
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const pending = scope.getStore();
    if (!pending && ["localhost","127.0.0.1","[::1]"].includes(url.hostname)) return nativeFetch(input, init);
    assert(pending && !pending.entry && (init.method ?? input.method) === "POST");
    const wire = typeof init.body === "string" ? init.body : await new Request(input, init).text();
    const entry = pending.entry = reserve(pending.cell, "tutor", "generation", url.href, wire);
    entry.sentAt = Date.now();
    const response = await nativeFetch(input, {...init, redirect:"error"});
    entry.http = response.status;
    pending.response = response.clone().text().then(raw => {
      entry.receivedAt = Date.now();
      entry.responseSha256 = sha(raw);
      entry.reportedModels = modelIds(raw);
    }).catch(() => {});
    return response;
  };
  async function tutor(cell, context, reasoning, signal) {
    const pending = {cell};
    try {
      const msg = await scope.run(pending, () => streamSimple(model, context, {
        ...auth, apiKey:tutorKey, signal, temperature:0, maxTokens, maxRetries:0,
        maxRetryDelayMs:0, timeoutMs:90_000, cacheRetention:"none",
        ...(reasoning && reasoning !== "off" ? {reasoning} : {}),
      }).result());
      await pending.response;
      assert(pending.entry, "Tutor returned without a reserved HTTP request");
      const message = sanitizeMessage(msg);
      if (message.stopReason === "error" && pending.entry.http === 429) message.errorMessage = "HTTP 429";
      assert(!secrets.some(s => JSON.stringify(message).includes(s)));
      // The classroom stores distinct public turns by timestamp.
      message.timestamp = Date.now();
      pending.entry.message = message;
      const u = msg.usage;
      settle(pending.entry, tokenCounts(u?.input + u?.cacheRead + u?.cacheWrite, u?.output), msg.stopReason);
      return message;
    } catch (error) {
      if (pending.entry) { await pending.response; settle(pending.entry, null, "transport-error"); }
      throw error;
    }
  }
  async function decision(cell, request, signal) {
    const ids = Object.keys(request.questions);
    const stage = ids.includes("learning_task") ? "plan" : ids.includes("draft_pair_choice") ? "pair"
      : ids.includes("draft_choice") ? "final-choice" : "review";
    const call = createSystemOneCaller({model:judgeId, apiKey:judgeKey, requireResolvedModel:true,
      retry:{maxAttempts:1, initialDelayMs:0, maxDelayMs:0},
      fetch:async(url, init) => {
        const entry = reserve(cell, "decision", stage, url, init.body);
        try {
          entry.sentAt = Date.now();
          const response = await nativeFetch(url, {...init, signal, redirect:"error"});
          entry.http = response.status;
          const raw = await response.text();
          entry.receivedAt = Date.now();
          entry.responseSha256 = sha(raw);
          const body = JSON.parse(raw);
          if (response.ok) {
            assert(!secrets.some(s => raw.includes(s)));
            entry.response = {answers:body.answers, usage:body.usage, model:body.model};
          }
          settle(entry, tokenCounts(body.usage?.input_tokens, body.usage?.output_tokens), response.ok ? "received" : "http-error");
          return new Response(raw, {status:response.status});
        } catch (error) {
          settle(entry, null, "transport-error");
          throw error;
        }
      }});
    return call(request, signal);
  }
  const classroomModel = Object.fromEntries(["id", "name", "provider", "api", "baseUrl", "input", "reasoning", "thinkingLevelMap", "compat", "cost", "contextWindow", "maxTokens"]
    .map(field => [field, model[field]]));
  return {ledger, tutor, decision, classroomModel, close() { globalThis.fetch = nativeFetch; }};
}
