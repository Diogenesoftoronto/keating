import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assessTeachingPolicyAdherence, followsSingleFeedbackQuestion, teachingPolicyState } from "../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { TEACHING_POLICY_RULES, TEACHING_POLICY_THRESHOLDS, TEACHING_POLICY_VERSION } from "../../../packages/learner-contracts/src/judgement/teaching-policy-catalog.ts";
import { qualityFloors, blocksRelease } from "../../../packages/learner-contracts/src/judgement/teaching-drafts/policy.ts";
import { reviewAttemptedCheckpoint } from "../../../packages/learner-contracts/src/judgement/teaching-drafts/attempt-feedback.ts";
import { createSystemOneCaller } from "../../../packages/learner-contracts/src/judgement/system-one.ts";
import { decodeAnswer, decodeSystemOneResponse, encodeSystemOneRequest } from "../../../packages/learner-contracts/src/judgement/wire.ts";
import { credential, fileSha, read, save, sha, usd } from "../openui-audit-2026-11-18/final-review/study/common.mjs";

const here = import.meta.dir;
const labelsSha = "a43ce75f14bb415645cb846da2c4289841e9ddde1682edb66e8fa4ff9b4b995a";
assert.equal(fileSha(join(here, "cases.json")), labelsSha);
const panel = read(join(here, "cases.json"));
const earlier = read(join(here, "../openui-audit-2026-11-18/final-review/study/classroom-v2.3.8/ledger.json"));
const original = earlier.entries.find(e => e.id === panel.sourceReviewId);
assert.equal(sha(original.request), panel.sourceRequestSha256);
assert.equal(sha(JSON.stringify(encodeSystemOneRequest(original.request, panel.model))), panel.sourceWireSha256);
const prior = read(join(here, "../jev-parallel-pairs-2026-11-18/summary.json"));
const endpoint = "https://api.typesafe.ai/v1/systemone";
const reserve = .003, phaseCapUsd = .045, usdPerMillionInput = .042;
assert.equal(usd(panel.cases.length * reserve), phaseCapUsd);
assert.equal(prior.totalBoundUsd, 2.857201804);
assert(prior.totalBoundUsd + phaseCapUsd < prior.globalCapUsd);
assert.deepEqual([...new Set(panel.order)].sort(),panel.cases.map(c => c.id).sort());
const ledgerPath = join(here, "ledger.json"), summaryPath = join(here, "summary.json");
const mode = process.argv[2];
assert(["--plan", "--live", "--summarize", "--verify"].includes(mode) && process.argv.length === 3);

function requestFor(row) {
  const request = structuredClone(original.request);
  if (row.source !== "archived") {
    const scene = panel.sourceVariants[row.scene];
    const questionSource = '~~~openui lifecycle=ephemeral id=feedback-item\nroot = LearningSurface([guess], "Make a prediction", "Consider this one item.", "ephemeral")\nguess = Question([{ header: "Your answer", question: '
      + JSON.stringify(scene.question) + ', type: "text", allowText: true }], "ephemeral", "One item", "Give your answer.")\n~~~';
    const docId = "feedback-item", nodeId = "guess";
    const turn = { learnerMessage: row.learner ?? scene.learner,
      conversation: [{ role:"user", content:scene.request }, { role:"assistant", content:questionSource.replaceAll("~~~", String.fromCharCode(96).repeat(3)) }],
      learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment:"none", domain:"unknown", improvementRuns:0, pendingSubmissions:[],
      activeWork:{plan:null,focus:null,truncated:false,openInteractions:[{ documentId:docId,nodeId,component:"question-group",presentedAt:1,itemId:null,state:"awaiting" }]},
      previousQuestionPresentation:{assistantTurnIndex:1,documentId:docId,nodeId} };
    assert(followsSingleFeedbackQuestion(turn), row.id);
    request.state = { ...teachingPolicyState(turn), reply: {text:row.reply,toolCalls:[]} };
  }
  assert(followsSingleFeedbackQuestion(request.state.turn));
  assert.equal(request.state.reply.toolCalls.length, 0);
  request.questions[panel.questionId] = panel.question;
  return request;
}

const entries = panel.order.map(id => {
  const row = panel.cases.find(c => c.id === id), request = requestFor(row);
  return { row, request, wire: JSON.stringify(encodeSystemOneRequest(request, panel.model)) };
});
const plan = { labelsSha, policy:TEACHING_POLICY_VERSION, target:panel.model, candidates:entries.length, phaseCapUsd, priorBoundUsd:prior.totalBoundUsd };
if (mode === "--plan") {
  console.log(JSON.stringify({...plan,newRequests:0}));
  process.exit(0);
}

