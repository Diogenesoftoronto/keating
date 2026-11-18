import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import type { OpenUiDiagnosticTurn } from "../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { readFileSync } from "node:fs";
import { inspectAssessmentCheckpoints, inspectOpenUIDiagnosticText } from "../keating/openui/diagnostic-components";
import { openUIDiagnosticEvent } from "../keating/openui/turn-diagnostics";
import { createOpenUIDiagnosticStore, diagnosticConversationId, diagnosticSourceId } from "../keating/openui/turn-diagnostics";
import { activeOpenUIDiagnosticTurn, observeOpenUITurns } from "../keating/openui/turn-observer";
import { KeatingOpenUIRenderer } from "../keating/openui/renderer";
import { createOpenUIActionLearnerResponse, serializeLearnerResponse } from "../keating/learner-response";
import { withTeachingDraftGate } from "../keating/judgement/draft-gate";
import { withReviewNotice } from "../keating/judgement/review-notice";
import { answerDraftGateReview } from "./helpers/teaching-draft-judge";

const source = [
  'root = LearningSurface([q], "Bayes", "", "ephemeral")',
  'q = Question([{ question: "PRIVATE prompt", type: "choice", choices: ["Evidence", "Typography"], allowText: true }], "ephemeral", "Bayes", "Choose one.")',
].join("\n");
const fence = (program: string) => "```openui\n" + program + "\n```";
const model = { id: "fixture-tutor", provider: "fixture", api: "openai-completions", name: "Fixture",
  reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 500 } as Model<Api>;
