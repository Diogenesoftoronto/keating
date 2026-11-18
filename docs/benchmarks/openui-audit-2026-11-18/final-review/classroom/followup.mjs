import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {teachingPolicyDeterministicChecks,teachingToolHasRequiredSubmission} from "../../../../../packages/learner-contracts/src/judgement/teaching-policy.ts";

const study=resolve(import.meta.dirname,"../study");
const read=async path=>JSON.parse(await readFile(path,"utf8"));
const sha=b=>createHash("sha256").update(b).digest("hex");
const [ledger,cohort]=await Promise.all([read(join(study,"ledger.json")),read(join(study,"cohort.json"))]);
const entries=new Map(ledger.entries.map(x=>[x.id,x]));
const grading=new Set(["grade_quiz","grade_question_checks"]);
const cells=[];
for(const tutor of ["flash","minimax"]) for(const judge of ["jev","google"]) {
  const id="paper-followup--"+tutor+"--"+judge;
  const bytes=await readFile(join(study,"receipts",id+".json"));
  const source=JSON.parse(bytes);
  const plan=entries.get(source.refs[0].entryId);
  const turn=plan.request.state.turn;
  assert.equal(turn.learnerMessage,cohort.followup.learner);
  assert.equal(turn.conversation.length,2);
  assert.equal(turn.pendingSubmissions?.length??0,0);
  const drafts=[];
  for(const [index,draft] of source.drafts.entries()) {
    const entry=entries.get(draft.entryId);
    const wire=gunzipSync(await readFile(join(study,"wire",entry.wireSha256+".json.gz")));
    assert.equal(sha(wire),entry.wireSha256);
    const names=(JSON.parse(wire).tools??[]).flatMap(t=>
      (t.functionDeclarations??t.function_declarations??[t]).map(decl=>decl.name??decl.function?.name).filter(Boolean));
    const calls=draft.toolCalls.map(({name,arguments:args})=>({name,arguments:args}));
    const actual=teachingPolicyDeterministicChecks(turn,{text:draft.text,toolCalls:calls})
      .find(c=>c.id==="grading_requires_submission").status;
    const attempt=source.attempts[index];
    assert.equal(actual,attempt.checks.find(c=>c.id==="grading_requires_submission").status);
    drafts.push({attempt:attempt.attempt, providerSchemaCount:names.length,
      providerGradingSchemas:names.filter(n=>grading.has(n)),
      gradingSchemasWithRecordFilter:names.filter(n=>grading.has(n)&&teachingToolHasRequiredSubmission(n,turn.pendingSubmissions)),
      gradingCalls:calls.map(c=>c.name).filter(n=>grading.has(n)),recordGradeCheck:actual,observedReview:attempt.status,
      failedChecks:attempt.checks.filter(c=>c.status==="fail").map(c=>c.id),
      uncertainCheckpoint:attempt.checks.some(c=>c.id==="checkpoint_answer_leaked"&&c.status==="unknown"),
    });
  }
  cells.push({id,receiptSha256:sha(bytes),typedAttempt:source.plan.decisions.attempt_present,
    anotherLearnerResponseDue:source.plan.features.learner_response_due,offered:source.plan.offered,
    priorPublicComponent:(await read(join(study,"receipts","paper-fold--"+tutor+"--"+judge+".json"))).public.components,
    observedDisposition:source.disposition,selectedAttempt:source.selectedAttempt,pendingRecords:0,drafts});
}
console.log(JSON.stringify({scope:"Original wire and unchanged deterministic grading check with a counterfactual comparison of advertised schemas. No model generation or new release.",learner:cohort.followup.learner,cells},null,2));
