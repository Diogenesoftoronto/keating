import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const [product, study] = process.argv.slice(2);
const {classifyOpenUiCue} = await import(resolve(product,"packages/learner-contracts/src/openui-diagnostic-turn.ts"));
const enrollment = JSON.parse(readFileSync(resolve(study,"final-review/study/cohort.json")));
const rows = [...enrollment.cases,enrollment.followup,enrollment.classroom].map(c=>{
  const cue = classifyOpenUiCue(c.learner);
  return {id:c.id,declared:{kind:c.cue,targets:c.targets},automatic:cue,
    matchesDeclaredCategoryAndAnAcceptedTarget:cue.kind===c.cue && (!c.targets.length || c.targets.some(t=>cue.targets.includes(t)))};
});
console.log(JSON.stringify({primaryMatches:rows.slice(0,enrollment.cases.length).filter(c=>c.matchesDeclaredCategoryAndAnAcceptedTarget).length,
  scheduledPrimary:enrollment.cases.length,rows},null,2));
