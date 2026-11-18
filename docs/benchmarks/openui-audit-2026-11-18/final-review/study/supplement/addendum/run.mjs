import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { plugin } from "bun";
import { cohort as baseCohort, displayMessage, fileSha, here as study, lock, read, sanitizeMessage, save, sha, total, usd } from "../../common.mjs";

const here = import.meta.dir;
const pred = join(here, "..", "prediction");
const cohort = read(join(here, "cohort.json"));
const mode = process.argv[2];
assert.equal(process.argv.length, 3);
assert(["--dry", "--freeze", "--execute", "--verify"].includes(mode));
assert.equal(fileSha(join(here, "cohort.json")), "ba038f4fcfeb1454f0898cb1d6185a6cf74e645ae8b28afaec5ae99be41f3089");
if (mode === "--dry") { console.log(JSON.stringify({slots:cohort.orderedCases, network:0, studyCapUsd:cohort.allStudyCapUsd})); process.exit(0); }
const live = mode === "--execute";
if (live) lock();
const prior = read(join(pred, "summary.json"));
const phase = read(join(pred, "manifest.json"));
const transportFile = join(study, "transport.mjs");
assert.equal(fileSha(transportFile), "52fd04074a7bec220e806108720f5b0a78b9ac0f7d8ad4c41d386dc468f0e560");
assert.equal(phase.sourceDeltaSha256, fileSha(join(pred, "source-delta.json.gz")));
assert.equal(prior.protocolSha256, fileSha(join(pred, "manifest.json")));
const manifestPath = join(here, "manifest.json");
const parentCase = cohort.cases.find(c => c.parent);
const parentFile = join(pred, "receipts", parentCase.parent + ".json");
assert.equal(fileSha(parentFile), prior.receipts[parentCase.parent]);
const manifest = {
  version:1, id:cohort.id, cohortSha256:fileSha(join(here,"cohort.json")), policy:phase.policy,
  sourceBaseSha256:phase.sourceBaseSha256, sourceDeltaSha256:phase.sourceDeltaSha256, sourceManifestSha256:fileSha(join(pred,"manifest.json")),
  parentSha256:fileSha(parentFile), previousSummarySha256:fileSha(join(pred,"summary.json")), priorBoundUsd:prior.totalBoundUsd,
  allStudyCapUsd:cohort.allStudyCapUsd, transportSha256:fileSha(transportFile), runnerSha256:fileSha(import.meta.path),
  environmentSha256:fileSha(join(here,"environment.mjs")), promptSha256:phase.systemSha256, toolsSha256:phase.toolsSha256,
  schedule:cohort.orderedCases
};
if (mode === "--freeze") {
  assert(!existsSync(manifestPath) && !existsSync(join(here,"ledger.json")));
  save(manifestPath, manifest); console.log(JSON.stringify({frozen:manifest.id, hash:fileSha(manifestPath), network:0})); process.exit(0);
}
assert.deepEqual(read(manifestPath), manifest);
const scratch = Bun.spawnSync(["rtk","proxy","python3","-I",join(here,"..","source-delta.py"),"restore","prediction"],{stdout:"pipe",stderr:"pipe"});
assert.equal(scratch.exitCode, 0, scratch.stderr.toString().slice(-800));
const product = scratch.stdout.toString().trim();
const privateDir = mkdtempSync(join(tmpdir(),"keating-final-addendum-"));
try { await run(); }
finally { rmSync(privateDir,{recursive:true,force:true}); rmSync(product,{recursive:true,force:true}); }

