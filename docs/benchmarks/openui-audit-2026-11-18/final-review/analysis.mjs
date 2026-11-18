// Rebuild the research summaries and both portable, content-free recordings offline.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isOpenUiDiagnosticGateIssue, isOpenUiDiagnosticInterface, NATIVE_PAGE_STAGES,
  normalizeOpenUiComponent, openUiMatchesTargets, parseOpenUiDiagnosticExport, projectTeachingDraftSelection, summarizeOpenUiDiagnostics,
} from "../../../../packages/learner-contracts/src/openui-diagnostics.ts";
import { inspectSelectedOpenUIDiagnosticText } from "../../../../web/src/keating/openui/diagnostic-components.ts";
import { inspected, taskFor } from "./blind.mjs";
import { cohort, fileSha, read, receiptFile, root, studyCells } from "./study/common.mjs";

const here = import.meta.dir;
const summary = read(join(here,"study/summary.json"));
const ratings = read(join(here,"ratings.json"));
const scores = new Map(ratings.map(r => [r.id,r]));
assert.equal(ratings.length,scores.size);
const usedScores = new Set();
const components = list => [...new Set(list)].sort();
const decisions = ["jev","google","none"];
const countBy = names => Object.fromEntries(components(names).map(key => [key,names.filter(v=>v===key).length]));
function fraction(values) {
  assert(values.every(value => [true,false,null].includes(value)));
  const pass=values.filter(value=>value===true).length, unknown=values.filter(value=>value===null).length;
  return {pass,observed:values.length-unknown,unknown,scheduled:values.length};
}
function rateBy(rows,key) { return fraction(rows.map(row=>row[key])); }
function wordCounts(rows) {
  const words=rows.map(row=>row.final?.words).filter(value=>typeof value==="number").sort((a,b)=>a-b);
  if(!words.length) return {count:0,min:null,median:null,p90:null,max:null};
  const middle=(words.length-1)/2;
  return {count:words.length,min:words[0],median:(words[Math.floor(middle)]+words[Math.ceil(middle)])/2,
    p90:words[Math.ceil(words.length*0.9)-1],max:words.at(-1)};
}

function response(task, raw) {
  if (!raw || !["toolUse","stop"].includes(raw.message?.stopReason)) return null;
  const output = inspected(task,raw);
  const rating = scores.get(output.id);
  assert(rating && ["pass","partial","fail","unknown"].includes(rating.verdict), "Missing review for "+output.id);
  assert.equal(typeof rating.reason,"string");
  usedScores.add(output.id);
  return {...output, ...inspectSelectedOpenUIDiagnosticText(output.text), fit:rating.verdict, note:rating.reason,
    words:output.editorOutsideWords ?? (output.components.some(isOpenUiDiagnosticInterface) ? output.outsideWords : null)};
}
const passed = reply => reply && reply.fit !== "unknown" ? reply.fit==="pass" : null;
const fenced = reply => reply ? reply.components.some(isOpenUiDiagnosticInterface) : null;
function targetReached(task,reply) {
  if (!reply || !task.targets.length) return null;
  if (openUiMatchesTargets(reply.components,task.targets)) return true;
  if (task.targets.includes("editable-code") && reply.editableCode?.includes("python")) return true;
  if (reply.nativeProposed) return null;
  return false;
}
function checkedReceipt(cell) {
  const path=receiptFile(cell.id);
  assert.equal(fileSha(path),summary.receipts[cell.id]);
  const r=read(path), task=taskFor(cell);
  assert.equal(r.prompt,task.learner); assert.equal(r.arm,cell.arm); assert.equal(r.tutor,cell.tutor);
  const first=response(task,r.drafts[0]), final=response(task,r.public);
  const completed=r.drafts.filter(d=>d.completed);
  const allComponents=completed.length ? components(completed.flatMap(d=>d.components)) : null;
  const offered=components((r.plan?.offered??[]).map(normalizeOpenUiComponent).filter(Boolean));
  const gateIssues=components(r.attempts.flatMap(a=>a.checks.filter(c=>c.status!=="pass").map(c=>c.id)));
  const knownWithheld=r.disposition==="withheld";
  const selection=projectTeachingDraftSelection({phase:r.disposition,selectedAttempt:r.selectedAttempt,attempts:r.attempts,
    reason:r.notice==="unverified"?"best-effort-draft":undefined});
  return {...cell,first,final,allComponents,offered,gateIssues,planKnown:!!r.plan,attempts:completed.length,
    planStatus:r.plan?.status??null, action:r.plan?.action??null, provided:r.drafts[0]?.providedDirectives??null,
    selectedAttempt:r.selectedAttempt, selection, notice:r.notice, status:r.disposition, missing:r.missing, receiptSha256:summary.receipts[cell.id],
    firstFit:passed(first), finalFit:knownWithheld ? false : passed(final), firstFenced:fenced(first), finalFenced:knownWithheld ? false : fenced(final),
    firstAction:targetReached(task,first), finalAction:knownWithheld && task.targets.length ? false : targetReached(task,final),
    firstOfferUsed:first && offered.length ? openUiMatchesTargets(first.components,offered) : null,
    finalOfferUsed:offered.length && (knownWithheld || final) ? !!final && openUiMatchesTargets(final.components,offered) : null,
    attempted:completed.length ? completed.some(d=>d.attempted) : null, guidanceReason:r.plan?.reason, codePracticeLanguage:r.plan?.codePracticeLanguage};
}
const cells=studyCells.map(checkedReceipt);
assert.equal(usedScores.size,scores.size,"The review contains an unlinked response.");
const primary=cells.filter(r=>r.kind==="primary"), later=cells.filter(r=>r.kind==="followup");
assert.equal(primary.length,24); assert.equal(later.length,6);

