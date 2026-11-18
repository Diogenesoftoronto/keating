// Apply prevously metered Jev answers to identical old and new product planning inputs, without a provider call.
import assert from "node:assert/strict";
import {copyFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {fileSha,here as study,read,save,sha} from "../common.mjs";
const here=import.meta.dir,oldDir=join(study,"classroom-v2.3.7"),mode=process.argv[2];
assert(process.argv.length===3 && ["--record","--verify"].includes(mode));
const old=read(join(oldDir,"receipts","classroom-tile-confirm--minimax--jev.json"));
const ledger=read(join(oldDir,"ledger.json")),planEntry=ledger.entries.find(e=>e.kind==="decision"),tutorEntry=ledger.entries.find(e=>e.kind==="tutor");
assert.equal(fileSha(join(oldDir,"ledger.json")),"f00f2c044c93208189f4c67eab0b553e0fa12949bce09cc7b21dce6cced7ba54");
assert.equal(planEntry.requestSha256,"0bdf4738bffd87d835c8c05f4e3dcb17185e627b3b49caaa812d50f0beb3b004");
function raw(entry){const b=gunzipSync(readFileSync(join(oldDir,"wire",entry.wireSha256+".json.gz")));assert.equal(sha(b),entry.wireSha256);return JSON.parse(b);}
const previousQuestion=planEntry.request.state.turn.previousQuestionPresentation,active=planEntry.request.state.turn.activeWork.openInteractions[0];
assert.equal(previousQuestion.documentId,active.documentId);assert.equal(previousQuestion.nodeId,active.nodeId);
assert.equal(active.state,"awaiting");assert.equal((planEntry.request.state.turn.pendingSubmissions??[]).length,0);
const oldFalse=old.plan.directives.find(v=>v.includes("has not yet answered"));assert(oldFalse);assert.equal(old.plan.features.learner_response_due,false);
const actual=raw(tutorEntry),system=Array.isArray(actual.system)?actual.system.map(p=>p.text??"").join("\n"):actual.system;
assert(system.includes(oldFalse));assert.equal(raw(planEntry).model,planEntry.model);
const bundle=JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz"))));
const evidence=[];
for(const directory of [oldDir,here]){
  const restored=Bun.spawnSync(["rtk","proxy","python3","-I",join(directory,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
  assert.equal(restored.exitCode,0,restored.stderr.toString().slice(-800));const product=restored.stdout.toString().trim();
  const scratch=mkdtempSync(join(tmpdir(),"keating-prior-plan-projection-"));
  try{
    copyFileSync(join(study,"transport.mjs"),join(scratch,"transport.mjs"));
    writeFileSync(join(scratch,"common.mjs"),"export * from "+JSON.stringify(join(oldDir,"environment.mjs"))+";\n");
    const {makeTransport}=await import(join(scratch,"transport.mjs")),transport=await makeTransport(product,bundle.models,false,true);
    const {runTeachingDrafts}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-drafts.ts"));
    const {TEACHING_POLICY_VERSION,projectTeachingPolicyDecision}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-policy.ts"));
    let calls=0,firstPrompt=null,plan=null;
    await runTeachingDrafts({turn:planEntry.request.state.turn,refinement:"ordinary",maxAttempts:1,timeoutMs:20000,maxReasoning:old.attempts[0].reasoning,
      judgementModel:{id:planEntry.model,requestTokens:64000,stateQuestionTokens:32000},
      judge:async(req,signal)=>{assert.equal(++calls,1);assert.deepEqual(req,planEntry.request);assert.equal(sha(req),planEntry.requestSha256);
        const {outcome}=await transport.decision("jev",req,planEntry.id,signal);assert(outcome.ok&&outcome.response.backend.model===planEntry.model);
        plan=projectTeachingPolicyDecision(req.state.turn,outcome);return outcome;},
      generate:async(input)=>{assert.equal(firstPrompt,null);firstPrompt=input.systemPrompt;throw Error("Offline first-prompt capture");}
    });
    assert.equal(calls,1);assert(firstPrompt&&plan);assert.equal(plan.features.learner_response_due,false);
    assert(plan.directives.every(d=>firstPrompt.includes("- "+d)));
    evidence.push({policy:TEACHING_POLICY_VERSION,sourceSha256:fileSha(join(directory,"source-delta.json.gz")),
      directives:plan.directives,action:plan.interaction.action,offered:plan.interaction.families.flatMap(f=>f.components),
      actualPolicyPromptSha256:sha(firstPrompt),sentOnEarlierTutorWire:system.includes(firstPrompt),containsFalseDirective:firstPrompt.includes(oldFalse)});
  }finally{rmSync(product,{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});}
}
assert.equal(evidence[0].policy,"keating-teaching-policy/v2.3.7");assert.equal(evidence[1].policy,"keating-teaching-policy/v2.3.8");
assert(evidence[0].containsFalseDirective && evidence[0].sentOnEarlierTutorWire && !evidence[1].containsFalseDirective);
const result={planRequestSha256:planEntry.requestSha256,planWireSha256:planEntry.wireSha256,oldTutorWireSha256:tutorEntry.wireSha256,
  learnerResponseDue:old.plan.features.learner_response_due,rawJevAnswer:planEntry.response.answers.learner_response_due??null,
  earlierFalseDirective:oldFalse,activePresentation:previousQuestion,versions:evidence,correctedOnSameInput:true,
  currentSourceSha256:evidence[1].sourceSha256,verifierSha256:fileSha(import.meta.path),newProviderCalls:0};
const output=join(here,"old-plan.json");
if(mode==="--record")save(output,result);else assert.deepEqual(result,read(output));
console.log(JSON.stringify({mode,correctedOnSameInput:true,planWireSha256:planEntry.wireSha256,newProviderCalls:0}));
