import assert from "node:assert/strict";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { plugin } from "bun";
import { cohort as base, displayMessage, fileSha, here as study, lock, read, sanitizeMessage, save, sha, stableContext, total, usd } from "../common.mjs";

const here=import.meta.dir, mode=process.argv[2], live=mode==="--bridge", c=read(join(here,"cohort.json"));
assert(process.argv.length===3 && ["--dry","--freeze","--bridge","--verify"].includes(mode));
assert.equal(fileSha(join(here,"cohort.json")),"383f4e9a1853252f0c45378be0e966f3553982c13ee5e5c0d2744971d1e5d0c6");
const parent=read(resolve(here,c.parentReceipt)), prior=read(resolve(here,c.priorSummary));
assert.equal(fileSha(resolve(here,c.parentReceipt)),c.parentReceiptSha256);
assert.equal(fileSha(resolve(here,c.priorSummary)),c.priorSummarySha256);assert.equal(prior.totalBoundUsd,c.priorBoundUsd);
assert.equal(fileSha(join(study,"classroom-v2.3.7","ledger.json")),c.priorLedgerSha256);
const publicHash=sha(parent.public.text), rowPath=join(here,"receipts",c.id+".json"), stagePath=join(here,"stage.json");
if(mode==="--dry"){console.log(JSON.stringify({slots:1,model:c.tutor,decision:c.decision,priorBoundUsd:c.priorBoundUsd,maxAdditionalUsd:c.phaseMaximumAdditionalUsd,network:0}));process.exit(0);}
if(live)lock();
const restore=Bun.spawnSync(["rtk","proxy","python3","-I",join(here,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
assert.equal(restore.exitCode,0,restore.stderr.toString().slice(-800));const product=restore.stdout.toString().trim();
const scratch=mkdtempSync(join(tmpdir(),"keating-active-classroom-"));chmodSync(scratch,0o700);
try{await main();}finally{rmSync(scratch,{recursive:true,force:true});rmSync(product,{recursive:true,force:true});}

function exactLearner(text, sentence) {
  return text===sentence || typeof text==="string" && /^\[Keating time note:[^\]\n]{1,300}\]\s*/u.test(text) && text.replace(/^\[Keating time note:[^\]\n]{1,300}\]\s*/u,"")===sentence;
}
function checkStage(stage) {
  assert.equal(stage.parentReceiptSha256,c.parentReceiptSha256);assert.equal(stage.parentPublicTextSha256,publicHash);
  assert.equal(stage.pendingSubmissions,0);assert.equal(stage.openInteractions.length,1);
  const x=stage.openInteractions[0];
  assert(typeof x.documentId==="string" && /^openui-[\w-]{1,140}-tile-draw-prediction$/u.test(x.documentId));
  assert.equal(x.nodeId,"guess");assert.equal(x.component,"question-group");assert.equal(x.state,"awaiting");
  return {parentReceiptSha256:stage.parentReceiptSha256,parentPublicTextSha256:stage.parentPublicTextSha256,pendingSubmissions:0,
    openInteractions:[{documentId:x.documentId,nodeId:x.nodeId,component:x.component,state:x.state}]};
}
function checkTurn(turn,stage) {
  assert(exactLearner(turn.learnerMessage,c.learner),"Current learner message must match the registered confirmation");
  assert.equal(turn.conversation.length,2);
  const previous=turn.conversation.at(-1), first=turn.conversation.find(m=>m.role==="user");
  assert.equal(previous?.role,"assistant");assert.equal(sha(previous.content),publicHash);
  assert(first && exactLearner(first.content,parent.prompt));assert.equal((turn.pendingSubmissions??[]).length,0);
  assert.equal(turn.activeWork?.openInteractions?.length,1);const item=turn.activeWork.openInteractions[0], record=stage.openInteractions[0];
  for(const k of ["documentId","nodeId","component","state"])assert.equal(item[k],record[k],"Mismatched stored presentation "+k);
  const evidence=turn.previousQuestionPresentation;
  assert(evidence,"Missing previous question presentation");assert.equal(evidence.assistantTurnIndex,turn.conversation.length-1);
  assert.equal(evidence.documentId,item.documentId);assert.equal(evidence.nodeId,item.nodeId);
}

async function main() {
  await plugin({name:"active-classroom-markdown",setup(b){b.onLoad({filter:/\.md(?:\?raw)?$/},async a=>({loader:"js",contents:"export default "+JSON.stringify(await Bun.file(a.path.replace(/\?raw$/u,"")).text())}));}});
  const {TEACHING_POLICY_VERSION,projectTeachingPolicyDecision,trimTrailingCheckpointProse,prepareAssessmentOptOutDraft}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-policy.ts"));
  const {runTeachingDrafts}=await import(join(product,"packages/learner-contracts/src/judgement/teaching-drafts.ts"));
  const {inspectOpenUIDiagnosticText:inspect}=await import(join(product,"web/src/keating/openui/diagnostic-components.ts"));
  const {parseReviewNotice:notice}=await import(join(product,"web/src/keating/judgement/review-notice.ts"));
  assert.equal(TEACHING_POLICY_VERSION,c.policy);
  const transportPath=join(study,"transport.mjs"),manifestPath=join(here,"manifest.json");
  assert.equal(fileSha(transportPath),"52fd04074a7bec220e806108720f5b0a78b9ac0f7d8ad4c41d386dc468f0e560");
  const archive=join(here,"source-delta.json.gz"),src=JSON.parse(gunzipSync(readFileSync(archive)));
  const bundle=JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz"))));
  const manifest={id:c.id,policy:c.policy,sourceDeltaSha256:fileSha(archive),sourceBaseSha256:src.baseSha256,sourceFiles:src.count,
    priorSummarySha256:c.priorSummarySha256,priorBoundUsd:c.priorBoundUsd,capUsd:c.globalCapUsd,phaseCapUsd:c.phaseMaximumAdditionalUsd,
    parentReceiptSha256:c.parentReceiptSha256,parentPublicTextSha256:publicHash,transportSha256:fileSha(transportPath),
    priorPlanOfflineProofSha256:fileSha(join(here,"old-plan.json")),
    code:Object.fromEntries(["cohort.json","source.py","environment.mjs","run.mjs","old-plan.mjs"].map(x=>[x,fileSha(join(here,x))]))};
  const oldPlan=read(join(here,"old-plan.json"));assert.equal(oldPlan.correctedOnSameInput,true);assert.equal(oldPlan.currentSourceSha256,manifest.sourceDeltaSha256);
  if(mode==="--freeze"){
    assert(!existsSync(manifestPath)&&!existsSync(join(here,"ledger.json")));
    save(manifestPath,manifest);console.log(JSON.stringify({manifest:fileSha(manifestPath),source:manifest.sourceDeltaSha256,network:0}));return;
  }
  assert.deepEqual(read(manifestPath),manifest);
  copyFileSync(transportPath,join(scratch,"transport.mjs"));
  writeFileSync(join(scratch,"common.mjs"),"export * from "+JSON.stringify(join(here,"environment.mjs"))+";\n");
  const {makeTransport}=await import(join(scratch,"transport.mjs"));const transport=await makeTransport(product,bundle.models,live,!live),entries=transport.ledger.entries;
  if(live&&!existsSync(rowPath))await serve();
  await transport.drain();
  const stage=checkStage(read(stagePath)),row=read(rowPath);assert.equal(row.id,c.id);
  const byId=Object.fromEntries(entries.map(e=>[e.id,e]));
  const planEntry=byId[row.refs[0].entryId];assert.equal(planEntry.model,c.decision);checkTurn(planEntry.request.state.turn,stage);
  const visited=new Set();let peak=c.priorBoundUsd, cumulative=c.priorBoundUsd;
  for(const e of entries){
    assert(!visited.has(e.id));visited.add(e.id);
    const raw=gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz")));
    assert.equal(sha(raw),e.wireSha256);assert.equal(JSON.parse(raw).model,e.model);
    const cfg=e.kind==="tutor"?base.tutors.minimax:base.judges.jev;assert.equal(cfg.id,e.model);
    assert.equal(e.host,new URL(cfg.endpoint).host);assert.equal(e.path,e.kind==="tutor"?"/anthropic/v1/messages":new URL(cfg.endpoint).pathname);
    assert.equal(e.reservedUsd,cfg.reserve);assert(e.finishedAt);
    assert.equal(e.accountedUsd,e.usage?usd((e.usage.inputTokens*cfg.input+e.usage.outputTokens*cfg.output)/1e6):e.reservedUsd);
    peak=Math.max(peak,usd(cumulative+e.reservedUsd));cumulative=usd(cumulative+e.accountedUsd);
  }
  assert.deepEqual(new Set(readdirSync(join(here,"wire"))),new Set(entries.map(e=>e.wireSha256+".json.gz")));
  assert.deepEqual(visited,new Set([...row.refs.map(r=>r.entryId).filter(Boolean),...row.drafts.map(d=>d.entryId)]));
  for(const d of row.drafts){const e=byId[d.entryId];assert.deepEqual(d.message,e.message);
    const raw=JSON.parse(gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz"))));
    assert.deepEqual((raw.tools??[]).map(t=>t.name),d.availableToolNames);assert(!d.availableToolNames.includes("grade_quiz")&&!d.availableToolNames.includes("grade_question_checks"));}
  assert(peak<=c.globalCapUsd && peak<=usd(c.priorBoundUsd+c.phaseMaximumAdditionalUsd));
  const summary={id:c.id,policy:c.policy,manifestSha256:fileSha(manifestPath),stageSha256:fileSha(stagePath),receipts:{[row.id]:fileSha(rowPath)},
    scheduled:1,stageVerified:true,disposition:row.disposition,selectedAttempt:row.selectedAttempt,selectionRule:row.selectionRule,
    providerRequests:entries.length,metered:entries.filter(e=>e.usage).length,unknownUsage:entries.filter(e=>!e.usage).length,
    previousBoundUsd:c.priorBoundUsd,newBoundUsd:total(entries),totalBoundUsd:cumulative,peakReservedUsd:peak,capUsd:c.globalCapUsd,phaseLimitUsd:c.phaseMaximumAdditionalUsd};
  if(live)save(join(here,"summary.json"),summary);
  else {
    assert.deepEqual(summary,read(join(here,"summary.json")));
    let calls=0,generated=0,logical=0,halted=false;
    const result=await runTeachingDrafts({turn:planEntry.request.state.turn,maxAttempts:c.maxDrafts,timeoutMs:90000,maxReasoning:row.attempts[0]?.reasoning??"off",refinement:"ordinary",
      judgementModel:{id:c.decision,requestTokens:64000,stateQuestionTokens:32000},
      judge:async(req,signal)=>{const ref=row.refs[calls++];assert(ref);assert.equal(sha(req),ref.requestSha256);
        const {outcome}=await transport.decision("jev",req,ref.label,signal);return outcome;},
      generate:async()=>{logical++;if(halted)throw Error("Archived transport closed after incomplete physical generation");const d=row.drafts[generated++];assert(d);
        if(!d.completed){halted=true;throw Error("Archived unavailable generation");}
        return {reply:{text:d.text,toolCalls:d.toolCalls.map(({name,arguments:args})=>({name,arguments:args}))},value:d.message};},
      check:()=>row.attempts[generated-1].checks.filter(x=>x.id==="runtime_tool_schema")
    });
    assert.equal(calls,row.refs.length);assert.equal(generated,row.drafts.length);assert.equal(logical,row.attempts.length);assert.equal(result.status,row.disposition);
    assert.equal(result.receipt.selectedAttempt,row.selectedAttempt);assert.equal(result.receipt.selectionRule??null,row.selectionRule);
    assert.deepEqual(result.receipt.attempts.map(a=>a.checks),row.attempts.map(a=>a.checks));
  }
  console.log(JSON.stringify({mode,...summary,newProviderCalls:live?entries.length:0}));

  async function serve(){
    assert(entries.length===0,"A previously dispatched browser turn cannot be restarted as a fresh turn.");
    const secret=randomBytes(32).toString("hex"),refs=[],drafts=[];let stage=null,plan=null,fullPlan=null,planTurn=null,failed=false,finished=false,inFlight=false,reviews=0,selections=0;
    const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:255,maxRequestBodySize:1100000,async fetch(req){
      const path=new URL(req.url).pathname,token=(req.headers.get("authorization")??"").replace(/^Bearer /u,"");
      if(token.length!==secret.length||!timingSafeEqual(Buffer.from(token),Buffer.from(secret)))return new Response("Unauthorized",{status:401});
      if(path==="/health"&&req.method==="GET")return Response.json({id:c.id,staged:!!stage,finished,pending:inFlight});
      if(req.method!=="POST"||!["/stage","/decision","/tutor","/receipt"].includes(path)||finished||inFlight)return new Response("Outside one-turn lease",{status:409});
      inFlight=true;
      try{
        const body=await req.json();
        if(path==="/stage"){assert(!stage&&!entries.length);stage=checkStage(body);save(stagePath,stage);return Response.json({staged:true,sha256:fileSha(stagePath)});}
        assert(stage,"The real classroom has not staged its prior question");
        if(path==="/decision"){
          assert(!failed);const reqBody=body.request,phase=reqBody.questions.learning_task?"plan":reqBody.questions.draft_choice?"selection":"review";
          checkTurn(reqBody.state.turn,stage);
          if(phase==="plan")assert(!refs.length&&!drafts.length);else if(phase==="selection")assert(drafts.length>=2&&selections++===0);
          else assert(drafts.length>0&&++reviews<=drafts.length);
          const label=c.id+"/"+phase+(phase==="review"?"/"+reviews:"");
          const {outcome,ref}=await transport.decision("jev",reqBody,label,req.signal);refs.push(ref);
          if(!outcome.ok)failed=true;
          else if(phase==="plan"){const p=projectTeachingPolicyDecision(reqBody.state.turn,outcome);fullPlan=p;planTurn=reqBody.state.turn;
            plan={status:p.status,action:p.interaction.action,offered:p.interaction.families.flatMap(f=>f.components),directives:p.directives,decisions:p.decisions,features:p.features};}
          return Response.json(outcome);
        }
        if(path==="/tutor"){
          assert(!failed&&plan&&drafts.length<c.maxDrafts&&reviews===drafts.length);
          const ctx=body.context;assert(ctx&&Array.isArray(ctx.messages)&&Array.isArray(ctx.tools)&&typeof ctx.systemPrompt==="string");
          function messageText(m){return typeof m.content==="string"?m.content:m.content.filter(x=>x.type==="text").map(x=>x.text).join("\n");}
          assert(ctx.messages.some(m=>m.role==="assistant"&&sha(messageText(m))===publicHash));assert(ctx.messages.some(m=>m.role==="user"&&exactLearner(messageText(m),c.learner)));
          const reasoning=body.reasoning??null;assert([null,"off","minimal","low","medium","high","xhigh"].includes(reasoning));
          const availableToolNames=ctx.tools.map(t=>t.name);
          assert(!availableToolNames.includes("grade_quiz")&&!availableToolNames.includes("grade_question_checks"));
          const label=c.id+"/tutor/"+(drafts.length+1);
          const {message,entry}=await transport.tutor("minimax",ctx,reasoning,label,req.signal);
          const visible=displayMessage(message),complete=["stop","toolUse"].includes(message.stopReason);if(!complete)failed=true;
          drafts.push({...visible,...inspect(visible.text),entryId:entry.id,completed:complete,availableToolNames,reasoning,
            contextSha256:sha(stableContext(ctx)),providedDirectives:plan.directives.every(d=>ctx.systemPrompt.includes("- "+d))});
          return Response.json(message);
        }
        const snapshot=body.snapshot,m=sanitizeMessage(body.message);assert(["released","withheld","cancelled"].includes(snapshot?.phase));
        assert(refs.length&&drafts.length);
        const shown=displayMessage(m),reviewNotice=notice(shown.text);
        if(snapshot.phase==="released"){
          const d=drafts[snapshot.selectedAttempt-1];assert(d?.completed);
          const reply={text:d.text,toolCalls:d.toolCalls.map(({name,arguments:args})=>({name,arguments:args}))};
          const trimmed=trimTrailingCheckpointProse(reply)??reply;
          const selected=prepareAssessmentOptOutDraft(planTurn,fullPlan,trimmed)?.reply??trimmed;
          assert.equal(reviewNotice?.text??shown.text,selected.text);
          assert.deepEqual(shown.toolCalls.map(t=>t.name),selected.toolCalls.map(t=>t.name));
        }
        const outcome={id:c.id,kind:"live-classroom-followup",policy:c.policy,learner:c.learner,tutor:"minimax",arm:"jev",
          parentReceiptSha256:c.parentReceiptSha256,stagedPresentation:stage,plan,refs,drafts,attempts:snapshot.attempts,
          selectedAttempt:snapshot.selectedAttempt??null,selectionRule:snapshot.selectionRule??null,releaseReason:snapshot.reason??null,
          disposition:snapshot.phase,notice:reviewNotice?.kind??null,public:snapshot.phase==="released"?{...shown,...inspect(reviewNotice?.text??shown.text)}:null,
          publicEnvelope:shown,finishedAt:new Date().toISOString(),classroomContext:{conversationId:typeof body.conversationId==="string"?body.conversationId.slice(0,128):null,
            turnId:typeof body.turnId==="string"?body.turnId.slice(0,128):null}};
        assert(!existsSync(rowPath));save(rowPath,outcome);finished=true;return Response.json({sealed:true,sha256:fileSha(rowPath)});
      }catch(error){return Response.json({error:String(error?.message??error).slice(0,300)},{status:422});}
      finally{inFlight=false;}
    }});
    const config=join(scratch,"bridge.json");writeFileSync(config,JSON.stringify({cellId:c.id,baseUrl:server.url.href.replace(/\/$/u,""),token:secret}),{mode:0o600,flag:"wx"});console.log("CLASSROOM_BRIDGE_CONFIG "+config);
    try {const until=Date.now()+20*60_000;while(!finished&&Date.now()<until)await Bun.sleep(350);assert(finished,"Final classroom receipt was not sealed");}
    finally {server.stop(true);}
  }
}
