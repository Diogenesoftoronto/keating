import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { measureStateComposition, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { JudgementStateInspector } from "../components/JudgementStateInspector";
import { DraftReviewStatus } from "../components/DraftReviewStatus";
import { projectTeachingDraftSnapshot } from "../keating/judgement/draft-status";

const state = measureStateComposition({ state: { turn: { learnerMessage: "PRIVATE_REQUEST", conversation: [{ role: "user", content: "PRIVATE_HISTORY" }], activeWork: { plan: { title: "PRIVATE_PLAN" }, focus: { id: "PRIVATE_FOCUS" }, openInteractions: [{ id: "PRIVATE_ACTIVITY" }] } } }, questions: { check: { type: "noul", instructions: "Supported?" } } }, 2000);
const snapshot: TeachingDraftSnapshot = { phase: "checking", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "concise", elapsedMs: 500, attempts: [], judgeModel: "fixture-v1", selectedAttempt: null, reason: null, state,
  slides: [{ phase: "planning", attempt: 0, elapsedMs: 1, turnsDropped: 2, before: state, after: state }],
  stateHistory: [{ phase: "checking", attempt: 1, elapsedMs: 400, requestIndex: 1, state }],
};

test("state inspector renders an accessible budget meter and content-free breakdown", () => {
  const html = renderToStaticMarkup(<JudgementStateInspector snapshot={snapshot} />);
  expect(html).toContain('role="meter"');
  expect(html).toContain('aria-label="Estimated judgement context usage"');
  expect(html).toContain("of the recorded token budget");
  expect(html).toContain("Current reviews keep the full conversation and search passages while they fit.");
  expect(html).toContain("the fewest whole turns needed");
  expect(html).toContain("Plan, Focus, Open activities");
  expect(html).toContain("2 turns removed");
  expect(html).toContain("Request samples (1)");
  expect(html).not.toContain("PRIVATE_");
});

test("a near-full request shows its actual usage without a lower trimming threshold", () => {
  const nearLimit = { ...state, budgetTokens: 2000, estimatedStateQuestionTokens: 1992, fillRatio: .996 };
  const html = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: nearLimit, slides: [] }} />);
  const meter = html.match(/<div\b[^>]*\brole="meter"[^>]*>/)?.[0] ?? "";
  expect(meter).toContain('aria-valuemax="100"');
  expect(meter).toContain('aria-valuenow="99.6"');
  expect(html).not.toContain("Window threshold");
  expect(html).toContain("99.6% of the recorded token budget");
  expect(html).toContain("Context trims (0)");
  expect(html).toContain("This review recorded no context trims.");
});

test("the saved chat receipt distinguishes an upstream context rejection from an estimated trim", () => {
  const projected = projectTeachingDraftSnapshot({ ...snapshot,
    slides: [{ ...snapshot.slides![0]!, reason: "provider-context-limit" }] });
  expect(renderToStaticMarkup(<JudgementStateInspector snapshot={projected} />)).toContain("The provider reported a context limit.");
  expect(renderToStaticMarkup(<JudgementStateInspector snapshot={snapshot} />)).not.toContain("The provider reported a context limit.");
});

test("a historical trim reports its recorded sizes independently of today's limits", () => {
  const before = { ...state, estimatedStateQuestionTokens: 1650, budgetTokens: 2000, fillRatio: .825 };
  const after = { ...before, estimatedStateQuestionTokens: 1300, fillRatio: .65 };
  const html = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: after,
    slides: [{ phase: "checking", attempt: 1, elapsedMs: 100, turnsDropped: 2, before, after }],
  }} />);
  expect(html).toContain("Context trims (1)");
  expect(html).toContain("<li>checking, draft 1 · 2 turns removed · 1,650 estimated tokens before, 1,300 after</li>");
  const missing = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, slides: undefined, stateHistory: undefined }} />);
  expect(missing).toContain("Context-trim data is unavailable for this receipt.");
  expect(missing).not.toContain("Context trims (0)");
  expect(missing).toContain("Request samples are unavailable for this receipt.");
});

