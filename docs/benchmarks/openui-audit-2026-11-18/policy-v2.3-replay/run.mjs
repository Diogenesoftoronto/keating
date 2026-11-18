// Post-hoc, offline comparison. Only the original v2.2 planner answers and tutor bytes are provider evidence.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { plugin } from "bun";
import { createAssistantMessageEventStream } from "../../../../node_modules/@earendil-works/pi-ai/dist/compat.js";
import { compileOpenUISourceToSharedDocument } from "../../../../packages/learner-contracts/src/openui-source.ts";
import { prepareAssessmentOptOutDraft, projectTeachingPolicyDecision, teachingPolicyDecisionRequest, TEACHING_POLICY_VERSION } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { teachingDraftAnswers } from "../../../../packages/learner-contracts/test/fixtures/teaching-drafts.ts";
import { fileHash, read, sha } from "../gemini-decision/journal.mjs";

assert(process.argv.length <= 3 && ["--verify","--write"].includes(process.argv[2] ?? "--verify"));
if (TEACHING_POLICY_VERSION !== "keating-teaching-policy/v2.3" && (process.argv[2] ?? "--verify") === "--verify") {
  await import("./verify-with-frozen-source.mjs");
  process.exit(0);
}
assert.equal(TEACHING_POLICY_VERSION,"keating-teaching-policy/v2.3");
globalThis.fetch = async () => { throw Error("Post-hoc verification is offline"); };
const { measuredTransport } = await import("../policy-v2.2/transport.mjs");
await plugin({name:"offline-teaching-markdown",setup(b){
  b.onLoad({ filter:/\.md(?:\?raw)?$/ }, async args => ({contents:"export default " + JSON.stringify(await Bun.file(args.path.replace(/\?raw$/, "")).text()),loader:"js"}));
}});
const { withTeachingDraftGate } = await import("../../../../web/src/keating/judgement/draft-gate.ts");
const { composeKeatingSystemPrompt } = await import("../../../../web/src/keating/browser-tools/prompt.ts");
const { parseOpenUIMessageSegments } = await import("../../../../web/src/keating/openui/segments.ts");
const { inspectOpenUIDiagnosticText } = await import("../../../../web/src/keating/openui/diagnostic-components.ts");
const previous = file => join(import.meta.dir,"../policy-v2.2",file);
const ledgerFile = previous("ledger.json");
assert.equal(fileHash(ledgerFile),"9a073ec65bd4ff01e76779988a5965c9722cbce99e8996a39a1293c7c23e0883");
const ledger = read(ledgerFile), manifest = read(previous("manifest.json"));
const bundleFile = previous("inputs.json.gz");
assert.equal(fileHash(bundleFile),manifest.inputsSha256);
const bundle = JSON.parse(gunzipSync(readFileSync(bundleFile)));
const transport = measuredTransport(false,fileHash(previous("manifest.json")));
const observations = new Map(), planning = [];
const goal = directives => directives.some(text => text.includes("Capture the concrete goal"));
const pacing = directives => directives.some(text => text.includes("pacing request against the active plan"));

for (const caseId of ["conveyor","direct-label","account-seats"]) for (const provider of ["jev","google"]) {
  const id = caseId + "--" + provider, receiptFile = previous("receipts/" + id + ".json"), receipt = read(receiptFile);
  const original = ledger.entries.find(e => e.label === id + "/plan");
  assert(original?.request && original.http === 200 && sha(original.request) === original.requestSha256);
  const turn = original.request.state.turn;
  const planRequest = teachingPolicyDecisionRequest(turn);
  assert.deepEqual(planRequest.state,original.request.state);
  for (const [name,q] of Object.entries(planRequest.questions)) assert.deepEqual(original.request.questions[name],q);
  const outcome = await transport.decision(provider,"offline-placeholder",original.request,original.label);
  assert(outcome.ok);
  const plan = projectTeachingPolicyDecision(turn,outcome);
  const offered = plan.interaction.families.flatMap(family => family.components);
  assert.deepEqual(offered,receipt.plan.offered);
  planning.push({id, receiptSha256:fileHash(receiptFile), planRequestSha256:original.requestSha256, wireSha256:original.wireSha256,
    providerModel:original.model, goalProbability:outcome.response.answers.project_goal_requested.noul,
    offered, before:{goalDirective:goal(receipt.plan.directives), pacingDirective:pacing(receipt.plan.directives)},
    after:{goalDirective:goal(plan.directives), pacingDirective:pacing(plan.directives), goalToolPermitted:plan.allowedTools.includes("set_learner_goal")}});
  observations.set(id,{receipt,turn,outcome,plan,original});
}

const cell = observations.get("conveyor--google"), selected = cell.receipt.drafts[cell.receipt.selectedAttempt-1];
const tutorEntry = ledger.entries.find(e => e.id === selected.label);
const textOf = message => message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
const input = cell.receipt.public.text;
assert.equal(textOf(tutorEntry.message),input);
assert.equal(selected.text,input);
const candidate = prepareAssessmentOptOutDraft(cell.turn,cell.plan,{text:input,toolCalls:[]});
assert(candidate?.repaired && !candidate.imposed);
const repaired = candidate.reply.text;

