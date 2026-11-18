// Capture ordinary review requests with the four saved, byte-identical tutor drafts. No execution or inference.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileHash, read, sha } from "../gemini-decision/journal.mjs";
import { runTeachingDrafts } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { TEACHING_POLICY_VERSION } from "../../../../packages/learner-contracts/src/judgement/teaching-policy-catalog.ts";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { createGeminiDecisionCaller } from "../../../../scripts/openui-diagnostics/gemini-decision.ts";

const mode = process.argv[2] ?? "--verify";
assert(process.argv.length <= 3 && ["--write","--verify"].includes(mode));
// v2.3.3 added local checks after these requests were measured. All request bytes must still match.
const measuredPolicy = "keating-teaching-policy/v2.3.2";
assert([measuredPolicy, "keating-teaching-policy/v2.3.3"].includes(TEACHING_POLICY_VERSION));
globalThis.fetch = () => {throw Error("Only recorded planning responses are available");};
const previous = name => join(import.meta.dir,"../policy-v2.3-completion",name);
assert.equal(fileHash(previous("ledger.json")),"d59321be0d302579339856562e5224eea2b5a16ee736c8a1bd19f6b175413dfa");
const ledger = read(previous("ledger.json"));
const models = read(join(import.meta.dir,"../cue-paraphrases/protocol.json")).providers;
const cases = [];
for (const historicalReviewer of ["jev","google"]) {
  const turnId = "python-practice--"+historicalReviewer, receipt = read(previous("receipts/"+turnId+".json"));
  const plan = ledger.entries.find(row=>row.label === turnId+"/plan"), cfg = models[historicalReviewer];
  assert(plan.http === 200 && sha(plan.request) === plan.requestSha256);
  const decodePlan = historicalReviewer === "google" ? createGeminiDecisionCaller({apiKey:"offline",fetch})
    : createSystemOneCaller({apiKey:"offline",model:cfg.id,endpoint:cfg.endpoint,fetch,requireResolvedModel:true,
      retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0}});
  async function fetch(url,init) {
    assert.equal(url,cfg.endpoint); assert.equal(init.method,"POST"); assert.equal(sha(init.body),plan.wireSha256);
    return Response.json(plan.response,{status:plan.http});
  }
  for (const [index,draft] of receipt.drafts.entries()) {
    const id = turnId+"--"+(index+1), original = ledger.entries.find(row=>row.label === turnId+"/review" && row.request.state.reply.text === draft.text);
    assert(original?.http === 200 && sha(original.request) === original.requestSha256);
    const tutor = ledger.entries.find(row=>row.id === draft.label)?.message;
    assert(tutor && tutor.model === "MiniMax-M2.7-highspeed");
    const calls = tutor.content.filter(part=>part.type === "toolCall").map(({name,arguments:args})=>({name,arguments:args}));
    assert.deepEqual(calls.map(call=>call.name),draft.tools);
    assert.deepEqual(calls,original.request.state.reply.toolCalls);
    let captured, stages = 0, generated = 0;
    const out = await runTeachingDrafts({turn:plan.request.state.turn,maxAttempts:1,refinement:"ordinary",timeoutMs:10000,
      judgementModel:{id:cfg.id,requestTokens:64000,stateQuestionTokens:32000},
      judge:async payload => {
        stages++;
        if (payload.questions.learning_task) {assert.deepEqual(payload,plan.request);return decodePlan(payload);}
        assert(payload.questions.debug_example_witness && payload.questions.debug_solution_visibility);
        assert.deepEqual(payload.state,original.request.state);
        const {debug_example_witness,debug_solution_visibility,...existing} = payload.questions;
        assert.deepEqual(existing,original.request.questions);
        captured = structuredClone(payload);
        return {ok:false,error:{code:"backend-unavailable",retryable:false}};
      },
      generate:async () => {generated++;return {reply:{text:draft.text,toolCalls:calls},value:index+1};}});
    assert.equal(out.status,"withheld");assert(captured && stages === 2 && generated === 1);
    cases.push({id,stage:"review",originalTutorDraftSha256:sha(draft.text),originalPlanRequestSha256:plan.requestSha256,
      originalReviewRequestSha256:original.requestSha256,requestSha256:sha(captured),request:captured});
  }
}
assert.equal(new Set(cases.map(c=>c.requestSha256)).size,4);
const result = {version:1,policy:measuredPolicy,cases};
const path = join(import.meta.dir,"requests.json");
if (mode === "--write") writeFileSync(path,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
else assert.deepEqual(result,read(path));
console.log(JSON.stringify({requests:cases.length,fileSha256:fileHash(path),newTutorCalls:0,newReviews:0}));
