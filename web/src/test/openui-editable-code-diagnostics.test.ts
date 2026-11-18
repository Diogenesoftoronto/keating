import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inspectEditableCodeEvidence, inspectEditableCodeLanguages } from "../keating/openui/editable-code-evidence";
import { inspectOpenUIDiagnosticText, inspectSelectedOpenUIDiagnosticText } from "../keating/openui/diagnostic-components";
import { createOpenUIDiagnosticStore } from "../keating/openui/turn-diagnostics";
import { observeOpenUITurns } from "../keating/openui/turn-observer";
import { editableCodeLanguage, recordedCodePracticeLanguage } from "../keating/editable-code-language";

const fence = (language: string, text: string, marker = "```") => [marker+language,text,marker].join("\n");
test("counts surrounding words from the accepted spans in the actual selected Python receipts", () => {
  const evidence = (provider: string) => {
    const file = new URL("../../../docs/benchmarks/openui-audit-2026-11-18/policy-v2.3-completion/receipts/python-practice--"+provider+".json",import.meta.url);
    const released = JSON.parse(readFileSync(file,"utf8")).public;
    return [released.outsideWords,inspectOpenUIDiagnosticText(released.text).outsideWords,inspectEditableCodeEvidence(released.text)];
  };
  expect(evidence("google")).toEqual([26,26,{editableCode:["python"],editorOutsideWords:0}]);
  expect(evidence("jev")).toEqual([24,24,{editableCode:["python"],editorOutsideWords:10}]);
  const mixed = ["First try.",fence("python","print('PRIVATE long example')"),"Then edit this:",fence("js","console.log(42)"),
    fence("openui",'root = LearningSurface([q])\nq = Explanation("Exclude these private tokens")'),"Your turn."].join("\n\n");
  expect(inspectEditableCodeEvidence(mixed)).toEqual({editableCode:["javascript","python"],editorOutsideWords:7});
  expect(inspectEditableCodeEvidence("Text before.\n```python\nprint(1)")).toEqual({editableCode:[],editorOutsideWords:null});
  expect(inspectEditableCodeEvidence("Just prose.")).toEqual({editableCode:[],editorOutsideWords:null});
});
test("uses closed editor-language fences outside OpenUI, examples, quotes and Strudel", () => {
  expect(inspectEditableCodeLanguages([fence("py","print(1)"),fence("TS","let n: number = 2","~~~"),fence("mjs","console.log(3)"),fence("python","print(4)")].join("\n\n")))
    .toEqual(["javascript","python","typescript"]);
  const inert = [
    fence("markdown",fence("python","print('quoted example')"),"````"),fence("js",'s("bd*2").gain(0.7)'),
    fence("jsx","const el = <div/>"),fence("tsx","const n = <label/>"),fence("java","return 4;"),fence("py","   "),
    fence("python","print('quoted')").split("\n").map(line=>"> "+line).join("\n"),
    "$$\n"+fence("py","print(0)")+"\n$$",
    '<!--\n'+fence("python","print(8)")+'\n-->',
    fence("openui",'root = LearningSurface([q])\nq = Explanation("hello")'),"```python\nprint('unclosed')",
  ];
  expect(inspectEditableCodeLanguages(inert.join("\n\n"))).toEqual([]);
  expect(inspectEditableCodeLanguages(fence("strudel",'note("a3")')+"\n\n"+fence("js",'console.log("s")'))).toEqual(["javascript"]);
  expect(inspectEditableCodeLanguages("   ~~~~python\r\n   print(1)\r\n   ~~~~")).toEqual(["python"]);
  expect(inspectEditableCodeLanguages(fence("py","x".repeat(256_001)))).toBeNull();
  expect(editableCodeLanguage(" CJS ")).toBe("javascript");
  expect(recordedCodePracticeLanguage({codePracticeLanguage:"js"})).toBeNull();
  expect(recordedCodePracticeLanguage({codePracticeLanguage:"python"})).toBe("python");
});

test("records final code languages, known empty and unobserved without storing code or inferring execution", async()=>{
  const store = createOpenUIDiagnosticStore(()=>undefined);
  const messages: {role:string;content:unknown;model?:string;stopReason?:string}[]=[];
  const events:Record<string,unknown>[]=[];
  const observer=observeOpenUITurns({sessionId:"editor",store,messages:()=>messages,mode:()=>"baseline",capture:(_,e)=>events.push(e)});
  for (const [content,stopReason] of [[fence("py","print('PRIVATE body')"),"stop"],["Plain text.","stop"],["","error"]] as const) {
    messages.push({role:"user",content:"Give me a Python loop I can fix."});observer.observe({type:"agent_start"});
    messages.push({role:"assistant",content,stopReason,model:"local"});observer.observe({type:"agent_end"});
  }
  await store.settled();
  expect(store.getRows().map(row=>row.editableCode??null)).toEqual([["python"],[],null]);
  expect(store.getRows()[0]).toMatchObject({selected:[],rendered:null,cue:{codeLanguage:"python"},nativePageRequested:false,editorOutsideWords:0});
  expect(store.getRows().map(row=>row.editorOutsideWords??null)).toEqual([0,null,null]);
  expect(JSON.stringify([events,store.getRows()])).not.toContain("PRIVATE");
  observer.dispose();
});

test("records the actual selected challenge language without reading it from prose or treating it as a Markdown editor", async()=>{
  const source = new URL("../../../docs/benchmarks/openui-audit-2026-11-18/evidence/gemini-3.1-flash-lite--code.json",import.meta.url);
  const javascript: string = JSON.parse(readFileSync(source,"utf8")).release.text;
  const typescript = javascript.replace('"javascript",', '"typescript",');
  expect(typescript).not.toBe(javascript);
  const store = createOpenUIDiagnosticStore(()=>undefined);
  const messages: {role:string;content:string;model?:string;stopReason?:string}[]=[];
  const wire:Record<string,unknown>[]=[];
  const observer = observeOpenUITurns({sessionId:"challenge",store,messages:()=>messages,mode:()=>"baseline",capture:(_,event)=>wire.push(event)});
  for (const [content,stopReason] of [[javascript,"stop"],[typescript,"stop"],["Here is a JavaScript CodingChallenge.","stop"],["","error"]]) {
    messages.push({role:"user",content:"Give me a short JavaScript loop I can fix myself."});observer.observe({type:"agent_start"});
    messages.push({role:"assistant",content:content!,stopReason:stopReason!,model:"test"});observer.observe({type:"agent_end"});
  }
  await store.settled();
  expect(store.getRows().map(row=>row.codingChallengeLanguages??null)).toEqual([["javascript"],["typescript"],[],null]);
  expect(store.getRows()[0]).toMatchObject({selected:["coding-challenge","markdown"],editableCode:[],rendered:null});
  expect(wire.some(event=>JSON.stringify(event.coding_challenge_languages)==='["typescript"]')).toBe(true);
  expect(inspectSelectedOpenUIDiagnosticText("```openui\nroot = BadSyntax(").codingChallengeLanguages).toEqual([]);
  observer.dispose();
});