async function run() {
  await plugin({name:"addendum-product-markdown",setup(build) {
    build.onLoad({filter:/\.md(?:\?raw)?$/}, async args => ({loader:"js",contents:"export default "+JSON.stringify(await Bun.file(args.path.replace(/\?raw$/u,"")).text())}));
  }});
  const {withTeachingDraftGate} = await import(join(product,"web/src/keating/judgement/draft-gate.ts"));
  const {composeKeatingSystemPrompt} = await import(join(product,"web/src/keating/browser-tools/prompt.ts"));
  const {inspectOpenUIDiagnosticText} = await import(join(product,"web/src/keating/openui/diagnostic-components.ts"));
  const {parseReviewNotice} = await import(join(product,"web/src/keating/judgement/review-notice.ts"));
  const {TEACHING_POLICY_VERSION,projectTeachingPolicyDecision} = await import(join(product,"packages/learner-contracts/src/judgement/teaching-policy.ts"));
  const {createAssistantMessageEventStream} = await import(join(product,"node_modules/@earendil-works/pi-ai/dist/compat.js"));
  assert.equal(TEACHING_POLICY_VERSION, manifest.policy);
  const bundle = JSON.parse(gunzipSync(readFileSync(join(study,"inputs.json.gz"))));
  assert.equal(sha(bundle.prompt), manifest.promptSha256);
  assert.equal(sha(bundle.tools), manifest.toolsSha256);
  const basePrompt = composeKeatingSystemPrompt();
  assert.equal(sha(basePrompt), phase.baseSha256);
  copyFileSync(transportFile, join(privateDir,"transport.mjs"));
  writeFileSync(join(privateDir,"common.mjs"),"export * from "+JSON.stringify(join(here,"environment.mjs"))+";\n");
  const {makeTransport} = await import(join(privateDir,"transport.mjs"));
  const transport = await makeTransport(product,bundle.models,live,!live);
  const entries = transport.ledger.entries;
  const rows = [];

  for (const caseId of cohort.orderedCases) {
    const c = cohort.cases.find(item => item.id === caseId);
    const id = c.id + "--minimax--jev";
    const file = join(here,"receipts",id+".json");
    let row;
    if (live && existsSync(file)) row = read(file);
    else {
      row = await generate(c, id);
      if (live) {
        save(file, row);
        console.log(JSON.stringify({id, disposition:row.disposition, drafts:row.drafts.length, currentBoundUsd:usd(prior.totalBoundUsd+total(entries))}));
      } else {
        const original = read(file);
        const stable = value => ({...value,refs:value.refs.map(({source,...ref})=>ref)});
        assert.deepEqual(stable(row), stable(original), id);
        row = original;
      }
    }
    rows.push(row);
  }
  await transport.drain();
  let peak = prior.totalBoundUsd, cumulative = prior.totalBoundUsd;
  const linked = new Set();
  for (const row of rows) {
    for (const d of row.drafts) {
      const e = entries.find(e=>e.id===d.entryId);
      assert(e && e.kind === "tutor");
      assert.deepEqual(e.message, d.message);
      const req = JSON.parse(gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz"))));
      assert.deepEqual((req.tools??[]).map(t=>t.name), d.availableToolNames);
      linked.add(e.id);
    }
    for (const ref of row.refs) {
      if (!ref.entryId) { assert(!ref.ok); continue; }
      const e = entries.find(e=>e.id===ref.entryId);
      assert(e && e.kind==="decision" && e.requestSha256===ref.requestSha256);
      assert.equal(sha(e.request), ref.requestSha256);
      linked.add(e.id);
    }
  }
  assert.deepEqual(linked,new Set(entries.map(e=>e.id)));
  for (const e of entries) {
    const wire = gunzipSync(readFileSync(join(here,"wire",e.wireSha256+".json.gz")));
    assert.equal(sha(wire),e.wireSha256);
    const cfg = e.kind==="tutor" ? baseCohort.tutors.minimax : baseCohort.judges.jev;
    assert.equal(e.model,cfg.id); assert.equal(JSON.parse(wire.toString()).model,cfg.id);
    assert.equal(e.host,new URL(cfg.endpoint).host); assert.equal(e.reservedUsd,cfg.reserve);
    assert.equal(e.path,e.kind==="tutor"?"/anthropic/v1/messages":new URL(cfg.endpoint).pathname);
    assert(e.finishedAt && Date.parse(e.startedAt)<=Date.parse(e.finishedAt));
    assert.equal(e.accountedUsd,e.usage?usd((e.usage.inputTokens*cfg.input+e.usage.outputTokens*cfg.output)/1e6):e.reservedUsd);
    peak = Math.max(peak,usd(cumulative+e.reservedUsd)); cumulative=usd(cumulative+e.accountedUsd);
  }
  assert(peak<=cohort.allStudyCapUsd);
  const summary = {
    version:1, id:cohort.id, policy:manifest.policy, protocolSha256:fileSha(manifestPath),
    scheduled:rows.length, eligible:rows.filter(r=>r.disposition!=="ineligible").length, publicReplies:rows.filter(r=>r.public).length,
    receipts:Object.fromEntries(rows.map(r=>[r.id,fileSha(join(here,"receipts",r.id+".json"))])),
    providerRequests:entries.length, unknownUsage:entries.filter(e=>!e.usage).length,
    previousBoundUsd:prior.totalBoundUsd, newBoundUsd:total(entries), totalBoundUsd:cumulative, peakReservationUsd:peak, capUsd:cohort.allStudyCapUsd
  };
  if (live) save(join(here,"summary.json"),summary); else assert.deepEqual(summary,read(join(here,"summary.json")));
  console.log(JSON.stringify({mode,...summary,newProviderCalls:live?entries.length:0}));

  async function generate(c, id) {
    const row = {id,caseId:c.id,parent:c.parent,parentReceiptSha256:c.parent?manifest.parentSha256:null,
      kind:c.parent?"prospective-followup":"prospective-first-turn",policy:manifest.policy,tutor:"minimax",arm:"jev",
      prompt:c.learner,originalHistory:[],plan:null,refs:[],drafts:[],attempts:[],selectedAttempt:null,selectionRule:null,releaseReason:null,disposition:null,
      missing:null,public:null,publicEnvelope:null,notice:null};
    if (c.parent) {
      const parent = read(parentFile);
      if (!parent.public || parent.public.toolCalls.length) {
        row.disposition="ineligible"; row.missing=parent.public?"parent-native-tool-pending":"parent-has-no-public-answer"; return row;
      }
      row.originalHistory.push({role:"user",content:parent.prompt,timestamp:1},parent.public.message);
    }
    if (transport.ledger.hardStop) {row.disposition="budget-or-auth-stop";row.missing=transport.ledger.hardStop;return row;}
    let failure=null, state=null, review=0;
    async function judge(req, signal) {
      if (failure) return {ok:false,error:{code:"backend-unavailable",retryable:false}};
      const stage=req.questions.learning_task?"plan":req.questions.draft_choice?"selection":"review";
      const {outcome,ref}=await transport.decision("jev",req,id+"/"+stage+(stage==="review"?"/"+(++review):""),signal);
      row.refs.push(ref);
      if (!outcome.ok) failure=stage+"-"+outcome.error.code;
      else if (stage==="plan") {
        const p=projectTeachingPolicyDecision(req.state.turn,outcome);
        row.plan={status:p.status,action:p.interaction.action,offered:p.interaction.families.flatMap(f=>f.components),
          codePracticeLanguage:p.interaction.codePracticeLanguage??null, reason:p.interaction.reason??null,
          features:p.features, decisions:p.decisions, directives:p.directives};
      }
      return outcome;
    }
    async function tutor(_model, context, opts={}) {
      if (failure) throw Error("Cell already stopped");
      let generated;
      try { generated=await transport.tutor("minimax",context,opts.reasoning??null,id+"/tutor/"+(row.drafts.length+1),opts.signal); }
      catch (error) { failure="tutor-transport-unavailable";throw error; }
      const {message,entry}=generated, visible=displayMessage(message), complete=["stop","toolUse"].includes(message.stopReason);
      row.drafts.push({...visible,...inspectOpenUIDiagnosticText(visible.text),entryId:entry.id,completed:complete,
        availableToolNames:(context.tools??[]).map(t=>t.name),
        providedDirectives:row.plan?row.plan.directives.every(d=>context.systemPrompt.includes("- "+d)):null, systemSha256:sha(context.systemPrompt)});
      const stream=createAssistantMessageEventStream();
      if (complete) stream.push({type:"done",reason:message.stopReason,message});
      else {failure="tutor-"+(entry.http??"transport")+"-"+message.stopReason;stream.push({type:"error",reason:"error",error:message});}
      stream.end(message);return stream;
    }
    const gate=withTeachingDraftGate(tutor,{sessionId:c.parent??id,basePrompt:()=>basePrompt,makeCaller:()=>judge,
      maxAttempts:cohort.maxDrafts,timeoutMs:cohort.outerTimeoutMs,refinement:"ordinary",
      judgementModel:{id:cohort.decision,requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{state=s;}});
    try {
      const messages=[...row.originalHistory,{role:"user",content:c.learner,timestamp:1}];
      const stream=await gate(bundle.models.minimax,{systemPrompt:bundle.prompt,tools:bundle.tools,messages},{});
      row.publicEnvelope=displayMessage(sanitizeMessage(await stream.result()));
      const notice=parseReviewNotice(row.publicEnvelope.text);
      row.notice=notice?.kind??null;
      row.disposition=failure && state?.phase!=="released"?"provider-error":state?.phase??"unknown";
      if (row.disposition==="released") row.public={...row.publicEnvelope,...inspectOpenUIDiagnosticText(notice?.text??row.publicEnvelope.text)};
      else row.missing=failure??state?.reason??row.disposition;
    } catch { row.disposition="provider-error";row.missing=failure??"generation-or-transport-unavailable"; }
    row.attempts=(state?.attempts??[]).map(({generationMs,judgementMs,...rest})=>rest);
    row.selectedAttempt=state?.selectedAttempt??null;
    row.selectionRule=state?.selectionRule??null;
    row.releaseReason=state?.reason??null;
    return row;
  }
}
