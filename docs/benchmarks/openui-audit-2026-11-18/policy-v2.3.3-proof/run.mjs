// Replay four archived tutor drafts × two recorded reviewers through the current web gate. No provider or tool execution.
import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {plugin} from "bun";
import {fileHash, read, sha} from "../gemini-decision/journal.mjs";
import {createSystemOneCaller} from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import {createGeminiDecisionCaller} from "../../../../scripts/openui-diagnostics/gemini-decision.ts";
import {TEACHING_POLICY_VERSION} from "../../../../packages/learner-contracts/src/judgement/teaching-policy-catalog.ts";
import {blocksRelease} from "../../../../packages/learner-contracts/src/judgement/teaching-drafts/policy.ts";
import {createAssistantMessageEventStream} from "../../../../node_modules/@earendil-works/pi-ai/dist/compat.js";

const mode = process.argv[2] ?? "--verify";
assert(["--write", "--verify"].includes(mode) && process.argv.length <= 3);
assert.equal(TEACHING_POLICY_VERSION, "keating-teaching-policy/v2.3.3");
globalThis.fetch = () => { throw Error("Network disabled during replay"); };
const source = (where, name) => join(import.meta.dir, "..", where, name);
const previous = name => source("policy-v2.3-completion", name);
const measured = name => source("policy-v2.3.2-review", name);
const hashes = {originalLedger:fileHash(previous("ledger.json")), inputs:fileHash(previous("inputs.json.gz")),
  reviews:fileHash(measured("ledger.json")), requests:fileHash(measured("requests.json"))};
