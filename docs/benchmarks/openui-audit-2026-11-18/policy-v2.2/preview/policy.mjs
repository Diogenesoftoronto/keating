import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { sha, read } from "../../replay-source/tree.mjs";

/** Use the recorded policy sources, even after the checkout moves on. */
export async function inspectPolicy(audit, repo, learner, specimens) {
  const study = join(audit, "policy-v2.2");
  const bytes = readFileSync(join(study, "source.json.gz"));
  assert.equal(sha(bytes), read(join(study, "evidence-sha256.json"))["source.json.gz"]);
  const snapshot = JSON.parse(gunzipSync(bytes));
  const base = "packages/learner-contracts/src/judgement/";
  const load = async filename => {
    const build = await Bun.build({ entrypoints: [join(repo,base,filename)], target: "bun", format: "esm", plugins: [{
      name: "archived-policy", setup(builder) {
        builder.onLoad({ filter: /\/packages\/learner-contracts\/src\/.*\.ts$/u }, ({path}) => {
          const content = snapshot[relative(repo, path)];
          return content === undefined ? undefined : {contents:content,loader:"ts"};
        });
      },
    }]});
    assert.ok(build.success, build.logs.map(String).join("\n"));
    return import("data:text/javascript;base64," + Buffer.from(await build.outputs[0].text()).toString("base64"));
  };
  const { runTeachingDrafts } = await load("teaching-drafts.ts");
  const { teachingPolicyDeterministicChecks } = await load("teaching-policy.ts");
  const frozen = read(join(audit, "gemini-decision/frozen/perimeter-request.json")).case;
  const perim = read(join(audit, "gemini-decision/frozen/perimeter-check.json"));
  const jev = read(join(audit, "policy-holdout", perim.sourceReceipt));
  const google = read(join(audit, "gemini-decision/frozen/perimeter-google-outcome.json")).case;
  const hash = value => sha(JSON.stringify(value));
  assert.equal(frozen.requestSha256, hash(frozen.request));
  assert.equal(frozen.requestSha256, google.requestSha256);
  const {turn,reply} = frozen.request.state;
  const decisions = [];
  for (const [key, model, answers] of [
    ["jev",perim.models.jev,jev.judgments[1].answers],
    ["gemini",perim.models.gemini,google.outcome.response.answers],
  ]) {
    const judge = async request => {
      const planning = Object.hasOwn(request.questions,"learning_task");
      assert.equal(hash(request),planning ? jev.judgments[0].hash : frozen.requestSha256);
      const values = planning ? jev.judgments[0].answers : answers;
      return {ok:true,response:{backend:{backend:"fixture",model,calibrationSha256:null},answers:Object.fromEntries(
        Object.entries(values).map(([id,v]) => [id,typeof v === "number" ? {type:"noul",noul:v} : v]))}};
    };
    const result = await runTeachingDrafts({ turn, judge, maxAttempts:1,
      judgementModel:{id:"recorded",requestTokens:64000,stateQuestionTokens:32000},
      generate:async () => ({reply,value:reply.text}),
      check:() => [{id:"runtime_tool_schema",source:"deterministic",status:"pass",severity:"critical",probability:0}] });
    const check = result.receipt.attempts[0].checks.find(c => c.id === "checkpoint_answer_leaked");
    assert.equal(check.probability, perim[key].leak.probability);
    assert.equal(result.status, "released");
    decisions.push({model,score:check.probability,raw:check.status,prior:perim[key].gate,current:result.status});
  }
  return {
    perimeter:{ text:reply.text,prompt:turn.learnerMessage,source:"gemini-decision/frozen/perimeter-check.json",
      requestSha256:frozen.requestSha256,decisions },
    languages:specimens.map(text => teachingPolicyDeterministicChecks({...turn,learnerMessage:learner},{text,toolCalls:[]})
      .find(check => check.id === "exercise_language_preserved")?.status ?? null),
  };
}
