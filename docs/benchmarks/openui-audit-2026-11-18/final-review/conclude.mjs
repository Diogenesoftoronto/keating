// Join sealed phases only after the last eligible learner turn has finished.
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cohort, fileSha, read, usd } from "./study/common.mjs";
import { inspected } from "./blind.mjs";

const here=import.meta.dir;
const feedbackDir="study/feedback-v2.3.6";
const classroomDir="study/classroom-v2.3.7";
const correctionDir="study/classroom-v2.3.8";
const phasePaths=["study","study/supplement/coding","study/supplement/prediction","study/supplement/addendum",feedbackDir,classroomDir,correctionDir];
const decisions=read(join(here,"analysis.json"));
const protocol=[...read(join(here,"study/supplement/cohort.json")).cases,
  ...read(join(here,"study/supplement/addendum/cohort.json")).cases];
const phases=[], additional=[];
const feedback={source:feedbackDir+"/summary.json",pairedReviews:[],generated:[]};
let previous=cohort.priorBoundUsd;
for(const directory of phasePaths){
  const dir=join(here,directory),path=join(dir,"summary.json"), phase=read(path);
  assert.equal(phase.previousBoundUsd,previous);
  assert.equal(usd(previous+phase.newBoundUsd),phase.totalBoundUsd);
  assert.equal(phase.capUsd,10);
  const ids=Object.keys(phase.receipts);
  for(const id of ids) {
    const f=join(dir,"receipts",id+".json");
    assert.equal(fileSha(f),phase.receipts[id]);
    if(directory==="study") continue;
    const row=read(f);
    if(directory===classroomDir||directory===correctionDir){
      const original=directory===classroomDir;
      assert.equal(id,original?"classroom-tile-confirm--minimax--jev":"classroom-tile-linked-feedback--minimax--jev");
      assert.equal(phase.stageVerified,true);
      const outcome={id,caseId:"classroom-confirmation",decision:"jev",policy:phase.policy,disposition:phase.disposition,notice:row.notice??null,
        selectedAttempt:row.selectedAttempt??null,selectionRule:row.selectionRule??null,
        learner:read(join(dir,"cohort.json")).learner,receipt:directory+"/receipts/"+id+".json",receiptSha256:phase.receipts[id],
        source:directory+"/summary.json",stage:directory+"/stage.json"};
      if(original) feedback.mounted=outcome;
      else feedback.postCorrection=outcome;
      continue;
    }
    if(directory===feedbackDir) {
      const entry={id,caseId:row.caseId,decision:row.arm,policy:row.policy,disposition:row.disposition,
        missing:row.missing,notice:row.notice,selectedAttempt:row.selectedAttempt,selectionRule:row.selectionRule,
        completedDrafts:row.drafts.filter(d=>d.completed).length,receipt:directory+"/receipts/"+id+".json",
        receiptSha256:phase.receipts[id]};
      if(row.kind==="fresh-tutor") {
        feedback.generated.push(entry);
      } else {
        assert.equal(row.kind,"fixed-review");
        if(row.reviewSha256) assert.equal(phase.pairedSharedRequestHashes[row.caseId],row.reviewSha256);
        feedback.pairedReviews.push({...entry,candidateSha256:row.fixedCandidateSha256,reviewRequestSha256:row.reviewSha256});
      }
      continue;
    }
    const task=protocol.find(c=>c.id===row.caseId);
    assert.equal(task.learner,row.prompt);
    const pub=row.public?inspected(task,row.public):null;
    additional.push({id,phase:directory,policy:row.policy,tutor:row.tutor,decision:row.arm,caseId:row.caseId,
      disposition:row.disposition,missing:row.missing??null,notice:row.notice,completedDrafts:row.drafts.filter(d=>d.completed).length,
      selectedAttempt:row.selectedAttempt,selectionRule:row.selectionRule??null,
      publicComponents:pub?.components??null,publicEditors:pub?.editableCode??null,publicTools:pub?.tools.map(t=>t.name)??null,
      selectedControlLanguages:pub?.segments.flatMap(s=>s.type==="document"?s.document.nodes.filter(n=>n.type==="coding-challenge").map(n=>n.language):[])??null,
      recordedParent:row.parent??null,receipt:directory+"/receipts/"+id+".json",receiptSha256:phase.receipts[id]});
  }
  phases.push({directory,source:directory+"/summary.json",sha256:fileSha(path),policy:phase.policy,
    sealed:ids.length,requests:phase.providerRequests??phase.paidTransportRows,missingUsage:phase.unknownUsage??phase.usageMissing,
    previousBoundUsd:previous,additionalBoundUsd:phase.newBoundUsd,cumulativeBoundUsd:phase.totalBoundUsd});
  previous=phase.totalBoundUsd;
}
assert.deepEqual(phases.map(p=>p.sealed),[31,4,1,2,10,1,1]);
assert.equal(feedback.generated.length,2);
assert.equal(feedback.pairedReviews.length,8);
const reviewStagePath=feedbackDir+"/review-stage.json", reviewStage=read(join(here,reviewStagePath));
assert.equal(reviewStage.reviewed, feedback.pairedReviews.length);
for(const row of reviewStage.rows) {
  const recorded=feedback.pairedReviews.find(r=>r.caseId===row.id&&r.decision===row.arm);
  assert.equal(row.requestSha256,recorded.reviewRequestSha256);
}
feedback.reviewStage={path:reviewStagePath,sha256:fileSha(join(here,reviewStagePath)),
  matchedExpected:reviewStage.matchedStrictStatus,observed:reviewStage.reviewed};
