import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileHash, read, save, sha, total, usd, verifyPrior } from "../gemini-decision/journal.mjs";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { createGeminiDecisionCaller, readGeminiDecisionUsage } from "../../../../scripts/openui-diagnostics/gemini-decision.ts";

const here = import.meta.dir;
export const cohort = read(join(here, "cohort.json"));
export const judges = read(join(here, "../cue-paraphrases/protocol.json")).providers;
export const actor = read(join(here, "../policy-holdout/cohort.json")).models.find(model => model.id === cohort.tutor);
const previous = read(join(here, "../cue-paraphrases/results.json"));
verifyPrior();
assert.equal(fileHash(join(here, "../cue-paraphrases/ledger.json")), cohort.previousLedgerSha256);
assert.equal(previous.cumulativeBoundUsd, cohort.previousBoundUsd);
assert.equal(usd(read(join(here, "../gemini-decision/summary.json")).accounting.allStudyBound +
  total(read(join(here, "../cue-paraphrases/ledger.json")).entries)), cohort.previousBoundUsd);
assert(cohort.previousBoundUsd + cohort.additionalCapUsd <= cohort.studyCapUsd);

const apiFetch = globalThis.fetch.bind(globalThis);
const tutorTransport = new AsyncLocalStorage();
const ledgerFile = join(here, "ledger.json");
export function measuredTransport(live, manifestSha256) {
  const ledger = existsSync(ledgerFile) ? read(ledgerFile) : { manifestSha256, entries: [] };
  assert.equal(ledger.manifestSha256, manifestSha256);
  globalThis.fetch = async (input, init) => {
    const call = tutorTransport.getStore();
    const url = new URL(input instanceof Request ? input.url : input);
    assert(live && call && !call.dispatched && url.origin === new URL(actor.endpoint).origin &&
      (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() === "POST", "Unexpected network dispatch");
    call.dispatched = true;
    const response = await apiFetch(input, { ...init, redirect: "error" });
    call.entry.http = response.status;
    save(ledgerFile, ledger);
    return response;
  };
  function reserve(id, model, upper, requestSha256) {
    assert(live && !ledger.entries.some(entry => entry.id === id), "Request already reserved");
    if (total(ledger.entries) + upper > cohort.additionalCapUsd) throw Error("segment budget exhausted");
    const entry = { id, model, requestSha256, startedAt: new Date().toISOString(), finishedAt: null,
      http: null, reservedUsd: upper, accountedUsd: upper, usage: null, status: "reserved" };
    ledger.entries.push(entry);
    save(ledgerFile, ledger);
    return entry;
  }
  function settle(entry, usage, priced, status) {
    if (priced !== null) assert(Number.isFinite(priced) && priced >= 0 && priced <= entry.reservedUsd);
    Object.assign(entry, { finishedAt: new Date().toISOString(), usage, status, accountedUsd: priced === null ? entry.reservedUsd : usd(priced) });
    save(ledgerFile, ledger);
  }
  async function decision(provider, key, request, label, signal) {
    const cfg = judges[provider], requestSha256 = sha(request);
    const id = cfg.id + "/" + requestSha256;
    const fetcher = async (url, opts) => {
      assert.equal(url, cfg.endpoint);
      assert.equal(JSON.parse(opts.body).model, cfg.id);
      assert.equal(opts.method, "POST");
      assert(Buffer.byteLength(opts.body) < 160000);
      const wireSha256 = sha(opts.body);
      let entry = ledger.entries.find(row => row.id === id);
      if (!entry) {
        assert(live, "No recorded decision for " + label);
        if (provider === "google") {
          const last = ledger.entries.findLast(row => row.model === cfg.id);
          const wait = last ? 15000 - (Date.now() - Date.parse(last.startedAt)) : 0;
          if (wait > 0) await Bun.sleep(wait);
        }
        entry = reserve(id, cfg.id, cfg.reserveUsd, requestSha256);
        Object.assign(entry, { label, wireSha256, request });
        save(ledgerFile, ledger);
        try {
          const response = await apiFetch(url, { ...opts, redirect: "error" });
          entry.http = response.status;
          const body = await response.json().catch(() => null);
          const data = response.ok && body && typeof body === "object" && !Array.isArray(body)
            ? Object.fromEntries(Object.entries(body).map(([key, value]) => [key,
                ["model", "model_version", "modelVersion", "answers", "usage"].includes(key) ? value : null]))
            : {};
          entry.response = data;
          const usage = provider === "google" ? readGeminiDecisionUsage(data)
            : Number.isSafeInteger(data.usage?.input_tokens) && data.usage.input_tokens > 0
                && Number.isSafeInteger(data.usage?.output_tokens) && data.usage.output_tokens >= 0
              ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null;
          settle(entry, usage, usage ? usage.inputTokens * cfg.inputUsdPerMillion / 1e6 : null, response.ok ? "received" : "http-error");
        } catch {
          if (!entry.finishedAt) settle(entry, null, null, "transport-uncertain");
          throw Error("Decision transport failed");
        }
      }
      assert.equal(entry.wireSha256, wireSha256);
      assert(entry.finishedAt && entry.http && entry.response, "Unobserved decision cannot be repeated");
      return Response.json(entry.response, { status: entry.http });
    };
    const caller = provider === "jev"
      ? createSystemOneCaller({ apiKey: key, model: cfg.id, endpoint: cfg.endpoint, fetch: fetcher, requireResolvedModel: true,
          retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 } })
      : createGeminiDecisionCaller({ apiKey: key, fetch: fetcher });
    return caller(request, signal);
  }
  async function tutor(id, context, makeStream) {
    const requestSha256 = sha([context.systemPrompt, context.messages, context.tools]);
    const old = ledger.entries.find(row => row.id === id);
    if (old) {
      assert.equal(old.requestSha256, requestSha256);
      assert(old.message, "An interrupted tutor request cannot be reissued");
      return old.message;
    }
    const entry = reserve(id, actor.id, .12, requestSha256);
    try {
      const raw = await tutorTransport.run({ entry, dispatched: false }, makeStream);
      const usage = raw.usage;
      const measured = usage?.totalTokens > 0 && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(n => Number.isSafeInteger(n) && n >= 0);
      const message = { role: "assistant", api: raw.api, provider: raw.provider, model: raw.model, timestamp: 1, stopReason: raw.stopReason,
        usage: raw.usage, content: raw.content.filter(part => part.type === "text" || part.type === "toolCall")
          .map(part => part.type === "text" ? { type:"text", text:part.text } : { type:"toolCall", name:part.name, id:part.id, arguments:part.arguments }) };
      assert.equal(message.model, actor.id);
      entry.message = message;
      const cost = measured ? ((usage.input + usage.cacheRead + usage.cacheWrite) * actor.inputPerMillionUsd
        + usage.output * actor.outputPerMillionUsd) / 1e6 : null;
      settle(entry, measured ? usage : null, cost, message.stopReason);
      return message;
    } catch {
      if (!entry.finishedAt) settle(entry, null, null, "transport-uncertain");
      throw Error("Tutor transport failed");
    }
  }
  return { ledger, decision, tutor };
}
