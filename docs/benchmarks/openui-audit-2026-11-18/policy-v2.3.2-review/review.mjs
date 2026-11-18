// Replay the closed review study from the actual requests, wire responses and provider usage.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileHash, read, sha, total, usd } from "../gemini-decision/journal.mjs";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { createGeminiDecisionCaller, readGeminiDecisionUsage } from "../../../../scripts/openui-diagnostics/gemini-decision.ts";

assert(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === "--verify", "Use --verify to replay the completed study.");
globalThis.fetch = () => { throw Error("This evidence replay runs offline"); };
const path = name => join(import.meta.dir, name);
const protocol = read(path("protocol.json"));
assert.equal(fileHash(path("capture.mjs")), protocol.runnerSha256);
assert.equal(fileHash(path("requests.json")), protocol.requestsSha256);
assert.equal(fileHash(path("examples.json")), protocol.examplesSha256);
const previous = path("../policy-v2.3-completion/ledger.json");
assert.equal(fileHash(previous), "d59321be0d302579339856562e5224eea2b5a16ee736c8a1bd19f6b175413dfa");
assert.equal(usd(1.733468526 + total(read(previous).entries)), protocol.previousBoundUsd);
const ledger = read(path("ledger.json"));
const summary = read(path("summary.json"));
const providers = read(path("../cue-paraphrases/protocol.json")).providers;
assert.equal(ledger.protocolSha256, fileHash(path("protocol.json")));
assert.deepEqual(ledger.entries.map(row => row.id), protocol.schedule);
assert.equal(protocol.schedule.length, 8);
const rows = [];
for (const job of read(path("requests.json")).cases) {
  assert.equal(sha(job.request), job.requestSha256);
  for (const [provider, config] of Object.entries(providers)) {
    const id = job.id + "/" + provider;
    const entry = ledger.entries[rows.length];
    assert.equal(entry.id, id);
    assert.equal(entry.requestSha256, job.requestSha256);
    assert.equal(entry.http, 200);
    let wires = 0;
    const fetch = async (url, init) => {
      assert.equal(url, config.endpoint);
      assert.equal(init.method, "POST");
      assert.equal(JSON.parse(init.body).model, config.id);
      assert.equal(sha(init.body), entry.wireSha256);
      wires++;
      return Response.json(entry.response, {status: entry.http});
    };
    const caller = provider === "google" ? createGeminiDecisionCaller({apiKey:"offline",fetch})
      : createSystemOneCaller({apiKey:"offline",model:config.id,endpoint:config.endpoint,fetch,requireResolvedModel:true,
          retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0}});
    const outcome = await caller(job.request);
    assert(outcome.ok && wires === 1);
    const scores = {};
    for (const key of ["debug_example_witness", "debug_solution_visibility"]) {
      const answer = outcome.response.answers[key];
      assert.equal(answer.type, "choice");
      scores[key] = {choice:answer.choice, confidence:answer.confidence, probabilities:{...answer.probabilities}};
    }
    rows.push({id,status:"reviewed",scores});
    const usage = provider === "google" ? readGeminiDecisionUsage(entry.response)
      : {inputTokens:entry.response.usage.input_tokens,outputTokens:entry.response.usage.output_tokens};
    assert.deepEqual(usage, entry.usage);
    assert.equal(usd((usage.inputTokens * config.inputUsdPerMillion + usage.outputTokens * config.outputUsdPerMillion) / 1e6), entry.accountedUsd);
    assert(entry.accountedUsd <= entry.reservedUsd);
  }
}
const extraUsd = total(ledger.entries);
const totalBoundUsd = usd(protocol.previousBoundUsd + extraUsd);
assert.deepEqual({rows, providerRequests:rows.length, extraUsd, totalBoundUsd}, summary);
assert(totalBoundUsd <= protocol.studyCapUsd);
console.log(JSON.stringify({verifiedReviews:rows.length, newRequests:0, extraUsd, totalBoundUsd}));
