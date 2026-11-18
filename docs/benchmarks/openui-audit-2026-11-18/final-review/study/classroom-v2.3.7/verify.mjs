// Verify the sealed browser outcome when one incomplete paid draft closed transport before two local retry callbacks.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { cohort as primary, fileSha, here as study, read, save, sha, usd } from "../common.mjs";

const here=import.meta.dir,mode=process.argv[2]??"--verify";
assert(process.argv.length<=3 && ["--verify","--record"].includes(mode));
const cohort=read(join(here,"cohort.json")),manifest=read(join(here,"manifest.json")),summary=read(join(here,"summary.json")),ledger=read(join(here,"ledger.json"));
assert.equal(summary.manifestSha256,fileSha(join(here,"manifest.json")));assert.equal(ledger.manifestSha256,summary.manifestSha256);
for(const [path,expected] of Object.entries(manifest.code))assert.equal(fileSha(join(here,path)),expected,path);
assert.equal(fileSha(join(here,"source-delta.json.gz")),manifest.sourceDeltaSha256);
const prev=read(join(here,cohort.priorSummary));
assert.equal(fileSha(join(here,cohort.priorSummary)),cohort.priorSummarySha256);assert.equal(prev.totalBoundUsd,ledger.priorBoundUsd);
const parent=read(join(here,cohort.parentReceipt));assert.equal(fileSha(join(here,cohort.parentReceipt)),cohort.parentReceiptSha256);
const rowFile=join(here,"receipts",cohort.id+".json"),row=read(rowFile);
assert.equal(fileSha(rowFile),summary.receipts[cohort.id]);
const stage=read(join(here,"stage.json"));assert.equal(fileSha(join(here,"stage.json")),summary.stageSha256);assert.deepEqual(row.stagedPresentation,stage);
const [plan, paid]=ledger.entries;assert.equal(ledger.entries.length,2);assert.deepEqual(row.refs.map(r=>r.entryId),[plan.id]);assert.deepEqual(row.drafts.map(d=>d.entryId),[paid.id]);
assert.equal(plan.kind,"decision");assert.equal(paid.kind,"tutor");assert.equal(plan.model,cohort.decision);assert.equal(paid.model,cohort.tutor);
assert.equal(plan.http,200);assert.equal(paid.http,200);assert.equal(paid.status,"length");assert.equal(paid.usage.outputTokens,cohort.maxOutputTokens);
assert.deepEqual(paid.message,row.drafts[0].message);assert.equal(paid.message.stopReason,"length");assert(!row.drafts[0].completed);
assert(paid.reportedModels.includes(cohort.tutor));assert.equal(row.disposition,"withheld");assert.equal(row.public,null);assert.equal(row.notice,"withheld");
const ids=new Set(), wires=new Set();let cumul=prev.totalBoundUsd,peak=cumul;
for(const e of ledger.entries){
  assert(!ids.has(e.id));ids.add(e.id);const cfg=e.kind==="tutor"?primary.tutors.minimax:primary.judges.jev;
  const raw=gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz")));
  assert.equal(sha(raw),e.wireSha256);wires.add(e.wireSha256+".json.gz");
  const payload=JSON.parse(raw);assert.equal(payload.model,cfg.id);assert.equal(e.host,new URL(cfg.endpoint).host);
  assert.equal(e.path,e.kind==="tutor"?"/anthropic/v1/messages":new URL(cfg.endpoint).pathname);
  if(e.kind==="tutor"){
    assert.equal(payload.max_tokens,cohort.maxOutputTokens);
    const tools=(payload.tools??[]).map(t=>t.name);
    assert.deepEqual(tools,row.drafts[0].availableToolNames);assert(!tools.includes("grade_quiz")&&!tools.includes("grade_question_checks"));
  }
  assert.equal(e.reservedUsd,cfg.reserve);assert(e.usage && e.finishedAt);
  assert.equal(e.accountedUsd,usd((e.usage.inputTokens*cfg.input+e.usage.outputTokens*cfg.output)/1e6));
  peak=Math.max(peak,usd(cumul+e.reservedUsd));cumul=usd(cumul+e.accountedUsd);
}
assert.deepEqual(new Set(readdirSync(join(here,"wire"))),wires);
assert.equal(cumul,summary.totalBoundUsd);assert.equal(peak,summary.peakReservedUsd);
assert(peak<=cohort.globalCapUsd && peak<=usd(prev.totalBoundUsd+cohort.phaseMaximumAdditionalUsd));
const turn=plan.request.state.turn;
assert.equal(sha(plan.request),plan.requestSha256);assert.equal(turn.conversation.length,2);
assert.equal(turn.conversation.at(-1).content,parent.public.text);assert.equal(sha(parent.public.text),stage.parentPublicTextSha256);
assert(turn.learnerMessage.endsWith(cohort.learner));assert.equal(stage.pendingSubmissions,0);assert.equal((turn.pendingSubmissions??[]).length,0);
assert.equal(stage.openInteractions.length,1);const mounted=stage.openInteractions[0];
assert.equal(mounted.state,"awaiting");assert.equal(mounted.nodeId,"guess");assert.equal(mounted.component,"question-group");
assert.equal(turn.activeWork.openInteractions.length,1);
for(const key of ["documentId","nodeId","component","state"])assert.equal(turn.activeWork.openInteractions[0][key],mounted[key]);
assert.deepEqual(turn.previousQuestionPresentation,{assistantTurnIndex:1,documentId:mounted.documentId,nodeId:mounted.nodeId});
const restored=Bun.spawnSync(["rtk","proxy","python3","-I",join(here,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
assert.equal(restored.exitCode,0,restored.stderr.toString().slice(-600));
const product=restored.stdout.toString().trim(),scratch=mkdtempSync(join(tmpdir(),"keating-length-replay-"));
try{
  assert.equal(fileSha(join(study,"transport.mjs")),manifest.transportSha256);
  copyFileSync(join(study,"transport.mjs"),join(scratch,"transport.mjs"));writeFileSync(join(scratch,"common.mjs"),"export * from "+JSON.stringify(join(here,"environment.mjs"))+";\n");
  const {makeTransport}=await import(join(scratch,"transport.mjs"));
  const {runTeachingDrafts}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-drafts.ts"));
  const bundle=JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz"))));
  const transport=await makeTransport(product,bundle.models,false,true);
  let requests=0,logical=0,physical=0,transportClosed=false;
  const result=await runTeachingDrafts({turn,maxAttempts:cohort.maxDrafts,timeoutMs:90000,maxReasoning:row.attempts[0].reasoning,refinement:"ordinary",
    judgementModel:{id:cohort.decision,requestTokens:64000,stateQuestionTokens:32000},
    judge:async(req,signal)=>{
      assert.equal(++requests,1,"The browser completed no semantic candidate review");assert.equal(sha(req),plan.requestSha256);
      const {outcome}=await transport.decision("jev",req,plan.id,signal);assert(outcome.ok);return outcome;
    },
    generate:async()=>{
      logical++;
      if(transportClosed)throw Error("The sealed one-turn bridge declined a second physical generation");
      physical++;assert(row.drafts[0].message.stopReason==="length");transportClosed=true;
      throw Error("The web gate cannot review an incomplete provider draft");
    },
    check:()=>{throw Error("No candidate reached web tool validation");}
  });
  assert.equal(requests,1);assert.equal(logical,row.attempts.length);assert.equal(physical,row.drafts.length);assert.equal(logical,3);
  assert.equal(result.status,row.disposition);assert.equal(result.receipt.reason,row.releaseReason);
  assert.deepEqual(result.receipt.attempts.map(a=>[a.status,a.checks]),row.attempts.map(a=>[a.status,a.checks]));
  const evidence={id:row.id,policy:cohort.policy,sourceSha256:manifest.sourceDeltaSha256,verifierSha256:fileSha(import.meta.path),
    receiptSha256:fileSha(rowFile),ledgerSha256:fileSha(join(here,"ledger.json")),stageSha256:summary.stageSha256,
    genuineActiveQuestion:true,pendingSubmissions:0,physicalJevCalls:requests,physicalTutorCalls:physical,
    logicalGenerationAttempts:logical,localRetryRefusals:logical-physical,completeCandidates:0,candidateReviews:0,
    tutorStop:paid.status,tutorOutputTokens:paid.usage.outputTokens,publicReply:row.public,disposition:result.status,
    cumulativeBoundUsd:cumul,newProviderCalls:0};
  const output=join(here,"replay.json");
  if(mode==="--record")save(output,evidence);else assert.deepEqual(evidence,read(output));
  console.log(JSON.stringify(evidence));
}finally{rmSync(product,{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});}
