import { expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { TeachingDraftFeedback } from "../src/judgement/teaching-drafts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { debuggingExerciseQuestions, readDebuggingExerciseReview } from "../src/judgement/debugging-exercise.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import { teachingDraftAnswers, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const topic = {...teachingDraftTurn,learnerMessage:"Give me a small broken Python function to debug myself. Leave finding the fix to me."};
const standard = {learning_task:.98,practice_requested:.96,hands_on_requested:.98,executable_code:.5};
const masked = "```python\na = [3,4,5,6]\nprint([n for n in a[1:] if n % 2 == 0])\n```\nThe goal is to print all even numbers.";
const witnessed = masked + " Check [2, 4]: the expected result is [2, 4].";
const clean = "```python\na = [2,4,6]\n# These values are in centimetres.\nprint(sum(a[1:]))  # Expected: 12\n```";
type Rating = [example:string,disclosure:string];
const backend = {backend:"fixture" as const,model:"exercise-fixture",calibrationSha256:null};

async function gate(drafts:string[],ratings:Rating[],options:{turn?:TeachingPolicyTurn;signals?:Record<string,number>;missing?:boolean}={}) {
  const inspected: JudgementRequest[] = [], feedback: TeachingDraftFeedback[][] = [], prompts:string[] = [];
  const judge:JudgementCaller = async req => {
    const answers = teachingDraftAnswers(req,req.questions.learning_task ? {...standard,...options.signals} : {});
    if (req.questions.debug_example_witness) {
      const [example,disclosure] = ratings[inspected.length]!;
      Object.assign(answers,teachingDraftAnswers(req,{debug_example_witness:example,debug_solution_visibility:disclosure}));
      if (options.missing) delete answers.debug_example_witness;
      inspected.push(req);
    }
    // Test the deterministic quality tie break when there is a second eligible draft.
    if (req.questions.draft_choice) return {ok:false,error:{code:"backend-unavailable",retryable:false}};
    return {ok:true,response:{backend,answers}};
  };
  const result=await runTeachingDrafts({turn:options.turn??topic,judge,maxAttempts:drafts.length,refinement:"ordinary",
    generate:async input=>{
      prompts.push(input.systemPrompt);feedback.push([...input.feedback]);
      const text = drafts[prompts.length-1]!;
      return {reply:{text,toolCalls:[]},value:text};
    }});
  return {result,inspected,feedback,prompts};
}

test("masked data gets a concrete counterexample repair; all other review checks see the complete candidate",async()=>{
  const {result,feedback,inspected,prompts}=await gate([masked,witnessed],[["masked","independent"],["observable","independent"]]);
  expect(result.status).toBe("released"); expect(result.reply?.text).toBe(witnessed);
  expect(result.receipt.attempts.map(a=>a.status)).toEqual(["fail","pass"]);
  expect(feedback[1]).toContainEqual(expect.objectContaining({id:"debug_example_unwitnessed",instruction:expect.stringContaining("counterexample")}));
  expect(inspected.map(req=>(req.state as {reply:{text:string}}).reply.text)).toEqual([masked,witnessed]);
  expect(prompts[0]).toContain("State the intended behavior or expected output.");
  expect(result.receipt.attempts[0]?.debuggingExercise?.example?.probabilities.masked).toBe(1);
  expect((await gate([masked],[["masked","independent"]])).result.status).toBe("withheld");
});

test("an explicit solution in comments, prose or a side control requires revision; expected output and ordinary documentation are allowed",async()=>{
  for(const text of [clean+"\nReplace a[1:] with a.",clean.replace("These values are in centimetres.","Fix: remove [1:] below."),
    clean+'\n\n```openui\nroot = LearningSurface([s])\ns = Explanation("Solution", "Remove the slice from the summation.")\n```']) {
    const {result}=await gate([text],[["observable","solution_given"]]);
    expect(result.status).toBe("withheld");
    expect(result.receipt.attempts[0]?.checks).toContainEqual(expect.objectContaining({id:"debug_fix_disclosed",status:"fail"}));
  }
  const {result}=await gate([clean],[["observable","independent"]]);
  expect(result.status).toBe("released"); expect(result.reply?.text).toBe(clean);
});

test("a confirmed mild line hint can earn one revision, while a lone useful draft and uncertain observations can still release",async()=>{
  const marked = clean.replace("  # Expected: 12","  # The problem is near this sum, which should include each value.");
  const solo=await gate([marked],[["observable","location_clue"]]);
  expect(solo.result.status).toBe("released");
  const revised=await gate([marked,clean],[["observable","location_clue"],["observable","independent"]]);
  expect(revised.result.reply?.text).toBe(clean);
  expect(revised.feedback[1]).toContainEqual(expect.objectContaining({id:"debug_location_hint"}));
  for(const rating of [["uncertain","uncertain"],["masked","outside"]] satisfies Rating[]) {
    const {result,inspected}=await gate([marked,clean],[rating]);
    expect(result.status).toBe("released");expect(inspected.length).toBe(1);
    expect(result.receipt.attempts[0]?.checks.find(c=>c.id==="debug_example_unwitnessed")?.status).toBe("unknown");
  }
});

test("requested hints/solutions, walkthroughs and unrelated coding practice can be classified outside; direct and graded turns keep their established review path",async()=>{
  for(const learnerMessage of ["Show me the solution for this debugging exercise.","Walk me through how to debug this code, including the faulty line.","Give me a Python function to write from scratch."]) {
    const {result}=await gate([clean],[["outside","outside"]],{turn:{...topic,learnerMessage},signals:{executable_code:.99}});
    expect(result.status).toBe("released");expect(result.receipt.attempts[0]?.debuggingExercise?.example?.choice).toBe("outside");
  }
  for(const subject of [{...topic,assessment:"assessed" as const},{...topic,pendingSubmissions:[{kind:"quiz" as const,id:"q",questionIds:["a"]}]}]) {
    const {inspected,prompts}=await gate([clean],[],{turn:subject});
    expect(inspected).toEqual([]);expect(prompts[0]).not.toContain("If the learner requests a new bug");
  }
  const direct=await gate([clean],[],{signals:{plain_reply_requested:.99,practice_requested:.01}});
  expect(direct.inspected).toEqual([]);
});

test("incomplete or fabricated distributions stay unknown; uncertain raw probabilities survive in the receipt",async()=>{
  const {result}=await gate([clean],[["observable","independent"]],{missing:true});
  expect(result.status).toBe("withheld");expect(result.receipt.attempts[0]?.debuggingExercise?.example).toBeNull();
  const answers:Record<string,JudgementAnswer> = {
    debug_example_witness:{type:"choice",choice:"masked",confidence:.53,probabilities:{observable:.43,masked:.53,uncertain:.03,outside:.01}},
    debug_solution_visibility:{type:"choice",choice:"independent",confidence:.9,probabilities:{independent:.9,untrusted:.1}},
  };
  const review=readDebuggingExerciseReview({ok:true,response:{backend,answers}});
  expect(review.checks[0]).toMatchObject({id:"debug_example_unwitnessed",status:"unknown",probability:.53});
  expect(review.evidence.disclosure).toBeNull();
  expect(Object.keys(debuggingExerciseQuestions)).toEqual(["debug_example_witness","debug_solution_visibility"]);
});