test("source-only trims show the recorded change even when every conversation turn survived", () => {
  const withSources = (entries: number, bytes: number) => ({ ...state, sections: { ...state.sections, sources: { entries, bytes } } });
  const html = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, slides: [
    { ...snapshot.slides![0]!, turnsDropped: 0, before: withSources(3, 900), after: withSources(3, 420) },
    { ...snapshot.slides![0]!, turnsDropped: 0, before: withSources(3, 420), after: withSources(1, 210) },
  ] }} />);
  expect(html).toContain("0 turns removed");
  expect(html).toContain("Source size 900 → 420 serialized bytes");
  expect(html).toContain("Source entries 3 → 1 · Source size 420 → 210 serialized bytes");
  expect(html).not.toContain("Source entries 3 → 3");
});

test("the inspector reports retained excerpt sizes for the current request, window changes, and samples", () => {
  const excerpts = ["PRIVATE_EARLIER_一", "PRIVATE_EARLIER_é"];
  const measured = (count: number) => measureStateComposition({
    state: { turn: { earlierLearnerExcerpts: excerpts.slice(0, count) } },
    questions: { check: { type: "noul", instructions: "Supported?" } },
  }, 2000);
  const first = measured(1), second = measured(2);
  const html = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: second,
    slides: [{ ...snapshot.slides![0]!, before: state, after: first }],
    stateHistory: [{ ...snapshot.stateHistory![0]!, state: second }],
  }} />);
  const bytes = (count: number) => new TextEncoder().encode(JSON.stringify(excerpts.slice(0, count))).byteLength;
  expect(html.match(new RegExp(`2 earlier learner excerpts retained \\(${bytes(2)} serialized bytes\\)`, "g"))).toHaveLength(2);
  expect(html).toContain(`1 earlier learner excerpt retained (${bytes(1)} serialized bytes)`);
  expect(html).toContain(`Earlier learner excerpts</th><td>2</td><td>${bytes(2)}</td>`);
  expect(html).not.toContain("PRIVATE_");
});

test("saved receipts predating retained excerpts render without inventing retention", () => {
  const { earlierLearnerExcerpts: _missing, ...oldSections } = state.sections;
  const oldState = { ...state, sections: oldSections };
  const old = { ...snapshot, state: oldState, slides: [{ ...snapshot.slides![0]!, before: oldState, after: oldState }],
    stateHistory: [{ ...snapshot.stateHistory![0]!, state: oldState }] } as unknown as TeachingDraftSnapshot;
  for (const receipt of [old, projectTeachingDraftSnapshot(old)]) {
    const html = renderToStaticMarkup(<JudgementStateInspector snapshot={receipt} />);
    expect(html).toContain("2 turns removed");
    expect(html).toContain("Request samples (1)");
    expect(html.toLowerCase()).not.toContain("earlier learner excerpt");
  }
});

test("developer diagnostics are reachable during checking and after release", () => {
  for (const phase of ["checking", "released"] as const) {
    const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="test" status={{ id: 1, feedback: null, snapshot: { ...snapshot, phase } }} />);
    expect(html).toContain("Developer diagnostics");
    expect(html).toContain("Judgement state");
    expect(html).toContain("Copy review");
    if (phase === "checking") expect(html).not.toContain("About this review");
  }
});

test("unknown or undispatched budgets do not imply zero usage", () => {
  const unknown = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: { ...state, budgetTokens: null, fillRatio: null } }} />);
  expect(unknown).toContain("budget unknown");
  expect(unknown).not.toContain('role="meter"');
  const missing = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: undefined }} />);
  expect(missing).toContain("Judgement request size is unavailable");
});

test("judgement diagnostics are hidden without developer opt-in", () => {
  for (const phase of ["checking", "released"] as const) {
    const html = renderToStaticMarkup(<DraftReviewStatus sessionId="default" status={{ id: 1, feedback: null, snapshot: { ...snapshot, phase } }} />);
    expect(html).toBe("");
  }
});
