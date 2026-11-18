import { describe, expect, test } from "bun:test";
import {
  classifyOpenUiCue, isOpenUiDiagnosticGateIssue, normalizeOpenUiComponent, OPENUI_DIAGNOSTIC_EXPORT_SCHEMA, TEACHING_DEBUGGING_ISSUES,
  observeAssessmentCheckpoints, observeAssessmentOptOut, openUiCheckpointAfterOptOut,
  pairReviewOverlapMs, projectOpenUiPairReviews, type OpenUiPairReview,
  openUiDiagnosticComponentForNode, openUiDiagnosticLoss, parseOpenUiDiagnosticExport, queryOpenUiDiagnosticTurns, summarizeOpenUiDiagnostics,
  type OpenUiDiagnosticTurn, type UiDocumentNode,
} from "../src/index.js";

const question = { kind: "implicit-action", targets: ["question"] } as const;
test("a tutor filter includes an observed request without inventing a completed response", () => {
  const id = "minimax/requested-tutor";
  const missing = turn(0, {model:null, requestedModel:id, reply:"withheld", selected:[]});
  const archived = turn(1, {model:null, reply:"withheld", selected:[]});
  expect(queryOpenUiDiagnosticTurns([missing,archived], {view:"withheld", model:id})).toMatchObject({matchingTurns:1, turns:[missing]});
  expect(() => parseOpenUiDiagnosticExport([{...missing, requestedModel:"unbounded learner prose"}])).toThrow("Invalid OpenUI");
});
const direct = { kind: "direct-text", targets: [] } as const;
function turn(index: number, fields: Partial<OpenUiDiagnosticTurn> = {}): OpenUiDiagnosticTurn {
  return { schemaVersion: 1, conversationId: "a", turnId: "t" + index, turnIndex: index, model: "tutor-1", mode: "guided",
    cue: { kind: "none", targets: [] }, reply: "released", attempted: false, compiled: [], selected: [], rendered: [], guidance: null, ...fields };
}
function cueQuestion() { return { kind: question.kind, targets: [...question.targets] }; }
function cueDirect() { return { kind: direct.kind, targets: [...direct.targets] }; }

test("pair evidence separates Jev preferences from release eligibility, incomplete pairs and absent measurements", () => {
  const first: OpenUiPairReview = { pair: 1, candidateAttempts: [1,2], status: "compared", preferredAttempt: 1, model: "jev-1.14.0",
    policyVersion: "keating-teaching-policy/v2.4.1", eligibleAttempts: [2], feedbackOnlyAttempts: [1], candidateIssueIds: [{ attempt: 1, issues: ["checkpoint_answer_leaked"] }, { attempt: 2, issues: [] }], finalistAttempt: 2, startedAtMs: 201, finishedAtMs: 281 };
  const second: OpenUiPairReview = { pair: 2, candidateAttempts: [3,4], status: "unavailable", preferredAttempt: null, model: null,
    error: "backend-rate-limited", eligibleAttempts: [], predictionQuestionAttempts: [3], finalistAttempt: null, startedAtMs: 209, finishedAtMs: 250 };
  const privateReview = { ...first, secret: "private candidate", probabilities: { draft_1: 1, draft_2: 0 } };
  expect(projectOpenUiPairReviews([second,privateReview])).toEqual([first,second]);
  expect(pairReviewOverlapMs([first,second])).toBe(41);
  expect(pairReviewOverlapMs([first])).toBeNull();
  expect(pairReviewOverlapMs([first,{...second, startedAtMs:281, finishedAtMs:320}])).toBe(0);
  const rows = [turn(0, { pairReviews: [first,second] }), turn(1, { reply: "withheld", pairReviews: [
    {pair:1, candidateAttempts:[], status:"incomplete", preferredAttempt:null, model:null},
  ] }), turn(2)];
  expect(queryOpenUiDiagnosticTurns(rows,{view:"pair-reviews",limit:1})).toMatchObject({
    matchingTurns:2, turnsWithoutPairRecords:1, comparedPairs:1, unavailablePairs:1, incompletePairs:1,
    unrecordedPairs:1, turnsWithMeasuredOverlap:1, turnsWithConcurrentReviews:1, turns:[rows[0]],
  });
  for (const bad of [[privateReview], [first,first], [{...first, preferredAttempt:4}], [{...first, finalistAttempt:1}],
    [{...first, candidateAttempts:[2,2]}], [{...first, feedbackOnlyAttempts:[3]}], [{...first, predictionQuestionAttempts:[1]}],
    [{...first, policyVersion:"private note"}], [{...first, candidateIssueIds:[{attempt:3,issues:[]}]}], [{...first, candidateIssueIds:[{attempt:1,issues:["secret"]}]}],
    [{...second, predictionQuestionAttempts:[2]}], [{...second, finishedAtMs:15}], [{...second, error:"private provider text"}]]) {
    expect(() => parseOpenUiDiagnosticExport([{...turn(0),pairReviews:bad}])).toThrow("Invalid OpenUI");
  }
  const finalComparison = { candidateAttempts:[2,4] as const, preferredAttempt:2, model:"jev-1.14.0", probabilities:{draft_2:0.54,draft_4:0.46}, confidence:0.08 };
  expect(parseOpenUiDiagnosticExport([{...turn(0), finalComparison}])[0]?.finalComparison).toEqual(finalComparison);
  expect(() => parseOpenUiDiagnosticExport([{...turn(0), pairReviews:[first,second], finalComparison}])).toThrow("Invalid OpenUI");
  for (const change of [{preferredAttempt:4}, {confidence:1.04}, {candidateAttempts:[1,2]}, {probabilities:{draft_2:1,draft_4:1}}, {note:"private"}]) {
    expect(() => parseOpenUiDiagnosticExport([{...turn(0),finalComparison:{...finalComparison,...change}}])).toThrow("Invalid OpenUI");
  }
});

