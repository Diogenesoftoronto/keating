/** Compare retained synthetic learner text against the frozen v2.3.5 classifier. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyOpenUiCue } from "../../../../../packages/learner-contracts/src/openui-diagnostic-turn";

if (!process.argv[2]) throw Error("Pass the checkout restored by source-delta.py restore prediction");
const entry = resolve(process.argv[2], "packages/learner-contracts/src/openui-diagnostic-turn.ts");
assert.equal(createHash("sha256").update(readFileSync(entry)).digest("hex"), "2239097c312295b624d09eeba9cacfc53260e1738fdb92f5e44e88e030e7003c");
const before = (await import(pathToFileURL(entry).href)).classifyOpenUiCue;
const audit = resolve(import.meta.dir, "../..");
const read = (file: string) => JSON.parse(readFileSync(resolve(audit, file), "utf8"));
const primary = read("final-review/study/cohort.json");
const scenarios = [
  ...read("policy-v2/evidence.json").rows.map((r: any) => ({id:"policy-v2/"+r.id, learner:r.state.turn.learnerMessage})),
  ...["cue-paraphrases/protocol.json","policy-v2.2/cohort.json","policy-v2.3/cohort.json","policy-v2.3-completion/cohort.json",
    "final-review/study/supplement/cohort.json","final-review/study/supplement/addendum/cohort.json"].flatMap(file =>
      read(file).cases.map((r: any) => ({id:file.split("/").slice(0,-1).join("/")+"/"+r.id,learner:r.learner}))),
  ...[...primary.cases,primary.followup,primary.classroom].map((r: any) => ({id:"final-review/study/"+r.id,learner:r.learner})),
];
const changed = [];
for (const { id, learner } of scenarios) {
  assert.equal(typeof learner, "string", id);
  const previous = before(learner), now = classifyOpenUiCue(learner);
  if (JSON.stringify(previous) !== JSON.stringify(now)) changed.push({id, previous, now});
}
console.log(JSON.stringify({registeredOrRecordedRows:scenarios.length, distinctLearnerWordings:new Set(scenarios.map(r=>r.learner)).size,
  changedRows:changed.length, changed}, null, 2));
