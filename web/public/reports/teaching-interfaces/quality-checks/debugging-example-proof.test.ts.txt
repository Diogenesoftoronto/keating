import { expect, test } from "bun:test";
import { proveDebuggingExample, provenDebuggingFailures } from "../src/judgement/debugging-example-proof.js";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const turn: TeachingPolicyTurn = {...teachingDraftTurn, learnerMessage: "Give me a buggy Python loop to fix myself."};
function parityReply(values: number[], odd = false): TeachingPolicyReply {
  const text = ["```python", "items = [" + values.join(", ") + "]", "chosen = []",
    "for ix in range(1, len(items)):", "    if items[ix] % 2 == " + Number(odd) + ":",
    "        chosen.append(items[ix])", "print(chosen)", "```", "Print all " + (odd ? "odd" : "even") + " numbers."].join("\n");
  return {text, toolCalls:[]};
}
const diagnosis = "The bug is starting at index one, which skips the first value.";
function page(description: string, extra = {}): TeachingPolicyReply["toolCalls"] {
  return [{name:"interactive_page", arguments:{title:"Edit the loop", description, ...extra}}];
}

test("a closed skip-first filter disagrees with an all-items reference precisely when the first value belongs in the result", () => {
  for (const odd of [true, false]) for (const first of [-3, -2, -1, 0, 1, 2, 3]) {
    const samples = [first, 4, -2, first];
    const reference = samples.filter(n => Math.abs(n % 2) === Number(odd));
    const actual = samples.slice(1).filter(n => Math.abs(n % 2) === Number(odd));
    const differs = actual.length !== reference.length;
    const proof = proveDebuggingExample(turn, parityReply(samples, odd));
    expect(proof).toEqual({reference:odd ? "all-odd-integers" : "all-even-integers",
      suppliedInput:differs ? "observable" : "masked", otherExamples:"none", nativeDescriptionGivesDiagnosis:false});
    expect(provenDebuggingFailures(proof).map(check=>check.id)).toEqual(differs ? [] : ["debug_static_example_masked"]);
  }
});

test("another concrete witness satisfies the exercise and ambiguous additional examples cannot veto a useful starter", () => {
  const base = parityReply([3, 2]);
  for (const [extra, expected] of [[" Run it with [2, 3].", "witness"], [" Try the two-item list starting with two.", "unverified"],
    [" A diagram below gives other test data.", "unverified"]] as const) {
    const proof = proveDebuggingExample(turn, {...base, text:base.text + extra});
    expect(proof).toMatchObject({suppliedInput:"masked", otherExamples:expected});
    expect(provenDebuggingFailures(proof)).toEqual([]);
  }
  const context = {...turn, conversation:[{role:"user" as const, content:"Use the sample we discussed."}]};
  expect(proveDebuggingExample(context, base)?.otherExamples).toBe("unverified");
  expect(proveDebuggingExample({...turn,learnerMessage:turn.learnerMessage + " Try two and three."}, base)?.otherExamples).toBe("unverified");
});

test("a native page is opaque, but a visible title or description can separately reveal the proven diagnosis", () => {
  const base = parityReply([3, 2]);
  const result = (calls: TeachingPolicyReply["toolCalls"]) => proveDebuggingExample(turn, {...base, toolCalls:calls});
  expect(result(page(diagnosis))).toMatchObject({suppliedInput:"masked", otherExamples:"unverified", nativeDescriptionGivesDiagnosis:true});
  expect(provenDebuggingFailures(result(page(diagnosis))).map(c=>c.id)).toEqual(["debug_native_fix_disclosed"]);
  expect(result(page("Open an editor.", {title:diagnosis}))?.nativeDescriptionGivesDiagnosis).toBe(true);
  for (const calls of [page("Read the first item carefully."), page("Open the tutorial.", {html:diagnosis}),
    page("The bug is not starting at index one, which skips the first value."),
    [{name:"other_tool", arguments:{description:diagnosis}}]]) {
    expect(result(calls)?.nativeDescriptionGivesDiagnosis).toBe(false);
    expect(provenDebuggingFailures(result(calls))).toEqual([]);
  }
});