describe("local OpenUI diagnostic cues", () => {
  test("recognizes a learner asking to predict a named attribute before being told", () => {
    const predicted = {kind:"implicit-action",targets:["question","quiz"]} satisfies OpenUiDiagnosticTurn["cue"];
    for (const text of [
      "I drop one square tile into a bag, then add three round tiles. Before you explain, can I guess the shape I'm most likely to draw?",
      "Can I guess the height of the tower before you explain the calculation?",
      "Before you reveal the answer could I predict its direction?",
      "I'd like to make a guess about the color first.",
      "Before you explain. Could I guess the length of the shadow?",
    ]) expect([text,classifyOpenUiCue(text)]).toEqual([text,predicted]);
    for (const text of [
      "Can I predict the width of a mark accurately with an old ruler?",
      "Before you explain, why is the taller tower more stable?",
      "Before you explain, don't ask me to guess the height.",
      "In yesterday's example the student asked, can I guess the speed before you explain?",
      "My teacher wrote “Before you explain, can I guess the shape?” What did she mean?",
      "Before you explain, can I guess the password?",
      "I guessed the distance before you explained it. Was I correct?",
    ]) expect([text,classifyOpenUiCue(text).targets]).toEqual([text,[]]);
  });
  test("binds a nearby learning language to a requested exercise and the learner's own debugging", () => {
    const original = "I'm learning Python. Give me a broken loop that should collect the multiples of three in [6, 5, 9]. The expected result is [6, 9]. I want to find the bug myself. No hints, please.";
    const python = {kind:"implicit-action",targets:["editable-code"],codeLanguage:"python"} satisfies OpenUiDiagnosticTurn["cue"];
    expect(classifyOpenUiCue(original)).toEqual(python);
    expect(classifyOpenUiCue("We're studying Python. Could you give us a faulty function? Let us find the error on our own.")).toEqual(python);
    expect(classifyOpenUiCue("I'm new to TypeScript. Give me an incomplete function to fix myself.")).toMatchObject({kind:"implicit-action",codeLanguage:"typescript"});
    for (const text of [
      "I'm learning Python. Give me a broken loop. I don't want to debug it.",
      "I'm learning Python. Explain how a broken loop fails. I want to find the bug myself.",
      "I'm learning Python. Give me a short story about a faulty program. I want to edit it.",
      "I'm learning Python. Give me a broken loop. I want to edit the description myself.",
      "I'm learning Python. Give me a broken JavaScript loop. I want to find the bug myself.",
      "I'm learning Python. The book says “Give me a broken loop. I want to find the bug myself.”",
      "I'm learning Python. Give me a broken loop. Now show me an English paragraph. I want to edit it myself.",
    ]) expect([text,classifyOpenUiCue(text).codeLanguage]).toEqual([text,undefined]);
  });
  test("recognizes learner-owned code edits across sentences and a bounded symbol request", () => {
    const starter = "Give me a short buggy Python loop that is supposed to add the numbers in [6, 9, 2]. ";
    const wantsEdit = "I want to edit it and find the fault myself.";
    const python = {kind:"implicit-action",targets:["editable-code"],codeLanguage:"python"} satisfies OpenUiDiagnosticTurn["cue"];
    expect(classifyOpenUiCue(starter + wantsEdit + " Leave me a case where I can actually see the wrong result, without giving away the fix.")).toEqual(python);
    expect(classifyOpenUiCue("Give me a short Python example I can fix without hints.")).toEqual(python);
    expect(classifyOpenUiCue("Don't use JavaScript; give me a short Python loop I can fix.")).toEqual(python);
    expect(classifyOpenUiCue("Give me an incomplete function in TypeScript. Let me test it.")).toMatchObject({codeLanguage:"typescript"});
    for (const text of [
      'My manual says “Give me a short buggy Python loop. I want to edit it and find the fault myself.” What does that mean?',
      'Give me a short manual about a Python loop. I want to edit it for clarity.',
      'Give me a short Python example. I want to edit the paragraph around it.',
      'Give me a short Python loop. Do not let me edit it.',
      'Compare a Python loop with JavaScript. I want to edit it myself.',
      'Give me a short Python loop. I want to edit it in TypeScript instead.',
    ]) expect(classifyOpenUiCue(text).codeLanguage).toBeUndefined();
    expect(classifyOpenUiCue("A strip of paper is folded in half once, then in half again. Before you tell me, I'd like to guess how many layers it has."))
      .toMatchObject({kind:"implicit-action",targets:["question","quiz"]});
    expect(classifyOpenUiCue("What is the chemical symbol for copper? Just the symbol, please.")).toEqual({kind:"direct-text",targets:[]});
    expect(classifyOpenUiCue("The sentence reads 'Just the symbol, please'. What does that mean?").kind).toBe("none");
    expect(classifyOpenUiCue("Not just the symbol, please. Explain the name's history.").kind).toBe("none");
    expect(classifyOpenUiCue("Did I get that right?").kind).toBe("none");
  });
  test("distinguishes explicitly named interfaces from learning actions and direct answers", () => {
    expect(classifyOpenUiCue("Give me a flashcard deck.")).toEqual({ kind: "explicit-interface", targets: ["deck"] });
    expect(classifyOpenUiCue("Can we do one more?").kind).toBe("implicit-action");
    expect(classifyOpenUiCue("What changes if I increase the speed?").targets).toContain("simulation");
    expect(classifyOpenUiCue("I want to change the speed and watch the distance. No more questions, please."))
      .toEqual({ kind: "implicit-action", targets: ["simulation"] });
    expect(classifyOpenUiCue("I'd like to adjust the tax rate and see the result. Without a quiz, please.").targets).toEqual(["simulation"]);
    expect(classifyOpenUiCue("I want to change the font in Settings.").kind).toBe("none");
    expect(classifyOpenUiCue("No questions for now.").kind).toBe("none");
    expect(classifyOpenUiCue("Text only. What changes if I increase the speed?").kind).toBe("direct-text");
    expect(classifyOpenUiCue("Give me some interactive activity to try.").targets).toEqual(["any"]);
    expect(classifyOpenUiCue("Give me the answer in one short sentence.").kind).toBe("direct-text");
    expect(classifyOpenUiCue("Start a quiz for me, please.").kind).toBe("explicit-interface");
    expect(classifyOpenUiCue("I still want the slider.")).toEqual({ kind: "explicit-interface", targets: ["simulation"], repeat: true });
    expect(classifyOpenUiCue("Can I have another slider please?").repeat).toBeUndefined();
  });
  test("ignores historical mentions and keeps negated answer giveaways out of positive cue detection", () => {
    expect(classifyOpenUiCue("I used a simulation yesterday.").kind).toBe("none");
    expect(classifyOpenUiCue("I don't want another diagram.").kind).toBe("none");
    expect(classifyOpenUiCue("Explain what a flashcard is.").kind).toBe("none");
    expect(classifyOpenUiCue("Don't ask me to predict. Just give me the answer.").kind).toBe("direct-text");
    expect(classifyOpenUiCue("Let me make a prediction. Don't tell me the answer yet.").kind).toBe("implicit-action");
    expect(classifyOpenUiCue("No quiz, but please draw me a diagram.")).toEqual({ kind: "explicit-interface", targets: ["diagram"] });
    expect(classifyOpenUiCue(null).kind).toBe("unknown");
  });
  test("canonicalizes useful model and renderer aliases without collapsing component counts", () => {
    expect(normalizeOpenUiComponent("SystemDesign")).toBe("diagram");
    expect(normalizeOpenUiComponent("Question")).toBe("question");
    expect(normalizeOpenUiComponent("question-group")).toBe("question-group");
    expect(normalizeOpenUiComponent("something the learner typed")).toBeNull();
    for (const [node, expected] of [
      [{ type: "task", kind: "practice", submission: { capture: { kind: "audio" } } }, "audio-response"],
      [{ type: "task", kind: "practice", diagram: {} }, "diagram"],
      [{ type: "task", kind: "fieldwork" }, "fieldwork"], [{ type: "quiz", mode: "exam" }, "exam"],
    ] as const) expect(openUiDiagnosticComponentForNode(node as UiDocumentNode)).toBe(expected);
  });
});

