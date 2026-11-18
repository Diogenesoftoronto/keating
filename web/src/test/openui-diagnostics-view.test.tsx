import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseOpenUiDiagnosticExport, summarizeOpenUiDiagnostics } from "@keating/learner-contracts";
import { OpenUiUsageView } from "../components/settings/OpenUiUsageView";
import { queryOpenUiDiagnosticTurns } from "../keating/openui/diagnostic-query";
import audit from "../keating/openui/examples/november-audit.json";
import holdout from "../keating/openui/examples/policy-holdout.json";
import decisions from "../keating/openui/examples/decision-models.json";
import paired from "../keating/openui/examples/paired-benchmark.json";
import episodes from "../keating/openui/examples/terminal-episodes.json";

describe("recorded sources in the interface diagnostics panel", () => {
  test("shows the actual released attempt, review disposition and known or unavailable prediction rule", () => {
    const [template] = parseOpenUiDiagnosticExport(audit);
    const choices = [{attempt:2,review:"verified",rule:"requested-prediction-over-prose"},
      {attempt:1,review:"best-effort",rule:"presentation-only-checkpoint-retained"}, {attempt:2,review:"best-effort"}, undefined];
    const rows = parseOpenUiDiagnosticExport(choices.map((selection, i) => ({...template,turnId:"pick-"+i,turnIndex:i, reply:"released",
      ...(selection ? {selection} : {})})));
    const view = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialView="all" />);
    expect(view).toContain("Attempt 2 · Passed review");
    expect(view).toContain("Attempt 1 · Best effort, unverified");
    expect(view).toContain("The requested answer field took precedence over a prose question.");
    expect(view).toContain("The answer field was retained after a presentation-only review finding.");
    expect(view).toContain("Prediction selection rule</dt><dd>Unobserved");
    expect(view).toContain("Released draft</dt><dd>Unobserved");
    expect(queryOpenUiDiagnosticTurns(rows,{view:"released-drafts",limit:2})).toMatchObject({matchingTurns:3,unknownSelections:1,turns:rows.slice(0,2)});
  });
  test("separates surrounding prose, Markdown code tokens and an unmeasured legacy editor", () => {
    const [template] = parseOpenUiDiagnosticExport(audit);
    const rows = parseOpenUiDiagnosticExport([0,10,null].map((words,i)=>({...template,turnId:"editor-"+i,turnIndex:i,
      reply:"released",selected:[],rendered:null,editableCode:["python"],editorOutsideWords:words,outsideWords:i===0?26:24})));
    const html = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="selected" />);
    expect(html).toContain("Words around editable code · median 5 · 2 measured editor replies · 1 unknown");
    expect(html).toContain("Words outside OpenUI, including code</dt><dd>26");
    expect(html).toContain("Words around editable code</dt><dd>0");
    expect(html).toContain("Words around editable code</dt><dd>Unobserved");
  });
  test("shows measured final-message time and coverage while keeping historical time unavailable", () => {
    const [template] = parseOpenUiDiagnosticExport(audit);
    const rows = parseOpenUiDiagnosticExport([
      {...template, turnId: "a", turnIndex: 0, reply: "released", replyElapsedMs: 1000},
      {...template, turnId: "b", turnIndex: 1, reply: "withheld", replyElapsedMs: 2000},
      {...template, turnId: "c", turnIndex: 2, reply: "released"},
    ]);
    const view = renderToStaticMarkup(<OpenUiUsageView turns={rows} />);
    expect(view).toContain("Time to reply or withholding");
    expect(view).toContain("Median 1.5 s · 90th percentile 2 s");
    expect(view).toContain("timed 2 of 3 released or withheld turns");
    expect(view).toContain("<dd>1 s</dd>");
    const legacy = renderToStaticMarkup(<OpenUiUsageView turns={rows.slice(2)} />);
    expect(legacy).toContain("Timing unavailable for 1 released or withheld turn.");
  });
  test("the matched recording exposes both decision models and follows their delivered OpenUI offers independently", () => {
    const rows = parseOpenUiDiagnosticExport(decisions);
    const summary = summarizeOpenUiDiagnostics(rows);
    expect(summary.byDecisionModel.map(m => [m.key, m.metrics.turns])).toEqual([["gemini-decision-1", 6], ["jev-1.14.0", 6]]);
    for (const model of summary.byDecisionModel) {
      expect(model.metrics.offeredType.selected).toMatchObject({ numerator: 2, denominator: 3 });
    }
    const view = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="selected" />);
    expect(view).toContain("All decision models");
    expect(view).toContain("Reply withheld");
  });
  test("a saved gate result can show selection loss without supplying web presentation evidence", () => {
    const rows = parseOpenUiDiagnosticExport(audit);
    const metrics = summarizeOpenUiDiagnostics(rows, {model:"MiniMax-M2.7-highspeed", cue:"implicit-action"}).overall;
    expect(metrics.losses.draftToSelection).toMatchObject({numerator:4, denominator:7});
    expect(metrics.rendered).toEqual({numerator:0, denominator:0, unknown:8, rate:null});
    expect(metrics.proseBesideInterface).toEqual({observed:3, unknown:0, median:60, p90:181});
    const recorded = summarizeOpenUiDiagnostics(rows);
    expect(recorded.components.find(c => c.key === "question-group")?.selected.numerator).toBe(7);
    expect(recorded.overall.nativePageRequested).toMatchObject({numerator:1, denominator:19, unknown:1});
    expect(recorded.overall.proseBesideInterface).toEqual({observed:10, unknown:0, median:11.5, p90:63});
    expect(rows.find(r => r.turnId === "gemini-3.1-flash-lite--prediction")).toMatchObject({selected:["question-group"], outsideWords:0});
    expect(rows.find(r => r.turnId === "MiniMax-M2.7-highspeed--variable")).toMatchObject({selected:["simulation"], outsideWords:181});
    const view = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="rendered" />);
    expect(view).toContain("No observations at this stage.");
    expect(view).toContain("20 unknown");
  });

  test("the later policy check distinguishes a public native page request, authored OpenUI and provider failures", () => {
    const rows = parseOpenUiDiagnosticExport(holdout);
    const measured = summarizeOpenUiDiagnostics(rows);
    expect(measured.overall.nativePageRequested).toMatchObject({numerator:1, denominator:4, unknown:2});
    expect(measured.overall.fit).toMatchObject({numerator:3, denominator:4, unknown:2});
    expect(rows.filter(r => r.selected?.length).map(r => r.selected)).toEqual([["question-group"], ["simulation"]]);
    expect(rows.find(r => r.nativePageRequested)).toMatchObject({selected:[], outsideWords:null, rendered:null});
    expect(measured.overall.rendered.denominator).toBe(0);
    const view = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="selected" />);
    expect(view).toContain("Native interactive page requested");
    expect(view).toContain("2 unknown");
  });

  test("the completed historical terminal episodes retain later and unresolved requests", () => {
    const summary = summarizeOpenUiDiagnostics(parseOpenUiDiagnosticExport(episodes));
    expect(summary.coverage.uniqueTurns).toBe(804);
    expect(summary.delays.selected).toMatchObject({opportunities:40, firstResponse:6, later:1, unresolved:33});
    expect(summary.delays.selected.byResponse).toContainEqual({responseNumber:2, count:1});
    expect(summary.overall.proseBesideInterface).toEqual({observed:0, unknown:204, median:null, p90:null});
    expect(summary.overall.rendered.denominator).toBe(0);
  });

  test("the paired prompt benchmark exposes first-draft effects and never claims a classroom release", () => {
    const summary = summarizeOpenUiDiagnostics(parseOpenUiDiagnosticExport(paired));
    const minimax = summary.comparisons.find(c => c.model === "minimax/MiniMax-M2.7-highspeed");
    expect(minimax?.compiled).toMatchObject({pairs:2, guidedOnly:0, controlOnly:1});
    expect(minimax?.selected.pairs).toBe(0);
    expect(minimax?.rendered.pairs).toBe(0);
    expect(minimax?.fit.pairs).toBe(4);
  });

  test("a mixed trace shows first and later delivery separately for named interfaces and inferred activities", () => {
    const [template] = parseOpenUiDiagnosticExport(audit);
    const rows = parseOpenUiDiagnosticExport([
      {...template, conversationId:"implicit-case", turnId:"a", turnIndex:0, cue:{kind:"implicit-action", targets:["question"]}, reply:"released", selected:["question-group"]},
      {...template, conversationId:"explicit-case", turnId:"b", turnIndex:0, cue:{kind:"explicit-interface", targets:["simulation"]}, reply:"released", selected:[]},
      {...template, conversationId:"explicit-case", turnId:"c", turnIndex:1, cue:{kind:"none", targets:[]}, reply:"released", selected:["simulation"]},
    ]);
    const view = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="selected" />);
    expect(view).toContain('aria-label="Reply delay by learner cue"');
    expect(view).toContain('<th scope="row">Implicit</th><td>1</td><td>1</td><td>0</td><td>0</td>');
    expect(view).toContain('<th scope="row">Explicit</th><td>1</td><td>0</td><td>1</td><td>0</td>');
  });

  test("a model can retrieve a bounded sample of genuine losses and filter by the learner cue", () => {
    const rows = parseOpenUiDiagnosticExport(audit);
    const query = queryOpenUiDiagnosticTurns(rows, {view: "draft-loss", cue: "implicit-action", limit: 2});
    expect(query).toMatchObject({matchingTurns: 4});
    expect("turns" in query && query.turns).toHaveLength(2);
    expect(queryOpenUiDiagnosticTurns(rows, {view: "render-loss"})).toMatchObject({matchingTurns: 0, turns: []});
    expect(() => queryOpenUiDiagnosticTurns(rows, {limit: 0})).toThrow();
  });

  test("the missed-cue inspector and model query agree on archived physical turns", () => {
    for (const [source, missed, observed] of [[episodes, 34, 40], [audit, 6, 16]] as const) {
      const rows = parseOpenUiDiagnosticExport(source);
      const query = queryOpenUiDiagnosticTurns(rows, { view: "unmet" });
      expect(query).toMatchObject({ matchingTurns: missed, observedOpportunities: observed, unknownOpportunities: 0 });
      const html = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="selected" initialView="unmet" />);
      expect(html).toContain('class="ou-drill" open');
      expect(html).toContain(`${missed} missed on this turn out of ${observed} with observed selection`);
      if (!("turns" in query)) throw new Error("Expected a turn list");
      for (const row of query.turns) expect(html).toContain(`<code>${row.turnId}</code>`);
    }
    const november = parseOpenUiDiagnosticExport(audit);
    const scoped = renderToStaticMarkup(<OpenUiUsageView turns={november} initialView="unmet" initialCue="implicit-action" />);
    expect(scoped).toContain('value="implicit-action" selected');
    expect(scoped).toContain("native page requested");
    const unobserved = renderToStaticMarkup(<OpenUiUsageView turns={parseOpenUiDiagnosticExport(paired)} initialView="unmet" />);
    expect(unobserved).toContain("No observed selections. Unknown selection for 10 cued turns.");
    expect(unobserved).not.toContain('class="ou-turn"');
  });
  test("shows the saved irrigation opt-outs, their signals and legacy silence", async () => {
    const saved = (await import("../../../docs/benchmarks/openui-audit-2026-11-18/final-review/assessment-opt-out/turns.json")).default;
    const rows = parseOpenUiDiagnosticExport(saved);
    const html = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialStage="selected" initialView="assessment-opt-out" />);
    expect(html).toContain("Assessment opt-outs <b>4</b>");
    expect(html).toContain("Checkpoint signal after an opt-out</dt><dd>50%</dd>");
    expect(html).toContain("Simulation instructions · 2");
    expect(html).toContain("2 matching turns");
    expect(html).toContain("Learner declined assessment</dt><dd>Yes, explicitly");
    expect(html).toContain("Checkpoint signals in reply</dt><dd>Simulation instructions");
    expect(html).not.toContain("No quiz");
    const [template] = parseOpenUiDiagnosticExport(audit);
    expect(renderToStaticMarkup(<OpenUiUsageView turns={[template!]} />)).not.toContain("Assessment opt-outs");
  });
  test("shows the observed overlaps and finalists from the original paired classroom run", async () => {
    const recording = await import("../keating/openui/examples/jev-pairs-first.json");
    const rows = parseOpenUiDiagnosticExport(recording.default);
    const html = renderToStaticMarkup(<OpenUiUsageView turns={rows} initialView="pair-reviews" />);
    expect(html).toContain("Compared pairs · 4.");
    expect(html).toContain("Concurrent reviews · 2 of 2 timed turns.");
    expect(html).toContain("Neither draft was eligible for release.");
    expect(html).toContain("None · reply withheld");
    expect(html).toContain("Draft 3 advanced.");
    const rejected = renderToStaticMarkup(<OpenUiUsageView turns={[{ ...rows[0]!, gateIssues: ["question_feedback_format", "prediction_question_format"] }]} initialView="pair-reviews" />);
    expect(rejected).toContain("standalone text reply (question_feedback_format)");
    expect(rejected).toContain("one standalone Question without hints or an answer key (prediction_question_format)");
  });
});
