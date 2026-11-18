// Independent wording check. Each label was fixed before the classifier author saw these prompts.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here=import.meta.dir, root=resolve(here,"../../../../..");
const [phase,option]=process.argv.slice(2);
assert(["v2.3.5","v2.3.6"].includes(phase) && [undefined,"--verify"].includes(option));
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const cases=readFileSync(join(here,"cases.json"));
assert.equal(digest(cases),"f1b8122f675c9797d02553ca4e7bb496fa49d8828dd85911d55cff64e2754816");
let source=root;
const original=phase==="v2.3.5", restore=original||option==="--verify";
if (restore) {
  const restoreSource=original?[join(here,"../study/supplement/source-delta.py"),"restore","prediction"]:
    [join(here,"../study/feedback-v2.3.6/source.py"),"restore"];
  const r=Bun.spawnSync(["rtk","proxy","python3","-I",...restoreSource]);
  assert.equal(r.exitCode,0,r.stderr.toString());source=r.stdout.toString().trim();
}
try {
  const mod=pathToFileURL(join(source,"packages/learner-contracts/src/openui-diagnostic-turn.ts")).href;
  const {classifyOpenUiCue}=await import(mod);
  const rows=JSON.parse(cases).cases.map(c=>{
    const predicted=classifyOpenUiCue(c.text);
    const correct = c.target===null ? !["implicit-action","explicit-interface"].includes(predicted.kind)
      : predicted.kind==="implicit-action" && predicted.targets.includes(c.target) && (!c.language || predicted.codeLanguage===c.language);
    return {id:c.id,expectedTarget:c.target,expectedLanguage:c.language??null,predicted,correct};
  });
  const result={phase,caseSha256:digest(cases),classifierSha256:digest(readFileSync(join(source,"packages/learner-contracts/src/openui-diagnostic-turn.ts"))),
    positiveCorrect:rows.filter(r=>r.correct&&r.expectedTarget).length,positives:rows.filter(r=>r.expectedTarget).length,
    falsePositives:rows.filter(r=>!r.correct&&!r.expectedTarget).length,negativeControls:rows.filter(r=>!r.expectedTarget).length,rows};
  if(!original) result.contextModuleSha256=digest(readFileSync(join(source,"packages/learner-contracts/src/openui-cue-context.ts")));
  const file=join(here,phase+".json"), bytes=JSON.stringify(result,null,2)+"\n";
  if(option==="--verify") assert.equal(readFileSync(file,"utf8"),bytes);
  else writeFileSync(file,bytes,{flag:"wx"});
  console.log(JSON.stringify({phase,positiveCorrect:result.positiveCorrect,positives:result.positives,falsePositives:result.falsePositives,negativeControls:result.negativeControls}));
} finally { if(restore)rmSync(source,{recursive:true,force:true}); }