if (mode === "--live") {
  assert(!existsSync(ledgerPath), "A reservation already exists. Reconcile the existing ledger before another experiment.");
  const key = credential("TYPESAFE_API_KEY", "typesafe_api_key");
  assert(key, "Configured TypeSafe credential unavailable.");
  assert(entries.every(e => !e.wire.includes(key)));
  const ledger = { version:1, ...plan, entries:[] };
  writeFileSync(ledgerPath, JSON.stringify(ledger), {flag:"wx", mode:0o600});
  for (const {row,request,wire} of entries) {
    const entry = { id:row.id, wireSha256:sha(wire), requestSha256:sha(request), reservedUsd:reserve, accountedUsd:reserve,
      reservedAt:new Date().toISOString(), sentAt:null, finishedAt:null, http:null, usage:null, result:null, error:null };
    assert(usd(ledger.entries.reduce((sum,e) => sum+e.accountedUsd,0) + reserve) <= phaseCapUsd);
    ledger.entries.push(entry); save(ledgerPath,ledger);
    const call = createSystemOneCaller({model:panel.model, apiKey:key, requireResolvedModel:true,
      retry:{maxAttempts:1, initialDelayMs:0, maxDelayMs:0}, fetch:async (url,init) => {
        assert.equal(url,endpoint); assert.equal(init.body,wire); assert.equal(entry.sentAt,null);
        entry.sentAt = new Date().toISOString(); save(ledgerPath,ledger);
        const response = await fetch(url,{...init,redirect:"error"});
        entry.http = response.status;
        const raw = await response.text();
        entry.responseSha256 = sha(raw);
        if (response.ok) {
          assert(!raw.includes(key));
          const body = JSON.parse(raw);
          entry.result = {model:body.model, answers:body.answers, usage:body.usage};
        }
        return new Response(raw,{status:response.status});
      }});
    const outcome = await call(request,AbortSignal.timeout(35000));
    if (!outcome.ok) entry.error = outcome.error.code;
    else if (outcome.response.backend.model !== panel.model) entry.error = "unexpected-model";
    if (!entry.error && outcome.ok) {
      const usage = outcome.response.usage;
      if (usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens>0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens>=0) {
        entry.usage = usage;
        entry.accountedUsd = usd(usage.inputTokens * usdPerMillionInput / 1e6);
        assert(entry.accountedUsd<=reserve);
      }
    }
    entry.finishedAt = new Date().toISOString(); save(ledgerPath,ledger);
    if (entry.error) break;
  }
}

function choose(outcome, id) {
  const question = entries[0].request.questions[id];
  const answer = decodeAnswer(question,outcome.response.answers[id]);
  if (answer?.type !== "choice") return null;
  const expected = Object.keys(question.criteria), actual = Object.keys(answer.probabilities);
  if (actual.length !== expected.length || !expected.every(k => Object.hasOwn(answer.probabilities,k))
    || answer.probabilities[answer.choice] !== Math.max(...Object.values(answer.probabilities))) return null;
  return answer;
}

/** Apply all current checks. As a counterfactual, change just a measured gray mastery check to pass, then ask if the ordinary product would release. */
function evaluate(request,outcome,gray,scope) {
  const {turn,reply} = request.state;
  const all = structuredClone(outcome);
  if (gray !== null) all.response.answers.mastery_overclaimed = {type:"noul",noul:gray};
  const raw = all.response.answers.mastery_overclaimed?.noul;
  const observedGray = Number.isFinite(raw) && raw>TEACHING_POLICY_THRESHOLDS.passAtMost && raw<TEACHING_POLICY_THRESHOLDS.failAtLeast;
  const itemOnly = scope?.choice === "item_feedback" && scope.probabilities.item_feedback >= panel.gate.minimumItemProbability;
  const attempt = choose(outcome,"checkpoint_attempt_state"), support = choose(outcome,"checkpoint_feedback_support");
  const clear = a => a && Math.min(a.probabilities[a.choice],a.confidence)>=TEACHING_POLICY_THRESHOLDS.failAtLeast;
  const scoped = observedGray && itemOnly && clear(attempt) && attempt.choice==="answered" && clear(support)
    && ["grounded_confirmation","grounded_correction"].includes(support.choice) && !/[?？]/u.test(reply.text);
  function blockers(hypothesis) {
    const adjudication = structuredClone(all);
    if (hypothesis && scoped) adjudication.response.answers.mastery_overclaimed = {type:"noul",noul:0};
    const ruleIds = TEACHING_POLICY_RULES.filter(rule => Object.hasOwn(request.questions,rule.id)).map(rule=>rule.id);
    const checks = [...assessTeachingPolicyAdherence(turn,reply,adjudication,ruleIds).checks];
    for (const id of ["quality_progress","quality_scope"]) {
      const p = adjudication.response.answers[id]?.noul;
      checks.push({id,source:"jev",severity:"major",probability:Number.isFinite(p)?1-p:null,
        status:!Number.isFinite(p)?"unknown":p>=qualityFloors.concise?"pass":p<=.2?"fail":"unknown"});
    }
    reviewAttemptedCheckpoint(checks,adjudication,reply,turn.learnerMessage);
    return checks.filter(blocksRelease).map(c => c.id);
  }
  const before = blockers(false), after = blockers(true);
  return {mastery:raw,before,after,scoped:Boolean(scoped && !after.length)};
}

