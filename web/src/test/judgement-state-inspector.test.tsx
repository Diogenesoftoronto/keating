import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { measureStateComposition, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { JudgementStateInspector } from "../components/JudgementStateInspector";
import { DraftReviewStatus } from "../components/DraftReviewStatus";

const state = measureStateComposition({ state: { turn: { learnerMessage: "PRIVATE_REQUEST", conversation: [{ role: "user", content: "PRIVATE_HISTORY" }], activeWork: { plan: { title: "PRIVATE_PLAN" }, focus: { id: "PRIVATE_FOCUS" }, openInteractions: [{ id: "PRIVATE_ACTIVITY" }] } } }, questions: { check: { type: "noul", instructions: "Supported?" } } }, 2000);
const snapshot: TeachingDraftSnapshot = { phase: "checking", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "concise", elapsedMs: 500, attempts: [], judgeModel: "fixture-v1", selectedAttempt: null, reason: null, state,
  slides: [{ phase: "planning", attempt: 0, elapsedMs: 1, turnsDropped: 2, before: state, after: state }],
  stateHistory: [{ phase: "checking", attempt: 1, elapsedMs: 400, requestIndex: 1, state }],
};

test("state inspector renders an accessible budget meter and content-free breakdown", () => {
  const html = renderToStaticMarkup(<JudgementStateInspector snapshot={snapshot} />);
  expect(html).toContain("<meter");
  expect(html).toContain('aria-label="Estimated judgement context usage"');
  expect(html).toContain("At 80%");
  expect(html).toContain("toward 65%");
  expect(html).toContain("Plan, Focus, Open activities");
  expect(html).toContain("2 turns removed");
  expect(html).toContain("Request samples (1)");
  expect(html).not.toContain("PRIVATE_");
});

test("developer diagnostics are reachable during checking and after release", () => {
  for (const phase of ["checking", "released"] as const) {
    const html = renderToStaticMarkup(<DraftReviewStatus sessionId="test" status={{ id: 1, feedback: null, snapshot: { ...snapshot, phase } }} />);
    expect(html).toContain("Developer diagnostics");
    expect(html).toContain("Judgement state");
    expect(html).toContain("Copy review");
    if (phase === "checking") expect(html).not.toContain("About this review");
  }
});

test("unknown or undispatched budgets do not imply zero usage", () => {
  const unknown = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: { ...state, budgetTokens: null, fillRatio: null } }} />);
  expect(unknown).toContain("budget unknown");
  expect(unknown).not.toContain("<meter");
  const missing = renderToStaticMarkup(<JudgementStateInspector snapshot={{ ...snapshot, state: undefined }} />);
  expect(missing).toContain("No judgement request dispatched yet");
});
