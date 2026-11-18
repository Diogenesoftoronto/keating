// Replay two provider planning decisions. The session stops at the tutor prompt, with no generation or network.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileHash, read, sha } from "../gemini-decision/journal.mjs";
import { createSystemOneCaller } from "../../../../packages/learner-contracts/src/judgement/system-one.ts";
import { createGeminiDecisionCaller } from "../../../../scripts/openui-diagnostics/gemini-decision.ts";
import { runTeachingDrafts } from "../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { projectTeachingPolicyDecision, TEACHING_POLICY_VERSION } from "../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";
import { inspectEditableCodeLanguages } from "../../../../web/src/keating/openui/editable-code-evidence.ts";

const target = "keating-teaching-policy/v2.3.1", mode = process.argv[2] ?? "--verify";
assert(["--verify","--write"].includes(mode) && process.argv.length <= 3);
if (TEACHING_POLICY_VERSION !== target && mode === "--verify") {
  await import("./verify-with-frozen-source.mjs");
  process.exit(0);
}
assert.equal(TEACHING_POLICY_VERSION,target);
globalThis.fetch = async () => { throw Error("Python projection is offline"); };
const previous = file => join(import.meta.dir,"../policy-v2.3-completion",file);
assert.equal(fileHash(previous("ledger.json")),"d59321be0d302579339856562e5224eea2b5a16ee736c8a1bd19f6b175413dfa");
const ledger = read(previous("ledger.json")), models = read(join(import.meta.dir,"../cue-paraphrases/protocol.json")).providers;
const original = read(join(import.meta.dir,"../policy-v2.3/manifest.json"));
const snapshots = {jev:"25bb39c1fede158179dd468045bf98d6d50e42d3f3add1852af18595e8c05e85",google:"61c331dd5365fcb6e40514606aad162f1eec694be92c9df278a1dd166e6ce44f"};
const summarize = directives => ({editor:directives.some(text=>text.includes("editable fenced python")),
  genericOpenUI:directives.some(text=>text.includes("one requested OpenUI practice")),
  goalCapture:directives.some(text=>text.includes("Capture the concrete goal")),
  genericNextStep:directives.some(text=>text.includes("then let the learner respond"))});
const rows = [];
for (const provider of ["jev","google"]) {
  const id = "python-practice--"+provider, receiptFile = previous("receipts/"+id+".json");
  assert.equal(fileHash(receiptFile),snapshots[provider]);
  const receipt = read(receiptFile), entry = ledger.entries.find(row=>row.label === id+"/plan"), cfg = models[provider];
  assert.equal(entry.requestSha256,sha(entry.request));
  assert.equal(entry.model,cfg.id);
  assert.equal(entry.http,200);
  const turn = entry.request.state.turn;
  const fetch = async (url,init) => {
    assert.equal(url,cfg.endpoint); assert.equal(init.method,"POST"); assert.equal(sha(init.body),entry.wireSha256);
    return Response.json(entry.response,{status:entry.http});
  };
  const request = provider === "google" ? createGeminiDecisionCaller({apiKey:"offline",fetch})
    : createSystemOneCaller({apiKey:"offline",model:cfg.id,endpoint:cfg.endpoint,requireResolvedModel:true,fetch,
      retry:{maxAttempts:1,initialDelayMs:0,maxDelayMs:0}});
  let decision, plan, prompt, calls = 0;
  const stop = new AbortController();
  const run = await runTeachingDrafts({turn,signal:stop.signal,maxAttempts:1,timeoutMs:10000,refinement:"ordinary",
    judgementModel:{id:cfg.id,requestTokens:64000,stateQuestionTokens:32000},
    judge:async payload => {
      calls++;
      assert.deepEqual(payload,entry.request);
      decision = await request(payload);
      assert(decision.ok);
      plan = projectTeachingPolicyDecision(turn,decision);
      return decision;
    },
    generate:async input=>{prompt=input.systemPrompt;stop.abort();throw Error("Stop at the tutor prompt");}
  });
  assert.equal(calls,1);
  assert.equal(run.receipt.interaction.codePracticeLanguage,"python");
  assert(plan.directives.every(line=>prompt.includes("- "+line)));
  const before = {action:receipt.plan.action,offered:receipt.plan.offered,reason:receipt.plan.reason,
    codeLanguage:receipt.plan.codeLanguage,...summarize(receipt.plan.directives)};
  const after = {action:plan.interaction.action,offered:plan.interaction.families.flatMap(f=>f.components),
    reason:plan.interaction.reason ?? null,codeLanguage:run.receipt.interaction.codePracticeLanguage,...summarize(plan.directives)};
  assert.deepEqual(after.offered,before.offered);
  assert(after.editor && !after.genericOpenUI && !after.goalCapture);
  const editable = inspectEditableCodeLanguages(receipt.public.text);
  assert.deepEqual(editable,["python"]);
  rows.push({id,requestedModel:cfg.id,originalReceiptSha256:snapshots[provider],semanticRequestSha256:entry.requestSha256,
    wireSha256:entry.wireSha256,planningProbabilities:Object.fromEntries(["learning_task","practice_requested","hands_on_requested","executable_code","learner_response_due","project_goal_requested"]
      .map(key=>[key,decision.response.answers[key].noul])),before,after,newTutorPromptSha256:sha(prompt),
    originalTutor:{model:original.model,release:receipt.status,attempt:receipt.selectedAttempt,selectedReplySha256:sha(receipt.public.text),
      canonicalComponents:receipt.public.components,editableCode:editable},newTutorReply:null});
}
assert.equal(rows[0].semanticRequestSha256,rows[1].semanticRequestSha256);
assert(rows[0].before.genericOpenUI && rows[0].before.goalCapture && !rows[0].before.editor);
const output = {policy:target,originalPolicy:original.policy,scope:"post-hoc replay of recorded planning decisions",rows,
  networkRequests:0,newTutorCalls:0,newDecisionCalls:0,incrementalUsd:0};
const path = join(import.meta.dir,"replay.json");
if (mode === "--write") writeFileSync(path,JSON.stringify(output,null,2)+"\n",{flag:"wx"});
else assert.deepEqual(read(path),output);
console.log(JSON.stringify({rows:rows.length,editorGuidanceBefore:rows.filter(row=>row.before.editor).length,
  editorGuidanceAfter:rows.filter(row=>row.after.editor).length,goalsBefore:rows.filter(row=>row.before.goalCapture).length,
  goalsAfter:rows.filter(row=>row.after.goalCapture).length,originalReleasedPython:rows.filter(row=>row.originalTutor.editableCode.includes("python")).length,newTutorCalls:0}));
