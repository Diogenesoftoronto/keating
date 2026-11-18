// --freeze and --verify run offline. --execute owns the shared study lock and can spend the remaining budget.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { plugin } from "bun";
import { credential, fileHash, read, root, save, sha, total, usd, withSharedLock } from "../gemini-decision/journal.mjs";
import { actor, cohort, judges, measuredTransport } from "./transport.mjs";
import { projectTeachingPolicyDecision, TEACHING_POLICY_VERSION } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { createBenchmarkRegistry } from "../../../../scripts/prompt-adherence/providers.ts";
import { createAssistantMessageEventStream, streamSimple } from "../../../../node_modules/@earendil-works/pi-ai/dist/compat.js";

const here = import.meta.dir;
const mode = process.argv[2] ?? "--dry";
assert(["--dry", "--preflight", "--freeze", "--execute", "--verify"].includes(mode) && process.argv.length <= 3);
assert.equal(fileHash(join(here, "cohort.json")), "a657b4e42f35726b7ecd17673c29d5b1b81df62e347f87d4d81860432c92985f");
const preflight = mode === "--preflight";
const outputDir = preflight ? mkdtempSync(join(tmpdir(), "keating-interface-smoke-")) : here;
if (preflight) process.on("exit", () => rmSync(outputDir, { recursive: true, force: true }));
const manifestPath = join(outputDir, "manifest.json"), bundlePath = join(outputDir, "inputs.json.gz"), receipts = join(outputDir, "receipts");
if (mode === "--dry") {
  console.log(JSON.stringify({scheduled:cohort.cases.length * 2, tutorCells:cohort.cases.filter(c => c.kind === "live").length * 2,
    prior:cohort.previousBoundUsd, cap:cohort.studyCapUsd, networkRequests:0}));
  process.exit(0);
}
await plugin({ name:"audit-local-markdown", setup(b) {
  b.onLoad({ filter:/\.md(?:\?raw)?$/ }, async args =>
    ({ contents:"export default " + JSON.stringify(await Bun.file(args.path.replace(/\?raw$/, "")).text()), loader:"js" }));
} });
const { composeKeatingSystemPrompt } = await import("../../../../web/src/keating/browser-tools/prompt.ts");
const { withTeachingDraftGate } = await import("../../../../web/src/keating/judgement/draft-gate.ts");
const { parseReviewNotice } = await import("../../../../web/src/keating/judgement/review-notice.ts");
const { inspectOpenUIDiagnosticText } = await import("../../../../web/src/keating/openui/diagnostic-components.ts");
const base = composeKeatingSystemPrompt();
const policyFiles = ["packages/learner-contracts/src/judgement/teaching-policy.ts", "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts",
  "packages/learner-contracts/src/judgement/interaction-affordances.ts", "packages/learner-contracts/src/judgement/teaching-drafts.ts",
  "packages/learner-contracts/src/judgement/teaching-drafts/session.ts", "packages/learner-contracts/src/judgement/teaching-drafts/policy.ts",
  "packages/learner-contracts/src/judgement/teaching-drafts/checkpoint-scope.ts", "packages/learner-contracts/src/judgement/teaching-policy-types.ts",
  "packages/learner-contracts/src/judgement/code-practice-language.ts", "packages/learner-contracts/src/judgement/system-one.ts",
  "packages/learner-contracts/src/judgement/wire.ts", "scripts/openui-diagnostics/gemini-decision.ts",
  "web/src/keating/judgement/draft-gate.ts", "web/src/keating/openui/diagnostic-components.ts"];
