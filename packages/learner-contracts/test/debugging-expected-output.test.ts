import {expect,test} from "bun:test";
import {independentlyVerifiedExpectedOutput,scopeDebuggingExpectedOutput} from "../src/judgement/debugging-expected-output.js";
import {readDebuggingExerciseReview} from "../src/judgement/debugging-exercise.js";
import {blocksRelease} from "../src/judgement/teaching-drafts/policy.js";
import type {TeachingPolicyCheck,TeachingPolicyReply,TeachingPolicyTurn} from "../src/judgement/teaching-policy-types.js";
import {teachingDraftTurn} from "./fixtures/teaching-drafts.js";
import type {ChoiceAnswer} from "../src/judgement/contracts.js";

const makeTurn=(input:number[], odd:boolean):TeachingPolicyTurn=>({...teachingDraftTurn,assessment:"unknown",
  learnerMessage:`Give me a broken Python loop to fix myself. It should collect every ${odd?"odd":"even"} integer in [${input.join(", ")}]. No hints, please.`});
function makeReply(input:number[], odd:boolean, predicate:number):TeachingPolicyReply {
  const keep=input.filter(n=>(Math.abs(n%2)===1)===odd);
  return {toolCalls:[],text:["Here is the exercise.","```python",`# Expected output: [${keep.join(", ")}]`,`values = [${input.join(", ")}]`,
    "answer = []","for n in values:",`    if n % 2 == ${predicate}:`,"        answer.append(n)","print(answer)","```","Run it."].join("\n")};
}
const positive=makeTurn([8,-3,6,0],false), broken=makeReply([8,-3,6,0],false,1);
const finding:TeachingPolicyCheck={id:"checkpoint_answer_leaked",severity:"major",source:"jev",status:"fail",probability:.89};
function answer(choice:string,other:string[],confidence=.98):ChoiceAnswer {
  return {type:"choice",choice,confidence,probabilities:Object.fromEntries([choice,...other].map((ch,i)=>[ch,i===0?confidence:(1-confidence)/other.length]))};
}
function specific(example="observable",disclosure="independent",confidence=.98){
  const choices=(chosen:string,all:string[])=>answer(chosen,all.filter(s=>s!==chosen),confidence);
  return readDebuggingExerciseReview({ok:true,response:{backend:{backend:"fixture",model:"example",calibrationSha256:null},usage:{inputTokens:0,outputTokens:0},
    answers:{debug_example_witness:choices(example,["observable","masked","outside","uncertain"]),
      debug_solution_visibility:choices(disclosure,["independent","location_clue","solution_given","outside","uncertain"])}}});
}

test("the independent oracle requires an actual divergence on the learner's own list and an exact expected output",()=>{
  for (const odd of [true,false]) for (const input of [[-9,-2,0,1,1],[2,4],[-5,7]]) {
    const t=makeTurn(input,odd);
    expect(independentlyVerifiedExpectedOutput(t,makeReply(input,odd,Number(!odd)))).toBe(true);
    expect(independentlyVerifiedExpectedOutput(t,makeReply(input,odd,Number(odd)))).toBe(false);
  }
  const replace=(a:string,b:string)=>({...broken,text:broken.text.replace(a,b)});
  for (const modified of [
    replace("8, 6, 0","8, -3, 6, 0"),replace("8, -3, 6, 0]","8, -3, 8, 0]"),replace("n % 2","n % 3"),
    replace("for n in values:","for n in reversed(values):"),replace("print(answer)","print('secret')"),
    replace("answer.append(n)","answer.append(n)\n        answer.append(0)"),replace("answer.append(n)","answer.append(n) # change the condition to even"),
    replace("Run it.","The condition is inverted. Change it to == 0."),replace("Run it.","Consider the parity check."),replace("Run it.","What is 6 times 7? 42."),
    replace("Run it.","Another checkpoint: 9."),replace("# Expected output:","# Expected output for [1, 2]:"),
    replace("Here is the exercise.","The answer is 42."),replace("```python","```javascript"),replace("for n in values:","for n in va lues:"),
    {...broken,text:broken.text+"\n```python\nprint(0)\n```"}, {...broken,toolCalls:[{name:"interactive_page",arguments:{description:"A hint"}}]},
  ]) expect(independentlyVerifiedExpectedOutput(positive,modified)).toBe(false);
});

test("unresolved or protected learner work, second tasks, declined expected answers, and non-independent practice remain protected",()=>{
  const append=(suffix:string)=>({...positive,learnerMessage:positive.learnerMessage+" "+suffix});
  for(const t of [
    {...positive,assessment:"assessed" as const},{...positive,assessment:"practice" as const},
    {...positive,conversation:[{role:"assistant" as const,content:"First predict the output."}]},
    {...positive,pendingSubmissions:[{kind:"quiz" as const,id:"quiz",questionIds:["q"]}]},
    {...positive,learnerEvidence:[{kind:"pending-checkpoint",content:"q"}]}, {...positive,sources:[{id:"s",url:"",text:"prior exam"}]},
    append("Do not show me the expected output."),append("Let me guess the result before you show it."),append("Give me the answer to the previous puzzle."),
    append("Also multiply 7 by 3."),append("Also, explain recursion."),append("Do my homework."),
    {...positive,learnerMessage:positive.learnerMessage.replace("to fix myself","with the answer key")},
    {...positive,learnerMessage:positive.learnerMessage.replace("in [","except for the first one in [")},
  ]) expect(independentlyVerifiedExpectedOutput(t,broken)).toBe(false);
});

test("the generic provider finding is scoped only alongside complete, affirmative specific judgments and no independent release blocker",()=>{
  const apply=(review=specific(),generic:TeachingPolicyCheck=finding,extra:TeachingPolicyCheck[]=[])=>{
    const checks:TeachingPolicyCheck[]=[{...generic},...review.checks,...extra];
    scopeDebuggingExpectedOutput(checks,review.evidence,positive,broken);
    return checks;
  };
  const good=apply();
  expect(good[0]).toEqual({...finding,applicability:"debugging-expected-output"});
  expect(good.filter(blocksRelease)).toEqual([]);
  for(const review of [specific("masked"),specific("uncertain"),specific("observable","uncertain"),specific("observable","solution_given"),
    specific("observable","location_clue"),specific("outside","outside"),specific("observable","independent",.5),readDebuggingExerciseReview(null)]) {
    expect(apply(review)[0]?.applicability).toBeUndefined();
  }
  for(const check of [{...finding,severity:"critical" as const},{...finding,source:"deterministic" as const},
    {...finding,status:"unknown" as const},{...finding,probability:null}]) expect(apply(specific(),check)[0]?.applicability).toBeUndefined();
  const strictHost={...finding,id:"host_checkpoint",source:"deterministic" as const,severity:"critical" as const};
  expect(apply(specific(),finding,[strictHost]).filter(blocksRelease)).toEqual([finding,strictHost]);
});