describe("diagnostic evidence and validation", () => {
  test("validates versions, known keys, opaque identifiers and closed issue codes without echoing content", () => {
    const safe = turn(0, { draftAttempts: 2, gateIssues: ["stop_after_checkpoint"], decisionModel: "jev-1.13.0" });
    expect(parseOpenUiDiagnosticExport({ schemaVersion: 1, turns: [safe] })).toEqual([safe]);
    expect(OPENUI_DIAGNOSTIC_EXPORT_SCHEMA.$defs.turn.additionalProperties).toBe(false);
    expect(isOpenUiDiagnosticGateIssue("stop_after_checkpoint")).toBe(true);
    for (const raw of [
      { schemaVersion: 1, turns: [], userText: "private" }, [{ ...safe, learner: "private" }],
      [{ ...safe, cue: { kind: "implicit-action", targets: [] } }], [{ ...safe, conversationId: "learner words" }],
      [{ ...safe, fit: { source: "review", passed: true, comment: "private" } }], [{ ...safe, gateIssues: ["private"] }],
      [{ ...safe, rendered: ["any"] }], [{ ...safe, schemaVersion: 2 }], [{ ...safe, turnIndex: 1.25 }],
      [{ ...safe, outsideWords: -1 }], [{ ...safe, outsideWords: 1.5 }], [{ ...safe, outsideWords: "42" }],
      [{ ...safe, nativePageRequested: "false" }], [{ ...safe, nativePageRequested: 1 }],
    ]) expect(() => parseOpenUiDiagnosticExport(raw)).toThrow();
  });
  test("round-trips conditional exercise gate issues without accepting free-form descriptions", () => {
    const row = turn(0, {gateIssues:[...TEACHING_DEBUGGING_ISSUES]});
    expect(parseOpenUiDiagnosticExport(JSON.parse(JSON.stringify({schemaVersion:1, turns:[row]})))).toEqual([row]);
    expect(() => parseOpenUiDiagnosticExport([{...row, gateIssues:["debug_private_description"]}])).toThrow();
  });
  test("counts actual per-turn components and keeps unmeasured or display-only responses separate", () => {
    const rows = [
      turn(0, { cue: cueQuestion(), attempted: true, compiled: ["question"], selected: ["question-group"], rendered: ["question-group", "markdown"],
        guidance: { source: "jev", action: "create", delivered: true, targets: ["question"] } }),
      turn(1, { cue: cueDirect(), attempted: true, compiled: ["question"], selected: ["callout"], rendered: ["callout"] }),
      turn(2, { cue: { kind: "explicit-interface", targets: ["simulation"] }, attempted: null, compiled: null, selected: ["quiz"], rendered: null,
        guidance: { source: "jev", action: "create", delivered: false, targets: ["quiz"] } }),
    ];
    const report = summarizeOpenUiDiagnostics(rows);
    expect(report.overall.rendered).toEqual({ numerator: 1, denominator: 2, unknown: 1, rate: 0.5 });
    expect(report.overall.opportunitySelected).toEqual({ numerator: 1, denominator: 2, unknown: 0, rate: 0.5 });
    expect(report.overall.directTextSelected.rate).toBe(0);
    expect(report.overall.directTextCompiled.rate).toBe(1);
    expect(report.overall.losses.draftToSelection).toEqual({ numerator: 1, denominator: 2, unknown: 0, rate: 0.5 });
    expect(report.overall.losses.selectionToRender).toEqual({ numerator: 0, denominator: 1, unknown: 1, rate: 0 });
    expect(report.overall.jevSelected).toEqual({ numerator: 1, denominator: 1, unknown: 0, rate: 1 });
    expect(report.components.find(r => r.key === "markdown")?.rendered.numerator).toBe(1);
    expect(summarizeOpenUiDiagnostics(rows, { model: "missing" }).overall.rendered.rate).toBeNull();
  });
  test("merges exact duplicate final turns while rejecting conflicting observations and duplicate positions", () => {
    const row = turn(0);
    expect(summarizeOpenUiDiagnostics([row, { ...row }]).coverage.duplicateRows).toBe(1);
    expect(() => summarizeOpenUiDiagnostics([row, { ...row, rendered: null }])).toThrow("Conflicting");
    expect(() => summarizeOpenUiDiagnostics([row, { ...row, turnId: "different" }])).toThrow("position");
  });
  test("counts public native page proposals independently of fenced interfaces and keeps older turns unknown", () => {
    const publicTool = turn(0, { nativePageRequested: true, attempted: false, compiled: [], selected: [], rendered: null });
    const fenced = turn(1, { nativePageRequested: false, selected: ["question"], rendered: ["question"] });
    const unknown = turn(2, { nativePageRequested: null });
    const legacy = turn(3);
    const report = summarizeOpenUiDiagnostics([publicTool, fenced, unknown, legacy]);
    expect(report.overall.nativePageRequested).toEqual({ numerator: 1, denominator: 2, unknown: 2, rate: 0.5 });
    expect(report.byModel[0]!.metrics.nativePageRequested).toEqual(report.overall.nativePageRequested);
    expect(report.overall.selected.numerator).toBe(1);
    expect(summarizeOpenUiDiagnostics([unknown, legacy]).overall.nativePageRequested)
      .toEqual({ numerator: 0, denominator: 0, unknown: 2, rate: null });
  });
  test("drill-down and aggregate losses use the same substantive interface condition", () => {
    const withheld = turn(0, { reply: "withheld", compiled: ["question"], selected: [] });
    const lost = turn(1, { selected: ["simulation"], rendered: ["markdown"] });
    const retained = turn(2, { selected: ["question"], rendered: ["question-group"] });
    const unknown = turn(3, { selected: ["question"], rendered: null });
    expect(openUiDiagnosticLoss(withheld, "draftToSelection")).toBe(true);
    expect(openUiDiagnosticLoss(withheld, "selectionToRender")).toBeNull();
    expect([lost, retained, unknown].map(row => openUiDiagnosticLoss(row, "selectionToRender"))).toEqual([true, false, null]);
    expect(summarizeOpenUiDiagnostics([withheld, lost, retained, unknown]).overall.losses.selectionToRender)
      .toEqual({ numerator: 1, denominator: 2, unknown: 1, rate: 0.5 });
  });
  test("loss queries return unique physical turns under the same filters and conflict rules as their summary", () => {
    const experiment = { experimentId: "pilot", caseId: "transfer", pairId: "one" };
    const lost = turn(0, { cue: cueQuestion(), compiled: ["question"], selected: [], experiment });
    const renderLoss = turn(1, { cue: cueQuestion(), selected: ["deck"], rendered: [] });
    const unknownRender = turn(2, { selected: ["diagram"], rendered: null });
    const other = turn(3, { cue: cueQuestion(), compiled: ["question"], selected: [] });
    const rows = [lost, { ...lost }, other, renderLoss, unknownRender];
    const options = { view: "draft-loss", model: "tutor-1", cue: "implicit-action", mode: "guided", limit: 1 };
    expect(queryOpenUiDiagnosticTurns(rows, options)).toEqual({ schemaVersion: 1, view: "draft-loss", matchingTurns: 2, turns: [lost] });
    expect(queryOpenUiDiagnosticTurns(rows, options, "pilot")).toMatchObject({ matchingTurns: 1, turns: [lost] });
    expect(queryOpenUiDiagnosticTurns(rows, options, "unseen")).toMatchObject({ matchingTurns: 0, turns: [] });
    expect(queryOpenUiDiagnosticTurns(rows, { view: "render-loss" })).toMatchObject({ matchingTurns: 1, turns: [renderLoss] });
    expect(queryOpenUiDiagnosticTurns(rows, {})).toEqual(summarizeOpenUiDiagnostics(rows));
    expect(() => queryOpenUiDiagnosticTurns([...rows, { ...lost, selected: ["deck"] }], { view: "render-loss", model: "other" })).toThrow("Conflicting observations");
    expect(() => queryOpenUiDiagnosticTurns([...rows, { ...other, turnId: "same-position" }], options)).toThrow("share a conversation position");
    expect(() => queryOpenUiDiagnosticTurns(rows, { rawText: true })).toThrow("Unknown diagnostics option.");
    expect(() => queryOpenUiDiagnosticTurns(rows, { view: "raw" })).toThrow("Unknown diagnostics view.");
    expect(() => queryOpenUiDiagnosticTurns(rows, { limit: 51 })).toThrow("Limit must be 1–50.");
  });
  test("unmet cues use the observed selection on each unique triggering turn", () => {
    const noDraft = turn(0, { cue: cueQuestion() });
    const later = turn(1, { selected: ["question-group"] });
    const wrong = turn(2, { cue: { kind: "explicit-interface", targets: ["simulation"] }, selected: ["quiz"] });
    const native = turn(3, { cue: cueQuestion(), nativePageRequested: true, rendered: null });
    const unknown = turn(4, { cue: cueQuestion(), selected: null, reply: "error" });
    const groupMatch = turn(5, { cue: cueQuestion(), selected: ["question-group"] });
    const text = turn(6, { cue: cueDirect(), selected: ["question"] });
    const any: OpenUiDiagnosticTurn["cue"] = { kind: "explicit-interface", targets: ["any"] };
    const anyMatch = turn(7, { cue: any, selected: ["deck"] });
    const decorative = turn(8, { cue: any, selected: ["markdown", "callout"] });
    const withheld = turn(9, { cue: cueQuestion(), compiled: ["question"], reply: "withheld" });
    const rows = [noDraft, { ...noDraft }, later, wrong, native, unknown, groupMatch, text, anyMatch, decorative, withheld];
    const query = queryOpenUiDiagnosticTurns(rows, { view: "unmet" });
    expect(query).toEqual({ schemaVersion: 1, view: "unmet", matchingTurns: 5, observedOpportunities: 7, unknownOpportunities: 1,
      turns: [noDraft, wrong, native, decorative, withheld] });
    expect(queryOpenUiDiagnosticTurns(rows, { view: "unmet", cue: "explicit-interface", limit: 1 })).toMatchObject({
      matchingTurns: 2, observedOpportunities: 3, unknownOpportunities: 0, turns: [wrong],
    });
    expect(queryOpenUiDiagnosticTurns(rows, { view: "unmet", cue: "direct-text" })).toMatchObject({
      matchingTurns: 0, observedOpportunities: 0, unknownOpportunities: 0, turns: [],
    });
    const summary = summarizeOpenUiDiagnostics(rows);
    expect(summary.overall.opportunitySelected).toMatchObject({ numerator: 2, denominator: 7, unknown: 1 });
    expect(summary.delays.selected.later).toBeGreaterThan(0);
  });
  test("counts fenced and native interfaces once per turn, preserving coverage and stage-specific fit", () => {
    const none = { succeeded:false, failed:false, attached:false, saved:false, mounted:false, ready:false, visible:false, opened:false, frameFailed:false };
    const ready = { ...none, succeeded:true, attached:true, saved:true, mounted:true, ready:true, visible:null };
    const any = { kind:"explicit-interface" as const, targets:["any"] };
    const rows = [
      turn(0, { cue:any, nativePageRequested:true, nativePage:ready }),
      turn(1, { cue:cueQuestion(), nativePageRequested:true, nativePage:ready }),
      turn(2, { cue:any, selected:["simulation"], rendered:["simulation"], nativePageRequested:true, nativePage:ready }),
      turn(3, { cue:any, nativePageRequested:true, nativePage:{...none,failed:true} }),
      turn(4, { cue:any, nativePageRequested:true }),
      turn(5, { cue:any, selected:["deck"], rendered:null }),
      turn(6, { cue:any, selected:["deck"], rendered:["deck"], nativePage:none, nativePageRequested:false }),
    ];
    const { overall } = summarizeOpenUiDiagnostics(rows);
    expect(overall.selected.numerator).toBe(3);
    expect(overall.nativePage.attached).toMatchObject({numerator:3,denominator:5,unknown:2});
    expect(overall.learnerInterfaces.selected).toEqual({ any:{numerator:5,denominator:6,unknown:1,rate:5/6}, nativeOnly:2, fencedOnly:1, both:1, otherSourceUnknown:1 });
    expect(overall.combinedOpportunitySelected).toMatchObject({numerator:4,denominator:5,unknown:2});
    expect(overall.combinedOpportunityRendered).toMatchObject({numerator:3,denominator:4,unknown:3});
    expect(queryOpenUiDiagnosticTurns(rows,{view:"combined-unmet"})).toMatchObject({matchingTurns:1,observedOpportunities:5,unknownOpportunities:2,turns:[rows[3]]});
    expect(queryOpenUiDiagnosticTurns(rows,{view:"native",limit:2})).toMatchObject({matchingTurns:5,turns:rows.slice(0,2)});
  });
  test("native delay measures compatible reminders, a changed cue, failure and unobserved outcomes", () => {
    const no = {succeeded:false,failed:false,attached:false,saved:false,mounted:false,ready:false,visible:false,opened:false,frameFailed:false};
    const ok = {...no,succeeded:true,attached:true,ready:true,mounted:true};
    const cue = {kind:"explicit-interface" as const, targets:["any"]};
    const rows = [
      turn(0,{cue, nativePage:{...no,failed:true}}),
      turn(1,{cue:{...cue,repeat:true},nativePage:ok}),
      turn(2,{cue,nativePage:no}),
      turn(3,{cue:cueDirect(),nativePage:no}),
      turn(4,{cue:cueQuestion(),nativePage:ok}),
      turn(5,{cue,nativePageRequested:true}),
      turn(6,{cue,nativePage:ok,reply:"withheld",selected:[]}),
    ];
    const { delays } = summarizeOpenUiDiagnostics(rows);
    expect(delays.combinedSelected).toMatchObject({opportunities:5,reminders:1,firstResponse:1,later:1,superseded:1,unknown:2,unresolved:0});
    expect(delays.combinedRendered.byResponse).toEqual([{responseNumber:1,count:1},{responseNumber:2,count:1}]);
    expect(delays.selected.firstResponse).toBe(0);
  });
  test("editor-language cues have their own action score and cannot inflate fenced or native counts", () => {
    const cue = classifyOpenUiCue("Give me a Python loop I can fix and run.");
    expect(cue).toMatchObject({kind:"implicit-action",targets:["editable-code"],codeLanguage:"python"});
    const guided = {source:"jev",action:"none",delivered:true,targets:[],codeLanguage:"python"} as const;
    const rows = [turn(0,{cue,editableCode:["python"],guidance:{...guided,targets:[]}}),turn(1,{cue,editableCode:["javascript"]}),
      turn(2,{cue,editableCode:[]}),turn(3,{cue}),turn(4,{cue,editableCode:null})];
    const s = summarizeOpenUiDiagnostics(rows);
    expect(s.overall.editableCode.any).toMatchObject({numerator:2,denominator:3,unknown:2});
    expect(s.overall.learnerActionSelected).toMatchObject({numerator:1,denominator:3,unknown:2});
    expect(s.overall.offeredCodeLanguageSelected).toMatchObject({numerator:1,denominator:1});
    const surrounded = summarizeOpenUiDiagnostics([turn(0,{editableCode:["python"],editorOutsideWords:0}),turn(1,{editableCode:["python"],editorOutsideWords:10}),
      turn(2,{editableCode:["javascript"]}),turn(3,{editableCode:[]}),turn(4,{})]).overall.editableCode.outsideWords;
    expect(surrounded).toEqual({observed:2,unknown:1,median:5,p90:10});
    expect(s.overall.opportunitySelected).toMatchObject({numerator:0,denominator:0,unknown:5});
    expect(s.overall.nativePage.ready.denominator).toBe(0);
    expect(s.overall.selected.numerator).toBe(0);
    expect(s.components.some(item=>item.key==="editable-code")).toBe(false);
    expect(queryOpenUiDiagnosticTurns(rows,{view:"editable-code"})).toMatchObject({matchingTurns:2});
    expect(queryOpenUiDiagnosticTurns(rows,{view:"action-unmet"})).toMatchObject({matchingTurns:2,unknownOpportunities:2,turns:rows.slice(1,3)});
    const later = turn(1,{editableCode:["python"]});
    expect(summarizeOpenUiDiagnostics([turn(0,{cue,editableCode:[]}),later]).delays.learnerActionSelected).toMatchObject({later:1,unknown:0});
    const switchLanguage = {...cue,repeat:true,codeLanguage:"typescript" as const};
    expect(summarizeOpenUiDiagnostics([turn(0,{cue,editableCode:[]}),turn(1,{cue:switchLanguage,editableCode:["typescript"]})]).delays.learnerActionSelected)
      .toMatchObject({firstResponse:1,superseded:1,reminders:0});
    for (const invalid of [{...rows[0],selected:["editable-code"]},{...rows[0],editableCode:["python","python"]},
      {...rows[0],editableCode:["python()"]},{...rows[0],cue:{kind:"none",targets:[],codeLanguage:"python"}},
      {...rows[0],editableCode:[],editorOutsideWords:0},{...rows[0],editorOutsideWords:-1},{...rows[0],editorOutsideWords:"10"}]) {
      expect(()=>parseOpenUiDiagnosticExport([invalid])).toThrow();
    }
  });
  test("a selected coding challenge is language-specific and historical language omissions stay unknown", () => {
    const js = classifyOpenUiCue("Give me a short JavaScript loop I can fix myself.");
    const ts = classifyOpenUiCue("Give me a TypeScript CodingChallenge I can fix myself.");
    const py = classifyOpenUiCue("Give me a short Python loop I can fix myself.");
    const fence = classifyOpenUiCue("Give me a JavaScript loop I can fix myself in a Markdown code fence.");
    const decline = classifyOpenUiCue("No coding challenge, but give me a JavaScript loop I can fix myself.");
    expect(js).toEqual({kind:"implicit-action",targets:["coding-challenge","editable-code"],codeLanguage:"javascript"});
    expect(ts).toEqual({kind:"explicit-interface",targets:["coding-challenge"],codeLanguage:"typescript"});
    expect(fence.targets).toEqual(["editable-code"]);
    expect(decline.targets).toEqual(["editable-code"]);
    const common = {selected:["coding-challenge"],editableCode:[],codingChallengeLanguages:["javascript" as const]};
    const rows = [turn(0,{...common,cue:js}),turn(1,{...common,cue:ts}),turn(2,{...common,cue:py}),turn(3,{...common,cue:fence}),
      turn(4,{...common,cue:js,codingChallengeLanguages:undefined}),turn(5,{...common,cue:js,selected:[],codingChallengeLanguages:[],editableCode:["javascript"]}),
      turn(6,{...common,cue:ts,codingChallengeLanguages:["typescript"]}),turn(7,{...common,cue:ts,selected:[],codingChallengeLanguages:[],editableCode:["typescript"]}),
      turn(8,{...common,cue:{...js,targets:["editable-code"]},codingChallengeLanguages:undefined})];
    const draft = rows[0]!;
    expect(summarizeOpenUiDiagnostics(rows).overall.learnerActionSelected).toMatchObject({numerator:3,denominator:7,unknown:2});
    expect(queryOpenUiDiagnosticTurns(rows,{view:"action-unmet"})).toMatchObject({matchingTurns:4,unknownOpportunities:2});
    expect(summarizeOpenUiDiagnostics([turn(0,{cue:js,editableCode:[]}),turn(1,{...common})]).delays.learnerActionSelected)
      .toMatchObject({firstResponse:0,later:1,unknown:0});
    const offers = rows.slice(0,3).map(r=>({...r,guidance:{source:"jev" as const,action:"create" as const,targets:["coding-challenge"],delivered:true,codeLanguage:r.cue.codeLanguage}}));
    expect(summarizeOpenUiDiagnostics(offers).overall.offeredCodeLanguageSelected).toMatchObject({numerator:1,denominator:3,unknown:0});
    const held = [turn(0,{cue:js,reply:"withheld"}),turn(1,{cue:js,reply:"withheld",selected:null}),
      turn(2,{cue:py,reply:"withheld"}),turn(3,{cue:py,reply:"withheld",nativePageRequested:true})];
    expect(queryOpenUiDiagnosticTurns(held,{view:"action-unmet"})).toMatchObject({matchingTurns:2,unknownOpportunities:2});
    for (const invalid of [{...draft,selected:[]},{...draft,selected:null},{...draft,reply:"withheld"},
      {...draft,codingChallengeLanguages:[]},{...draft,codingChallengeLanguages:["python"]},{...draft,codingChallengeLanguages:["javascript","javascript"]}]) {
      expect(()=>parseOpenUiDiagnosticExport([invalid])).toThrow();
    }
  });
  test("attributes an offered type to the recorded decision model with separate tutor, loss and missing-data filters", () => {
    const jev = turn(0, { decisionModel: "jev-1.14.0", reply: "withheld", compiled: ["question"], selected: [],
      guidance: { source: "jev", action: "create", delivered: true, targets: ["question"] } });
    const google = turn(1, { decisionModel: "gemini-decision-1", compiled: ["question-group"], selected: ["question-group"], rendered: null,
      guidance: { source: "other", action: "create", delivered: true, targets: ["question"] } });
    const rows = [jev, google, turn(2)];
    const result = summarizeOpenUiDiagnostics(rows);
    expect(result.overall.offeredType.selected).toMatchObject({ numerator: 1, denominator: 2 });
    expect(result.overall.jevSelected).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.byDecisionModel.map(group => group.key)).toEqual(["gemini-decision-1", "jev-1.14.0", "unknown"]);
    const filtered = summarizeOpenUiDiagnostics(rows, { decisionModel: "gemini-decision-1", model: "tutor-1" });
    expect(filtered.overall.offeredType.rendered).toMatchObject({ denominator: 0, unknown: 1 });
    expect(filtered.overall.offeredType.selected).toMatchObject({ numerator: 1, denominator: 1 });
    expect(queryOpenUiDiagnosticTurns(rows, { decisionModel: "jev-1.14.0", view: "draft-loss" })).toMatchObject({ turns: [jev] });
    expect(queryOpenUiDiagnosticTurns(rows, { decisionModel: "jev-1.14.0", view: "withheld" })).toMatchObject({ matchingTurns: 1, turns: [jev] });
    expect(queryOpenUiDiagnosticTurns(rows, { decisionModel: "gemini-decision-1", view: "withheld" })).toMatchObject({ matchingTurns: 0, turns: [] });
    expect(queryOpenUiDiagnosticTurns(rows, { decisionModel: "unknown" })).toMatchObject({ overall: { turns: 1 } });
    expect(() => queryOpenUiDiagnosticTurns(rows, { decisionModel: 123 })).toThrow("exact decision model ID");
  });
  test("reports observed words beside a selected interface, including zero and historical missing counts", () => {
    const rows = [0, 2, 4, 7, 11, 20, 25, 30, 32, 99].map((outsideWords, i) => turn(i, { selected: ["question"], outsideWords }));
    rows.push(turn(10, { selected: ["simulation"], outsideWords: null }), turn(11, { selected: ["deck"] }),
      turn(12, { selected: ["markdown"], outsideWords: 500 }), turn(13, { selected: null, outsideWords: 600 }));
    const summary = summarizeOpenUiDiagnostics(rows);
    expect(summary.overall.proseBesideInterface).toEqual({ observed: 10, unknown: 2, median: 15.5, p90: 32 });
    expect(summary.byModel[0]!.metrics.proseBesideInterface).toEqual(summary.overall.proseBesideInterface);
    expect(summarizeOpenUiDiagnostics(rows.slice(10)).overall.proseBesideInterface)
      .toEqual({ observed: 0, unknown: 2, median: null, p90: null });
  });
});

