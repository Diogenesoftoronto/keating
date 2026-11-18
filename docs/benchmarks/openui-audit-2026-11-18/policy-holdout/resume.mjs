// Budget-only continuation of the archived first runner; the initial receipts stay immutable.
import { plugin } from "bun";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseOpenUiDiagnosticExport } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn.ts";
import { TEACHING_POLICY_VERSION, projectTeachingPolicyDecision, interactionDirectives } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";

const here = import.meta.dir, audit = resolve(here, ".."), root = resolve(audit, "../../..");
const read = f => JSON.parse(readFileSync(f, "utf8"));
const sha = x => createHash("sha256").update(typeof x === "string" || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest("hex");
const requireThat = (v, reason) => { if (!v) throw Error(reason); };
const save = (f, obj) => {
  const fd = openSync(f + ".tmp", "w");
  try { writeFileSync(fd, JSON.stringify(obj, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(f + ".tmp", f);
  const dir = openSync(here, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
};
const cohort = read(join(here, "cohort.json")), cfg = cohort.protocol;
const bundle = JSON.parse(gunzipSync(readFileSync(join(here, "release-inputs.json.gz"))));
const tools = JSON.parse(bundle.toolSchemasText).map(t => t.function);
requireThat(cohort.policy === TEACHING_POLICY_VERSION && bundle.meta.sourceRelease === cohort.releasePromptSource
  && bundle.meta.verifiedEqualToOriginalWebBuilder && sha(bundle.systemPrompt) === cohort.systemSha256
  && sha(bundle.toolSchemasText) === cohort.toolSchemasSha256, "Input or policy revision changed");
await plugin({ name: "frozen-openui-markdown", setup(b) { b.onLoad({filter: /\.md(?:\?raw)?$/},
  async a => ({contents: "export default " + JSON.stringify(await Bun.file(a.path.replace(/\?raw$/, "")).text()), loader: "js"})); } });
const { composeKeatingSystemPrompt } = await import("../../../../web/src/keating/browser-tools/prompt.ts");
const { DEFAULT_TEACHER_PERSONA } = await import("../../../../web/src/keating/persona.ts");
const { withTeachingDraftGate } = await import("../../../../web/src/keating/judgement/draft-gate.ts");
const { parseReviewNotice } = await import("../../../../web/src/keating/judgement/review-notice.ts");
const { inspectOpenUIDiagnosticText } = await import("../../../../web/src/keating/openui/diagnostic-components.ts");
const { parseOpenUIMessageSegments } = await import("../../../../web/src/keating/openui/segments.ts");
const { tryCompileOpenUISourceToSharedDocument } = await import("../../../../web/src/keating/openui/shared-bridge.ts");
const base = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);
requireThat(bundle.systemPrompt.startsWith(base) && sha(base) === bundle.meta.basePromptSha256, "Gate prefix differs from the verified export");
const rawSources = ["web/src/keating/judgement/draft-gate.ts", "web/src/keating/openui/diagnostic-components.ts",
  "web/src/keating/openui/segments.ts", "web/src/keating/openui/shared-bridge.ts", "packages/learner-contracts/src/openui-source.ts",
  "packages/learner-contracts/src/ui.ts", "packages/learner-contracts/src/openui-diagnostic-turn.ts",
  "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts", "packages/learner-contracts/src/judgement/teaching-policy.ts",
  "packages/learner-contracts/src/judgement/interaction-affordances.ts", "packages/learner-contracts/src/judgement/teaching-drafts/session.ts",
  "packages/learner-contracts/src/judgement/teaching-drafts/policy.ts", "packages/learner-contracts/src/judgement/system-one.ts",
  "node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js", "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"];
const sourceHashes = Object.fromEntries(rawSources.map(f => [f, sha(readFileSync(join(root, f)))]));
const keyFor = (m, c) => m.id + "--" + c.id;
const cells = cohort.cases.flatMap(c => cohort.models.map(m => ({c, m, id: keyFor(m, c)})));
const manifestFile = join(here, "manifest.json"), ledgerFile = join(here, "segment-two-ledger.json");
const manifest = { version: 1, cohortSha256: sha(readFileSync(join(here, "cohort.json"))), releaseInputsSha256: sha(readFileSync(join(here, "release-inputs.json.gz"))),
  sourceHashes, scheduled: cells.map(x => x.id), sourceRelease: cohort.releasePromptSource, policy: cohort.policy, frozenAt: null };
const sum = rows => rows.reduce((s, e) => s + e.accountedUsd, 0);
const earlier = sum(read(join(audit, "evidence/budget.json")));
const followups = sum(read(join(audit, "policy-v2/ledger.json")).entries) + sum(read(join(audit, "policy-v2.1/ledger.json")).entries);
requireThat(Math.abs(earlier-cfg.priorStudyAccountedUsd) < .000000001 && Math.abs(followups-cfg.priorFollowupAccountedUsd) < .000000001, "Prior accounting changed");
const amendment=read(join(here,"budget-amendment.json")), first=read(join(here,"ledger.json"));
const amendmentHash=sha(readFileSync(join(here,"budget-amendment.json")));
for(const [file,digest] of Object.entries(amendment.provenance))
  requireThat(sha(readFileSync(join(here,file)))===digest,"First-segment provenance differs: "+file);
requireThat(first.stopReason==="budget" && first.entries.every(e=>e.status!=="reserved" && e.finishedAt)
  && JSON.stringify(first.entries.map(e=>e.label))===JSON.stringify(amendment.firstSent)
  && Math.abs(sum(first.entries)-amendment.firstHoldoutAccountedUsd)<1e-9
  && Math.abs(earlier+followups-amendment.priorAllBeforeHoldoutUsd)<1e-9
  && JSON.stringify(cells.slice(2).map(c=>c.id))===JSON.stringify(amendment.scope),"First segment or original schedule differs");
const priorExposure = earlier+followups+sum(first.entries);
const inspect = text => {
  const measured = inspectOpenUIDiagnosticText(text), documents = [], issues = [], outsideText = [];
  for (const part of parseOpenUIMessageSegments(text)) {
    if (part.type === "text") { outsideText.push(part.content); continue; }
    if (!part.complete) { issues.push("unfinished"); continue; }
    if (part.format === "document") {
      if (part.document) documents.push(part.document.nodes); else issues.push("invalid-document");
    } else {
      const compiled = tryCompileOpenUISourceToSharedDocument(part.rawProgram, {
        documentId: part.metadata.id, revision: part.metadata.revision, retention: part.metadata.lifecycle,
      });
      if (compiled.ok) documents.push(compiled.document.nodes); else issues.push(compiled.kind);
    }
  }
  return { ...measured, documents, issues, outsideText: outsideText.join("\n").trim() };
};
if (process.argv.includes("--verify")) {
  const { verify } = await import("./score.mjs"); await verify({here, cohort, cells, inspect, manifest, parseOpenUiDiagnosticExport}); process.exit(0);
}
if (!process.argv.includes("--execute")) {
  console.log(JSON.stringify({ dryRun:true, scheduled:amendment.scope, policy:cohort.policy, cohortSha256:manifest.cohortSha256,
    priorExposureUsd:priorExposure, secondLimitUsd:amendment.secondIncrementalLimitUsd, totalLimitUsd:cfg.studyLimitUsd, amendmentHash, externalRequests:0 })); process.exit(0);
}
// flock is released by the OS on a crash. Re-entry never replays a started cell.
if (!process.argv.includes("--locked")) {
  mkdirSync(join(root,".keating/benchmarks/openui-audit-2026-11-18"), {recursive:true});
  const child = Bun.spawnSync(["rtk","proxy","flock","-n","-E","75",join(root,".keating/benchmarks/openui-audit-2026-11-18/.budget.lock"),
    process.execPath,import.meta.path,"--execute","--locked"], {env:process.env,stdin:"inherit",stdout:"inherit",stderr:"inherit"});
  process.exit(child.exitCode ?? 1);
}
if (existsSync(manifestFile)) {
  const previous = read(manifestFile); requireThat(sha({...previous,frozenAt:null}) === sha(manifest), "Existing manifest differs");
} else save(manifestFile, {...manifest,frozenAt:new Date().toISOString()});
const ledger = existsSync(ledgerFile) ? read(ledgerFile) : { cohortSha256:manifest.cohortSha256, amendmentHash,
  priorExposureUsd:priorExposure, segmentLimitUsd:amendment.secondIncrementalLimitUsd, stopReason:null, entries:[] };
requireThat(ledger.cohortSha256 === manifest.cohortSha256 && ledger.amendmentHash===amendmentHash, "Wrong ledger");
if (ledger.stopReason) { console.log("Ledger is stopped: " + ledger.stopReason); process.exit(0); }
function stop(reason) { ledger.stopReason ??= reason; save(ledgerFile,ledger); }
function reserve(kind, label, model, upper) {
  requireThat(!ledger.stopReason, "Study stopped");
  requireThat(!first.entries.some(e=>e.label===label) && !ledger.entries.some(e => e.label === label), "Duplicate dispatch");
  if (sum(ledger.entries) + upper > amendment.secondIncrementalLimitUsd || priorExposure + sum(ledger.entries) + upper > cfg.studyLimitUsd) {
    stop("budget"); throw Error("Budget exhausted");
  }
  const entry = { kind,label,model,reservedUsd:upper,accountedUsd:upper,measured:false,status:"reserved",startedAt:new Date().toISOString(),http:null };
  ledger.entries.push(entry); save(ledgerFile,ledger); return entry;
}
function settle(entry,cost,status) {
  if (Number.isFinite(cost) && cost >= 0) { entry.accountedUsd=cost;entry.measured=true; }
  entry.status=status;entry.finishedAt=new Date().toISOString();
  if (cost>entry.reservedUsd) stop("reservation-exceeded");
  if (status==="billing" || status==="authorization") stop(status);
  save(ledgerFile,ledger);
}
// Refuse redirects, provider-side SDK HTTP retries and requests to an unbudgeted host.
const route = new AsyncLocalStorage(), networkFetch = globalThis.fetch;
globalThis.fetch = async function(input,init) {
  const scope=route.getStore(), raw=input instanceof Request?input.url:String(input), url=new URL(raw);
  requireThat(scope && url.origin===scope.origin && !scope.dispatched && (init?.method ?? (input instanceof Request?input.method:"GET")).toUpperCase()==="POST", "Unbudgeted HTTP dispatch");
  scope.dispatched=true; scope.entry.host=url.host; save(ledgerFile,ledger);
  const resp = await networkFetch(input,{...init,redirect:"error"});
  scope.entry.http=resp.status;save(ledgerFile,ledger);return resp;
};
function credential(envName,skateName) {
  if (process.env[envName]) return process.env[envName];
  const cmd=Bun.spawnSync(["rtk","proxy","skate","get",skateName+"@secrets"],{stdout:"pipe",stderr:"pipe"});
  return cmd.exitCode===0?cmd.stdout.toString().trim():null;
}
const {createBenchmarkRegistry} = await import("../../../../scripts/prompt-adherence/providers.ts");
const {streamSimple} = await import("../../../../node_modules/@earendil-works/pi-ai/dist/compat.js");
const registry=await createBenchmarkRegistry(join(root,".keating/pi-config"));
const jevKey=credential("TYPESAFE_API_KEY","typesafe_api_key");
requireThat(jevKey, "Missing Jev credential");
const modelRefs = new Map();
for (const item of cohort.models) {
  const model=registry.find(item.provider,item.id);
  requireThat(model && model.baseUrl===item.endpoint && model.id===item.id && model.provider===item.provider,"Unexpected actor model");
  const auth=await registry.getApiKeyAndHeaders(model);
  const apiKey=auth.apiKey || credential(item.provider==="google"?"GEMINI_API_KEY":"MINIMAX_API_KEY",item.provider==="google"?"gemini":"minimax");
  requireThat(apiKey,"Missing credential for "+item.id);modelRefs.set(item.id,{model,auth,apiKey});
}
const publicText=m=>m.content.filter(p=>p.type==="text").map(p=>p.text).join("\n");
const usefulUsage=u=>u && u.totalTokens>0 && ["input","output","cacheRead","cacheWrite"].every(k=>Number.isFinite(u[k])&&u[k]>=0)
  ? {input:u.input,output:u.output,cacheRead:u.cacheRead,cacheWrite:u.cacheWrite}:null;
const errorClass=(s,http)=>http===402||/balanc|credit|funds|billing|402/i.test(s)?"billing":http===401||http===403||/unauthori|invalid api.key/i.test(s)?"authorization":http===429?"rate-limit":"provider";
const pastJudges=new Map();
for(const {id} of cells) {
  for(const file of [id+".json","segment-two--"+id+".json"]) {
    if(!existsSync(join(here,file))) continue;
    const prior=read(join(here,file));
    for(const [index,j] of prior.judgments.entries()) {
      if(j.reusedFrom) continue;
      if(j.hash && !pastJudges.has(j.hash)) pastJudges.set(j.hash,{origin:file+"#judge-"+(index+1),j});
    }
  }
}
for (const cell of cells) {
  const {m,c,id}=cell,f=join(here,"segment-two--"+id+".json");
  if(!amendment.scope.includes(id)) continue;
  requireThat(!first.entries.some(e=>e.kind==="tutor"&&e.label.startsWith(id+"/")),"First-segment tutor already dispatched");
  if (existsSync(f) || ledger.entries.some(e=>e.label.startsWith(id+"/"))) continue;
  if (ledger.stopReason) break;
  const row={id,caseId:c.id,configuredModel:m.id,provider:m.provider,endpoint:m.endpoint,cohortSha256:manifest.cohortSha256,
    status:"started",startedAt:new Date().toISOString(),judgments:[],drafts:[],decision:null,phase:null,selection:null,checks:[],public:null};
  save(f,row);
  const pending=[], {model,auth,apiKey}=modelRefs.get(m.id); let plan=null,last=null,judgeIndex=0,tutorWireFailure=false,judgeWireFailure=false;
  const judge=async (req,signal)=>{
    if (ledger.stopReason || judgeWireFailure) return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    const phase=req.questions.learning_task?"plan":req.questions.draft_choice?"select":"review";
    const label=id+"/judge-"+(++judgeIndex);
    const item={phase,hash:sha(req),model:null,error:null,usage:null,reusedFrom:null};
    row.judgments.push(item);save(f,row);
    const cached=pastJudges.get(item.hash);
    if(id===amendment.scope[0] && phase==="plan" && (item.hash!==amendment.originalBusPlanRequestSha256 || !cached)) {
      tutorWireFailure=true;judgeWireFailure=true;item.error="original-plan-state-differs";save(f,row);
      return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    }
    if(cached && (cached.j.phase!==phase || !cached.j.answers || cached.j.model!==cohort.judge.model
       || JSON.stringify(Object.keys(req.questions).sort())!==JSON.stringify(Object.keys(cached.j.answers).sort()))) {
      tutorWireFailure=true;judgeWireFailure=true;item.error="exact-prior-judgment-unavailable";save(f,row);
      return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    }
    const caller=createSystemOneCaller({apiKey:jevKey,model:cohort.judge.model,requireResolvedModel:true,retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0},
      fetch:async(url,options)=>{
        requireThat(url===cohort.judge.endpoint && Buffer.byteLength(options.body)<150000 && !Object.keys(options.headers).some(h=>h.toLowerCase().includes("long-context")),"Unexpected Jev request");
        const entry=reserve("jev",label,cohort.judge.model,cfg.judgeReserveUsd), scope={entry,origin:new URL(url).origin,dispatched:false};
        try {
          const resp=await route.run(scope,()=>fetch(url,options));const data=resp.ok?await resp.clone().json():null;
          const n=data?.usage?.input_tokens??data?.usage?.inputTokens; settle(entry,Number.isSafeInteger(n)&&n>=0?n*cohort.judge.inputPerMillionUsd/1e6:null,resp.ok?"complete":errorClass("",resp.status));
          if(!resp.ok) judgeWireFailure=true;
          return resp;
        } catch {judgeWireFailure=true;settle(entry,null,"uncertain");throw Error("Jev transport interrupted");}
      }});
    const res=cached ? {ok:true,response:{answers:Object.fromEntries(Object.entries(cached.j.answers).map(
      ([k,v])=>[k,typeof v==="number"?{type:"noul",noul:v}:v])),
      backend:{backend:"system-one",model:cached.j.model,calibrationSha256:null},usage:cached.j.usage}}
      :await caller(req,signal);
    if(cached) item.reusedFrom=cached.origin;
    item.model=res.ok?res.response.backend.model:null;item.error=res.ok?null:res.error.code;item.usage=res.ok?res.response.usage??null:null;
    item.answers=res.ok?Object.fromEntries(Object.entries(res.response.answers).map(([key,answer])=>[key,answer.type==="noul"?answer.noul:answer])):null;
    if(phase==="plan" && res.ok) {
      plan=projectTeachingPolicyDecision(req.state.turn,res);
      row.decision={model:item.model,action:plan.interaction.action,targets:plan.interaction.families.flatMap(v=>v.components),
        interactionDirectives:interactionDirectives(plan.interaction),planDirectives:plan.directives,
        signals:Object.fromEntries(["learner_response_due","hands_on_requested","plain_reply_requested","assessment_declined","prediction_opportunity","variable_relationship"].map(k=>[k,res.response.answers[k]?.noul ?? null]))};
    }
    if(!cached) pastJudges.set(item.hash,{origin:"segment-two--"+id+".json#judge-"+judgeIndex,j:item});
    save(f,row);return res;
  };
  const actor=async(_model,ctx,opts)=>{
    if(tutorWireFailure || ledger.stopReason) throw Error("No further provider dispatch for this interrupted turn");
    const n=row.drafts.length+1;
    const dedicated=plan?interactionDirectives(plan.interaction):[];
    const decisions=ctx.systemPrompt.split("\n\nResponse scope:")[0];
    const relevant=plan?.interaction.action==="none"?plan.directives:dedicated;
    const delivered=plan&&relevant.length?relevant.every(s=>decisions.includes("- "+s)) && !ctx.systemPrompt.includes("Tools are disabled for this response."):null;
    const d={attempt:n,systemSha256:sha(ctx.systemPrompt),messagesSha256:sha(ctx.messages),toolsSha256:sha(ctx.tools),payloadSha256:null,delivered,
      hasUsableTools:!!ctx.tools?.length,status:"started",response:null};
    row.drafts.push(d);save(f,row);
    const entry=reserve("tutor",id+"/tutor-"+n,m.id,cfg.tutorReserveUsd);
    const scope={entry,origin:new URL(m.endpoint).origin,dispatched:false};
    const work=route.run(scope,async()=>{
      try {
        const stream=streamSimple(model,ctx,{...opts,apiKey,headers:auth.headers,env:auth.env,maxTokens:cfg.maxOutputTokens,temperature:cfg.temperature,
          maxRetries:0,maxRetryDelayMs:0,timeoutMs:cfg.tutorTimeoutMs,cacheRetention:"none",onPayload:async(payload,pm)=>{
            const v=(await opts?.onPayload?.(payload,pm))??payload;const wire=JSON.stringify(v);requireThat(Buffer.byteLength(wire)<=160000,"Tutor payload exceeds cost envelope");
            d.payloadSha256=sha(wire);save(f,row);return v;
          }});
        const msg=await stream.result(),usage=usefulUsage(msg.usage);
        const status=msg.stopReason==="error"?errorClass(String(msg.errorMessage||""),entry.http):msg.stopReason;
        if(msg.stopReason==="error"||msg.stopReason==="aborted") tutorWireFailure=true;
        const cost=usage?((usage.input+usage.cacheRead+usage.cacheWrite)*m.inputPerMillionUsd+usage.output*m.outputPerMillionUsd)/1e6:null;
        d.response={text:publicText(msg),nativeTools:msg.content.filter(p=>p.type==="toolCall").map(p=>p.name),provider:msg.provider,model:msg.model,
          responseModel:msg.responseModel||null,stop:msg.stopReason,usage}; d.status=status;
        settle(entry,cost,status);save(f,row);return stream;
      } catch {tutorWireFailure=true;d.status="transport-uncertain";settle(entry,null,"uncertain");save(f,row);throw Error("Tutor transport interrupted");}
    });
    pending.push(work);return work;
  };
  try {
    const gate=withTeachingDraftGate(actor,{sessionId:id,basePrompt:()=>base,makeCaller:()=>judge,maxAttempts:cfg.maxDrafts,timeoutMs:cfg.turnTimeoutMs,refinement:"ordinary",
      judgementModel:{id:cohort.judge.model,requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{last=s;}});
    const stream=await gate(model,{systemPrompt:bundle.systemPrompt,messages:[{role:"user",timestamp:1,content:c.prompt}],tools},{});
    const message=await stream.result();await Promise.allSettled(pending);
    const text=publicText(message),notice=parseReviewNotice(text);
    row.phase=last?.phase??null;row.selection=last?.selectedAttempt??null;row.reason=last?.reason??null;
    row.checks=(last?.attempts??[]).map(a=>({attempt:a.attempt,status:a.status,variant:a.variant,trimmedCheckpointSuffix:!!a.trimmedCheckpointSuffix,
      findings:a.checks.filter(x=>x.status!=="pass").map(({id,status,probability})=>({id,status,probability}))}));
    row.public={text:notice?.text??text,notice:notice?.kind??null,stop:message.stopReason,tools:message.content.filter(p=>p.type==="toolCall").map(p=>p.name)};
    row.status=ledger.stopReason?"interrupted":"complete";
  } catch {row.status="interrupted";await Promise.allSettled(pending);}
  row.finishedAt=new Date().toISOString();save(f,row);
  console.log(JSON.stringify({id,status:row.status,phase:row.phase,selected:row.selection,drafts:row.drafts.map(d=>d.status),accountedUsd:sum(ledger.entries)}));
}
