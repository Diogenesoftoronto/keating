// Runs with Bun in either the hash-verified archived product or the local checkout.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";

globalThis.fetch = () => { throw Error("Offline probe"); };
const [product, study] = process.argv.slice(2).map(path => resolve(path));
const module = name => import(resolve(product, name));
const diagnostics = await module("packages/learner-contracts/src/openui-diagnostics.ts");
const {inspectOpenUIDiagnosticText, inspectSelectedOpenUIDiagnosticText} = await module("web/src/keating/openui/diagnostic-components.ts");
const {inspectEditableCodeEvidence} = await module("web/src/keating/openui/editable-code-evidence.ts");
const {runTeachingDrafts} = await module("packages/learner-contracts/src/judgement/teaching-drafts.ts");
const {proveDebuggingExample,provenDebuggingFailures} = await module("packages/learner-contracts/src/judgement/debugging-example-proof.ts");
const release = JSON.parse(readFileSync(resolve(study,"evidence/gemini-3.1-flash-lite--code.json"))).release.text;
const observed = (inspectSelectedOpenUIDiagnosticText ?? inspectOpenUIDiagnosticText)(release);
const editor = inspectEditableCodeEvidence(release);
const cases = ["Give me a JavaScript coding challenge I can fix and test myself.",
  "Give me a short JavaScript loop I can fix myself.", "Give me a short TypeScript loop I can fix myself.",
  "Give me a short Python loop I can fix myself."].map(prompt => {
  const cue = diagnostics.classifyOpenUiCue(prompt);
  const row = {schemaVersion:1,conversationId:"probe",turnId:"turn",turnIndex:0,model:"recorded-tutor",mode:"baseline",cue,
    reply:"released",compiled:observed.components,selected:observed.components,rendered:null,guidance:null,attempted:observed.attempted,
    ...editor, ...(observed.codingChallengeLanguages ? {codingChallengeLanguages:observed.codingChallengeLanguages} : {})};
  return {prompt, cue, actionMatched:diagnostics.matchesSelectedLearnerAction(row),
    missedActionTurns:diagnostics.queryOpenUiDiagnosticTurns([row],{view:"action-unmet"}).matchingTurns};
});
const turn = {learnerMessage:"Give me a buggy Python loop to fix myself.",conversation:[],learnerEvidence:[],availableTools:["interactive_page"],
  toolResults:[],sources:[],assessment:"none",improvementRuns:0,domain:"general"};
const reply = {text:["```python","items = [3, 2]","chosen = []","for ix in range(1, len(items)):",
  "    if items[ix] % 2 == 0:","        chosen.append(items[ix])","print(chosen)","```","Print all even numbers."].join("\n"),
  toolCalls:[{name:"interactive_page",arguments:{title:"Edit the loop",description:"The bug is starting at index one, which skips the first value.",html:"<p>Explore.</p>",purpose:"explore"}}]};
// Fixed, intentionally permissive opinions. They exercise the host proof and never contact a judge.
const judge = async ({questions}) => {
  const positive = ["learning_task","practice_requested","hands_on_requested","executable_code"];
  const chosen = {draft_standard:"concise",draft_reasoning:"low",debug_example_witness:"observable",debug_solution_visibility:"independent"};
  const answers = Object.fromEntries(Object.entries(questions).map(([key,q]) => {
    if (q.type !== "choice") return [key,{type:"noul",noul:positive.includes(key) || key.startsWith("quality_") ? .99 : .01}];
    const choice = chosen[key] ?? Object.keys(q.criteria)[0];
    return [key,{type:"choice",choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,Number(k===choice)]))}];
  }));
  return {ok:true,response:{answers,backend:{backend:"fixture",model:"offline-test",calibrationSha256:null},usage:{inputTokens:0,outputTokens:0}}};
};
const proofCases = [];
for(const suffix of [""," No hints, please."," No spoilers, please."," No solutions, but give me a hint."]) {
  const input = {...turn,learnerMessage:turn.learnerMessage + suffix};
  const proof = proveDebuggingExample(input,reply);
  const actual = await runTeachingDrafts({turn:input,judge,maxAttempts:2,refinement:"ordinary",generate:async()=>({reply,value:1})});
  proofCases.push({suffix,staticFindings:provenDebuggingFailures(proof).map(c=>c.id),
    disposition:actual.status,failedChecks:actual.receipt.attempts[0].checks.filter(c=>c.status==="fail").map(c=>c.id)});
}
console.log(JSON.stringify({archivedDraftSha256:createHash("sha256").update(release).digest("hex"),
  observedComponents:observed.components, challengeLanguages:observed.codingChallengeLanguages ?? null, markdownEditor:editor,
  cases, proofCases,paidCalls:0},null,2));