function group(rows) {
  const opportunities=rows.filter(r=>taskFor(r).cue==="implicit-action");
  const offers=rows.filter(r=>r.action==="create" && r.offered.length && r.provided===true);
  const authored=rows.filter(r=>r.allComponents?.some(isOpenUiDiagnosticInterface));
  return {n:rows.length,first:rateBy(rows,"firstFit"),final:rateBy(rows,"finalFit"),
    firstFenced:rateBy(rows,"firstFenced"),finalFenced:rateBy(rows,"finalFenced"),
    firstAction:rateBy(opportunities,"firstAction"),finalAction:rateBy(opportunities,"finalAction"),
    firstOfferUsed:rateBy(offers,"firstOfferUsed"),finalOfferUsed:rateBy(offers,"finalOfferUsed"),
    draftedThenLost:fraction(authored.map(r=>r.finalFenced===null?null:!r.finalFenced)),
    types:countBy(rows.flatMap(r=>r.final?.components.filter(isOpenUiDiagnosticInterface)??[])),
    edits:countBy(rows.flatMap(r=>r.final?.editableCode??[])), nativeProposals:rows.filter(r=>r.final?.nativeProposed).length,
    wordsOutsidePublishedControl:wordCounts(rows),
    dispositions:countBy(rows.map(r=>r.status)), notices:countBy(rows.filter(r=>r.notice).map(r=>r.notice))};
}
const counts=decisions.map(arm=>({arm,...group(primary.filter(c=>c.arm===arm))}));
const tutors=["minimax","flash"].flatMap(tutor=>decisions.map(arm=>({tutor,arm,...group(primary.filter(c=>c.tutor===tutor&&c.arm===arm))})));
const caseResults=cohort.cases.map(task=>({caseId:task.id,...group(primary.filter(c=>c.caseId===task.id))}));

function portable(r,firstOnly) {
  const task=taskFor(r), plan=r.planKnown ? {
    source:r.arm==="jev"?"jev":"other",action:r.action??"unknown",targets:r.offered,delivered:r.provided,
    ...(r.guidanceReason?{reason:r.guidanceReason}:{}), ...(r.codePracticeLanguage?{codeLanguage:r.codePracticeLanguage}:{}),
  } : null;
  const outcome=r.final?"released":r.status==="withheld"?"withheld":"error";
  const questionRoot=r.kind==="followup"?"paper-fold":r.caseId;
  const selection = firstOnly ? null : r.final?.components??(outcome==="withheld"?[]:null);
  const nativeRequested = !firstOnly && r.final ? r.final.nativeProposed : !firstOnly && outcome==="withheld" ? false : null;
  // A captured public tool call was proposed. Runtime stages need a separate tool execution or browser observer.
  const nativePage=Object.fromEntries(NATIVE_PAGE_STAGES.map(k=>[k,nativeRequested===false?false:null]));
  return {schemaVersion:1,conversationId:questionRoot+"--"+r.tutor+"--"+r.arm,turnId:r.id,turnIndex:r.kind==="followup"?1:0,
    model:cohort.tutors[r.tutor].id,decisionModel:cohort.judges[r.arm]?.id??null,mode:r.arm==="none"?"baseline":"guided",
    cue:{kind:task.cue,targets:task.targets,...(r.caseId==="python-sum"?{codeLanguage:"python"}:{})},
    reply:firstOnly?"unknown":outcome,attempted:firstOnly?r.first?.attempted??null:r.attempted,
    compiled:firstOnly?r.first?.components??null:r.allComponents,selected:selection,rendered:null,
    nativePageRequested:nativeRequested,nativePage,guidance:plan, draftAttempts:firstOnly?Number(!!r.first):r.attempts,
    ...(!firstOnly && r.selection ? {selection:r.selection}:{}),
    ...(!firstOnly && r.final ? {outsideWords:r.final.outsideWords,editableCode:r.final.editableCode,
      codingChallengeLanguages:r.final.codingChallengeLanguages,editorOutsideWords:r.final.editorOutsideWords}:{}),
    experiment:{experimentId:cohort.id+(firstOnly?"-first":"-output"),caseId:r.caseId,pairId:r.tutor+"-"+r.caseId},
    ...(!firstOnly?{gateIssues:r.gateIssues.filter(isOpenUiDiagnosticGateIssue)}:{}),
    fit:{source:"fable-blind-task-fit-v1",passed:firstOnly?r.firstFit:r.finalFit}};
}
const firstRows=primary.map(r=>portable(r,true));
const deliveryRows=cells.filter(c=>c.arm!=="none" && c.status!=="ineligible").map(r=>portable(r,false));
const recording=rows=>({schemaVersion:1,turns:parseOpenUiDiagnosticExport(rows)});
const pairs=summarizeOpenUiDiagnostics(firstRows).comparisons;
assert.equal(pairs.length,4);
assert(pairs.every(p=>p.ambiguous===0 && p.unpaired===0));
const delivery=summarizeOpenUiDiagnostics(deliveryRows);
const unwrap = ({first,final,...r})=>({...r,firstResponse:first?.id??null,finalResponse:final?.id??null,
  firstComponents:first?.components??null,finalComponents:final?.components??null,finalEditableCode:final?.editableCode??null,
  firstVerdict:first?.fit??null,finalVerdict:final?.fit??null});