assert.deepEqual(hashes, {
  originalLedger:"d59321be0d302579339856562e5224eea2b5a16ee736c8a1bd19f6b175413dfa",
  inputs:"f1b7e3d3d6e1f2c74cda08d12d3cff5ddb3218ee4fe560e1edbf447054550e80",
  reviews:"b7de2d03ab9f47928f534747cbd7fe3203d109474da65baf87fc89ba4af6ed9a",
  requests:"c78d335036142bf008615d411988fcffe9c2ac59702492de392902be1220e79c",
});
const original = read(previous("ledger.json")).entries;
const bundle = JSON.parse(gunzipSync(readFileSync(previous("inputs.json.gz"))));
const study = read(measured("requests.json")), reviews = read(measured("ledger.json")).entries;
const providers = read(source("cue-paraphrases", "protocol.json")).providers;
await plugin({name:"replay-local-prompt-markdown", setup(build) {
  build.onLoad({filter:/\.md(?:\?raw)?$/}, async args => ({contents:"export default " + JSON.stringify(await Bun.file(args.path.replace(/\?raw$/, "")).text()), loader:"js"}));
}});
const {withTeachingDraftGate} = await import("../../../../web/src/keating/judgement/draft-gate.ts");
const {composeKeatingSystemPrompt} = await import("../../../../web/src/keating/browser-tools/prompt.ts");
const {parseReviewNotice} = await import("../../../../web/src/keating/judgement/review-notice.ts");
const base = composeKeatingSystemPrompt();
function decode(provider, entry, request) {
  assert.equal(entry.http, 200);
  assert.equal(sha(request), entry.requestSha256);
  const config = providers[provider];
  const fetch = async (url, init) => {
    assert.equal(url, config.endpoint); assert.equal(init.method, "POST"); assert.equal(sha(init.body), entry.wireSha256);
    return Response.json(entry.response, {status:entry.http});
  };
  const caller = provider === "google" ? createGeminiDecisionCaller({apiKey:"offline", fetch})
    : createSystemOneCaller({apiKey:"offline", endpoint:config.endpoint, model:config.id, requireResolvedModel:true,
      fetch, retry:{maxAttempts:1, initialDelayMs:0, maxDelayMs:0}});
  return caller(request);
}
const results = [];
for (const candidate of study.cases) {
  const [, originalPlanner, number] = candidate.id.split("--");
  const arm = "python-practice--" + originalPlanner;
  const old = read(previous("receipts/" + arm + ".json"));
  const planEntry = original.find(e => e.label === arm + "/plan");
  const generation = original.find(e => e.id === arm + "/tutor/" + number).message;
  assert.equal(planEntry.requestSha256, candidate.originalPlanRequestSha256);
  assert.equal(generation.model, "MiniMax-M2.7-highspeed");
  assert.deepEqual(generation.content.filter(p=>p.type === "toolCall").map(({name,arguments:args})=>({name,arguments:args})), candidate.request.state.reply.toolCalls);
  const text = generation.content.filter(p=>p.type === "text").map(p=>p.text).join("\n");
  assert.equal(sha(text), candidate.originalTutorDraftSha256);
  assert.equal(text, candidate.request.state.reply.text);
  for (const reviewer of Object.keys(providers)) {
    const entry = reviews.find(e=>e.id === candidate.id + "/" + reviewer);
    const same = originalPlanner === reviewer;
    const backend = {backend:"fixture", model:"offline-paired-plan-review", calibrationSha256:null};
    let snapshot, replayError, requestedDrafts = 0;
    const dispatched = [];
    const judge = async request => {
      const plan = Boolean(request.questions.learning_task);
      assert.equal(request.questions.draft_choice, undefined);
      assert.deepEqual(request, plan ? planEntry.request : candidate.request);
      const outcome = await decode(plan ? originalPlanner : reviewer, plan ? planEntry : entry, request);
      assert(outcome.ok);
      dispatched.push({stage:plan ? "plan":"review", model:outcome.response.backend.model, sha256:sha(request)});
      // The product requires a single reviewer identity per turn. For the two crossed arms only, identify
      // this deliberately assembled offline fixture as such. Every returned answer and request stays byte-matched.
      return same ? outcome : {...outcome, response:{...outcome.response, backend}};
    };
    const tutor = async () => {
      if (++requestedDrafts > 1) throw Error("There is only one authored draft in this offline comparison");
      const stream = createAssistantMessageEventStream();
      stream.push({type:"done", reason:generation.stopReason === "toolUse" ? "toolUse":"stop", message:generation});
      stream.end(generation);
      return stream;
    };
    const gate = withTeachingDraftGate(tutor, {sessionId:"static-proof-" + entry.id, basePrompt:()=>base, makeCaller:()=>async r => {
      try {return await judge(r);} catch(error) {replayError=error; throw error;}
    },
      maxAttempts:2, timeoutMs:10000, refinement:"ordinary", judgementModel:{id:same ? providers[reviewer].id : backend.model,
        requestTokens:64000,stateQuestionTokens:32000}, onProgress:s=>{snapshot=s;}});
    const learner = candidate.request.state.turn.learnerMessage;
    const stream = await gate(bundle.model, {systemPrompt:bundle.prompt, tools:bundle.tools, messages:[{role:"user", content:learner, timestamp:1}]}, {});
    const publicMessage = await stream.result();
    if (replayError) throw replayError;
    assert(requestedDrafts >= 1 && requestedDrafts <= 2); assert.deepEqual(dispatched.map(s=>s.stage), ["plan","review"]);
    assert.equal(snapshot.attempts.filter(a=>a.status!=="generation-error").length,1);
    const attempt = snapshot.attempts[0];
    const publicText = publicMessage.content.filter(p=>p.type==="text").map(p=>p.text).join("\n");
    const notice = parseReviewNotice(publicText);
    if (snapshot.phase === "released") assert.equal(notice?.text ?? publicText, text);
    else assert.equal(snapshot.phase, "withheld");
    const facts = attempt.debuggingExercise;
    assert(facts?.example && facts.disclosure);
    results.push({id:entry.id, originalPlanner, pairedReviewer:reviewer, identity:same ? "original-provider":"offline-crossed-fixture",
      tutor:generation.model, draftSha256:sha(text), dispatched, originalDraftStatus:old.findings[Number(number)-1].status,
      originalSelected:old.selectedAttempt===Number(number), attemptStatus:attempt.status, additionalDraftUnavailable:requestedDrafts>1, singleDraftDisposition:snapshot.phase,
      notice:notice?.kind ?? null, staticProof:facts.staticProof ?? null, example:facts.example, disclosure:facts.disclosure,
      blocking:attempt.checks.filter(blocksRelease).map(({id,source,status,probability})=>({id,source,status,probability})),
      debuggingChecks:attempt.checks.filter(c=>c.id.startsWith("debug_"))});
  }
}
assert.equal(results.length, 8);
const result = {version:1, policy:TEACHING_POLICY_VERSION, measuredQuestionPolicy:study.policy, scope:"post-hoc single-draft web gate replay",
  hashes, providerCalls:0, tutorCalls:0, toolExecutions:0, results};
const file = join(import.meta.dir, "replay.json");
if (mode === "--write") writeFileSync(file, JSON.stringify(result,null,2)+"\n", {flag:"wx"});
else assert.deepEqual(result, read(file));
console.log(JSON.stringify({rows:results.length, released:results.filter(r=>r.singleDraftDisposition==="released").length,
  hardStaticFindings:results.filter(r=>r.blocking.some(c=>c.id==="debug_native_fix_disclosed" || c.id==="debug_static_example_masked")).length,
  providerCalls:0, sha256:fileHash(file)}));
