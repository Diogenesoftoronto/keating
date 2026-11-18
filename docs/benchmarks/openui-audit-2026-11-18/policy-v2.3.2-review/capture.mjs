// Review the four archived synthetic Python exercises. No tutor, execution or repair request.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  credential,
  fileHash,
  read,
  save,
  sha,
  total,
  usd,
  withSharedLock,
} from "../gemini-decision/journal.mjs";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import {
  createGeminiDecisionCaller,
  readGeminiDecisionUsage,
} from "../../../../scripts/openui-diagnostics/gemini-decision.ts";

const here = import.meta.dir;
const prior = 1.912935216,
  cap = 2;
const mode = process.argv[2] ?? "--dry";
assert(
  ["--dry", "--freeze", "--execute", "--verify"].includes(mode) &&
    process.argv.length <= 3,
);
const live = mode === "--execute";
const path = (name) => join(here, name);
const previousLedger = path("../policy-v2.3-completion/ledger.json");
assert.equal(
  fileHash(previousLedger),
  "d59321be0d302579339856562e5224eea2b5a16ee736c8a1bd19f6b175413dfa",
);
assert.equal(usd(1.733468526 + total(read(previousLedger).entries)), prior);
const providers = read(path("../cue-paraphrases/protocol.json")).providers;
const jobs = read(path("requests.json")).cases;
const focus = ["debug_example_witness", "debug_solution_visibility"];
const expect = read(path("examples.json"));
assert.equal(jobs.length, 4);
assert.equal(new Set(jobs.map((job) => job.id)).size, 4);
assert.equal(new Set(jobs.map((job) => sha(job.request))).size, 4);
assert.deepEqual(Object.keys(expect), jobs.map(job => job.id));
for (const job of jobs) {
  assert.equal(sha(job.request), job.requestSha256);
  for (const key of focus) {
    const question = job.request.questions[key];
    assert.equal(question.type, "choice");
    assert(Object.hasOwn(question.criteria, expect[job.id][key]));
  }
}
const protocol = {
  previousBoundUsd: prior,
  studyCapUsd: cap,
  requestsSha256: fileHash(path("requests.json")),
  examplesSha256: fileHash(path("examples.json")),
  runnerSha256: fileHash(import.meta.path),
  schedule: jobs.flatMap((job) =>
    Object.keys(providers).map((p) => job.id + "/" + p),
  ),
  method:
    "Post-hoc review of the four original synthetic tutor drafts with the application review request. Each provider sees each input once. No new tutor responses.",
};
function decisionCaller(provider, cfg, apiKey, fetch) {
  if (provider === "google") return createGeminiDecisionCaller({ apiKey, fetch });
  assert.equal(provider, "jev");
  return createSystemOneCaller({
    apiKey, model: cfg.id, endpoint: cfg.endpoint, fetch, requireResolvedModel: true,
    retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
  });
}
function checkWire(cfg, url, request) {
  assert.equal(url, cfg.endpoint);
  assert.equal(request.method, "POST");
  assert.equal(JSON.parse(request.body).model, cfg.id);
  assert(Buffer.byteLength(request.body) < 64000);
}
if (mode === "--dry") {
  let preflighted = 0;
  for (const job of jobs) {
    for (const [provider, cfg] of Object.entries(providers)) {
      const caller = decisionCaller(provider, cfg, "offline", async (url, request) => {
        checkWire(cfg, url, request);
        preflighted++;
        return Response.json({}, { status: 400 });
      });
      assert.equal((await caller(job.request)).ok, false);
    }
  }
  assert.equal(preflighted, protocol.schedule.length);
  console.log(
    JSON.stringify({
      preflighted,
      decisions: protocol.schedule.length,
      tutors: 0,
      availableUsd: usd(cap - prior),
    }),
  );
  process.exit(0);
}
if (mode === "--freeze") {
  assert(
    !existsSync(path("protocol.json")) && !existsSync(path("ledger.json")),
  );
  save(path("protocol.json"), protocol);
  process.exit(0);
}
assert.deepEqual(read(path("protocol.json")), protocol);
if (live) withSharedLock();
const ledger = existsSync(path("ledger.json"))
  ? read(path("ledger.json"))
  : { protocolSha256: fileHash(path("protocol.json")), entries: [] };
assert.equal(ledger.protocolSha256, fileHash(path("protocol.json")));
const keys = live
  ? {
      jev: credential("TYPESAFE_API_KEY", "typesafe_api_key"),
      google:
        credential("GEMINI_API_KEY", "gemini") || process.env.GOOGLE_API_KEY,
    }
  : {};
