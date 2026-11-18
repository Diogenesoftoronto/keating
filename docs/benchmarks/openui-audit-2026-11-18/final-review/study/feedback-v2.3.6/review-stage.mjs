// Offline fixed-input adjudication. The planning and reviewing sessions each see one genuine provider identity.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileSha, here as study, read, save, sha } from "../common.mjs";

const here=import.meta.dir, mode=process.argv[2];
assert(process.argv.length===3 && ["--record","--verify"].includes(mode));
const manifest=read(join(here,"manifest.json")), summary=read(join(here,"summary.json")), protocol=read(join(here,"cohort.json"));
assert.equal(summary.manifestSha256,fileSha(join(here,"manifest.json")));
assert.equal(manifest.sourceDeltaSha256,fileSha(join(here,"source-delta.json.gz")));
assert.equal(sha(readFileSync(join(study,"transport.mjs"))),manifest.transportSha256);
const result=Bun.spawnSync(["rtk","proxy","python3","-I",join(here,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
assert.equal(result.exitCode,0,result.stderr.toString().slice(-800));
const product=result.stdout.toString().trim(),scratch=mkdtempSync(join(tmpdir(),"keating-review-stage-"));
try {await project();} finally {rmSync(product,{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});}

async function project() {
  copyFileSync(join(study,"transport.mjs"),join(scratch,"transport.mjs"));
  writeFileSync(join(scratch,"common.mjs"),"export * from "+JSON.stringify(join(here,"environment.mjs"))+";\n");
  const {makeTransport}=await import(join(scratch,"transport.mjs"));
  const {TeachingDraftSession}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-drafts/session.ts"));
  const bundle=JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz"))));
  const transport=await makeTransport(product,bundle.models,false,true);
  const rows=[];
  for(const [id,arm] of protocol.reviewOrder) {
    const label=["review",id,arm].join("--"), fixed=read(join(here,"receipts",label+".json"));
    assert.equal(fileSha(join(here,"receipts",label+".json")),summary.receipts[label]);
    const planRef=fixed.refs.find(r=>r.stage==="plan"),reviewRef=fixed.refs.find(r=>r.stage==="review");
    if(!planRef?.ok||!reviewRef?.ok||!fixed.attempts?.length){rows.push({id,arm,status:null,missing:"review-unavailable"});continue;}
    const preflight=transport.ledger.entries.find(e=>e.id===planRef.entryId);
    const wire=transport.ledger.entries.find(e=>e.id===reviewRef.entryId);
    assert.equal(preflight.model,protocol.models.jev);assert.equal(wire.model,protocol.models[arm]);
    const turn=preflight.request.state.turn,reply=wire.request.state.reply;
    assert.deepEqual(turn,wire.request.state.turn);assert.equal(sha(reply.text),fixed.fixedCandidateSha256);assert.deepEqual(reply.toolCalls,[]);
    const previous=fixed.attempts[0],schemaChecks=previous.checks.filter(c=>c.id==="runtime_tool_schema");
    assert.equal(schemaChecks.length,1);assert.equal(schemaChecks[0].source,"deterministic");assert.equal(schemaChecks[0].status,"pass");
    const common={turn,refinement:"ordinary",maxAttempts:1,timeoutMs:30000,maxReasoning:previous.reasoning,
      // These exact candidates have no native tool calls. Preserve the result of the original web schema validator.
      check:()=>structuredClone(schemaChecks),generate:()=>{throw Error("Fixed review never generates a tutor reply");}};
    const planner=new TeachingDraftSession({...common,judgementModel:{id:protocol.models.jev,requestTokens:64000,stateQuestionTokens:32000},
      judge:async(req,signal)=>{
        assert.equal(sha(req),preflight.requestSha256);
        const {outcome}=await transport.decision("jev",req,preflight.id,signal);
        assert(outcome.ok && outcome.response.backend.model===protocol.models.jev);return outcome;
      }});
    let planned,standard,reasoning;
    try {
      planned=await planner.plan(); assert(planned);
      standard=planner.context.standard;reasoning=planner.context.reasoning;
      assert.equal(standard,previous.standard);assert.equal(reasoning,previous.reasoning);
    } finally {planner.dispose();}
    const reviewer=new TeachingDraftSession({...common,judgementModel:{id:protocol.models[arm],requestTokens:64000,stateQuestionTokens:32000},
      judge:async(req,signal)=>{
        assert.equal(sha(req),wire.requestSha256,"Exact product-generated review request differs");assert.deepEqual(req,wire.request);
        const {outcome}=await transport.decision(arm,req,wire.id,signal);
        assert(outcome.ok && outcome.response.backend.model===protocol.models[arm]);return outcome;
      }});
    try {
      assert.equal(reviewer.context.judgeIdentity,null);
      reviewer.context.standard=standard;reviewer.context.reasoning=reasoning;reviewer.context.attempt=1;
      const ev=await reviewer.reviewCandidate(reply,planned.plan,previous.variant,0,false,planned.reviewScope,{},null);
      assert.equal(reviewer.context.judgeModel,protocol.models[arm]);
      const attempt=reviewer.context.attempts[0];
      if(arm==="jev"){
        assert.equal(ev.status,previous.status);
        assert.deepEqual(attempt.checks,previous.checks);
        assert.deepEqual(attempt.attemptedCheckpointFeedback,previous.attemptedCheckpointFeedback);
      }
      const evidence={};
      for(const key of ["checkpoint_attempt_state","checkpoint_feedback_support","checkpoint_answer_leaked","checkpoint_continued"]){
        evidence[key]={asked:Object.hasOwn(wire.request.questions,key),answer:wire.response.answers[key]??null};
      }
      const expected=["authentic-confirmation","wrong-corrected"].includes(id)?"pass":"fail";
      rows.push({id,arm,model:wire.model,provenance:reviewRef.provenance??"provider-reported-model",requestSha256:wire.requestSha256,wireSha256:wire.wireSha256,
        expected,reviewStatus:ev.status,expectedStrictStatus:ev.status===expected,raw:evidence,
        contextualProjection:attempt.attemptedCheckpointFeedback??null,checks:attempt.checks,blocking:ev.blocking,
        originalFullSession:{disposition:fixed.disposition,status:previous.status,releaseReason:fixed.releaseReason,
          sameJudgeThroughout:arm==="jev"},proof:"isolated-review-stage"});
    } finally {reviewer.dispose();}
  }
  const paired=Object.fromEntries(protocol.reviewCases.map(c=>{
    const a=rows.filter(x=>x.id===c.id);assert.equal(a.length,2);
    const available=a.filter(x=>x.requestSha256);
    if(available.length===2)assert.equal(available[0].requestSha256,available[1].requestSha256);
    return [c.id,available.length===2?available[0].requestSha256:null];
  }));
  const result={version:1,policy:manifest.policy,manifestSha256:summary.manifestSha256,ledgerSha256:fileSha(join(here,"ledger.json")),
    codeSha256:fileSha(import.meta.path),sameInput:paired,reviewed:rows.filter(r=>r.reviewStatus).length,
    matchedStrictStatus:rows.filter(r=>r.expectedStrictStatus).length,rows,newProviderCalls:0};
  const output=join(here,"review-stage.json");
  if(mode==="--record")save(output,result);else assert.deepEqual(result,read(output));
  console.log(JSON.stringify({mode,pairs:Object.values(paired).filter(Boolean).length,strict:result.matchedStrictStatus,reviewed:result.reviewed,
    dispositions:rows.map(r=>[r.id,r.arm,r.reviewStatus]),newProviderCalls:0}));
}
