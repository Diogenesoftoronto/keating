// Reconstruct the private prompt, never a model completion. The only transport returns a pinned recording.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

globalThis.fetch=()=>{throw Error("Network unavailable in directive replay");};
const here=import.meta.dir, study=resolve(here,"../study"), sealed=join(study,"classroom-v2.3.7");
const read=file=>readFileSync(file), json=file=>JSON.parse(read(file));
const sha=data=>createHash("sha256").update(typeof data==="string" || Buffer.isBuffer(data)?data:JSON.stringify(data)).digest("hex");
const args=process.argv.slice(2);assert(args.length<=2 && (!args[0]||["--verify","--record"].includes(args[0])));
const ledgerFile=join(sealed,"ledger.json"), originalFile=join(sealed,"receipts/classroom-tile-confirm--minimax--jev.json");
assert.equal(sha(read(ledgerFile)),"f00f2c044c93208189f4c67eab0b553e0fa12949bce09cc7b21dce6cced7ba54");
assert.equal(sha(read(originalFile)),"43137d6bcc3cdd31b5b136bfc77e00dd41074f679d649d198acf0f31d3883aa4");
assert.equal(sha(read(join(sealed,"source-delta.json.gz"))),"7045fa9fc97c180996d4684bbd9eedcc5e5ae270eb1651b77ba2eb2f57fd08ab");
const receipt=json(originalFile), [decision,tutor]=json(ledgerFile).entries, pin=json(join(study,"cohort.json")).judges.jev;
assert.equal(sha(decision.request),"0bdf4738bffd87d835c8c05f4e3dcb17185e627b3b49caaa812d50f0beb3b004");
function originalWire(entry) {
  const raw=gunzipSync(read(join(sealed,"wire",entry.wireSha256+".json.gz")));
  assert.equal(sha(raw),entry.wireSha256);
  return raw.toString("utf8");
}
const decisionWire=originalWire(decision), tutorWire=originalWire(tutor);
const beforeWire=JSON.parse(tutorWire), turn=decision.request.state.turn;
assert.equal(sha(tutorWire),"23e450bf0841c706f3e572d54eb7238b973edfc74d5572cdbe4b963e2acda005");
function restore(folder){
  const result=Bun.spawnSync(["rtk","proxy","python3","-I",join(folder,"source.py"),"restore"],{stdout:"pipe",stderr:"pipe"});
  assert.equal(result.exitCode,0,result.stderr.toString());
  const product=result.stdout.toString().trim();
  assert(product.startsWith(join(tmpdir(),"keating-final-classroom-")));
  return product;
}
const beforeProduct=restore(sealed);
const frozenNext=join(study,"classroom-v2.3.8");
const useFrozen=!args[1] && existsSync(join(frozenNext,"source-delta.json.gz"));
if (useFrozen) assert.equal(sha(read(join(frozenNext,"source-delta.json.gz"))),"aeebc83dbbb3b9322ced2974a140995dcb0e303f6d31a431d47ebe108feb2bd6");
const afterProduct=args[1]?resolve(args[1]):useFrozen?restore(frozenNext):resolve(here,"../../../../..");
try {
  const before=await capture(beforeProduct), after=await capture(afterProduct);
  assert.equal(before.version,"keating-teaching-policy/v2.3.7");
  assert.equal(after.version,"keating-teaching-policy/v2.3.8");
  assert.deepEqual(before.plan.directives,receipt.plan.directives);
  assert.deepEqual(before.plan.decisions,after.plan.decisions);
  assert.deepEqual(before.plan.features,after.plan.features);
  assert.deepEqual(before.plan.allowedTools,after.plan.allowedTools);
  assert.deepEqual(before.plan.interaction.families,after.plan.interaction.families);
  assert.equal(after.plan.interaction.action,before.plan.interaction.action);
  assert.equal(after.plan.interaction.continueInteraction?.typedAttempt,true);
  assert.equal(after.plan.directives.length,1);
  assert(after.plan.directives[0].includes("Give concise feedback"));
  assert(!after.prompt.includes("has not yet answered") && !after.prompt.includes("Choose one useful next learning step"));
  assert.equal(after.plan.decisions.attempt_present,true);assert.equal(after.plan.features.learner_response_due,false);
  // Prove the whole old generated fragment appears exactly once on the actual outgoing wire.
  // Replacing only that byte sequence on the original request leaves browser context, role order, headers in the body and tools alone.
  const oldText=JSON.stringify(before.prompt).slice(1,-1), newText=JSON.stringify(after.prompt).slice(1,-1);
  assert.equal(tutorWire.split(oldText).length,2);
  const newWire=tutorWire.replace(oldText,()=>newText), next=JSON.parse(newWire);
  assert.equal(newWire.replace(newText,()=>oldText),tutorWire);
  assert.equal(beforeWire.system.length,1);
  assert.equal(beforeWire.system[0].text.split(before.prompt).length,2);
  assert.equal(next.system[0].text,beforeWire.system[0].text.replace(before.prompt,()=>after.prompt));
  assert.deepEqual({...next,system:beforeWire.system},beforeWire);
  const checkedIds=["attempt_present","learner_response_due","learning_task","hands_on_requested","practice_requested","assessment_declined"];
  const evidence={kind:"offline same-decision prompt projection",version:1,providerCalls:0,
    originalReceiptSha256:sha(read(originalFile)),originalPlanRequestSha256:sha(decision.request),originalPlanWireSha256:sha(decisionWire),
    decisionModel:decision.response.model,recordedProbabilities:Object.fromEntries(checkedIds.map(id=>[id,decision.response.answers[id].noul])),
    previousQuestionPresentation:turn.previousQuestionPresentation,awaiting:turn.activeWork.openInteractions.map(({documentId,nodeId,state})=>({documentId,nodeId,state})),
    pendingSubmissions:turn.pendingSubmissions.length,old:{policy:before.version,action:before.plan.interaction.action,directives:before.plan.directives,
      originalTutorWireSha256:sha(tutorWire),privatePromptSha256:sha(before.prompt),completion:tutor.status,selectedAttempt:receipt.selectedAttempt},
    revised:{policy:after.version,action:after.plan.interaction.action,continued:after.plan.interaction.continueInteraction,directives:after.plan.directives,
      projectedTutorWireSha256:sha(newWire),privatePromptSha256:sha(after.prompt),newTutorOutput:null},
    identical:{planAppAndWire:true,decisionResponse:true,modelSettings:true,messages:true,tools:true,toolCount:next.tools.length,
      attachedToolNames:next.tools.map(t=>t.name),systemOutsideCapturedDraftPrompt:true},
    note:"The old body was actually dispatched. The revised full body is a reversible offline substitution of the real generator's new private prompt on the archived body. It has no attached provider response."};
  const output=join(here,"directive-replay.json");
  if(args[0]==="--record") writeFileSync(output,JSON.stringify(evidence,null,2)+"\n",{flag:"wx"});
  else assert.deepEqual(json(output),evidence);
  console.log(JSON.stringify({before:before.plan.directives,after:after.plan.directives,plan:sha(decision.request),old:sha(tutorWire),
    revisedProjection:sha(newWire),identicalTools:next.tools.length,paidCalls:0}));
} finally {
  rmSync(beforeProduct,{recursive:true,force:true});
  if(useFrozen) rmSync(afterProduct,{recursive:true,force:true});
}

