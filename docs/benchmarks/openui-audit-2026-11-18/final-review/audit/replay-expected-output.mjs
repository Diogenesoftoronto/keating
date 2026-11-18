// A real web-gate replay of complete saved candidates. Missing decisions or changed request bytes abort; no tutor is invoked.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {gunzipSync} from "node:zlib";
import {plugin} from "bun";

globalThis.fetch=()=>{throw Error("Network disabled during expected-output replay");};
const study=resolve(import.meta.dir,"../study"), product=resolve(process.argv[3] ?? resolve(import.meta.dir,"../../../../.."));
assert(process.argv.length<=4 && (process.argv[2]===undefined || ["--verify","--record"].includes(process.argv[2])));
const asset=name=>readFileSync(join(study,name));
const hash=data=>createHash("sha256").update(typeof data==="string"||Buffer.isBuffer(data)?data:JSON.stringify(data)).digest("hex");
const name="supplement/coding/ledger.json";
assert.equal(hash(asset(name)),"b3914f30052d808cbcc89fa166daf9ede9bd7fa4c54bc81262c94ca9b2910af2");
assert.equal(hash(asset("inputs.json.gz")),"0528c8b452693eb54fa25b5203d2ef685ab0c9eb5cf7465ebb6c6e172fd3f60d");
const all=JSON.parse(asset(name)).entries, bundle=JSON.parse(gunzipSync(asset("inputs.json.gz")));
const judges=JSON.parse(asset("cohort.json")).judges;
await plugin({name:"expected-output-gate-markdown",setup(build){build.onLoad({filter:/\.md(?:\?raw)?$/},async args=>({
  contents:"export default "+JSON.stringify(await Bun.file(args.path.replace(/\?raw$/u,"")).text()),loader:"js"}));}});
const mod=path=>import(join(product,path));
const {withTeachingDraftGate}=await mod("web/src/keating/judgement/draft-gate.ts");
const {composeKeatingSystemPrompt}=await mod("web/src/keating/browser-tools/prompt.ts");
const {parseReviewNotice}=await mod("web/src/keating/judgement/review-notice.ts");
const {createSystemOneCaller}=await mod("packages/learner-contracts/src/judgement/system-one.ts");
const {createGeminiDecisionCaller}=await mod("scripts/openui-diagnostics/gemini-decision.ts");
const {createAssistantMessageEventStream}=await mod("node_modules/@earendil-works/pi-ai/dist/compat.js");
const {blocksRelease}=await mod("packages/learner-contracts/src/judgement/teaching-drafts/policy.ts");
const {TEACHING_POLICY_VERSION}=await mod("packages/learner-contracts/src/judgement/teaching-policy-catalog.ts");
const base=composeKeatingSystemPrompt();
const rows=[];
for(const entry of all.filter(e=>e.id.includes("/review/"))) {
  const [cell,,attempt]=entry.id.split("/"), arm=cell.split("--").at(-1);
  const old=JSON.parse(asset("supplement/coding/receipts/"+cell+".json"));
  const plan=all.find(e=>e.id===cell+"/plan"), tutor=all.find(e=>e.id===cell+"/tutor/"+attempt).message;
  assert.equal(old.drafts[Number(attempt)-1].text,tutor.content.filter(p=>p.type==="text").map(p=>p.text).join("\n"));
  const decoded=[];let snapshot,error,emitted=0;
  const judge=async request=>{
    try{
      const wire=request.questions.learning_task?plan:entry;
      assert.equal(hash(request),wire.requestSha256);assert.deepEqual(request,wire.request);
      // The ledger pins the sanitized response envelope. Its responseSha256 identifies the unretained raw HTTP bytes.
      assert(wire.response?.answers && wire.response.usage);assert.equal(wire.http,200);
      const cfg=judges[arm];
      const fetch=async(url,init)=>{
        assert.equal(String(url),cfg.endpoint);assert.equal(hash(init.body),wire.wireSha256);
        assert.equal(init.body,gunzipSync(asset("supplement/coding/wire/"+wire.wireSha256+".json.gz")).toString("utf8"));
        return Response.json(wire.response,{status:200});
      };
      const call=arm==="jev"?createSystemOneCaller({apiKey:"offline",endpoint:cfg.endpoint,model:cfg.id,requireResolvedModel:true,
        retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0},fetch}):createGeminiDecisionCaller({apiKey:"offline",fetch});
      const out=await call(request);assert(out.ok);decoded.push(wire.requestSha256);return out;
    }catch(e){error=e;throw e;}
  };
  const streamTutor=async()=>{
    if (++emitted>1) throw Error("No additional historical tutor candidate belongs to this single-candidate replay");
    const stream=createAssistantMessageEventStream();stream.push({type:"done",reason:tutor.stopReason,message:tutor});stream.end(tutor);return stream;
  };
  const gate=withTeachingDraftGate(streamTutor,{sessionId:"expected-result-"+cell+"-"+attempt,makeCaller:()=>judge,basePrompt:()=>base,
    maxAttempts:2,timeoutMs:10000,refinement:"ordinary",judgementModel:{id:judges[arm].id,requestTokens:64000,stateQuestionTokens:32000},onProgress:s=>{snapshot=s;}});
  const publicMsg=await (await gate(bundle.models.minimax,{systemPrompt:bundle.prompt,tools:bundle.tools,messages:[{role:"user",content:old.prompt,timestamp:1}]},{})).result();
  if (error) throw error;
  assert.equal(decoded.length,2);
  const publicText=publicMsg.content.filter(p=>p.type==="text").map(p=>p.text).join("\n");
  if(snapshot.phase==="released") assert.equal(parseReviewNotice(publicText)?.text ?? publicText,entry.request.state.reply.text);
  const saved=old.attempts[Number(attempt)-1], current=snapshot.attempts[0];
  const before=saved.checks.find(c=>c.id==="checkpoint_answer_leaked"), now=current.checks.find(c=>c.id==="checkpoint_answer_leaked");
  const raw=({applicability,...rest})=>rest;
  assert.deepEqual(before && raw(before),now && raw(now));
  const block=checks=>checks.filter(blocksRelease).map(c=>c.id);
  rows.push({cell,attempt:Number(attempt),tutorDraftSha256:hash(entry.request.state.reply.text),planSha256:decoded[0],reviewSha256:decoded[1],
    originalCell:old.disposition,originalAttempt:saved.status,originalBlocking:block(saved.checks),singleCandidateNow:snapshot.phase,
    newlyScoped:now?.applicability??null,rawCheckpoint:now&&raw(now),blockingNow:block(current.checks),
    advisoryTrace:current.checks.find(c=>c.id==="code_trace_missing")?.probability ?? null});
}
const output={measuredPolicy:"keating-teaching-policy/v2.3.4",replayPolicy:TEACHING_POLICY_VERSION,paidCalls:0,rows};
const result=join(import.meta.dir,"expected-output-replay.json");
if(process.argv[2]==="--record")writeFileSync(result,JSON.stringify(output,null,2)+"\n",{flag:"wx"});
else if(process.argv[2]==="--verify")assert.deepEqual(output,JSON.parse(readFileSync(result)));
console.log(JSON.stringify(output,null,2));