function visible(text) {
  const segments = parseOpenUIMessageSegments(text);
  const blocks = segments.filter(seg => seg.type === "openui");
  assert.equal(blocks.length,1);
  const doc = compileOpenUISourceToSharedDocument(blocks[0].program,{documentId:blocks[0].metadata.id,createdAt:"2026-01-01T00:00:00.000Z"});
  assert.equal(doc.nodes.length,1);
  const node = doc.nodes[0];
  assert.equal(node.type,"simulation");
  const {brief, ...control} = node;
  return {control,brief,outside:segments.filter(seg => seg.type === "text").map(seg => seg.content),outsideWords:inspectOpenUIDiagnosticText(text).outsideWords};
}
const before = visible(input), after = visible(repaired);
assert.deepEqual(before.control,after.control);
assert.deepEqual(before.outside,after.outside);
assert.equal(before.outsideWords,143);
assert(before.brief.endsWith(after.brief) && !/predict:/i.test(after.brief));
const zeroUsage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const syntheticAssistant = text => ({role:"assistant",model:bundle.model.id,api:bundle.model.api,provider:bundle.model.provider,
  content:[{type:"text",text}],stopReason:"stop",timestamp:1,usage:zeroUsage});
function fixedTutor() {
  const stream = createAssistantMessageEventStream(), message = structuredClone(tutorEntry.message);
  stream.push({type:"done",reason:"stop",message}); stream.end(message); return stream;
}

async function replayWebGate(mode) {
  const fixture = mode === "passing-test-double";
  const backend = {backend:"fixture",model:"offline-app-contract",calibrationSha256:null};
  let last, reviewed, seenPlan, reviewRequest;
  const judge = async request => {
    if (request.questions.learning_task) {
      seenPlan = sha(request);
      assert.equal(seenPlan,cell.original.requestSha256,"The web host produced a different typed planning request");
      return fixture ? {...cell.outcome,response:{...cell.outcome.response,backend}} : cell.outcome;
    }
    assert(request.questions.declined_assessment_imposed && request.questions.quality_progress);
    reviewed = request.state.reply.text; reviewRequest = sha(request);
    assert.equal(reviewed,repaired);
    assert(!ledger.entries.some(entry => entry.requestSha256 === reviewRequest),"A new byte sequence reused an old review");
    if (!fixture) return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    return {ok:true,response:{backend,answers:teachingDraftAnswers(request)}};
  };
  const messages = [...cell.turn.conversation.map(m => m.role === "assistant" ? syntheticAssistant(m.content) : {...m,timestamp:1}),
    {role:"user",content:cell.turn.learnerMessage,timestamp:1}];
  const gate = withTeachingDraftGate(fixedTutor,{sessionId:"posthoc-fixed-conveyor-" + mode,basePrompt:composeKeatingSystemPrompt,
    maxAttempts:1,refinement:"ordinary",timeoutMs:12000,makeCaller:()=>judge,
    judgementModel:{id:fixture?backend.model:cell.original.model,requestTokens:64000,stateQuestionTokens:32000},onProgress:p=>{last=p;}});
  const message = await (await gate(bundle.model,{systemPrompt:bundle.prompt,messages,tools:bundle.tools})).result();
  assert.equal(seenPlan,cell.original.requestSha256);
  assert.equal(reviewed,repaired);
  const attempt = last.attempts[0];
  assert.equal(attempt.repairedAssessmentBrief,true);
  assert.equal(last.phase,fixture?"released":"withheld");
  if (fixture) assert.equal(textOf(message),repaired);
  else assert(!textOf(message).includes("carton spacing"));
  return {reviewSource:mode,status:last.phase,fixedDraftAttempts:last.attempts.length,
    reviewedSha256:sha(reviewed), reviewRequestSha256:reviewRequest, selectedSha256:fixture?sha(textOf(message)):null,
    repairedAssessmentBrief:attempt.repairedAssessmentBrief,preferenceChecks:attempt.checks.filter(c => c.id.startsWith("declined_assessment_"))};
}

const results = {version:1,policy:TEACHING_POLICY_VERSION,historicalPolicy:manifest.policy,
  networkRequests:0,newProviderReviews:0,newTutorGenerations:0,incrementalUsd:0,planning,
  conveyor:{caseId:cell.receipt.id,historicalStatus:cell.receipt.status,historicalSelectedAttempt:cell.receipt.selectedAttempt,
    originalTutor:bundle.model.id, originalReviewer:cell.original.model, sourceSha256:sha(input), candidateSha256:sha(repaired),
    outsideWords:after.outsideWords, outsideByteIdentical:true, controlsByteIdentical:true, control:after.control,
    beforeBrief:before.brief, afterBrief:after.brief, proposedReply:repaired, freshProviderRelease:null,
    realHostRuns:[await replayWebGate("no-review-available"),await replayWebGate("passing-test-double")]}};
assert.equal(planning.filter(row=>row.before.goalDirective).length,6);
assert.equal(planning.filter(row=>row.after.goalDirective||row.after.goalToolPermitted).length,0);
const output = join(import.meta.dir,"replay.json");
if (process.argv[2] === "--write") writeFileSync(output,JSON.stringify(results,null,2)+"\n",{flag:"wx"});
else assert.deepEqual(results,read(output));
console.log(JSON.stringify({planning:planning.length,goalDirectives:"6 to 0",control:after.control.type,
  trimmedCharacters:input.length-repaired.length,outsideWords:after.outsideWords,web:results.conveyor.realHostRuns.map(r=>[r.reviewSource,r.status]),
  freshProviderReview:null,networkRequests:0}));