describe("delay in actual tutor replies", () => {
  test("summarizes observed browser elapsed times for released and withheld turns, with explicit historical coverage", () => {
    const rows = [
      turn(0, { replyElapsedMs: 0 }), turn(1, { replyElapsedMs: 80 }),
      turn(2, { reply: "withheld", replyElapsedMs: 1200 }), turn(3, { replyElapsedMs: 2000 }),
      turn(4), turn(5, { reply: "withheld", replyElapsedMs: null }),
      turn(6, { reply: "pending" }), turn(7, { reply: "error" }), turn(8, { reply: "cancelled" }), turn(9, { reply: "unknown" }),
    ];
    const summary = summarizeOpenUiDiagnostics(parseOpenUiDiagnosticExport([rows[0], ...rows]));
    expect(summary.overall.replyElapsedMs).toEqual({ observed: 4, unknown: 2, median: 640, p90: 2000 });
    expect(summary.byModel[0]!.metrics.replyElapsedMs).toEqual(summary.overall.replyElapsedMs);
    expect(summarizeOpenUiDiagnostics(rows.slice(4)).overall.replyElapsedMs).toEqual({ observed: 0, unknown: 2, median: null, p90: null });
    for (const replyElapsedMs of [-1, 1.5, "42", Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseOpenUiDiagnosticExport([{ ...rows[0], replyElapsedMs }])).toThrow();
    }
    expect(() => parseOpenUiDiagnosticExport([turn(10, { reply: "pending", replyElapsedMs: 0 })])).toThrow();
    expect(OPENUI_DIAGNOSTIC_EXPORT_SCHEMA.$defs.turn.required).not.toContain("replyElapsedMs");
  });
  test("retained conversations measure real replies from the same tutor without a recorded guidance mode", () => {
    const rows = [turn(0, { mode: "unknown", cue: cueQuestion() }), turn(1, { mode: "unknown", selected: ["question"] })];
    expect(summarizeOpenUiDiagnostics(rows, { mode: "unknown" }).delays.selected)
      .toMatchObject({ opportunities: 1, byResponse: [{ responseNumber: 2, count: 1 }], unknown: 0 });
  });
  test("a matching reminder keeps the original request and counts the second conversational reply", () => {
    const start = turn(0, { cue: classifyOpenUiCue("Could I change the width and watch the area?") });
    const reminder = turn(1, { cue: classifyOpenUiCue("I still want the slider."), rendered: ["simulation"] });
    const report = summarizeOpenUiDiagnostics([start, reminder]);
    expect(report.delays.rendered).toMatchObject({ opportunities: 1, reminders: 1, firstResponse: 0, later: 1,
      byResponse: [{ responseNumber: 2, count: 1 }] });
    expect(report.overall.opportunityRendered.denominator).toBe(2);
    expect(report.byCue.find(group => group.key === "implicit-action")!.metrics.delays.rendered.reminders).toBe(1);
    expect(summarizeOpenUiDiagnostics([start, { ...reminder, turnIndex: 3 }]).delays.rendered)
      .toMatchObject({ opportunities: 2, reminders: 0, unknown: 1, firstResponse: 1 });
    const incompatible = turn(1, { cue: classifyOpenUiCue("I still want the flashcards."), rendered: ["deck"] });
    expect(summarizeOpenUiDiagnostics([start, incompatible]).delays.rendered)
      .toMatchObject({ opportunities: 2, reminders: 0, superseded: 1, firstResponse: 1 });
  });
  test("follows the requested family across replies and filters, skips withheld generations, keeps mounts distinct", () => {
    const rows = [
      turn(0, { cue: cueQuestion(), selected: ["question"], rendered: [], draftAttempts: 3 }),
      turn(1, { reply: "withheld", rendered: null, draftAttempts: 4 }),
      turn(2, { selected: ["deck"], rendered: ["deck"] }),
      turn(3, { selected: ["question-group"], rendered: ["question-group"] }),
    ];
    const report = summarizeOpenUiDiagnostics(rows.reverse(), { cue: "implicit-action" });
    expect(report.overall.turns).toBe(1);
    expect(report.delays.selected.byResponse).toEqual([{ responseNumber: 1, count: 1 }]);
    expect(report.delays.rendered.byResponse).toEqual([{ responseNumber: 3, count: 1 }]);
  });
  test("distinguishes a superseding request, end of export, missing measurements and missing turn positions", () => {
    const rows = [
      turn(0, { cue: cueQuestion() }), turn(1, { cue: { kind: "explicit-interface", targets: ["simulation"] } }),
      turn(2, { rendered: ["question"] }),
      turn(0, { conversationId: "gap", cue: cueQuestion() }), turn(2, { conversationId: "gap", rendered: ["question"] }),
      turn(0, { conversationId: "no-observation", cue: cueQuestion(), rendered: null }),
      turn(1, { conversationId: "no-observation", rendered: ["question"] }),
      turn(0, { conversationId: "other", rendered: ["simulation"] }),
      turn(0, { conversationId: "new-model", cue: cueQuestion() }),
      turn(1, { conversationId: "new-model", model: "another-tutor", rendered: ["question"] }),
    ];
    expect(summarizeOpenUiDiagnostics(rows).delays.rendered).toMatchObject({
      opportunities: 5, superseded: 1, unresolved: 1, unknown: 3, firstResponse: 0, later: 0, medianResponseNumber: null,
    });
  });
});