const ledger = read(ledgerPath);
assert.equal(ledger.labelsSha,labelsSha);
const rows = [];
for (const {row,request,wire} of entries) {
  const entry = ledger.entries.find(e=>e.id===row.id);
  if (!entry || entry.error || !entry.result) {rows.push({id:row.id,observed:false}); continue;}
  assert.equal(entry.wireSha256,sha(wire)); assert.equal(entry.requestSha256,sha(request));
  assert.equal(entry.result.model,panel.model);
  const decoded = decodeSystemOneResponse(request,entry.result);
  assert(decoded);
  const outcome = {ok:true,response:{backend:{backend:"system-one",model:decoded.model,calibrationSha256:null},answers:decoded.answers}};
  const scope = choose(outcome,panel.questionId);
  const grayOutcome = structuredClone(outcome);
  if (row.source==="archived") {
    // Preserve every original verdict on the failure that motivated the new question.
    const saved = decodeSystemOneResponse(original.request,original.response);
    grayOutcome.response.answers = {...saved.answers,[panel.questionId]:decoded.answers[panel.questionId]};
  }
  const gray = evaluate(request,grayOutcome,row.source==="archived"?null:.5,scope);
  const actual = evaluate(request,outcome,null,scope);
  rows.push({id:row.id,observed:true,model:decoded.model,category:row.category,
    scope:{choice:scope?.choice??null,pItem:scope?.probabilities.item_feedback??null,confidence:scope?.confidence??null},
    expectedGrayScope:row.expectGrayScope,gray,actual,wireSha256:sha(wire)});
}
const seen = rows.filter(r=>r.observed);
const positives = seen.filter(r=>r.expectedGrayScope), negatives = seen.filter(r=>!r.expectedGrayScope);
const admittedNegatives = negatives.filter(r=>r.gray.scoped).map(r=>r.id);
const claimsCalledItem = entries.filter(({row})=>row.mustRejectItemScope).map(({row})=>rows.find(r=>r.id===row.id))
  .filter(r=>r.observed && r.scope.choice==="item_feedback" && r.scope.pItem>=panel.gate.minimumItemProbability).map(r=>r.id);
const positivePasses = positives.filter(r=>r.gray.scoped).length;
const qualified = seen.length===panel.cases.length && rows.find(r=>r.id==="archived-tile-confirmation")?.gray?.scoped===true
  && positivePasses>=panel.gate.minimumPositivesIncludingDiscovery && !admittedNegatives.length && !claimsCalledItem.length;
const cost = usd(ledger.entries.reduce((n,e)=>n+e.accountedUsd,0));
const summary = { version:1, labelsSha, ledgerSha256:fileSha(ledgerPath), judged:seen.length, planned:entries.length,
  positivePasses, positives:positives.length, admittedNegatives, negatives:negatives.length, claimsCalledItem, qualified,
  newBoundUsd:cost,totalBoundUsd:usd(prior.totalBoundUsd+cost),invoiceUsd:null,rows };
if (mode === "--live" || mode === "--summarize") save(summaryPath,summary);
else assert.deepEqual(summary,read(summaryPath));
console.log(JSON.stringify({...summary,rows:rows.map(r=>[r.id,r.scope?.choice,r.scope?.pItem,r.gray?.scoped,r.gray?.after])}));