const cueChecks=["v2.3.5","v2.3.6"].map(version=>{
  const path="cue-transfer/"+version+".json";
  const {positiveCorrect,positives,falsePositives,negativeControls,caseSha256}=read(join(here,path));
  assert.equal(fileSha(join(here,"cue-transfer/cases.json")),caseSha256);
  return {version,positiveCorrect,positives,falsePositives,negativeControls,path,sha256:fileSha(join(here,path))};
});
const preferencePath="assessment-opt-out/evidence.json", preference=read(join(here,preferencePath));
assert.equal(fileSha(join(here,"assessment-opt-out/turns.json")),preference.output["turns.json"]);
const main={schedule:24,observed:decisions.primary.final.observed,missing:decisions.primary.final.unknown,
  knownAction:decisions.primary.finalAction,authoredOpenUi:decisions.primary.firstFenced,publishedOpenUi:decisions.primary.finalFenced,
  publishedTypes:decisions.primary.types,editableCode:decisions.primary.edits,wordsOutsideControls:decisions.primary.wordsOutsidePublishedControl,
  grouped:decisions.counts.map(c=>({arm:c.arm,firstFit:c.first,finalFit:c.final,finalAction:c.finalAction,firstOfferUsed:c.firstOfferUsed,lastOfferUsed:c.finalOfferUsed}))};
const browserEvidence=["live-stage-light","recorded-question","recorded-python","final-prediction","final-python"].map(dir=>{
  const path="classroom/"+dir+"/evidence.json", evidence=read(join(here,path));
  const original=additional.find(r=>r.id===evidence.id);
  const source=original?.receipt??"study/receipts/"+evidence.id+".json";
  assert.equal(fileSha(join(here,source)),evidence.receiptSha256);
  assert.equal(evidence.settingsExportMatches,true);
  assert.equal(evidence.locallyRegisteredWebMcpMatchesCli,true);
  return {source:evidence.source,path,id:evidence.id,receiptSha256:evidence.receiptSha256,
    browserActions:evidence.actions.map(a=>a.step),pageErrors:evidence.pageErrors.length};
});
for(const [directory,record] of [["live-tile-confirm",feedback.mounted],["linked-tile-confirm",feedback.postCorrection]]) {
  const path="classroom/"+directory+"/evidence.json", mounted=read(join(here,path));
  assert.equal(mounted.cell,record.id);
  assert.equal(mounted.receiptSha256,record.receiptSha256);
  assert.equal(mounted.stageSha256,fileSha(join(here,record.stage)));
  assert.equal(mounted.disposition,record.disposition);
  assert.equal(mounted.locallyRegisteredWebMcpMatchesCli,true);
  browserEvidence.push({source:mounted.source,path,id:mounted.cell,receiptSha256:mounted.receiptSha256,
    browserActions:["type-answer-in-chat"],pageErrors:mounted.pageErrors.length,publicDisposition:mounted.disposition});
}
const result={version:1,primary:main,matchedFirstDrafts:decisions.pairedFirstFit,followup:decisions.followups,
  additional,feedback,cueChecks,assessmentOptOut:{path:preferencePath,sha256:fileSha(join(here,preferencePath)),...preference.summary},
  phases,budget:{previousStudiesBoundUsd:cohort.priorBoundUsd,newStudyBoundUsd:usd(previous-cohort.priorBoundUsd),totalBoundUsd:previous,capUsd:10,invoiceUsd:null},
  classroom:{live:browserEvidence.filter(r=>r.source.startsWith("live-")).length,
    replays:browserEvidence.filter(r=>r.source==="released-message-replay").length,evidence:browserEvidence,
    summary:"classroom/README.md"},production:{...read(join(here,"production-window.json")),buildReceipt:"production-build.json"},
  blindedReview:{uniqueBodies:read(join(here,"ratings.json")).length,sha256:decisions.ratingsSha256,source:"ratings.json"}};
const bytes=JSON.stringify(result,null,2)+"\n", destination=join(here,"final.json");
if(process.argv[2]==="--verify") assert.equal(readFileSync(destination,"utf8"),bytes);
else {assert.equal(process.argv.length,2);writeFileSync(destination,bytes);}
console.log(JSON.stringify({sealed:phases.reduce((sum,p)=>sum+p.sealed,0),additional:additional.length,...result.budget}));