if (live)
  assert(
    keys.jev && keys.google,
    "Configured decision credentials unavailable",
  );
const dispatch = fetch.bind(globalThis);
globalThis.fetch = async () => {
  throw Error("Only the measured decision adapters can make requests");
};
const rows = [];
for (const job of jobs) {
  for (const [provider, cfg] of Object.entries(providers)) {
    const id = job.id + "/" + provider;
    const observed = ledger.entries.find((row) => row.id === id);
    if (observed && (!observed.http || !observed.response)) {
      rows.push({ id, status: "transport-unknown", scores: null });
      continue;
    }
    if (
      !observed &&
      usd(prior + total(ledger.entries) + cfg.reserveUsd) > cap
    ) {
      rows.push({ id, status: "budget-not-dispatched", scores: null });
      continue;
    }
    const fetcher = async (url, request) => {
      checkWire(cfg, url, request);
      const wireSha256 = sha(request.body);
      let entry = observed;
      if (!entry) {
        assert(live, "No saved provider response for " + id);
        if (provider === "google") {
          const last = ledger.entries.findLast(
            (row) => row.provider === "google",
          );
          const wait = last
            ? 15000 - (Date.now() - Date.parse(last.startedAt))
            : 0;
          if (wait > 0) await Bun.sleep(wait);
        }
        entry = {
          id,
          provider,
          model: cfg.id,
          requestSha256: sha(job.request),
          wireSha256,
          http: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          reservedUsd: cfg.reserveUsd,
          accountedUsd: cfg.reserveUsd,
        };
        ledger.entries.push(entry);
        save(path("ledger.json"), ledger);
        try {
          const resp = await dispatch(url, {
            ...request,
            redirect: "error",
            signal: AbortSignal.timeout(45000),
          });
          entry.http = resp.status;
          const body = await resp.json().catch(() => null);
          entry.response =
            resp.ok && body && typeof body === "object" && !Array.isArray(body)
              ? Object.fromEntries(
                  Object.entries(body).map(([key, v]) => [
                    key,
                    [
                      "model",
                      "model_version",
                      "modelVersion",
                      "answers",
                      "usage",
                    ].includes(key)
                      ? v
                      : null,
                  ]),
                )
              : {};
          const usage =
            provider === "google"
              ? readGeminiDecisionUsage(entry.response)
              : {
                  inputTokens: entry.response.usage?.input_tokens,
                  outputTokens: entry.response.usage?.output_tokens,
                };
          if (
            usage &&
            Number.isSafeInteger(usage.inputTokens) &&
            usage.inputTokens > 0 &&
            Number.isSafeInteger(usage.outputTokens) &&
            usage.outputTokens >= 0
          ) {
            const priced = usd(
              (usage.inputTokens * cfg.inputUsdPerMillion) / 1e6,
            );
            assert(priced <= cfg.reserveUsd);
            entry.usage = usage;
            entry.accountedUsd = priced;
          }
        } finally {
          entry.finishedAt = new Date().toISOString();
          save(path("ledger.json"), ledger);
        }
      }
      assert.equal(entry.requestSha256, sha(job.request));
      assert.equal(entry.wireSha256, wireSha256);
      return Response.json(entry.response, { status: entry.http });
    };
    const caller = decisionCaller(provider, cfg, keys[provider] ?? "offline", fetcher);
    const result = await caller(job.request);
    const entry = ledger.entries.find((row) => row.id === id);
    const unavailable = entry && (!entry.http || !entry.response);
    const scores = result.ok
      ? Object.fromEntries(
          focus.map((key) => {
            const answer = result.response.answers[key];
            return [
              key,
              answer?.type === "choice"
                ? {
                    choice: answer.choice,
                    confidence: answer.confidence,
                    probabilities: answer.probabilities,
                  }
                : (answer?.noul ?? null),
            ];
          }),
        )
      : null;
    const complete =
      scores && Object.values(scores).every((value) => value !== null);
    rows.push({
      id,
      status: unavailable
        ? "transport-unknown"
        : result.ok
          ? complete
            ? "reviewed"
            : "partial-review"
          : result.error.code,
      scores,
    });
  }
}
const summary = {
  rows,
  providerRequests: ledger.entries.length,
  extraUsd: total(ledger.entries),
  totalBoundUsd: usd(prior + total(ledger.entries)),
};
assert(summary.totalBoundUsd <= cap);
if (live) save(path("summary.json"), summary);
else assert.deepEqual(summary, read(path("summary.json")));
console.log(JSON.stringify(summary));
