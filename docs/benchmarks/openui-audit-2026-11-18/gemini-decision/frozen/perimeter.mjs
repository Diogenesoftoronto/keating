// A post-hoc single-candidate diagnostic, separate from the preregistered 15 cases.
// All inference is supplied by saved files; the scorer performs no network access.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { runTeachingDrafts } from "../../../../../packages/learner-contracts/src/judgement/teaching-drafts.ts";
import { blocksRelease } from "../../../../../packages/learner-contracts/src/judgement/teaching-drafts/policy.ts";
import { encodeSystemOneRequest } from "../../../../../packages/learner-contracts/src/judgement/wire.ts";
import { observe } from "./score.mjs";

const here = import.meta.dir, historical = join(here, "../../policy-holdout");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const sha = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const bytes = value => JSON.stringify(value, null, 2) + "\n";
const mode = process.argv[2] ?? "--verify";
assert(["--freeze","--verify","--score"].includes(mode) && process.argv.length <= 3);
const actorFile = "segment-two--MiniMax-M2.7-highspeed--perimeter.json";
const actor = read(join(historical, actorFile)), cohort = read(join(historical, "cohort.json"));
const archivedManifest = read(join(historical, "manifest.json"));
const bundleBytes = readFileSync(join(historical, "release-inputs.json.gz"));
assert.equal(sha(bundleBytes), archivedManifest.releaseInputsSha256);
assert.equal(sha(readFileSync(join(historical, "cohort.json"))), archivedManifest.cohortSha256);
const bundle = JSON.parse(gunzipSync(bundleBytes).toString("utf8"));
assert.equal(sha(bundle.toolSchemasText), cohort.toolSchemasSha256);
const tools = JSON.parse(bundle.toolSchemasText).map(t => t.function.name);
const problem = cohort.cases.find(c => c.id === "perimeter");
const turn = { learnerMessage: problem.prompt, conversation: [], learnerEvidence: [], availableTools: tools,
  toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown" };
const [savedPlan, savedReview] = actor.judgments;
assert.equal(savedPlan.model, "jev-1.14.0"); assert.equal(savedReview.model, savedPlan.model);
assert.equal(actor.phase, "released"); assert.equal(actor.drafts.length, 1);
const answer = actor.drafts[0].response.text;
assert.equal(answer, "16."); assert.equal(actor.public.text, answer); assert.deepEqual(actor.drafts[0].response.nativeTools, []);
const planAnswers = expand(savedPlan.answers), jevAnswers = expand(savedReview.answers);
const origin = read(join(historical, savedPlan.reusedFrom.split("#")[0])).judgments[0];
assert.equal(origin.hash, savedPlan.hash); assert.deepEqual(origin.answers, savedPlan.answers);
function expand(answers) {
  return Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, typeof v === "number" ? {type:"noul",noul:v} : v]));
}
function fixture(answers) {
  return { ok:true,response:{backend:{backend:"fixture",model:"frozen-answer-replay",calibrationSha256:null},answers} };
}
let captured;
async function assess(reviewAnswers) {
  let plans = 0, reviews = 0;
  const result = await runTeachingDrafts({
    turn, maxAttempts: 1, refinement: "ordinary", judgementModel: { id: savedPlan.model, requestTokens: 64000, stateQuestionTokens: 32000 },
    generate: async () => ({ reply: { text:answer, toolCalls:[] }, value:null }),
    check: reply => [{id:"runtime_tool_schema",source:"deterministic",severity:"critical",status:reply.toolCalls.length?"fail":"pass",probability:reply.toolCalls.length?1:0}],
    judge: async request => {
      if (request.questions.learning_task) {
        plans++; assert.equal(sha(request), savedPlan.hash, "Reconstructed original planning request differs.");
        return fixture(planAnswers);
      }
      reviews++; assert.equal(sha(request), savedReview.hash, "Reconstructed original review request differs.");
      assert.equal(request.state.reply.text, answer); assert.deepEqual(request.state.reply.toolCalls, []);
      const row = { id:"posthoc-perimeter-16", stage:"review", request, requestSha256:sha(request),
        jevWireSha256:sha(encodeSystemOneRequest(request, savedReview.model)) };
      if (captured) assert.deepEqual(captured, row);
      else captured = row;
      return fixture(reviewAnswers);
    },
  });
  assert.equal(plans, 1); assert.equal(reviews, 1); assert.equal(result.receipt.attempts.length, 1);
  const attempt = result.receipt.attempts[0], leak = attempt.checks.find(check => check.id === "checkpoint_answer_leaked");
  assert(leak); assert.equal(leak.probability, reviewAnswers.checkpoint_answer_leaked.noul);
  return { gate:result.status, attempt:attempt.status, reason:result.receipt.reason, selectedAttempt:result.receipt.selectedAttempt,
    leak:{probability:leak.probability,status:leak.status}, blockers:attempt.checks.filter(blocksRelease).map(({id,status,probability})=>({id,status,probability})) };
}
function artifact(name, value, create) {
  const path = join(here,name), text = bytes(value);
  if (create && !existsSync(path)) writeFileSync(path,text,{flag:"wx"});
  assert.equal(readFileSync(path,"utf8"),text, "Changed perimeter artifact: " + name);
}
const jev = await assess(jevAnswers);
assert.equal(jev.gate, actor.phase); assert.equal(jev.attempt, actor.checks[0].status); assert.equal(jev.reason, actor.reason);
assert.equal(jev.leak.probability, .35);
assert.deepEqual(jev.blockers, []);
const requestFile = { version:1, case:captured };
artifact("perimeter-request.json", requestFile, mode === "--freeze");
const sourceSha256 = sha(bytes(requestFile));
console.log(JSON.stringify({ sourceSha256, caseId:captured.id, requestSha256:captured.requestSha256, jevWireSha256:captured.jevWireSha256 }));
const resultPath = join(here,"perimeter-google-outcome.json"), scorePath = join(here,"perimeter-check.json");
if (mode === "--score" || (mode === "--verify" && existsSync(scorePath))) {
  const returned = read(resultPath);
  assert.equal(returned.version,1); assert.equal(returned.sourceSha256,sourceSha256);
  assert.equal(returned.case.caseId,captured.id);
  const observation = observe(captured, returned.case, sha, read);
  const gemini = observation.status === "measured" ? await assess(returned.case.outcome.response.answers) : null;
  const record = {version:1,design:"Post-hoc fixed-input check selected after a separate end-to-end run withheld correct direct answers. Excluded from all 15 preregistered denominators.",
    caseId:captured.id,learnerPrompt:problem.prompt,answer,rubric:problem.rubric,policy:cohort.policy,
    tutor:actor.configuredModel,planning:{model:savedPlan.model,requestSha256:savedPlan.hash,action:actor.decision.action,targets:actor.decision.targets},
    sourceReceipt:actorFile,sourceReceiptSha256:sha(readFileSync(join(historical,actorFile))),requestSha256:captured.requestSha256,
    jevWireSha256:captured.jevWireSha256,wireProvenance:"The prior run retained the shared application-request hash. The TypeSafe wire hash was reconstructed using the original model and encoder.",
    models:{jev:savedReview.model,gemini:"gemini-decision-1"},jev,gemini,observation,googleOutcomeSha256:sha(readFileSync(resultPath))};
  artifact("perimeter-check.json",record,mode==="--score");
  console.log(JSON.stringify({jev,gemini,observation:observation.status}));
}