const learner = (content: string) => ({ role: "user" as const, content, timestamp: 1 });
const assistant = (text: string, reason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
  role: "assistant", content: [{ type: "text", text }], provider: model.provider, model: model.id, api: model.api,
  timestamp: 2, stopReason: reason, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const row = (index: number): OpenUiDiagnosticTurn => ({ schemaVersion: 1, conversationId: "example",
  turnId: `learner-${index}`, turnIndex: index, model: null, mode: "unknown", cue: { kind: "none", targets: [] },
  reply: "pending", attempted: null, compiled: null, selected: null, rendered: null, guidance: null });

describe("durable content-free OpenUI turn observation", () => {
  test("binds an actual language-only planning receipt to the selected Python editor without crediting fenced OpenUI", async () => {
    const store = createOpenUIDiagnosticStore(()=>undefined);
    const sessionId = "code-language-offer";
    const request = learner("Give me a short Python loop with a bug I can edit and run.");
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const observation = observeOpenUITurns({sessionId,store,messages:()=>messages,mode:()=>"unknown",capture(){}});
    messages.push(request);
    observation.observe({type:"agent_start"});
    const gate = withTeachingDraftGate(() => {
      const reply = assistant(["```python","numbers = [1, 2, 3]","for i in range(len(numbers) + 1):","    print(numbers[i])","```"].join("\n"));
      const stream = createAssistantMessageEventStream();
      stream.push({type:"done",reason:"stop",message:reply}); stream.end(reply); return stream;
    },{sessionId,basePrompt:()=>"Help the learner.",makeCaller:()=>async input=>{
      const output=answerDraftGateReview(input);
      if (!output.ok) return output;
      const answers={...output.response.answers};
      if (answers.executable_code) answers.executable_code={type:"noul",noul:1};
      if (answers.direct_answer_requested) answers.direct_answer_requested={type:"noul",noul:0};
      return {...output,response:{...output.response,answers,backend:{backend:"system-one",model:"jev-fixture",calibrationSha256:null}}};
    }});
    const reply = await (await gate(model,{systemPrompt:"Help the learner.",messages:[request]})).result();
    messages.push(reply); observation.observe({type:"agent_end"}); await store.settled();
    expect(store.getRows()[0]).toMatchObject({reply:"released",editableCode:["python"],selected:[],
      guidance:{source:"jev",action:"none",delivered:true,targets:[],codeLanguage:"python"}});
    observation.dispose();
  });
  test("recognizes incomplete and invalid fences without counting component-shaped text", () => {
    expect(inspectOpenUIDiagnosticText("Please use Question([...]).")).toEqual({ attempted: false, components: [], outsideWords: 3 });
    expect(inspectOpenUIDiagnosticText("```openui\n" + source)).toEqual({ attempted: true, components: [], outsideWords: 0 });
    expect(inspectOpenUIDiagnosticText(fence('root = LearningSurface([missing], "broken")'))).toEqual({ attempted: true, components: [], outsideWords: 0 });
    expect(inspectOpenUIDiagnosticText(fence(source) + "\n" + fence(source))).toEqual({ attempted: true, components: ["question-group"], outsideWords: 0 });
  });

  test("only the committed renderer emits a family marker for the completed Question document", () => {
    const rendered = (program: string, complete: boolean) => renderToStaticMarkup(createElement(KeatingOpenUIRenderer,
      { program, metadata: { id: "contract", lifecycle: "ephemeral", revision: 0 }, sourceComplete: complete, isStreaming: !complete }));
    expect(rendered(source, true)).toContain('data-openui-diagnostic-nodes="question-group"');
    expect(rendered(source, false)).not.toContain("data-openui-diagnostic-nodes");
    expect(rendered('root = LearningSurface([missing])', true)).not.toContain("data-openui-diagnostic-nodes");
  });

  test("records the actual gated tutor and planner, before and after selection, without retaining content", async () => {
    const factory = new IDBFactory();
    const store = createOpenUIDiagnosticStore(() => factory);
    const sessionId = "PRIVATE imported session title";
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [learner("PRIVATE old history"), assistant("PRIVATE historical reply")];
    const events: Record<string, unknown>[] = [];
    const observer = observeOpenUITurns({ sessionId, store, messages: () => messages, mode: () => "unknown",
      capture: (name, fields) => { expect(name).toBe("openui_turn_observed"); events.push(fields); } });
    const request = learner("Ask me a question about PRIVATE material.");
    messages.push(request);
    observer.observe({ type: "agent_start" });
    observer.observe({ type: "message_end", message: request });
    const gate = withTeachingDraftGate(() => {
      const reply = assistant(fence(source));
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: reply });
      stream.end(reply);
      return stream;
    }, { sessionId, basePrompt: () => "Help the learner.", makeCaller: () => async request => {
      const outcome = answerDraftGateReview(request);
      if (!outcome.ok) return outcome;
      const answers = { ...outcome.response.answers };
      if (answers.learner_response_due) answers.learner_response_due = { type: "noul", noul: 1 };
      if (answers.direct_answer_requested) answers.direct_answer_requested = { type: "noul", noul: 0 };
      return { ...outcome, response: { ...outcome.response, answers,
        backend: { backend: "system-one", model: "jev-1.fixture", calibrationSha256: null } } };
    } });
    const stream = await gate(model, { systemPrompt: "Help the learner.", messages: [request] });
    const response = await stream.result();
    messages.push(response);
    observer.observe({ type: "agent_end" });
    await store.settled();
    const [observed] = store.getRows();
    expect(observed).toMatchObject({ turnId: "learner-1", turnIndex: 1, model: "fixture/fixture-tutor", mode: "guided",
      decisionModel: "jev-1.fixture", reply: "released", attempted: true, compiled: ["question-group"], selected: ["question-group"], rendered: null,
      selection: { attempt: 1, review: "verified", rule: "none" },
      guidance: { source: "jev", action: "create", delivered: true, targets: ["question"] } });
    expect(observed?.draftAttempts).toBeGreaterThanOrEqual(1);
    expect(events.map(item => item.reply_outcome)).toEqual(["pending", "released"]);
    expect(events[0]?.cue_kind).toBe("implicit-action");
    const session = diagnosticConversationId(sessionId);
    expect(session).not.toContain("PRIVATE");
    expect(store.awaitingRender(session, ["assistant-1-2"])).toBe(false); // old history
    expect(store.awaitingRender(session, ["assistant-3-2", "another"])).toBe(false); // grouped projections
    expect(store.awaitingRender(session, ["assistant-3-2"])).toBe(true);
    store.rendered(session, ["assistant-3-2"], ["question-group"]);
    store.rendered(session, ["assistant-3-2"], ["question-group"]); // simultaneous remount
    observer.dispose();
    await store.settled();
    expect(events).toHaveLength(3);
    expect(events.at(-1)?.rendered_components).toEqual(["question-group"]);
    expect(events.map(item => item.outside_words)).toEqual([null, 0, 0]);
    expect(events.map(item => item.native_page_requested)).toEqual([null, false, false]);
    expect(events[2]!.diagnostic_revision).toBeGreaterThan(events[1]!.diagnostic_revision as number);
    expect(JSON.stringify([store.getRows(), events])).not.toContain("PRIVATE");
    const reloaded = createOpenUIDiagnosticStore(() => factory);
    await reloaded.settled();
    expect(reloaded.getRows()).toEqual(store.getRows());
    expect(reloaded.awaitingRender(session, ["assistant-3-2"])).toBe(false);
  });

  test("counts words outside a selected card and leaves unavailable or tool-only answers unmeasured", async () => {
    const store = createOpenUIDiagnosticStore(() => new IDBFactory());
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const observer = observeOpenUITurns({ sessionId: "word-count", store, messages: () => messages, mode: () => "unknown", capture() {} });
    const toolOnly: AssistantMessage = { ...assistant(""), content: [{ type: "toolCall", id: "lookup", name: "lookup", arguments: {} }] };
    for (const reply of [assistant(fence(source)), assistant(withReviewNotice("unverified", "Try this.\n" + fence(source) + "\nExplain\tyour choice.")),
      assistant(withReviewNotice("withheld", "PRIVATE explanation")), toolOnly]) {
      messages.push(learner("Continue."));
      observer.observe({ type: "agent_start" });
      messages.push(reply);
      observer.observe({ type: "agent_end" });
    }
    await store.settled();
    expect(store.getRows().map(turn => [turn.reply, turn.outsideWords])).toEqual([
      ["released", 0], ["released", 5], ["withheld", null], ["released", null],
    ]);
    observer.dispose();
  });

  test("times the exact final public message across drafts and tool rounds, before later settlement or rendering", async () => {
    const store = createOpenUIDiagnosticStore(() => new IDBFactory());
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const durations: unknown[] = [];
    let clock = 100.25;
    const sessionId = "timed-turn";
    const observer = observeOpenUITurns({ sessionId, store, messages: () => messages, mode: () => "unknown",
      now: () => clock, capture: (_event, fields) => { durations.push(fields.reply_elapsed_ms); } });
    const request = learner("Give me a question."), intermediate = assistant("", "toolUse"), final = assistant(fence(source));
    messages.push(request);
    observer.observe({ type: "agent_start" });
    clock = 220;
    observer.observe({ type: "message_end", message: request });
    activeOpenUIDiagnosticTurn(sessionId)!.beginRound().candidate(intermediate, false);
    clock = 600;
    messages.push(intermediate);
    observer.observe({ type: "message_end", message: intermediate });
    activeOpenUIDiagnosticTurn(sessionId)!.beginRound().candidate(final, false);
    messages.push(final);
    clock = 3850.8;
    observer.observe({ type: "message_end", message: final });
    clock = 7300;
    observer.observe({ type: "message_end", message: final }); // repeated observation of the same object
    observer.observe({ type: "agent_end" });
    await store.settled();
    store.rendered(diagnosticConversationId(sessionId), ["assistant-2-2"], ["question-group"]);
    await store.settled();
    expect(store.getRows()[0]).toMatchObject({ reply: "released", rendered: ["question-group"], replyElapsedMs: 3751 });
    expect(durations).toEqual([null, 3751, 3751]);
    observer.dispose();
  });

  test("a retry starts its own clock; cancellation, missing messages and clock reversal stay unknown", async () => {
    const store = createOpenUIDiagnosticStore(() => undefined);
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    let clock = 200;
    const observer = observeOpenUITurns({ sessionId: "timed-retry", store, messages: () => messages, mode: () => "unknown",
      now: () => clock, capture() {} });
    function complete(reply: AssistantMessage, end: number, observed = true) {
      messages.push(reply);
      clock = end;
      if (observed) observer.observe({ type: "message_end", message: reply });
      observer.observe({ type: "agent_end" });
    }
    messages.push(learner("Try one."));
    observer.observe({ type: "agent_start" });
    complete(assistant("", "aborted"), 900);
    await store.settled();
    expect(store.getRows()[0]).toMatchObject({ reply: "cancelled", replyElapsedMs: null });
    messages.pop(); // the classroom removes the failed reply when retrying this learner turn
    clock = 9300;
    observer.observe({ type: "agent_start" });
    complete(assistant(withReviewNotice("withheld", "Try later.")), 9300);
    for (const [reason, end, observed] of [["stop", 9500, false], ["stop", 9400, true], ["error", 9900, true]] as const) {
      const queued = learner("Continue.");
      messages.push(queued);
      observer.observe({ type: "message_end", message: queued });
      complete(assistant("", reason), end, observed);
    }
    clock = 11000;
    messages.push(learner("One more."));
    observer.observe({ type: "agent_start" });
    const first = assistant("Four.");
    messages.push(first);
    clock = 11100;
    observer.observe({ type: "message_end", message: first });
    const followup = learner("Why?");
    messages.push(followup);
    clock = 11200;
    observer.observe({ type: "message_end", message: followup }); // same agent run, fresh learner turn
    complete(assistant("Two pairs."), 11475);
    await store.settled();
    expect(store.getRows().map(row => [row.reply, row.replyElapsedMs])).toEqual([
      ["withheld", 0], ["released", null], ["released", null], ["error", null], ["released", 100], ["released", 275],
    ]);
    observer.dispose();
  });

  test("separates real prose, withheld replies, and failures before a tutor was called", async () => {
    const store = createOpenUIDiagnosticStore(() => undefined);
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const obs = observeOpenUITurns({ sessionId: "session", store, messages: () => messages, mode: () => "baseline", capture() {} });
    const run = (request: string, response: AssistantMessage) => {
      messages.push(learner(request));
      obs.observe({ type: "agent_start" });
      messages.push(response);
      obs.observe({ type: "agent_end" });
    };
    run("Answer in plain text.", assistant("Four."));
    run("Test me.", assistant(withReviewNotice("withheld", "PRIVATE reason")));
    run("Take another look.", assistant("PRIVATE connection failure", "error"));
    run("Stop the test.", assistant("", "aborted"));
    await store.settled();
    expect(store.getRows().map(item => [item.turnIndex, item.reply, item.compiled, item.selected, item.rendered, item.model])).toEqual([
      [0, "released", [], [], null, "fixture/fixture-tutor"], [1, "withheld", null, [], null, null],
      [2, "error", null, null, null, null], [3, "cancelled", null, null, null, null],
    ]);
    expect(store.getRows().every(item => item.mode === "baseline" && item.guidance === null)).toBe(true);
    const session = diagnosticConversationId("session");
    store.rendered(session, ["assistant-1-2"], []);
    store.rendered(session, ["assistant-5-2"], []);
    await store.settled();
    expect(store.getRows().map(item => item.rendered)).toEqual([[], null, null, null]);
    obs.dispose();
  });

  test("counts public native page proposals independently of fenced UI, private candidates and later tutor changes", async () => {
    const store = createOpenUIDiagnosticStore(() => undefined);
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const sessionId = "native-pages";
    const observer = observeOpenUITurns({sessionId, store, messages: () => messages, mode: () => "unknown", capture() {}});
    const pageCall: AssistantMessage = {...assistant("", "toolUse"), content: [{type:"toolCall", id:"page", name:"interactive_page", arguments:{source:"PRIVATE"}}]};
    for (const replies of [
      [pageCall], [pageCall, assistant("Your page is ready.")], [assistant("Calling interactive_page might help.")],
      [pageCall, {...assistant("A second tutor answered."), model:"other"}], [assistant(withReviewNotice("withheld", "PRIVATE"))],
    ]) {
      messages.push(learner("I want to change a rate and see the result."));
      observer.observe({type:"agent_start"});
      activeOpenUIDiagnosticTurn(sessionId)!.beginRound().candidate(pageCall, false);
      messages.push(...replies);
      observer.observe({type:"agent_end"});
    }
    await store.settled();
    expect(store.getRows().map(r => r.nativePageRequested)).toEqual([true, true, false, null, null]);
    expect(store.getRows()[0]).toMatchObject({model:"fixture/fixture-tutor", outsideWords:null, rendered:null});
    expect(JSON.stringify(store.getRows())).not.toContain("PRIVATE");
    observer.dispose();
  });

  test("preserves same-tutor candidates and turn-wide gate counts across tool rounds and isolates a changed tutor", async () => {
    const store = createOpenUIDiagnosticStore(() => undefined);
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const sessionId = "multiple-rounds";
    const obs = observeOpenUITurns({ sessionId, store, messages: () => messages, mode: () => "unknown", capture() {} });
    const snapshot: TeachingDraftSnapshot = { phase: "drafting", attempt: 1, maxAttempts: 10, reasoning: "low", standard: "concise", elapsedMs: 2,
      judgeModel: "jev-1.fixture", selectedAttempt: null, reason: null, interaction: { action: "create", families: [{ family: "question", components: ["Question"] }], paired: false, features: [] },
      attempts: [{ attempt: 1, reasoning: "low", standard: "concise", generationMs: 1, judgementMs: 1, status: "fail", variant: "default",
        checks: [
          { id: "checkpoint_not_interactive", status: "fail", severity: "minor", source: "jev", probability: 1 },
          { id: "PRIVATE dynamic content", status: "fail", severity: "minor", source: "jev", probability: 1 },
          { id: "checkpoint_answer_leaked", status: "fail", severity: "major", source: "jev", probability: .74, applicability: "standalone-direct-answer" },
        ] }] };
    for (const finalModel of ["fixture-tutor", "second-tutor"]) {
      messages.push(learner("Quiz me."));
      obs.observe({ type: "agent_start" });
      const turn = activeOpenUIDiagnosticTurn(sessionId)!;
      const first = turn.beginRound();
      const candidate = assistant(fence(source), "toolUse");
      first.plan(snapshot, { backend: "system-one", model: "jev-1.fixture" });
      first.candidate(candidate, true, 1);
      first.plan({ ...snapshot, phase: "released", selectedAttempt: 1, reason: "best-effort-draft", selectionRule: "none" }, null);
      messages.push(candidate);
      const second = turn.beginRound();
      const reply = { ...assistant("PRIVATE selected prose"), model: finalModel };
      second.plan({ ...snapshot, attempts: [], interaction: { action: "none", features: [], paired: false, families: [] } }, { backend: "local", model: "fixture-local-planner" });
      second.candidate(reply, true);
      messages.push(reply);
      obs.observe({ type: "agent_end" });
    }
    await store.settled();
    expect(store.getRows().map(r => [r.model, r.attempted, r.compiled, r.selected])).toEqual([
      ["fixture/fixture-tutor", true, ["question-group"], []], ["fixture/second-tutor", false, [], []],
    ]);
    for (const turn of store.getRows()) {
      expect(turn.selection).toBeUndefined(); // A selected private tool round cannot identify the later public answer's winner.
      expect(turn).toMatchObject({ draftAttempts: 2, gateIssues: ["checkpoint_not_interactive"], decisionModel: "fixture-local-planner",
        guidance: { source: "other", action: "none", targets: [], delivered: true } });
    }
    obs.dispose();
  });

  test("counts physical learner inputs, excludes automatic repair and imported provenance, and keeps generated answer instructions out of cues", async () => {
    const store = createOpenUIDiagnosticStore(() => undefined);
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const obs = observeOpenUITurns({ sessionId: "queue", store, messages: () => messages, mode: () => "unknown", capture() {} });
    const imported = { ...learner("Make me a quiz from this private room"), keatingPrivateFork: { kind: "imported-context", version: 1 } };
    const one = learner("What is two plus two?"), two = learner("Actually, just give me the answer.");
    messages.push(imported, one, two);
    obs.observe({ type: "agent_start" });
    for (const message of [imported, one, two]) obs.observe({ type: "message_end", message });
    messages.push(assistant("Four."));
    obs.observe({ type: "agent_end" });
    const action = (type: string) => learner(serializeLearnerResponse(createOpenUIActionLearnerResponse({ kind: "legacy", type,
      humanFriendlyMessage: "Make me a private quiz", params: { source: "make a quiz" }, document: { id: "d", revision: 0, lifecycle: "ephemeral" } })));
    for (const next of [action("regenerate-interaction"), action("choose-option")]) {
      messages.push(next);
      obs.observe({ type: "agent_start" });
      messages.push(assistant("A follow-up."));
      obs.observe({ type: "agent_end" });
    }
    await store.settled();
    expect(store.getRows().map(r => [r.turnIndex, r.reply, r.cue.kind])).toEqual([
      [0, "unknown", "none"], [1, "released", "direct-text"], [2, "released", "none"],
    ]);
    obs.dispose();
  });

  test("a newer attempt owns its turn across tabs and retention survives a fresh connection", async () => {
    const factory = new IDBFactory();
    const tab = createOpenUIDiagnosticStore(() => factory, false, 2);
    const otherTab = createOpenUIDiagnosticStore(() => factory, false, 2);
    const first = tab.begin(row(0));
    await tab.settled();
    const retry = otherTab.begin(row(0));
    await otherTab.settled();
    retry({ ...row(0), reply: "released", selected: [] }, diagnosticSourceId("new"));
    first({ ...row(0), reply: "released", selected: ["quiz"] }, diagnosticSourceId("old"));
    await Promise.all([tab.settled(), otherTab.settled()]);
    let snapshot = createOpenUIDiagnosticStore(() => factory, false, 2);
    await snapshot.settled();
    expect(snapshot.getRows()).toHaveLength(1);
    expect(snapshot.getRows()[0]?.selected).toEqual([]);
    expect(snapshot.awaitingRender("example", ["old"])).toBe(false);
    expect(snapshot.awaitingRender("example", ["new"])).toBe(true);
    await Bun.sleep(3);
    tab.begin(row(1));
    await tab.settled();
    await Bun.sleep(3);
    tab.begin(row(2));
    await tab.settled();
    snapshot = createOpenUIDiagnosticStore(() => factory, false, 2);
    await snapshot.settled();
    expect(snapshot.getRows().map(item => item.turnIndex)).toEqual([1, 2]);
  });
});