const classroom=read(join(here,"classroom/live-stage-light/evidence.json"));
assert.equal(fileSha(receiptFile(classroom.id)),classroom.receiptSha256);
const slider=classroom.actions.find(a=>a.step==="change-slider");
assert(slider.correctReadout);
const a=slider.before,b=slider.after;
const replayResults=read(join(here,"prediction-replay/patched.json")).results;
const repaired = new Map();
for (const key of ["target/jev-best-effort","target/google-approved-choice"]) {
  const result=replayResults[key];
  assert(result.status==="released" && result.recorded.hadOpenUi===false && result.publicHasOpenUi);
  assert.deepEqual(result.publicToolCalls,[]);
  const raw = inspected(taskFor(cells.find(c=>c.id===result.id)),{text:result.publicText,toolCalls:[]});
  assert(raw.components.includes("question-group"));
  repaired.set(result.id,{...raw,words:raw.outsideWords,fit:null,
    note:"Replaying the saved drafts and reviews selected attempt "+result.selectedAttempt+
      (result.notice==="unverified"?" as an unverified best-effort reply.":" as an approved reply.")});
}
assert.equal(repaired.size,2);
const study={counts,cells:cells.map(c=>({...c,replay:repaired.get(c.id)??null})),classroom:{headline:"One learner turn in the live local classroom",value:
  `At ${a.value} flashes per second the light flashed ${a.readouts[0].number} times in 12 seconds. Moving the control to ${b.value} changed the total to ${b.readouts[0].number}.`,
  href:"classroom/live-stage-light/classroom-after-action.png",
  document:inspected(cohort.classroom,read(receiptFile(classroom.id)).public).segments.find(p=>p.type==="document").document}};
const analysis={schemaVersion:1,policy:cohort.policy,cohortSha256:fileSha(join(here,"study/cohort.json")),
  ratingsSha256:fileSha(join(here,"ratings.json")),counts,tutors,caseResults,
  primary:group(primary),guided:group(primary.filter(r=>r.arm!=="none")),
  pairedFirstFit:pairs.map(({model,decisionModel,matchedPairs,ineligibleGuidance,fit})=>({model,decisionModel,matchedPairs,ineligibleGuidance,fit})),
  followups:{scheduled:later.length,physical:later.filter(r=>r.status!=="ineligible"&&r.status!=="budget-or-auth-stop").length,
    ...group(later),ineligible:later.filter(r=>r.status==="ineligible").map(r=>({id:r.id,reason:r.missing}))},
  guidedLearnerActionDelay:delivery.delays.learnerActionSelected,studyTotalBoundUsd:summary.totalBoundUsd,
  cells:cells.map(unwrap), classroom:{id:classroom.id,receiptSha256:classroom.receiptSha256,correctReadout:slider.correctReadout}};

export {study};
function output(path,value,verify) {
  const bytes=JSON.stringify(value,null,2)+"\n";
  if(verify) assert.equal(readFileSync(path,"utf8"),bytes,path);
  else writeFileSync(path,bytes);
}
if(import.meta.main) {
  const verify=process.argv[2]==="--verify";
  assert(process.argv.length===2||verify);
  for(const [local,example,rows] of [["first-drafts","final-review-first",firstRows],["turns","final-review",deliveryRows]]) {
    for(const path of [join(here,local+".json"),join(root,"web/src/keating/openui/examples",example+".json")]) output(path,recording(rows),verify);
  }
  output(join(here,"analysis.json"),analysis,verify);
  console.log(JSON.stringify({primary:firstRows.length,guidedPhysical:deliveryRows.length,uniqueRatedReplies:scores.size,verified:verify}));
}