async function capture(product) {
  const from=file=>import(join(product,"packages/learner-contracts/src/judgement",file));
  const { runTeachingDrafts }=await from("teaching-drafts.ts");
  const { projectTeachingPolicyDecision,TEACHING_POLICY_VERSION:version }=await from("teaching-policy.ts");
  const { createSystemOneCaller }=await from("system-one.ts");
  let plan,prompt,calls=0,error;
  const judge=async request=>{
    try {
      assert.equal(++calls,1);assert.deepEqual(request,decision.request);assert.equal(sha(request),decision.requestSha256);
      const caller=createSystemOneCaller({apiKey:"offline",endpoint:pin.endpoint,model:pin.id,requireResolvedModel:true,
        retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0},fetch:async (url,init)=>{
          assert.equal(String(url),pin.endpoint);assert.equal(init.body,decisionWire);return Response.json(decision.response);
        }});
      const out=await caller(request);assert(out.ok);
      plan=projectTeachingPolicyDecision(turn,out);return out;
    } catch(e){error=e;throw e;}
  };
  await runTeachingDrafts({turn,maxAttempts:1,timeoutMs:9000,maxReasoning:receipt.attempts[0]?.reasoning??"off",refinement:"ordinary",
    judgementModel:{id:pin.id,requestTokens:64000,stateQuestionTokens:32000},judge,
    generate:async input=>{assert.equal(input.attempt,1);prompt=input.systemPrompt;throw Error("Capture ended before tutor execution");}});
  if(error) throw error;
  assert.equal(calls,1);assert(typeof prompt==="string" && plan);
  return {plan,prompt,version};
}
