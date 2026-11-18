import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { plugin } from "bun";
import { cohort as primary, displayMessage, fileSha, here as study, lock, read, sanitizeMessage, save, sha, total, usd } from "../common.mjs";

const here=import.meta.dir, mode=process.argv[2], live=mode==="--execute";
assert.equal(process.argv.length,3);
assert(["--freeze","--execute","--verify","--dry"].includes(mode));
const cfg=read(join(here,"cohort.json")), cohortHash="f7f29a12cfb4f3f1c11922f9dd495204e1f466903c490e2c485493dbe0bbe427";
assert.equal(fileSha(join(here,"cohort.json")),cohortHash);
const priorDir=join(study,"supplement","addendum"), prior=read(join(priorDir,"summary.json"));
assert.equal(fileSha(join(priorDir,"summary.json")),"5f39d3f4c35a0c1dce053349946f1c715d2ae06ffb3ff221fca3d711edd0d058");
assert.equal(fileSha(join(priorDir,"ledger.json")),"ab87e6bf2897b738261ffb50815b443f44d6be12f02605f96c46a842d9936bc9");
assert.equal(prior.totalBoundUsd,cfg.priorBoundUsd);
const parentFile=resolve(here,cfg.parentReceipt), oldFile=resolve(here,cfg.originalWithheldTurn);
assert.equal(fileSha(parentFile),cfg.parentSha256);assert.equal(fileSha(oldFile),cfg.originalWithheldSha256);
const parent=read(parentFile), old=read(oldFile);
assert(parent.public && !parent.public.toolCalls.length);
assert.equal(old.prompt,cfg.learners.correct);
assert.deepEqual(old.originalHistory,[{role:"user",content:parent.prompt,timestamp:1},parent.public.message]);
const authentic=old.drafts[2].message;
assert.equal(sha(displayMessage(authentic).text),cfg.reviewCases[0].candidateSha256);
const schedule=[
  ...cfg.reviewOrder.map(([caseId,arm])=>({id:["review",caseId,arm].join("--"),caseId,arm,kind:"fixed-review"})),
  ...cfg.generationOrder.map(arm=>({id:["fresh","confirmation",arm].join("--"),caseId:"authentic-confirmation",arm,kind:"fresh-tutor"}))
];
if (mode==="--dry") {console.log(JSON.stringify({slots:schedule.length,fixedReviews:cfg.reviewOrder.length,generatedTurns:cfg.generationOrder.length,priorBoundUsd:prior.totalBoundUsd,phaseCapUsd:cfg.phaseMaximumAdditionalUsd,network:0}));process.exit(0);}
if (live) lock();
const source=join(here,"source-delta.json.gz"), meta=JSON.parse(gunzipSync(readFileSync(source)));
assert.equal(meta.policy,cfg.expectedPolicy);assert.equal(meta.baseSha256,fileSha(join(study,"product-v2.3.3.tar.gz")));
const scope=Bun.spawnSync(["rtk","proxy","python3","-I",join(here,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
assert.equal(scope.exitCode,0,scope.stderr.toString().slice(-700));
const product=scope.stdout.toString().trim(), scratch=mkdtempSync(join(tmpdir(),"keating-feedback-wire-"));
try {await run();} finally {rmSync(product,{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});}

async function run() {
  await plugin({name:"feedback-product-markdown",setup(b){b.onLoad({filter:/\.md(?:\?raw)?$/},async a=>({loader:"js",contents:"export default "+JSON.stringify(await Bun.file(a.path.replace(/\?raw$/u,"")).text())}));}});
  const {withTeachingDraftGate}=await import(join(product,"web/src/keating/judgement/draft-gate.ts"));
  const {composeKeatingSystemPrompt}=await import(join(product,"web/src/keating/browser-tools/prompt.ts"));
  const {inspectOpenUIDiagnosticText}=await import(join(product,"web/src/keating/openui/diagnostic-components.ts"));
  const {parseReviewNotice}=await import(join(product,"web/src/keating/judgement/review-notice.ts"));
  const {TEACHING_POLICY_VERSION,projectTeachingPolicyDecision}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-policy.ts"));
  const {createAssistantMessageEventStream}=await import(join(product,"node_modules/@earendil-works/pi-ai/dist/compat.js"));
  assert.equal(TEACHING_POLICY_VERSION,cfg.expectedPolicy);
  const bundle=JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz"))));
  const base=composeKeatingSystemPrompt(), originalTransport=join(study,"transport.mjs");
  assert.equal(fileSha(originalTransport),"52fd04074a7bec220e806108720f5b0a78b9ac0f7d8ad4c41d386dc468f0e560");
  assert.deepEqual(inspectOpenUIDiagnosticText(cfg.reviewCases[2].text).components,["question-group"]);
  const manifestPath=join(here,"manifest.json"), manifest={
    id:cfg.id, version:1, policy:TEACHING_POLICY_VERSION, sourceBaseSha256:meta.baseSha256,sourceDeltaSha256:fileSha(source),sourceFileCount:meta.count,
    cohortSha256:cohortHash,priorBoundUsd:cfg.priorBoundUsd,previousSummarySha256:fileSha(join(priorDir,"summary.json")),
    previousLedgerSha256:fileSha(join(priorDir,"ledger.json")),globalCapUsd:cfg.globalCapUsd,phaseCapUsd:cfg.phaseMaximumAdditionalUsd,
    systemSha256:sha(bundle.prompt),baseSha256:sha(base),toolsSha256:sha(bundle.tools),tools:bundle.tools.length,transportSha256:fileSha(originalTransport),
    code:Object.fromEntries(["run.mjs","environment.mjs","source.py"].map(f=>[f,fileSha(join(here,f))])),schedule
  };
  if (mode==="--freeze") {
    assert(!existsSync(manifestPath)&&!existsSync(join(here,"ledger.json")));
    const dest=join(scratch,"system.txt");
    const ex=Bun.spawnSync([process.execPath,join(product,"scripts/training/export_system_prompt.ts"),dest],{cwd:product,stdout:"pipe",stderr:"pipe"});
    assert.equal(ex.exitCode,0,ex.stderr.toString().slice(-800));assert(read(dest+".metadata.json").verifiedEqualToOriginalWebBuilder);
    assert.equal(readFileSync(dest,"utf8"),bundle.prompt);assert.deepEqual(read(join(scratch,"tool-schemas.json")).map(x=>x.function),bundle.tools);
    save(manifestPath,manifest);console.log(JSON.stringify({frozen:fileSha(manifestPath),policy:TEACHING_POLICY_VERSION,source:manifest.sourceDeltaSha256,slots:schedule.length,network:0}));return;
  }
  assert.deepEqual(read(manifestPath),manifest);
  copyFileSync(originalTransport,join(scratch,"transport.mjs"));
  writeFileSync(join(scratch,"common.mjs"),"export * from "+JSON.stringify(join(here,"environment.mjs"))+";\n");
  const {makeTransport}=await import(join(scratch,"transport.mjs"));
  const transport=await makeTransport(product,bundle.models,live,!live), entries=transport.ledger.entries;
  const rows=[], firstRequest=new Map();

  for (const cell of schedule) {
    const file=join(here,"receipts",cell.id+".json");
    let row;
    if (live && existsSync(file)) row=read(file);
    else {
      row=await generate(cell);
      if (live) {
        save(file,row);console.log(JSON.stringify({id:row.id,phase:row.disposition,reviewStatus:row.attempts[0]?.status,
          drafts:row.drafts.length,providerRequests:entries.length,upperUsd:usd(prior.totalBoundUsd+total(entries))}));
      } else {
        const before=read(file), normalize=r=>({...r,refs:r.refs.map(({source,...ref})=>ref)});
        assert.deepEqual(normalize(row),normalize(before),row.id);row=before;
      }
    }
    if (row.kind==="fixed-review" && row.reviewSha256) {
      if (firstRequest.has(row.caseId)) assert.equal(firstRequest.get(row.caseId),row.reviewSha256);
      firstRequest.set(row.caseId,row.reviewSha256);
    }
    rows.push(row);
  }
  await transport.drain();
  const used=new Set();
  for(const row of rows) {
    for(const ref of row.refs) {
      if (!ref.entryId) {assert(!ref.ok);continue;}
      const e=entries.find(e=>e.id===ref.entryId);assert(e&&e.requestSha256===ref.requestSha256);assert.equal(sha(e.request),ref.requestSha256);used.add(e.id);
    }
    for(const draft of row.drafts) {
      if (row.kind==="fixed-review") {assert.equal(draft.origin,"fixed");assert.equal(draft.entryId,null);continue;}
      const e=entries.find(e=>e.id===draft.entryId);assert(e&&e.kind==="tutor");assert.deepEqual(e.message,draft.message);
      assert.deepEqual((parseWire(e).tools??[]).map(t=>t.name),draft.toolNames);used.add(e.id);
    }
  }
  assert.deepEqual(used,new Set(entries.map(e=>e.id)));
  let peak=prior.totalBoundUsd, cumulative=prior.totalBoundUsd;
  const wireNames=new Set();
  for(const e of entries) {
    const model=[...Object.values(primary.judges),primary.tutors.minimax].find(m=>m.id===e.model);
    assert(model && e.reservedUsd===model.reserve);assert.equal(new URL(model.endpoint).host,e.host);
    assert.equal(e.path,e.kind==="tutor"?"/anthropic/v1/messages":new URL(model.endpoint).pathname);
    assert.equal(parseWire(e).model,e.model);wireNames.add(e.wireSha256+".json.gz");
    assert(e.finishedAt && Date.parse(e.finishedAt)>=Date.parse(e.startedAt));
    assert.equal(e.accountedUsd,e.usage?usd((e.usage.inputTokens*model.input+e.usage.outputTokens*model.output)/1e6):e.reservedUsd);
    peak=Math.max(peak,usd(cumulative+e.reservedUsd));cumulative=usd(cumulative+e.accountedUsd);
  }
  assert.deepEqual(readdirSync(join(here,"wire")).sort(),[...wireNames].sort());
  assert(peak<=cfg.globalCapUsd && peak<=usd(prior.totalBoundUsd+cfg.phaseMaximumAdditionalUsd));
  const summary={id:cfg.id,policy:manifest.policy,manifestSha256:fileSha(manifestPath),sourceSha256:manifest.sourceDeltaSha256,
    fixedReviews:rows.filter(r=>r.kind==="fixed-review").length,pairedSharedRequestHashes:Object.fromEntries(firstRequest),
    fixed:rows.filter(r=>r.kind==="fixed-review").map(brief),fresh:rows.filter(r=>r.kind==="fresh-tutor").map(brief),
    receipts:Object.fromEntries(rows.map(r=>[r.id,fileSha(join(here,"receipts",r.id+".json"))])),
    providerRequests:entries.length,unknownUsage:entries.filter(e=>!e.usage).length,
    previousBoundUsd:prior.totalBoundUsd,newBoundUsd:total(entries),totalBoundUsd:cumulative,peakReservedUsd:peak,capUsd:cfg.globalCapUsd};
  if (live) save(join(here,"summary.json"),summary);else assert.deepEqual(summary,read(join(here,"summary.json")));
  console.log(JSON.stringify({mode,pairs:firstRequest.size,receipts:rows.length,providerRequests:entries.length,cumulativeBoundUsd:cumulative,newProviderCalls:live?entries.length:0}));

  function parseWire(e) {
    const raw=gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz")));
    assert.equal(sha(raw),e.wireSha256);return JSON.parse(raw.toString("utf8"));
  }
  function brief(row) {
    return {id:row.id,reviewSha256:row.reviewSha256,disposition:row.disposition,notice:row.notice,selectionRule:row.selectionRule,
      selectedAttempt:row.selectedAttempt,attemptStatus:row.attempts.map(a=>a.status),text:row.public?.text??null,
      publicTools:row.public?.toolCalls.map(t=>t.name)??null,requestIds:row.refs.map(r=>r.entryId),missing:row.missing};
  }
  async function generate(cell) {
    const fixed=cell.kind==="fixed-review", example=cfg.reviewCases.find(c=>c.id===cell.caseId), learner=cfg.learners[example.learner];
    const row={...cell,policy:TEACHING_POLICY_VERSION,learner,originalHistory:old.originalHistory,parentSha256:cfg.parentSha256,
      fixedCandidateSha256:fixed?sha(example.text??displayMessage(authentic).text):null,plan:null,refs:[],reviewSha256:null,drafts:[],attempts:[],
      disposition:null,notice:null,selectedAttempt:null,selectionRule:null,releaseReason:null,public:null,publicEnvelope:null,missing:null};
    if (transport.ledger.hardStop) {row.disposition="budget-or-auth-stop";row.missing=transport.ledger.hardStop;return row;}
    let failure=null,last=null,ri=0;
    async function decide(req,signal) {
      if(failure)return {ok:false,error:{code:"backend-unavailable",retryable:false}};
      const stage=req.questions.learning_task?"plan":req.questions.draft_choice?"selection":"review";
      const arm=fixed && stage==="plan"?"jev":cell.arm;
      const label=fixed && stage==="plan"?"common-plan/"+example.learner:cell.id+"/"+stage+(stage==="review"?"/"+(++ri):"");
      if(stage==="review") {
        const digest=sha(req);
        if(fixed&&firstRequest.has(cell.caseId)) assert.equal(digest,firstRequest.get(cell.caseId),"Mismatched review pair before dispatch");
        if(!row.reviewSha256) row.reviewSha256=digest;
      }
      const {outcome,ref}=await transport.decision(arm,req,label,signal);row.refs.push({...ref,stage,arm});
      if(!outcome.ok)failure=stage+"-"+outcome.error.code;
      else if(stage==="plan") {
        const p=projectTeachingPolicyDecision(req.state.turn,outcome);
        row.plan={status:p.status,action:p.interaction.action,offered:p.interaction.families.flatMap(f=>f.components),directives:p.directives,
          decisions:p.decisions,features:p.features,reason:p.interaction.reason??null,codePracticeLanguage:p.interaction.codePracticeLanguage??null};
      }
      return outcome;
    }
    async function tutor(_model,context,opts={}) {
      if(failure) throw Error("Cell stopped");
      let message,entryId=null;
      if(fixed){
        assert.equal(row.drafts.length,0);
        message=example.text?{...authentic,content:[{type:"text",text:example.text}]}:structuredClone(authentic);
        assert.equal(sha(displayMessage(message).text),row.fixedCandidateSha256);
      } else {
        try {const g=await transport.tutor("minimax",context,opts.reasoning??null,cell.id+"/tutor/"+(row.drafts.length+1),opts.signal);
          message=g.message;entryId=g.entry.id;
        } catch(error){failure="tutor-transport-unavailable";throw error;}
      }
      const visible=displayMessage(message),complete=["stop","toolUse"].includes(message.stopReason);
      row.drafts.push({...visible,...inspectOpenUIDiagnosticText(visible.text),origin:fixed?"fixed":"provider",entryId,completed:complete,
        providedDirectives:row.plan?row.plan.directives.every(d=>context.systemPrompt.includes("- "+d)):null,toolNames:(context.tools??[]).map(t=>t.name)});
      const stream=createAssistantMessageEventStream();
      if(complete)stream.push({type:"done",reason:message.stopReason,message});
      else {failure="tutor-unavailable";stream.push({type:"error",reason:"error",error:message});}
      stream.end(message);return stream;
    }
    const gate=withTeachingDraftGate(tutor,{sessionId:parent.id,basePrompt:()=>base,makeCaller:()=>decide,
      maxAttempts:fixed?1:cfg.tutor.maxDrafts,timeoutMs:cfg.tutor.outerTimeoutMs,refinement:"ordinary",
      judgementModel:{id:fixed?cfg.models.jev:cfg.models[cell.arm],requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{last=s;}});
    const messages=[...old.originalHistory,{role:"user",content:learner,timestamp:1}];
    const stream=await gate(bundle.models.minimax,{systemPrompt:bundle.prompt,messages,tools:bundle.tools},{});
    row.publicEnvelope=displayMessage(sanitizeMessage(await stream.result()));
    const notice=parseReviewNotice(row.publicEnvelope.text);row.notice=notice?.kind??null;
    row.disposition=failure&&last?.phase!=="released"?"provider-error":last?.phase??"unknown";
    if(row.disposition==="released")row.public={...row.publicEnvelope,...inspectOpenUIDiagnosticText(notice?.text??row.publicEnvelope.text)};
    else row.missing=failure??last?.reason??row.disposition;
    row.selectedAttempt=last?.selectedAttempt??null;row.selectionRule=last?.selectionRule??null;row.releaseReason=last?.reason??null;
    row.attempts=(last?.attempts??[]).map(({generationMs,judgementMs,...rest})=>rest);
    return row;
  }
}
