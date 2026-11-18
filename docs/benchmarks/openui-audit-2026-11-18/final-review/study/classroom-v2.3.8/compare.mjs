import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileSha, read, save, sha } from "../common.mjs";

const here=import.meta.dir,mode=process.argv[2],off=read(join(here,"old-plan.json"));
assert(process.argv.length===3 && ["--record","--verify"].includes(mode));
assert(off.correctedOnSameInput && off.versions[0].containsFalseDirective && !off.versions[1].containsFalseDirective);
function observed(dir) {
  const summary=read(join(dir,"summary.json")),ledger=read(join(dir,"ledger.json"));
  const [id,seal]=Object.entries(summary.receipts)[0],f=join(dir,"receipts",id+".json"),row=read(f);
  assert.equal(fileSha(f),seal);
  const plan=ledger.entries.find(e=>e.kind==="decision");
  assert.equal(plan.id,row.refs[0].entryId);
  const tutorWires=row.drafts.map(d=>{
    const e=ledger.entries.find(v=>v.id===d.entryId),raw=gunzipSync(readFileSync(join(dir,"wire",e.wireSha256+".json.gz")));
    assert.equal(sha(raw),e.wireSha256);const body=JSON.parse(raw);
    const prompt=typeof body.system==="string"?body.system:body.system.map(s=>s.text??"").join("\n");
    return {entryId:e.id,bodySha256:e.wireSha256,tutor:e.model,reportedModels:e.reportedModels,http:e.http,
      outputTokens:e.usage?.outputTokens??null,maxOutputTokens:body.max_tokens,stop:e.status,
      containsEarlierFalseDirective:prompt.includes(off.earlierFalseDirective),allPlanDirectives:d.providedDirectives,
      gradeToolAdvertised:(body.tools??[]).some(t=>["grade_quiz","grade_question_checks"].includes(t.name))};
  });
  return {id,policy:summary.policy,manifestSha256:summary.manifestSha256,receiptSha256:seal,stageSha256:summary.stageSha256,
    sourceSha256:read(join(dir,"manifest.json")).sourceDeltaSha256,priorBoundUsd:summary.previousBoundUsd,costUsd:summary.newBoundUsd,
    cumulativeBoundUsd:summary.totalBoundUsd,matchedPresentation:row.stagedPresentation.openInteractions[0],
    pendingSubmissions:row.stagedPresentation.pendingSubmissions,
    planningRequestSha256:plan.requestSha256,planningWireSha256:plan.wireSha256,
    freshRawResponseDue:plan.response?.answers?.learner_response_due??null,projectedResponseDue:row.plan?.features?.learner_response_due??null,
    planAction:row.plan?.action??null,plannedFamilies:row.plan?.offered??[],tutorWires,
    logicalGenerationAttempts:row.attempts.length,completeCandidates:row.drafts.filter(d=>d.completed).length,
    candidateReviews:row.refs.filter(r=>r.label.includes("/review/")).length,
    selectedAttempt:row.selectedAttempt,reviewNotice:row.notice,disposition:row.disposition,
    releasedText:row.public?.text??null,outerWords:row.public?.outsideWords??null,nativeProposals:row.public?.toolCalls.map(t=>t.name)??null};
}
const original=observed(join(here,"..","classroom-v2.3.7")),current=observed(here);
assert.equal(original.tutorWires[0].containsEarlierFalseDirective,true);
assert.equal(original.cumulativeBoundUsd,current.priorBoundUsd);
const result={design:"Sequential, non-blind implementation checks with a freshly mounted copy of the same parent and the same typed learner answer.",
  selection:"The requirement to remove the earlier contradiction was evaluated only on the historical response. The fresh provider decision was retained as returned.",
  sharedHistoricalPlanProofSha256:fileSha(join(here,"old-plan.json")),codeSha256:fileSha(import.meta.path),original,current,newProviderCalls:0};
const output=join(here,"comparison.json");
if(mode==="--record")save(output,result);else assert.deepEqual(result,read(output));
console.log(JSON.stringify({mode,registered:2,original:original.disposition,current:current.disposition,
  originalSentContradiction:original.tutorWires.map(w=>w.containsEarlierFalseDirective),
  currentSentEarlierDirective:current.tutorWires.map(w=>w.containsEarlierFalseDirective),totalBoundUsd:current.cumulativeBoundUsd,newProviderCalls:0}));
