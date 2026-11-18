// Capture ordinary web-gate requests without using any network service or executing a proposed tool.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { plugin } from "bun";

globalThis.fetch = () => { throw Error("Network disabled for historical feedback replay"); };
const here = import.meta.dir, study = resolve(here,"../study"), original = join(study,"supplement/addendum");
const mode = process.argv[2] ?? "--verify";
assert(["--verify","--verify-current-headless","--record"].includes(mode));
const bytes = (name) => readFileSync(name);
const json = (name) => JSON.parse(bytes(name));
const sha = (data) => createHash("sha256").update(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data)).digest("hex");
const ledgerFile = join(original,"ledger.json"), receiptFile = join(original,"receipts/tile-bag-confirm--minimax--jev.json");
assert.equal(sha(bytes(ledgerFile)), "ab87e6bf2897b738261ffb50815b443f44d6be12f02605f96c46a842d9936bc9");
assert.equal(sha(bytes(receiptFile)), "4f17f82ba12d94c8b4bab79362c43ba38020026d8093023014291df52e42d7f1");
const receipt = json(receiptFile), entries = json(ledgerFile).entries;
const parentFile = join(study,"supplement/prediction/receipts/tile-bag--minimax--jev.json");
assert.equal(sha(bytes(parentFile)), receipt.parentReceiptSha256);
const parent = json(parentFile);
assert.deepEqual(receipt.originalHistory, [{role:"user",content:parent.prompt,timestamp:1},parent.public.message]);
const pin = json(join(study,"cohort.json")).judges.jev;
const bundle = JSON.parse(gunzipSync(bytes(join(study,"inputs.json.gz"))));
const entry = (name) => entries.find(item => item.id === receipt.id + "/" + name);
const plan = entry("plan"), historicalReviews = receipt.drafts.map((_,i) => entry("review/"+(i+1)));
function wire(item) {
  assert.equal(sha(item.request),item.requestSha256);
  const raw = gunzipSync(bytes(join(original,"wire",item.wireSha256+".json.gz")));
  assert.equal(sha(raw),item.wireSha256);
  return raw.toString("utf8");
}
[plan,...historicalReviews].forEach(wire);

