import assert from "node:assert/strict";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {gzipSync,gunzipSync} from "node:zlib";
import {plugin} from "bun";
import {audit,cohort,displayMessage,fileSha,here,lock,read,receiptFile,root,sanitizeMessage,save,sealReceipt,sha,sourceRoot,studyCells,total,usd,verifyPrior} from "./common.mjs";
import {makeTransport} from "./transport.mjs";
import {classroomBridge} from "./bridge.mjs";

const mode=process.argv[2]??"--dry";
assert(["--dry","--freeze","--execute","--verify","--classroom"].includes(mode) && process.argv.length<=3);
verifyPrior();
const live=mode==="--execute"||mode==="--classroom", manifestFile=join(here,"manifest.json"), bundleFile=join(here,"inputs.json.gz");
if(mode==="--dry"){console.log(JSON.stringify({primary:24,followupSlots:6,classroomSlots:1,priorBoundUsd:cohort.priorBoundUsd,budgetUsd:cohort.allStudyLimitUsd,network:0}));process.exit(0);}
if(live) lock();
const product=sourceRoot();
try {await main();}finally{rmSync(product,{recursive:true,force:true});}

async function main(){
  await plugin({name:"frozen-product-markdown",setup(b){b.onLoad({filter:/\.md(?:\?raw)?$/},async args=>({
    contents:"export default "+JSON.stringify(await Bun.file(args.path.replace(/\?raw$/u,"")).text()),loader:"js"}));}});
  const {withTeachingDraftGate}=await import(join(product,"web/src/keating/judgement/draft-gate.ts"));
  const {composeKeatingSystemPrompt}=await import(join(product,"web/src/keating/browser-tools/prompt.ts"));
  const {inspectOpenUIDiagnosticText}=await import(join(product,"web/src/keating/openui/diagnostic-components.ts"));
  const {parseReviewNotice}=await import(join(product,"web/src/keating/judgement/review-notice.ts"));
  const {projectTeachingPolicyDecision,TEACHING_POLICY_VERSION}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-policy.ts"));
  const {createAssistantMessageEventStream}=await import(join(product,"node_modules/@earendil-works/pi-ai/dist/compat.js"));
  assert.equal(TEACHING_POLICY_VERSION,cohort.policy);
  const sourceMeta=read(join(here,"product-v2.3.3.json")),base=composeKeatingSystemPrompt();
  assert.equal(fileSha(join(here,"product-v2.3.3.tar.gz")),sourceMeta.archiveSha256);
  const code=Object.fromEntries(["run.mjs","transport.mjs","bridge.mjs","common.mjs","source.py"].map(f=>[f,fileSha(join(here,f))]));
  if(mode==="--freeze"){
    assert(!existsSync(manifestFile)&&!existsSync(join(here,"ledger.json"))&&!existsSync(bundleFile));
    const dir=mkdtempSync(join(tmpdir(),"keating-final-prompt-"));
    try {
      const out=join(dir,"system.txt"), bin=Bun.spawnSync([process.execPath,join(product,"scripts/training/export_system_prompt.ts"),out],{cwd:product,stdout:"pipe",stderr:"pipe"});
      assert.equal(bin.exitCode,0,bin.stderr.toString().slice(-1000));const metadata=read(out+".metadata.json");
      assert(metadata.verifiedEqualToOriginalWebBuilder);
      const prompt=readFileSync(out,"utf8"), tools=read(join(dir,"tool-schemas.json")).map(x=>x.function);
      const {createBenchmarkRegistry}=await import(join(product,"scripts/prompt-adherence/providers.ts"));
      const registry=await createBenchmarkRegistry(join(root,".keating/pi-config")), models={};
      for(const [name,cfg] of Object.entries(cohort.tutors)){
        const m=registry.find(cfg.provider,cfg.id);assert(m && m.id===cfg.id && m.baseUrl===cfg.endpoint);
        models[name]=Object.fromEntries(["id","name","api","provider","baseUrl","reasoning","input","cost","contextWindow","maxTokens","compat"].filter(k=>m[k]!==undefined).map(k=>[k,m[k]]));
      }
      const old=read(join(audit,"policy-v2.3/manifest.json"));
      assert.equal(sha(base),old.baseSha256);assert.equal(sha(prompt),old.systemSha256);
      const oldTools=JSON.parse(gunzipSync(readFileSync(join(audit,"policy-v2.3/inputs.json.gz")))).tools;
      assert.equal(sha(oldTools),old.toolsSha256);
      const withoutPageProse=list=>list.map(tool=>tool.name==="interactive_page"?{...tool,description:""}:tool);
      assert.deepEqual(withoutPageProse(tools),withoutPageProse(oldTools));
      writeFileSync(bundleFile,gzipSync(JSON.stringify({prompt,tools,models})),{flag:"wx"});
      save(manifestFile,{version:1,createdAt:new Date().toISOString(),cohortSha256:fileSha(join(here,"cohort.json")),policy:TEACHING_POLICY_VERSION,
        sourceArchiveSha256:sourceMeta.archiveSha256,sourceDescriptorSha256:fileSha(join(here,"product-v2.3.3.json")),sourceCount:Object.keys(sourceMeta.files).length,
        code,bundleSha256:fileSha(bundleFile),baseSha256:sha(base),systemSha256:sha(prompt),toolsSha256:sha(tools),toolCount:tools.length,
        previousToolsSha256:old.toolsSha256,toolChangesSinceV23:sha(tools)===old.toolsSha256?[]:["interactive_page.description"],
        schedule:studyCells,priorBoundUsd:cohort.priorBoundUsd,priorLedgerSha256:fileSha(join(audit,"policy-v2.3.2-review/ledger.json"))});
      console.log(JSON.stringify({frozen:fileSha(manifestFile),source:sourceMeta.archiveSha256,system:sha(prompt),tools:tools.length,schedule:studyCells.length,network:0}));
    }finally{rmSync(dir,{recursive:true,force:true});}return;
  }
  const manifest=read(manifestFile);
  assert.deepEqual(manifest.code,code);assert.deepEqual(studyCells,manifest.schedule);assert.equal(manifest.cohortSha256,fileSha(join(here,"cohort.json")));
  assert.equal(manifest.sourceDescriptorSha256,fileSha(join(here,"product-v2.3.3.json")));assert.equal(manifest.bundleSha256,fileSha(bundleFile));
  const bundle=JSON.parse(gunzipSync(readFileSync(bundleFile)));assert.equal(sha(bundle.prompt),manifest.systemSha256);assert.equal(sha(bundle.tools),manifest.toolsSha256);
  const transport=await makeTransport(product,bundle.models,live,!live);
  function project(turn,out){const p=projectTeachingPolicyDecision(turn,out);return {status:p.status,action:p.interaction.action,
    offered:p.interaction.families.flatMap(f=>f.components),families:p.interaction.families,reason:p.interaction.reason??null,
    codePracticeLanguage:p.interaction.codePracticeLanguage??null,features:p.features,decisions:p.decisions,directives:p.directives};}
  const bridge=live&&!existsSync(receiptFile(cohort.classroom.id))?classroomBridge(transport,project,inspectOpenUIDiagnosticText,parseReviewNotice):null;
  const records=[];
  try {
    if(mode!=="--classroom") for(const cell of studyCells) {
      let row;
      if(live&&existsSync(receiptFile(cell.id))) row=read(receiptFile(cell.id));
      else {
        row=await runCell(cell);
        if(live) {sealReceipt(row); console.log(JSON.stringify({id:cell.id,status:row.disposition,drafts:row.drafts.length,components:row.public?.components,
          transportRows:transport.ledger.entries.length,bound:usd(cohort.priorBoundUsd+total(transport.ledger.entries))}));}
        else {
          const old=read(receiptFile(cell.id));
          const stable=r=>({id:r.id,disposition:r.disposition,public:r.public,publicEnvelope:r.publicEnvelope,plan:r.plan,
            drafts:r.drafts,selectedAttempt:r.selectedAttempt,attempts:r.attempts,missing:r.missing,refs:r.refs.map(({source,...ref})=>ref)});
          assert.deepEqual(stable(row),stable(old),cell.id);row=old;
        }
      }
      records.push(row);
    }
    if(live&&bridge){const start=Date.now();while(!bridge.progress.finished && Date.now()-start<15*60_000 && !transport.ledger.hardStop) await Bun.sleep(750);}
    await transport.drain();
    const classFile=receiptFile(cohort.classroom.id),classroom=existsSync(classFile)?read(classFile):null;
    if(mode==="--classroom" && !classroom) throw Error("Classroom receipt pending");
    if(mode==="--classroom") return;
    const d=transport.ledger.entries;
    const summary={id:cohort.id,policy:cohort.policy,protocolSha256:fileSha(manifestFile),
      scheduledPrimary:24,scheduledFollowup:6,classroom:{scheduled:1,sealed:!!classroom,disposition:classroom?.disposition??null},
      primaryObserved:records.filter(r=>r.kind==="primary"&&r.public).length,followupObserved:records.filter(r=>r.kind==="followup"&&r.public).length,
      counts:Object.fromEntries([...new Set(records.map(r=>r.disposition))].sort().map(k=>[k,records.filter(r=>r.disposition===k).length])),
      receipts:Object.fromEntries([...records,...(classroom?[classroom]:[])].map(r=>[r.id,fileSha(receiptFile(r.id))])),
      paidTransportRows:d.length,completedUsage:d.filter(e=>e.usage).length,usageMissing:d.filter(e=>!e.usage).length,
      knownUpperUsd:total(d.filter(e=>e.usage)),heldUpperUsd:total(d.filter(e=>!e.usage)),newBoundUsd:total(d),
      previousBoundUsd:cohort.priorBoundUsd,totalBoundUsd:usd(cohort.priorBoundUsd+total(d)),capUsd:cohort.allStudyLimitUsd,hardStop:transport.ledger.hardStop};
    assert(summary.totalBoundUsd<=cohort.allStudyLimitUsd);
    if(live) save(join(here,"summary.json"),summary);else assert.deepEqual(summary,read(join(here,"summary.json")));
    console.log(JSON.stringify({mode,rows:records.length,networkCalls:live?d.length:0,primaryObserved:summary.primaryObserved,accountedBound:summary.totalBoundUsd,classroom:summary.classroom}));
  }finally{bridge?.close();}
  async function runCell(cell){
    const model=bundle.models[cell.tutor], refs=[], drafts=[], messages=[], start=Date.now();
    let plan=null, last=null, failure=null,publicEnvelope=null,notice=null,publicRow=null,disposition,missing=null,reviewIndex=0;
    if(cell.parent){
      const parent=read(receiptFile(cell.parent));
      if(!parent.public || parent.public.toolCalls.length) {disposition="ineligible";missing=parent.public?"parent-native-tool-pending":"parent-has-no-public-answer";}
      else messages.push({role:"user",content:parent.prompt,timestamp:1},parent.public.message);
    }
    if(!disposition && transport.ledger.hardStop){disposition="budget-or-auth-stop";missing=transport.ledger.hardStop;}
    const history=structuredClone(messages);
    messages.push({role:"user",content:cell.prompt,timestamp:1});
    async function decision(req,signal){
      if(failure)return {ok:false,error:{code:"backend-unavailable",retryable:false}};
      const phase=req.questions.learning_task?"plan":req.questions.draft_choice?"selection":"review";
      const label=cell.id+"/"+phase+(phase==="review"?"/"+(++reviewIndex):"");
      const {outcome,ref}=await transport.decision(cell.arm,req,label,signal);
      refs.push(ref);if(!outcome.ok) failure=phase+"-"+outcome.error.code;
      else if(phase==="plan") plan=project(req.state.turn,outcome);
      return outcome;
    }
    const send=async(_model,context,opts={})=>{
      if(failure)throw Error("No additional calls after cell failure");
      const label=cell.id+"/tutor/"+(drafts.length+1);
      let generated;
      try {generated=await transport.tutor(cell.tutor,context,opts.reasoning??null,label,opts.signal);}
      catch(error){failure="tutor-transport-unavailable";throw error;}
      const {message,entry}=generated;
      const visible=displayMessage(message),complete=["stop","toolUse"].includes(message.stopReason);
      drafts.push({...visible,...inspectOpenUIDiagnosticText(visible.text),entryId:entry.id,completed:complete,
        providedDirectives:plan?plan.directives.every(d=>context.systemPrompt.includes("- "+d)):null,systemSha256:sha(context.systemPrompt)});
      if(!complete)failure="tutor-"+(entry.http??"transport")+"-"+message.stopReason;
      const stream=createAssistantMessageEventStream();
      if(complete)stream.push({type:"done",reason:message.stopReason,message});
      else stream.push({type:"error",reason:message.stopReason==="aborted"?"aborted":"error",error:message});
      stream.end(message);return stream;
    };
    if(!disposition){
      try {
        const ctx={systemPrompt:bundle.prompt,messages,tools:bundle.tools};
        const driver=cell.arm==="none"?send:withTeachingDraftGate(send,{sessionId:cell.id,basePrompt:()=>base,makeCaller:()=>decision,
          maxAttempts:cohort.maxDrafts,timeoutMs:cohort.turnTimeoutMs,refinement:"ordinary",judgementModel:{id:cohort.judges[cell.arm].id,requestTokens:64000,stateQuestionTokens:32000},
          onProgress:s=>{last=s;}});
        const stream=await driver(model,ctx,{});const m=sanitizeMessage(await stream.result());publicEnvelope=displayMessage(m);
        notice=parseReviewNotice(publicEnvelope.text);
        disposition=cell.arm==="none"?(failure?"provider-error":"ungated"):(last?.phase??"unknown");
        if(failure && disposition!=="released")disposition="provider-error";
        if(disposition==="released"||disposition==="ungated")publicRow={...publicEnvelope,...inspectOpenUIDiagnosticText(notice?.text??publicEnvelope.text)};
        if(!publicRow)missing=failure??last?.reason??disposition;
      }catch(error){disposition="provider-error";missing=failure??"generation-or-transport-unavailable";}
    }
    const attempts=(last?.attempts??[]).map(({generationMs,judgementMs,...rest})=>rest);
    return {id:cell.id,caseId:cell.caseId,kind:cell.kind,tutor:cell.tutor,arm:cell.arm,prompt:cell.prompt,originalHistory:history,plan,refs,drafts,attempts,
      selectedAttempt:cell.arm==="none"?(publicRow?1:null):last?.selectedAttempt??null,disposition,missing,public:publicRow,publicEnvelope,
      notice:notice?.kind??null,elapsedMs:Date.now()-start};
  }
}
