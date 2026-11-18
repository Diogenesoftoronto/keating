// The v2.3.4 baseline runner is sealed. This prediction driver also retains the actual contextual tool list and terminal selection rule.
import assert from "node:assert/strict";
import {existsSync,readFileSync,writeFileSync,copyFileSync,mkdirSync,rmSync,mkdtempSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {gunzipSync} from "node:zlib";
import {plugin} from "bun";
import {cohort as primary,here as study,sha,fileSha,read,save,lock,total,usd,displayMessage,sanitizeMessage} from "../common.mjs";

const [name,mode]=process.argv.slice(2), live=mode==="--execute";
assert(process.argv.length===4 && name==="prediction" && ["--freeze","--execute","--verify"].includes(mode));
if(live) lock();
const dir=import.meta.dir,here=join(dir,name),prospective=read(join(dir,"cohort.json")),phase=prospective.phases.find(p=>p.id===name);
const surface=join(here,"source-delta.json.gz"),meta=JSON.parse(gunzipSync(readFileSync(surface)));
const priorSummary=name==="coding"?join(study,"summary.json"):join(dir,"coding","summary.json");
const previous=read(priorSummary);
assert.equal(fileSha(join(study,"summary.json")),"b9858b46d39d02955363dfdfddd00958612e3b64e8523ee4fe962100e781a5b1");
assert.equal(fileSha(join(study,"ledger.json")),"a7ecb679c0679b6c084414723858c734688c185a9f8ca85fed05ffad2f94d980");
assert.equal(fileSha(join(study,"transport.mjs")),"52fd04074a7bec220e806108720f5b0a78b9ac0f7d8ad4c41d386dc468f0e560");
const restored=Bun.spawnSync(["rtk","proxy","python3","-I",join(dir,"source-delta.py"),"restore",name],{stdout:"pipe",stderr:"pipe"});
assert.equal(restored.exitCode,0,restored.stderr.toString().slice(-800));const product=restored.stdout.toString().trim();
const temp=mkdtempSync(join(tmpdir(),"keating-final-probe-"));
try{await run();}finally{rmSync(temp,{recursive:true,force:true});rmSync(product,{recursive:true,force:true});}

async function run(){
  await plugin({name:"frozen-supplement-markdown",setup(b){b.onLoad({filter:/\.md(?:\?raw)?$/},async args=>({
    contents:"export default "+JSON.stringify(await Bun.file(args.path.replace(/\?raw$/u,"")).text()),loader:"js"}));}});
  const {withTeachingDraftGate}=await import(join(product,"web/src/keating/judgement/draft-gate.ts"));
  const {composeKeatingSystemPrompt}=await import(join(product,"web/src/keating/browser-tools/prompt.ts"));
  const {inspectOpenUIDiagnosticText}=await import(join(product,"web/src/keating/openui/diagnostic-components.ts"));
  const {parseReviewNotice}=await import(join(product,"web/src/keating/judgement/review-notice.ts"));
  const {projectTeachingPolicyDecision,TEACHING_POLICY_VERSION}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-policy.ts"));
  const {createAssistantMessageEventStream}=await import(join(product,"node_modules/@earendil-works/pi-ai/dist/compat.js"));
  assert.equal(TEACHING_POLICY_VERSION,meta.policy);
  const bundle=JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz")))), base=composeKeatingSystemPrompt();
  const hashes=Object.fromEntries(["cohort.json","phase-environment.mjs","source-delta.py","run.mjs","prediction-driver.mjs"].map(f=>[f,fileSha(join(dir,f))]));
  const metadata={version:1,phase:name,policy:meta.policy,sourceDeltaSha256:fileSha(surface),sourceBaseSha256:meta.baseArchiveSha256,
    codeAndCohort:hashes,exactTransportSha256:fileSha(join(study,"transport.mjs")),priorSummarySha256:fileSha(priorSummary),
    priorBoundUsd:previous.totalBoundUsd,capUsd:prospective.studyCapUsd,baseSha256:sha(base),systemSha256:sha(bundle.prompt),
    toolsSha256:sha(bundle.tools),schedule:phase.schedule};
  const manifest=join(here,"manifest.json");
  if(mode==="--freeze"){
    assert(!existsSync(manifest)&&!existsSync(join(here,"ledger.json")));
    const output=join(temp,"system.txt"), ex=Bun.spawnSync([process.execPath,join(product,"scripts/training/export_system_prompt.ts"),output],{cwd:product,stdout:"pipe",stderr:"pipe"});
    assert.equal(ex.exitCode,0,ex.stderr.toString().slice(-800));assert(read(output+".metadata.json").verifiedEqualToOriginalWebBuilder);
    assert.equal(readFileSync(output,"utf8"),bundle.prompt);assert.deepEqual(read(join(temp,"tool-schemas.json")).map(t=>t.function),bundle.tools);
    save(manifest,metadata);console.log(JSON.stringify({frozen:phase.id,policy:meta.policy,sourceSha256:metadata.sourceDeltaSha256,scheduled:phase.schedule.length,priorBoundUsd:metadata.priorBoundUsd,network:0}));return;
  }
  assert.deepEqual(read(manifest),metadata);
  // Import the unmodified primary transport from a private directory with only its phase-config import rebound.
  copyFileSync(join(study,"transport.mjs"),join(temp,"transport.mjs"));
  writeFileSync(join(temp,"common.mjs"),"export * from "+JSON.stringify(join(dir,"phase-environment.mjs"))+";\n");
  const {makeTransport}=await import(join(temp,"transport.mjs"));
  const transport=await makeTransport(product,bundle.models,live,!live),rows=[];
  for(const [caseId,arm] of phase.schedule){
    const id=caseId+"--minimax--"+arm,file=join(here,"receipts",id+".json");
    let row;
    if(live&&existsSync(file)){row=read(file);}
    else{
      row=await cell(caseId,arm,id);
      if(live){save(file,row);console.log(JSON.stringify({id,disposition:row.disposition,drafts:row.drafts.length,refs:row.refs.length,currentUpper:usd(previous.totalBoundUsd+total(transport.ledger.entries))}));}
      else {const original=read(file);const stable=value=>({...value,refs:value.refs.map(({source,...rest})=>rest)});assert.deepEqual(stable(row),stable(original),id);row=original;}
    }rows.push(row);
  }
  await transport.drain();
  const es=transport.ledger.entries;
  for(const e of es){
    assert.equal(sha(gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz")))),e.wireSha256);
    if(e.usage){const cfg=[...Object.values(primary.judges),...Object.values(primary.tutors)].find(c=>c.id===e.model);
      assert.equal(usd((e.usage.inputTokens*cfg.input+e.usage.outputTokens*cfg.output)/1e6),e.accountedUsd);}
    else assert.equal(e.accountedUsd,e.reservedUsd);
    assert(e.accountedUsd<=e.reservedUsd);
  }
  const summary={version:1,phase:name,policy:meta.policy,protocolSha256:fileSha(manifest),receipts:Object.fromEntries(rows.map(r=>[r.id,fileSha(join(here,"receipts",r.id+".json"))])),
    scheduled:rows.length,publicReplies:rows.filter(r=>r.public).length,providerRequests:es.length,unknownUsage:es.filter(e=>!e.usage).length,
    previousBoundUsd:previous.totalBoundUsd,newBoundUsd:total(es),totalBoundUsd:usd(previous.totalBoundUsd+total(es)),capUsd:prospective.studyCapUsd};
  assert(summary.totalBoundUsd<=summary.capUsd);
  if(live)save(join(here,"summary.json"),summary);else assert.deepEqual(summary,read(join(here,"summary.json")));
  console.log(JSON.stringify({mode,...summary,newProviderCalls:live?es.length:0}));

  async function cell(caseId,arm,id){
    const c=prospective.cases.find(c=>c.id===caseId),refs=[],drafts=[];let plan=null,last=null,failure=null,i=0;
    const ctx={systemPrompt:bundle.prompt,tools:bundle.tools,messages:[{role:"user",content:c.learner,timestamp:1}]};
    const judge=async(req,signal)=>{
      if(failure)return{ok:false,error:{code:"backend-unavailable",retryable:false}};
      const stage=req.questions.learning_task?"plan":req.questions.draft_choice?"selection":"review";
      const {outcome,ref}=await transport.decision(arm,req,id+"/"+stage+(stage==="review"?"/"+(++i):""),signal);refs.push(ref);
      if(!outcome.ok) failure=stage+"-"+outcome.error.code;
      else if(stage==="plan"){const p=projectTeachingPolicyDecision(req.state.turn,outcome);plan={status:p.status,action:p.interaction.action,
        offered:p.interaction.families.flatMap(f=>f.components),features:p.features,decisions:p.decisions,directives:p.directives,
        codePracticeLanguage:p.interaction.codePracticeLanguage??null,reason:p.interaction.reason??null};}
      return outcome;
    };
    const tutor=async(_model,context,opts={})=>{
      if(failure)throw Error("Cell already stopped");
      let generated;try{generated=await transport.tutor("minimax",context,opts.reasoning??null,id+"/tutor/"+(drafts.length+1),opts.signal);}
      catch(error){failure="tutor-transport-unavailable";throw error;}
      const {message,entry}=generated,visible=displayMessage(message),complete=["stop","toolUse"].includes(message.stopReason);
      drafts.push({...visible,...inspectOpenUIDiagnosticText(visible.text),entryId:entry.id,completed:complete,
        availableToolNames:(context.tools??[]).map(t=>t.name),providedDirectives:plan?plan.directives.every(d=>context.systemPrompt.includes("- "+d)):null,systemSha256:sha(context.systemPrompt)});
      const stream=createAssistantMessageEventStream();
      if(complete)stream.push({type:"done",reason:message.stopReason,message});
      else{failure="tutor-"+(entry.http??"transport")+"-"+message.stopReason;stream.push({type:"error",reason:"error",error:message});}
      stream.end(message);return stream;
    };
    const gate=withTeachingDraftGate(tutor,{sessionId:id,makeCaller:()=>judge,basePrompt:()=>base,maxAttempts:prospective.maxDrafts,
      timeoutMs:prospective.outerTimeoutMs,refinement:"ordinary",judgementModel:{id:primary.judges[arm].id,requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{last=s;}});
    const stream=await gate(bundle.models.minimax,ctx,{}),m=sanitizeMessage(await stream.result()), envelope=displayMessage(m),notice=parseReviewNotice(envelope.text);
    const phase=last?.phase??"unknown",disposition=failure&&phase!=="released"?"provider-error":phase;
    return {id,caseId,tutor:"minimax",arm,kind:"prospective-supplement",policy:meta.policy,prompt:c.learner,originalHistory:[],plan,refs,drafts,
      attempts:(last?.attempts??[]).map(({generationMs,judgementMs,...rest})=>rest),selectedAttempt:last?.selectedAttempt??null,
      selectionRule:last?.selectionRule??null,releaseReason:last?.reason??null,
      disposition,missing:disposition==="released"?null:failure??last?.reason??phase,public:disposition==="released"?{...envelope,...inspectOpenUIDiagnosticText(notice?.text??envelope.text)}:null,
      publicEnvelope:envelope,notice:notice?.kind??null};
  }
}