await plugin({name:"historical-feedback-markdown",setup(build){
  build.onLoad({filter:/\.md(?:\?raw)?$/},async ({path}) => ({loader:"js",contents:"export default "+JSON.stringify(await Bun.file(path.replace(/\?raw$/u,"")).text())}));
}});
assert.equal(sha(bytes(join(study,"supplement/prediction/source-delta.json.gz"))),"b8887229f672005ad98dbb0678c9eb7ba32440b2595805ba255d5481ba4a3627");
assert.equal(sha(bytes(join(study,"feedback-v2.3.6/source-delta.json.gz"))),"31f2648ee87b9131b6a066acd4a0fa174ac7feaf038aeb7c05731cb528afeaee");
function restore(...args) {
  const restored=Bun.spawnSync(["rtk","proxy","python3","-I",...args],{stdout:"pipe",stderr:"pipe"});
  assert.equal(restored.exitCode,0,restored.stderr.toString());
  const directory=restored.stdout.toString().trim();
  assert(directory.startsWith(join(tmpdir(),"keating-final-classroom-")));
  return directory;
}
const oldProduct=restore(join(study,"supplement/source-delta.py"),"restore","prediction");
const currentProduct=restore(join(study,"feedback-v2.3.6/source.py"),"restore");
try {
  const before = await gate(oldProduct,"historical",receipt.prompt,receipt.drafts.map(d => d.message));
  const after = await gate(currentProduct,"capture",receipt.prompt,receipt.drafts.map(d => d.message));
  if (mode === "--verify-current-headless") {
    const present = await gate(resolve(here,"../../../../.."),"capture",receipt.prompt,receipt.drafts.map(d => d.message));
    assert.deepEqual(present.requests,after.requests);
    console.log(JSON.stringify({currentPolicy:present.policy,unchangedHeadlessInputs:present.requests.length,matchedFrozenPolicy:after.policy}));
  }
  assert.equal(before.policy, "keating-teaching-policy/v2.3.5");
  assert.equal(after.policy, "keating-teaching-policy/v2.3.6");
  assert.equal(before.snapshot.phase, receipt.disposition);
  assert.equal(before.snapshot.selectedAttempt, receipt.selectedAttempt);
  for (const [index,attempt] of before.snapshot.attempts.entries()) assert.deepEqual(attempt.checks,receipt.attempts[index].checks);
  assert.deepEqual(after.requests.map(r => r.state), before.requests.map(r => r.state));
  const changes = (a,b) => [...new Set([...Object.keys(a.questions),...Object.keys(b.questions)])].filter(id=>!Bun.deepEquals(a.questions[id],b.questions[id]));
  assert.deepEqual(changes(before.requests[0],after.requests[0]),["learner_response_due"]);
  const prior = receipt.attempts.map((a,i) => ({
    attempt:a.attempt,candidateSha256:sha(receipt.drafts[i].text),tools:receipt.drafts[i].toolCalls.map(k=>k.name),
    components:receipt.drafts[i].components,oldReviewSha256:historicalReviews[i].requestSha256,oldWireSha256:historicalReviews[i].wireSha256,
    result:a.status,blockers:a.checks.filter(before.blocksRelease).map(({id,status,probability,severity})=>({id,status,probability,severity})),
    newRequestSha256:sha(after.requests[i+1]),changedQuestions:changes(before.requests[i+1],after.requests[i+1]),
  }));
  assert.deepEqual(prior[0].changedQuestions,[]);
  assert.deepEqual(prior[1].changedQuestions,[]);
  assert.deepEqual(prior[2].changedQuestions,["checkpoint_answer_leaked","checkpoint_continued","checkpoint_attempt_state","checkpoint_feedback_support"]);
  const comparison = {version:1,oldPolicy:before.policy,newPolicy:after.policy,paidCalls:0,oldDisposition:before.snapshot.phase,
    oldSelectedAttempt:before.snapshot.selectedAttempt,oldLedgerSha256:sha(bytes(ledgerFile)),oldReceiptSha256:sha(bytes(receiptFile)),
    priorTutorReceiptSha256:receipt.parentReceiptSha256,learnerMessage:receipt.prompt,singleQuestion:parent.public.components,
    oldPlanRequestSha256:sha(before.requests[0]),newPlanRequestSha256:sha(after.requests[0]),changedPlanQuestions:["learner_response_due"],
    originalPlan:{attemptPresent:receipt.plan.decisions.attempt_present,learnerResponseDue:receipt.plan.features.learner_response_due,action:receipt.plan.action},
    newOutcome:null,note:"Request projection holds the archived plan answers fixed. New review questions have no historical response. Separate prospective study outcomes use their own plans and judgments.",candidates:prior};
  const cases = [{id:"archived-accurate-confirmation",provenance:"exact prior problem, learner answer and third tutor candidate",request:after.requests[3]}];
  const wrong = "I think square is the most likely, because there is one square tile.";
  const controls = [
    ["invented-confirmation",wrong,"Yes, square is more likely. One square outweighs three round tiles."],
    ["supported-correction",wrong,"Round is more likely. Three of the four tiles are round, so its chance is three quarters."],
    ["unanswered-new-item",receipt.prompt,"Round is the more likely shape. If the bag instead had four squares and one round tile, which shape would be more likely? It would be square."],
  ];
  for (const [id,prompt,text] of controls) {
    const prototype=structuredClone(receipt.drafts[2].message);
    prototype.content=[{type:"text",text}];
    const output=await gate(currentProduct,"capture",prompt,[prototype]);
    assert(output.requests[1].questions.checkpoint_attempt_state);
    cases.push({id,provenance:"authored control on the unchanged archived tutor question, unscored",request:output.requests[1]});
  }
  const requests={version:1,policy:after.policy,paidCalls:0,dispatch:false,
    note:"Captured fixed-review inputs using the normal web gate and an injected recorded plan. The independent prospective panel has its own preregistered candidates and fresh planning calls.",
    cases:cases.map(c=>({...c,requestSha256:sha(c.request)}))};
  function artifact(file,data) {
    if(mode==="--record") writeFileSync(join(here,file),JSON.stringify(data,null,2)+"\n",{flag:"wx"});
    else assert.deepEqual(data,json(join(here,file)),file);
  }
  artifact("baseline.json",comparison); artifact("requests.json",requests);
  console.log(JSON.stringify({verified:mode,oldDisposition:comparison.oldDisposition,attempts:prior.length,newOutcomes:0,projections:cases.length,
    priorFinalRaw:prior[2].blockers,questionChanges:prior.map(r=>r.changedQuestions.length),paidCalls:0}));
} finally {
  rmSync(oldProduct,{recursive:true,force:true});
  rmSync(currentProduct,{recursive:true,force:true});
}