describe("explicitly paired comparisons", () => {
  const exp = { experimentId: "keating-lab", caseId: "prediction", pairId: "settings-seed-1" };
  const observation = (mode: OpenUiDiagnosticTurn["mode"], fields: Partial<OpenUiDiagnosticTurn> = {}) =>
    turn(0, { mode, experiment: exp, conversationId: mode, cue: cueQuestion(),
      guidance: mode === "guided" ? { source: "jev", action: "create", delivered: true, targets: ["question"] } : null, ...fields });

  test("compares declared tutor arms, preserves blinded fit and avoids imputing browser mounts", () => {
    const report = summarizeOpenUiDiagnostics([
      observation("guided", { compiled: ["question-group"], reply: "unknown", selected: null, rendered: null, fit: { source: "blind-1", passed: true } }),
      observation("baseline", { compiled: [], reply: "unknown", selected: null, rendered: null, fit: { source: "blind-1", passed: false } }),
      observation("offer-only", { compiled: ["simulation"], reply: "unknown", selected: null, rendered: null, fit: { source: "another", passed: true } }),
    ]);
    const baseline = report.comparisons.find(c => c.control === "baseline")!;
    expect(baseline.compiled).toMatchObject({ pairs: 1, guidedOnly: 1, difference: 1 });
    expect(baseline.rendered).toMatchObject({ pairs: 0, unknown: 1, difference: null });
    expect(baseline.fit.difference).toBe(1);
    expect(report.comparisons.find(c => c.control === "offer-only")!.fit.pairs).toBe(0);
  });
  test("pairs direct-text controls on restraint, keeps unlabelled traffic and mismatched pairs out", () => {
    const rows = [
      observation("guided", { cue: cueDirect(), selected: [] }),
      observation("baseline", { cue: cueDirect(), selected: ["quiz"] }),
      observation("baseline", { experiment: { ...exp, pairId: "other" }, conversationId: "orphan" }),
      observation("guided", { experiment: { ...exp, pairId: "mixed" }, conversationId: "mixed-g" }),
      observation("baseline", { experiment: { ...exp, pairId: "mixed" }, conversationId: "mixed-b", cue: cueDirect() }),
      turn(3, { mode: "guided", cue: cueQuestion() }), turn(4, { mode: "baseline", cue: cueQuestion() }),
    ];
    const pair = summarizeOpenUiDiagnostics(rows).comparisons[0]!;
    expect(pair).toMatchObject({ matchedPairs: 1, unpaired: 1, ambiguous: 1, selected: { guidedOnly: 1 } });
    expect(summarizeOpenUiDiagnostics(rows.filter(r => !r.experiment)).comparisons).toEqual([]);
  });
  test("a guided mode label alone cannot attribute an experiment comparison to Jev", () => {
    for (const guidance of [null, { source: "other", action: "create", delivered: true, targets: ["question"] },
      { source: "jev", action: "create", delivered: false, targets: ["question"] }] as const) {
      const rows = [observation("guided", { guidance: guidance ? { ...guidance, targets: ["question"] } : null }), observation("baseline")];
      expect(summarizeOpenUiDiagnostics(rows).comparisons[0]).toMatchObject({ matchedPairs: 0, ineligibleGuidance: 1 });
    }
  });
});