describe("assessment opt-out on ordinary web turns", () => {
  const receipt = (id: string) => JSON.parse(readFileSync(new URL(
    `../../../docs/benchmarks/openui-audit-2026-11-18/final-review/study/receipts/${id}.json`, import.meta.url), "utf8")) as { prompt: string; public: { text: string } };
  async function observeTurn(request: ReturnType<typeof learner>, reply?: AssistantMessage) {
    const store = createOpenUIDiagnosticStore(() => undefined);
    const events: Record<string, unknown>[] = [];
    const messages: Array<AssistantMessage | ReturnType<typeof learner>> = [];
    const observation = observeOpenUITurns({ sessionId: "assessment", store, messages: () => messages, mode: () => "baseline",
      capture(_, properties) { events.push(properties); } });
    messages.push(request);
    observation.observe({ type: "agent_start" });
    if (reply) messages.push(reply);
    observation.observe({ type: "agent_end" });
    await store.settled();
    observation.dispose();
    return { row: store.getRows()[0]!, event: events.at(-1)! };
  }

  test("flags both saved unguided irrigation replies and neither guided reply", async () => {
    const expected: Record<string, NonNullable<OpenUiDiagnosticTurn["assessment"]>["checkpoints"]> = {
      "irrigation--flash--none": ["simulation-brief"], "irrigation--minimax--none": ["simulation-brief"],
      "irrigation--minimax--google": [], "irrigation--minimax--jev": [] };
    for (const [id, checkpoints] of Object.entries(expected)) {
      const saved = receipt(id);
      const { row, event } = await observeTurn(learner(saved.prompt), assistant(saved.public.text));
      expect([id, row.selected, row.assessment]).toEqual([id, ["simulation"], { optOut: true, checkpoints }]);
      expect([event.assessment_opt_out, event.assessment_checkpoints]).toEqual([true, checkpoints]);
      const sent = JSON.stringify(event);
      expect(sent).not.toContain("No quiz");
      expect(sent).not.toContain("Predict");
    }
  });

  test("keeps a missing opt-out, a voluntary invitation, a withheld reply and absent learner words distinct", async () => {
    const slider = (brief: string) => fence(['root = LearningSurface([sim], "Flow", "", "ephemeral")',
      'sim = Simulation("s", "Flow", [{ id: "flow", label: "Flow", unit: "L/min", min: 0, max: 5, step: 1, value: 2 }], '
        + '[{ id: "total", label: "Total", unit: "L", expr: "flow * 6" }], "ephemeral", ' + JSON.stringify(brief) + ")"].join("\n"));
    const pressed = slider("Predict the total first. Then drag the slider.");
    expect(inspectAssessmentCheckpoints(pressed)).toEqual(["simulation-brief"]);
    expect((await observeTurn(learner("Let me change the flow."), assistant(pressed))).row.assessment).toEqual({ optOut: false, checkpoints: ["simulation-brief"] });
    expect((await observeTurn(learner("No quiz, thanks."), assistant(slider("Predict the total first if you like. Then drag the slider.")))).row.assessment)
      .toEqual({ optOut: true, checkpoints: [] });
    expect((await observeTurn(learner("No quiz, thanks."), assistant(fence(source)))).row.assessment).toEqual({ optOut: true, checkpoints: ["question-interface"] });
    const withheld = await observeTurn(learner("No quiz, thanks."), assistant(withReviewNotice("withheld", "PRIVATE reason")));
    expect([withheld.row.reply, withheld.row.assessment]).toEqual(["withheld", { optOut: true, checkpoints: null }]);
    expect((await observeTurn(learner("No quiz, thanks."), assistant("```openui\nroot = BadSyntax("))).row.assessment).toEqual({ optOut: true, checkpoints: null });
    expect((await observeTurn(learner("No quiz, thanks."))).row.assessment).toEqual({ optOut: true, checkpoints: null });
    const absent = await observeTurn(learner("   "), assistant(pressed));
    expect(absent.row.assessment).toBeUndefined();
    expect([absent.event.assessment_opt_out, absent.event.assessment_checkpoints]).toEqual([null, null]);
    expect(openUIDiagnosticEvent(row(0), 1)).toMatchObject({ assessment_opt_out: null, assessment_checkpoints: null });
  });
});