async function gate(product,kind,prompt,candidates) {
  const from = path => import(join(product,path));
  const { withTeachingDraftGate } = await from("web/src/keating/judgement/draft-gate.ts");
  const { composeKeatingSystemPrompt } = await from("web/src/keating/browser-tools/prompt.ts");
  const { createAssistantMessageEventStream } = await from("node_modules/@earendil-works/pi-ai/dist/compat.js");
  const { createSystemOneCaller } = await from("packages/learner-contracts/src/judgement/system-one.ts");
  const { TEACHING_POLICY_VERSION:policy } = await from("packages/learner-contracts/src/judgement/teaching-policy-catalog.ts");
  const { blocksRelease } = await from("packages/learner-contracts/src/judgement/teaching-drafts/policy.ts");
  let snapshot,error,generated=0;
  const requests=[];
  async function replayAnswer(item,request) {
    const caller=createSystemOneCaller({apiKey:"offline",endpoint:pin.endpoint,model:pin.id,requireResolvedModel:true,
      retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0},fetch:async (url,init)=>{
        assert.equal(String(url),pin.endpoint);assert.equal(init.body,wire(item));
        return Response.json(item.response,{status:200});
      }});
    const out=await caller(request);assert(out.ok);return out;
  }
  async function judge(request) {
    try {
      requests.push(request);
      const isPlan=Boolean(request.questions.learning_task);
      if(kind==="historical") {
        const item=isPlan?plan:historicalReviews[generated-1];
        assert.deepEqual(request,item.request);
        return await replayAnswer(item,request);
      }
      if(isPlan) return await replayAnswer(plan,plan.request);
      // Reuse a historical response only when the entire request is unchanged.
      const identical=historicalReviews.find(q=>sha(request)===q.requestSha256);
      if(identical) return await replayAnswer(identical,request);
      return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    } catch (e) {error=e;throw e;}
  }
  const driver=withTeachingDraftGate(async()=>{
    const modelMessage=candidates[generated++];
    if(!modelMessage) throw Error("No further recorded candidate");
    const stream=createAssistantMessageEventStream();
    stream.push({type:"done",reason:modelMessage.stopReason,message:modelMessage});stream.end(modelMessage);
    return stream;
  },{sessionId:receipt.parent,basePrompt:()=>composeKeatingSystemPrompt(),makeCaller:()=>judge,maxAttempts:candidates.length,
    timeoutMs:10000,refinement:"ordinary",judgementModel:{id:pin.id,requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{snapshot=s;}});
  await (await driver(bundle.models.minimax,{systemPrompt:bundle.prompt,tools:bundle.tools,
    messages:[...receipt.originalHistory,{role:"user",content:prompt,timestamp:1}]},{})).result();
  if(error) throw error;
  assert.equal(requests.length,candidates.length+1);
  return {policy,blocksRelease,snapshot,requests};
}