describe("assessment opt-out observation", () => {
  test("recognises only an explicit decline in the learner's own words", () => {
    for (const text of ["No quiz, thanks.", "Let me change the flow and see the total. No quiz, thanks.", "Please don't quiz me on this.",
      "Show me the slider without a quiz", "skip the quiz please", "I don't want to be tested today", "Just explain it and don't make me predict",
      "ok no more quizzes for now", "Walk me through it (no pop quiz)"]) expect([text, observeAssessmentOptOut(text)]).toEqual([text, true]);
    for (const text of ["Quiz me on this.", "I have no questions, thanks", "Write the function, no tests", "My teacher said no quiz",
      'What does "no quiz" mean?', "If I said no quiz would you stop?", "Is there no quiz today?", "The manual says to go without a quiz",
      "Explain why the sum is 17."]) expect([text, observeAssessmentOptOut(text)]).toEqual([text, false]);
    for (const text of ["", "   ", "12345", null, undefined, "no quiz ".repeat(1000)]) expect(observeAssessmentOptOut(text)).toBeNull();
  });

  test("separates an instruction to predict from voluntary, negated, quoted and hypothetical wording", () => {
    const signals = (reply: Partial<Parameters<typeof observeAssessmentCheckpoints>[0]>) =>
      observeAssessmentCheckpoints({ components: [], simulationBriefs: [], prose: "", ...reply });
    expect(signals({ simulationBriefs: ["Predict the total. Then drag the slider."] })).toEqual(["simulation-brief"]);
    expect(signals({ prose: "Here is the model.\n\nFirst, predict the total before you drag." })).toEqual(["reply-text"]);
    expect(signals({ prose: "- **Predict** the result, then check it." })).toEqual(["reply-text"]);
    expect(signals({ components: ["simulation", "question-group"] })).toEqual(["question-interface"]);
    expect(signals({ components: ["quiz"], simulationBriefs: ["Guess the reading first."], prose: "Answer the question below." }))
      .toEqual(["simulation-brief", "question-interface", "reply-text"]);
    for (const clean of [{ simulationBriefs: ["Predict the total first if you like."] }, { simulationBriefs: ["Move the slider. You do not need to predict anything."] },
      { prose: 'The worksheet says "Predict the total first."' }, { prose: "You could predict the total, but the slider shows it." },
      { prose: "> Predict the total first.\n\nDrag the slider." }, { prose: "```python\npredict = 3\n```" },
      { components: ["simulation", "markdown"], simulationBriefs: ["Start at 2 L/min and move the slider."] }]) expect(signals(clean)).toEqual([]);
  });

  test("accepts legacy rows and rejects an observation the reply cannot support", () => {
    const valid = (fields: Partial<OpenUiDiagnosticTurn>) => { try { parseOpenUiDiagnosticExport([turn(0, fields)]); return true; } catch { return false; } };
    expect(valid({})).toBe(true);
    expect(valid({ assessment: { optOut: true, checkpoints: [] } })).toBe(true);
    expect(valid({ reply: "withheld", assessment: { optOut: true, checkpoints: null } })).toBe(true);
    expect(valid({ selected: ["question"], assessment: { optOut: false, checkpoints: ["question-interface"] } })).toBe(true);
    expect(valid({ reply: "withheld", assessment: { optOut: true, checkpoints: [] } })).toBe(false);
    expect(valid({ selected: ["question"], assessment: { optOut: true, checkpoints: [] } })).toBe(false);
    expect(valid({ assessment: { optOut: true, checkpoints: ["question-interface"] } })).toBe(false);
    for (const bad of [{ optOut: null, checkpoints: null }, { optOut: true }, { optOut: true, checkpoints: ["prose"] },
      { optOut: true, checkpoints: ["reply-text", "reply-text"] }, { optOut: true, checkpoints: null, text: "No quiz" }]) {
      expect(valid({ assessment: bad as never })).toBe(false);
    }
    expect(JSON.stringify(OPENUI_DIAGNOSTIC_EXPORT_SCHEMA)).toContain('"assessment"');
  });

  test("counts a checkpoint after an opt-out without scoring unreleased or unobserved turns", () => {
    const legacy = [turn(0), turn(1)];
    expect("assessmentOptOut" in summarizeOpenUiDiagnostics(legacy)).toBe(false);
    const rows = [
      turn(0, { selected: ["simulation"], assessment: { optOut: true, checkpoints: ["simulation-brief"] } }),
      turn(1, { selected: ["simulation"], assessment: { optOut: true, checkpoints: [] } }),
      turn(2, { reply: "withheld", selected: [], assessment: { optOut: true, checkpoints: null } }),
      turn(3, { selected: ["question"], assessment: { optOut: false, checkpoints: ["question-interface"] } }),
      turn(4, { assessment: { optOut: false, checkpoints: [] } }),
      turn(5),
    ];
    expect(rows.map(openUiCheckpointAfterOptOut)).toEqual([true, false, null, null, null, null]);
    expect(summarizeOpenUiDiagnostics(rows).assessmentOptOut).toEqual({
      observedTurns: 5, unobservedTurns: 1, optOuts: 3, notReleased: 1,
      checkpointAfterOptOut: { numerator: 1, denominator: 2, unknown: 1, rate: 0.5 },
      signals: [{ signal: "simulation-brief", turns: 1 }, { signal: "question-interface", turns: 0 }, { signal: "reply-text", turns: 0 }],
      checkpointWithoutOptOut: { numerator: 1, denominator: 2, unknown: 0, rate: 0.5 },
    });
    expect(queryOpenUiDiagnosticTurns(rows, { view: "assessment-opt-out" })).toEqual({ schemaVersion: 1, view: "assessment-opt-out",
      matchingTurns: 1, observedOptOuts: 2, unknownOptOuts: 1, unobservedTurns: 1, turns: [rows[0]!] });
    expect(queryOpenUiDiagnosticTurns(legacy, { view: "assessment-opt-out" })).toMatchObject({ matchingTurns: 0, observedOptOuts: 0, unobservedTurns: 2 });
  });
});