const policyHashes = Object.fromEntries(policyFiles.map(file => [file,fileHash(join(root,file))]));
if (mode === "--freeze" || preflight) {
  assert(!existsSync(manifestPath) && !existsSync(join(here, "ledger.json")), "Already frozen or dispatched");
  const dir = mkdtempSync(join(tmpdir(), "keating-interface-inputs-"));
  try {
    const output = join(dir, "system.txt");
    const exported = Bun.spawnSync([process.execPath, join(root, "scripts/training/export_system_prompt.ts"), output], {cwd:root, stdout:"pipe", stderr:"pipe"});
    assert.equal(exported.exitCode, 0, exported.stderr.toString().slice(-900));
    const metadata = read(output + ".metadata.json"), prompt = readFileSync(output, "utf8");
    assert(metadata.verifiedEqualToOriginalWebBuilder && prompt.startsWith(base));
    assert.equal(sha(prompt),metadata.promptSha256);
    const tools = read(join(dir, "tool-schemas.json")).map(x => x.function);
    const registry = await createBenchmarkRegistry(join(root, ".keating/pi-config"));
    const configured = registry.find(actor.provider, actor.id);
    assert(configured && configured.baseUrl === actor.endpoint);
    const model = Object.fromEntries(["id","name","api","provider","baseUrl","reasoning","input","cost","contextWindow","maxTokens","compat"]
      .filter(k => configured[k] !== undefined).map(k => [k,configured[k]]));
    writeFileSync(bundlePath, gzipSync(JSON.stringify({prompt, tools, model})), {flag:"wx"});
    save(manifestPath, { frozenAt:new Date().toISOString(), cohortSha256:fileHash(join(here,"cohort.json")),
      inputsSha256:fileHash(bundlePath), policy:TEACHING_POLICY_VERSION, systemSha256:sha(prompt), baseSha256:sha(base),
      toolsSha256:sha(tools), model:actor.id, sourceHashes:metadata.sourceSha256, policyHashes,
      runnerSha256:fileHash(import.meta.path), transportSha256:fileHash(join(here,"transport.mjs")) });
    console.log("Frozen actual new-user web prompt, tool declarations and model, with no requests.");
  } finally { rmSync(dir,{recursive:true,force:true}); }
  if (!preflight) process.exit(0);
}
const manifest = read(manifestPath);
assert.deepEqual(policyHashes,manifest.policyHashes,"Current policy source differs from the frozen run.");
assert.equal(fileHash(bundlePath),manifest.inputsSha256);
assert.equal(manifest.policy,TEACHING_POLICY_VERSION);
assert.equal(manifest.cohortSha256,fileHash(join(here,"cohort.json")));
assert.equal(manifest.runnerSha256,fileHash(import.meta.path));
assert.equal(manifest.transportSha256,fileHash(join(here,"transport.mjs")));
const bundle = JSON.parse(gunzipSync(readFileSync(bundlePath)));
assert.equal(sha(bundle.prompt),manifest.systemSha256);
assert.equal(sha(base),manifest.baseSha256);
assert.equal(sha(bundle.tools),manifest.toolsSha256);
const live = mode === "--execute";
if (live) withSharedLock();
const identity = {api:bundle.model.api,provider:bundle.model.provider,model:bundle.model.id};
const zeroUsage = {input:0, output:0, cacheRead:0, cacheWrite:0, totalTokens:0, cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
function syntheticAssistant(text) {
  return {role:"assistant",...identity,content:[{type:"text",text}],usage:zeroUsage,stopReason:"stop",timestamp:1};
}
function streamOf(message) {
  const stream = createAssistantMessageEventStream();
  if (["error","aborted"].includes(message.stopReason)) stream.push({type:"error",reason:message.stopReason,error:message});
  else stream.push({type:"done",reason:message.stopReason === "toolUse" ? "toolUse" : "stop",message});
  stream.end(message);
  return stream;
}
const publicText = message => message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
const transport = preflight ? {ledger:{entries:[]}} : measuredTransport(live, fileHash(manifestPath));
if (preflight) globalThis.fetch = async () => { throw Error("Preflight never dispatches a request"); };
let tutorAuth;
const keys = {};
if (live) {
  keys.jev = credential("TYPESAFE_API_KEY","typesafe_api_key");
  keys.google = credential("GEMINI_API_KEY","gemini") || process.env.GOOGLE_API_KEY;
  const registry = await createBenchmarkRegistry(join(root, ".keating/pi-config"));
  tutorAuth = await registry.getApiKeyAndHeaders(registry.find(actor.provider,actor.id));
  tutorAuth = {...tutorAuth, apiKey:tutorAuth.apiKey || credential("MINIMAX_API_KEY","minimax")};
  assert(keys.jev && keys.google && tutorAuth.apiKey, "Required configured study credentials unavailable");
  mkdirSync(receipts,{recursive:true});
}

async function runCell(c, provider) {
  const id = c.id + "--" + provider, phases = [], drafts = [];
  const pending = new Set();
  function track(fn) {
    return (...args) => {
      const running = fn(...args);
      pending.add(running);
      running.then(() => pending.delete(running), () => pending.delete(running));
      return running;
    };
  }
  const controller = new AbortController();
  const messages = [...c.history.map(m => m.role === "assistant" ? syntheticAssistant(m.content) : {...m,timestamp:1}),
    {role:"user", content:c.learner, timestamp:1}];
  let plan = null, last = null, failed = false;
  const judge = async (request, signal) => {
    if (failed) return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    const phase = request.questions.learning_task ? "plan" : request.questions.draft_choice ? "select" : "review";
    const out = preflight ? {ok:true,response:{backend:{backend:"system-one",model:"offline-test-double",calibrationSha256:null},
      answers:Object.fromEntries(Object.entries(request.questions).filter(([,q])=>q.type==="noul").map(([k])=>[k,{type:"noul",probability:0.01}]))}}
      : await transport.decision(provider, keys[provider] || "offline",request,id + "/" + phase,signal);
    phases.push({phase,requestSha256:sha(request),ok:out.ok, model:out.ok ? out.response.backend.model : null,
      errorCode:out.ok ? null : out.error.code});
    if (!out.ok) failed = true;
    if (out.ok && phase === "plan") {
      const p = projectTeachingPolicyDecision(request.state.turn,out);
      plan = {action:p.interaction.action, offered:p.interaction.families.flatMap(f => f.components),
        reason:p.interaction.reason ?? null,directives:p.directives};
    }
    if (c.kind === "plan") controller.abort();
    return out;
  };
  const tutor = async (_model,ctx,opts) => {
    if (failed || c.kind === "plan") throw Error("No generation after stopping at the plan");
    const label = id + "/tutor/" + (drafts.length + 1);
    const message = c.kind === "fixed" || preflight ? syntheticAssistant(c.draft ?? "24.")
      : await transport.tutor(label,ctx,async () => {
        const stream = streamSimple(bundle.model,ctx,{...opts,...tutorAuth,temperature:0,maxTokens:cohort.maxOutputTokens,
          maxRetries:0,maxRetryDelayMs:0,timeoutMs:60000,cacheRetention:"none",onPayload:async (p,m) => {
            const payload=(await opts?.onPayload?.(p,m)) ?? p;
            assert(Buffer.byteLength(JSON.stringify(payload)) <= 160000,"Tutor input exceeds reservation");return payload;
          }});
        return stream.result();
      });
    const text = publicText(message);
    drafts.push({label, kind:c.kind, systemSha256:sha(ctx.systemPrompt), text, ...inspectOpenUIDiagnosticText(text),
      guidanceDelivered:plan ? plan.directives.every(d => ctx.systemPrompt.includes("- " + d)) : null,
      tools:message.content.filter(p => p.type === "toolCall").map(p => p.name), stop:message.stopReason});
    if (["error","aborted"].includes(message.stopReason)) failed=true;
    return streamOf(message);
  };
  const gate=withTeachingDraftGate(track(tutor),{sessionId:id,basePrompt:()=>base,makeCaller:()=>track(judge),
    maxAttempts:c.kind === "fixed" ? 1 : cohort.maxDrafts,timeoutMs:150000,refinement:"ordinary",
    judgementModel:{id:judges[provider].id,requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{last=s;}});
  const stream=await gate(bundle.model,{systemPrompt:bundle.prompt,messages,tools:bundle.tools},{signal:controller.signal});
  const msg=await stream.result(), text=publicText(msg), notice=parseReviewNotice(text);
  while (pending.size) await Promise.allSettled([...pending]);
  const status = failed ? "provider-error" : c.kind === "plan" && plan ? "plan-only" : last?.phase ?? "unknown";
  const visible = status === "released" ? {text, ...inspectOpenUIDiagnosticText(text),
    tools:msg.content.filter(p=>p.type==="toolCall").map(p=>p.name)} : null;
  return {id,caseId:c.id,provider,decisionModel:judges[provider].id,kind:c.kind,phases,plan,drafts,status,
    public:visible, notice:notice?.kind ?? null,selectedAttempt:last?.selectedAttempt ?? null,
    findings:(last?.attempts??[]).map(a=>({attempt:a.attempt,status:a.status,checks:a.checks.filter(f=>f.status!=="pass")
      .map(({id,status,probability,...rest})=>({id,status,probability,...(rest.applicability ? {applicability:rest.applicability} : {})}))}))};
}
const records=[];
if (preflight) {
  const result = await runCell(cohort.cases[0], "jev");
  assert(result.phases.some(p => p.phase === "plan") && result.phases.some(p => p.phase === "review") && result.drafts.length);
  assert.equal(transport.ledger.entries.length, 0);
  console.log("Actual exporter, model lookup and web gate exercised through a plan, tutor draft and review with offline doubles.");
  process.exit(0);
}
for (const c of cohort.cases) {
  for (const provider of Object.keys(judges)) {
    const id=c.id+"--"+provider,path=join(receipts,id+".json");
    if (live && existsSync(path)) { records.push(read(path)); continue; }
    if (live) save(path,{id,caseId:c.id,provider,kind:c.kind,status:"interrupted"});
    const record=JSON.parse(JSON.stringify(await runCell(c,provider)));
    if (live) save(path,record);
    else assert.deepEqual(record,read(path),"Replayed result differs for "+id);
    records.push(record);
    console.log(JSON.stringify({id,status:record.status,offered:record.plan?.offered,released:record.public?.components,
      accountedUsd:total(transport.ledger.entries)}));
  }
}
const summary={ policy:manifest.policy,scheduled:cohort.cases.length*2,rows:records.map(r=>({
  id:r.id,kind:r.kind,status:r.status,offered:r.plan?.offered ?? null,planReason:r.plan?.reason ?? null,
  selected:r.public?.components ?? null,nativeRequested:r.public ? r.public.tools.includes("interactive_page") : null,
  selectedAttempt:r.selectedAttempt,drafts:r.drafts?.length ?? null,
})), providerRequests:transport.ledger.entries.length, incrementalBoundUsd:total(transport.ledger.entries),
  cumulativeBoundUsd:usd(cohort.previousBoundUsd+total(transport.ledger.entries)) };
assert(summary.cumulativeBoundUsd<=cohort.studyCapUsd);
for (const c of cohort.cases) {
  const hashes=records.filter(r=>r.caseId===c.id).map(r=>r.phases?.find(p=>p.phase==="plan")?.requestSha256);
  if(hashes.every(Boolean))assert.equal(hashes[0],hashes[1],"Planning inputs differ for "+c.id);
}
if (live) save(join(here,"summary.json"),summary); else assert.deepEqual(summary,read(join(here,"summary.json")));
console.log(JSON.stringify({mode, rows:summary.scheduled,requests:summary.providerRequests,boundUsd:summary.cumulativeBoundUsd}));
