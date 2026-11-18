// Independent offline recount from raw archived replies, terminal status, declared cases, and bound journals.
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {resolve, join} from "node:path";
import {inspectSelectedOpenUIDiagnosticText} from "../../../../../web/src/keating/openui/diagnostic-components";
import {normalizeOpenUiComponent, isOpenUiDiagnosticInterface, openUiMatchesTargets, summarizeOpenUiDiagnostics} from "../../../../../packages/learner-contracts/src/openui-diagnostics.ts";

const study = resolve(import.meta.dir,"../..");
const read = name => JSON.parse(readFileSync(join(study,name)));
const cases = new Map(read("scenarios.json").map(c=>[c.id,c]));
const terminal = r => r && ["toolUse","stop"].includes(r.stop);
const inspect = text => inspectSelectedOpenUIDiagnosticText(text ?? "");
const has = observation => observation?.components.some(isOpenUiDiagnosticInterface) ?? false;
const rows = [];
for (const source of readdirSync(join(study,"evidence")).filter(f=>f.includes("--") && f.endsWith(".json")).sort()) {
  const r = read("evidence/"+source);
  if (r.cohort && r.cohort !== "primary") continue;
  const c = cases.get(r.scenario);
  const offered = [...new Set(r.decision?.families.flatMap(f=>f.components.map(normalizeOpenUiComponent).filter(Boolean)) ?? [])];
  const drafts = r.drafts.map(d=>terminal(d.response) ? inspect(d.response.text) : null);
  const final = r.phase === "released" && r.selection && terminal(r.drafts.find(d=>d.attempt===r.selection)?.response)
    ? inspect(r.release?.text ?? r.publicText) : null;
  const control = terminal(r.counterfactual?.response) ? inspect(r.counterfactual.response.text) : null;
  rows.push({id:r.id,model:r.model,caseId:r.scenario,c,offered,drafts,final,control});
}
const count = (list, condition) => list.filter(condition).length;
const match = (observation,targets) => observation ? openUiMatchesTargets(observation.components,targets) : false;
assert.equal(new Set(rows.map(r=>r.model+"/"+r.caseId)).size,20);
const op = rows.filter(r=>r.c.group==="opportunity"), text = rows.filter(r=>r.c.group==="control");
const named = op.filter(r=>r.offered.length), paired = named.filter(r=>r.drafts[0] && r.control);
const november = {
  scheduled:rows.length, opportunities:op.length, firstCompleted:count(op,r=>r.drafts[0]), firstCompiled:count(op,r=>has(r.drafts[0])),
  anyDraftCompiled:count(op,r=>r.drafts.some(has)), finalCompiled:count(op,r=>has(r.final)),
  familyFit:count(op,r=>match(r.final,r.c.fit)), familyAndLanguage:count(op,r=>match(r.final,r.c.fit) && (r.caseId!=="code" || r.final.codingChallengeLanguages.includes("python"))),
  questions:count(op,r=>match(r.final,["question"])), namedOffers:named.length, selectedNamedFamily:count(named,r=>match(r.final,r.offered)),
  model:[...new Set(op.map(r=>r.model))].map(model=>({model,opportunities:count(op,r=>r.model===model),
    compiled:count(op,r=>r.model===model && r.drafts.some(has)),selected:count(op,r=>r.model===model && has(r.final))})),
  pairedFirstDrafts:{pairs:paired.length,anyWith:count(paired,r=>has(r.drafts[0])),anyWithout:count(paired,r=>has(r.control)),
    familyWith:count(paired,r=>match(r.drafts[0],r.offered)),familyWithout:count(paired,r=>match(r.control,r.offered))},
  directText:{scheduled:text.length,withoutFencedControl:count(text,r=>r.final && !has(r.final))},
};
const s = read("summary.json").primary;
assert.deepEqual([november.anyDraftCompiled,november.finalCompiled,november.familyFit,november.familyAndLanguage,november.questions,november.selectedNamedFamily],
  [s.validPrivate,s.validFinal,s.formFit,s.requestFit,s.questions,s.offersMatched]);
const pairedJudges = read("gemini-decision/comparison.json").fresh;
const judged = Object.fromEntries(["jev","gemini"].map(key=>{
  const opportunities = pairedJudges.filter(r=>r.cue.kind==="implicit-action").map(r=>{
    const raw = read(join("gemini-decision",r[key].source));
    const observation = inspect(raw.phase==="released" ? raw.public.text : "");
    const completed = raw.drafts.filter(d=>terminal(d.response)).length;
    assert.deepEqual(observation.components,r[key].selected);
    assert.equal(completed,r[key].completedCandidates);
    return {matched:match(observation,r.cue.targets),completed};
  });
  const assessed = pairedJudges.filter(r=>r[key].fit!==null);
  return [key,{scheduled:pairedJudges.length,opportunities:opportunities.length,
    matchedFenced:count(opportunities,r=>r.matched),withCompletedDraft:count(opportunities,r=>r.completed>0),
    assessed:assessed.length,passedSavedRubric:count(assessed,r=>r[key].fit),
    classroomsObserved:count(pairedJudges,r=>r[key].rendered!==null)}];
}));
const episodes = summarizeOpenUiDiagnostics(read("../../../web/src/keating/openui/examples/terminal-episodes.json").turns,{cue:"implicit-action"}).delays.selected;
const original = read("policy-v2.3/ledger.json").entries;
const completed = read("policy-v2.3-completion/ledger.json").entries;
assert.deepEqual(completed.slice(0,original.length),original);
const sources = ["evidence/budget.json","policy-v2/ledger.json","policy-v2.1/ledger.json","policy-holdout/ledger.json",
  "policy-holdout/segment-two-ledger.json","gemini-decision/ledger.json","cue-paraphrases/ledger.json","policy-v2.2/ledger.json",
  "policy-v2.3-completion/ledger.json","policy-v2.3.2-review/ledger.json"];
const bound = sources.map(source=>{
  const ledger = read(source), entries = ledger.entries instanceof Array ? ledger.entries : ledger;
  return {source,entries:entries.length,nanoUsd:Math.round(entries.reduce((sum,e)=>sum+e.accountedUsd,0)*1e9)};
});
const accountedUpperUsd = bound.reduce((sum,entry)=>sum+entry.nanoUsd,0)/1e9;
assert.equal(accountedUpperUsd,read("policy-v2.3.2-review/summary.json").totalBoundUsd);
const result = {november,matchedDecisionStudy:judged,terminalImplicitDelays:episodes,budget:{accountedUpperUsd,invoiceUsd:null,bound,
  overlappingInitialEntries:original.length,observedCompletedSegmentEntries:completed.length},providerCalls:0};
if (process.argv[2]==="--verify") assert.deepEqual(result,JSON.parse(readFileSync(join(import.meta.dir,"recount.json"))));
else assert.equal(process.argv.length,2);
console.log(JSON.stringify(result,null,2));