test("unsupported programs, goals and requests abstain without executing or forbidding ordinary comments", () => {
  const candidate = parityReply([3, 2]);
  const altered = [
    ["all even numbers", "items after the first"], ["all even numbers", "all odd numbers"], ["all even numbers", "all even numbers except the first"],
    ["[3, 2]", "[]"], ["[3, 2]", "[make_value(), 2]"], ["[3, 2]", "[True, 2]"], ["range(1, len", "range(0, len"],
    ["chosen.append(items[ix])", "chosen.append(items[0])"], ["print(chosen)", "print(chosen)  # Expected: [2]"],
    ["print(chosen)", "print(\"Odd numbers:\", chosen)"], ["items", "len"], ["chosen", "class"], ["items = ", "items\u00a0= "],
    ["```python", "```javascript"], ["chosen = []", "chosen = []\nmutate(items)"], ["items[ix] % 2", "items[ix] % 3"],
  ];
  for (const [from, to] of altered) expect(proveDebuggingExample(turn, {...candidate,text:candidate.text.replaceAll(from!,to!)})).toBeNull();
  for (const learnerMessage of ["Give me a buggy Python loop to fix myself, with a hint.", "Give me a buggy Python loop to fix myself and include hints.",
    "Write me a buggy example and walk me through it.",
    "Give me the solution.", "Why does my existing program skip the first item?", "Help me learn filtering with Python."]) {
    expect(proveDebuggingExample({...turn, learnerMessage},candidate)).toBeNull();
  }
  expect(proveDebuggingExample({...turn, assessment:"assessed"},candidate)).toBeNull();
  expect(proveDebuggingExample({...turn, pendingSubmissions:[{kind:"quiz",id:"q",questionIds:["one"]}]},candidate)).toBeNull();
});

test("host proof survives a confident contrary reviewer, blocks best-effort release and gives the generator a concrete repair", async () => {
  const failed = parityReply([3,2]), repaired = parityReply([4,2]);
  const judge = makeTeachingDraftJudge((req): Record<string, number|string> => req.questions.learning_task
    ? {learning_task:.99,practice_requested:.99,hands_on_requested:.99,executable_code:.99}
    : {debug_example_witness:"observable",debug_solution_visibility:"independent"});
  const seen: string[][] = [];
  const result = await runTeachingDrafts({turn, judge, maxAttempts:2, refinement:"ordinary", generate:async generation => {
    seen.push(generation.feedback.map(f=>f.id));
    const reply = generation.attempt === 1 ? failed : repaired;
    return {reply,value:reply.text};
  }});
  expect(result.receipt.attempts.map(a=>a.status)).toEqual(["fail","pass"]);
  expect(result.receipt.attempts[0]?.debuggingExercise?.example?.choice).toBe("observable");
  expect(result.receipt.attempts[0]?.debuggingExercise?.staticProof?.suppliedInput).toBe("masked");
  expect(seen[1]).toContain("debug_static_example_masked");
  expect(result.reply?.text).toBe(repaired.text);
  const only = await runTeachingDrafts({turn,judge,maxAttempts:1,refinement:"ordinary",generate:async()=>({reply:failed,value:0})});
  expect(only.status).toBe("withheld");
});

test("declined help preserves independent debugging, and a positive request in another clause still permits help", async () => {
  const candidate = parityReply([3,2]);
  const spoiler = {...candidate, toolCalls:page(diagnosis)};
  for (const suffix of ["No hints, please.", "Without a clue.", "Don't give me hints or solutions.", "I don’t want the solution.",
    "Please skip the hints.", "Don't tell me why it fails."]) {
    const input = {...turn,learnerMessage:turn.learnerMessage+" "+suffix};
    expect(provenDebuggingFailures(proveDebuggingExample(input,spoiler)).map(c=>c.id)).toEqual(["debug_native_fix_disclosed"]);
  }
  for (const suffix of ["No solutions, but give me a hint.", "No hints. Walk me through it.", "I want a clue, not the solution.",
    "Don't skip the hints.", "I'd like a hint and no solution."]) {
    expect(proveDebuggingExample({...turn,learnerMessage:turn.learnerMessage+" "+suffix},spoiler)).toBeNull();
  }
  expect(provenDebuggingFailures(proveDebuggingExample({...turn,learnerMessage:turn.learnerMessage+" No hints, please."},candidate)).map(c=>c.id))
    .toEqual(["debug_static_example_masked"]);
  expect(proveDebuggingExample({...turn,learnerMessage:turn.learnerMessage+" No hints. Try the other list we discussed."},candidate)?.otherExamples).toBe("unverified");
  const prior = (content:string) => proveDebuggingExample({...turn,conversation:[{role:"user",content}]},spoiler);
  expect(prior("No hints.")?.nativeDescriptionGivesDiagnosis).toBe(true);
  expect(prior("Give me a hint.")).toBeNull();
  const judge = makeTeachingDraftJudge((req): Record<string,number|string> => req.questions.learning_task
    ? {learning_task:.99,practice_requested:.99,hands_on_requested:.99,executable_code:.99}
    : {debug_example_witness:"observable",debug_solution_visibility:"independent"});
  const eligible = {...turn,availableTools:["interactive_page"]};
  for (const [suffix,status] of [["No hints, please.","withheld"],["No solutions, but give me a hint.","released"]] as const) {
    const result = await runTeachingDrafts({turn:{...eligible,learnerMessage:eligible.learnerMessage+" "+suffix},judge,maxAttempts:2,refinement:"ordinary",
      generate:async()=>({reply:spoiler,value:0})});
    expect(result.status).toBe(status);
  }
});
