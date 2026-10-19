import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { measureStateComposition, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { DraftReviewStatus } from "../components/DraftReviewStatus";
import { clearTeachingDraftStatuses, clearTeachingDraftTally, getTeachingDraftStatus, getTeachingDraftTally, publishTeachingDraftStatus, recordTeachingDraftFeedback, teachingDraftIsActive } from "../keating/judgement/draft-status";
import { clearDiagnostics, getDiagnosticsSnapshot } from "../lib/diagnostics";

const snapshot: TeachingDraftSnapshot = { phase: "checking", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "concise",
  elapsedMs: 500, attempts: [], judgeModel: "jev-1.13.0", selectedAttempt: null, reason: null };
afterEach(clearTeachingDraftStatuses);

test("best available release does not imply every review concern passed", () => {
  publishTeachingDraftStatus("best-effort", { ...snapshot, phase: "released", reason: "best-effort-draft", selectedAttempt: 2 });
  const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="best-effort" status={getTeachingDraftStatus("best-effort")} />);
  expect(html).toContain("Best available response");
  expect(html).toContain("Some review concerns remain");
  expect(html).not.toContain("Response checked");
});

test("synthesis diagnostics retain only two distinct bounded preceding attempt numbers", () => {
  publishTeachingDraftStatus("synthesis", { ...snapshot, phase: "revising", attempt: 4,
    synthesisSourceAttempts: ["PRIVATE_DRAFT", { text: "PRIVATE_SOURCE" }, 0, 1.5, 11, 4, 1, 1, 2, 3],
    attempts: [{ attempt: 3, reasoning: "low", standard: "concise", generationMs: 100, judgementMs: 30, status: "pass", checks: [],
      synthesisSourceAttempts: ["PRIVATE_TEXT", 3, 2, 1], text: "PRIVATE_CONTENT" }],
  } as unknown as TeachingDraftSnapshot);
  const state = getTeachingDraftStatus("synthesis")!;
  expect(state.snapshot.synthesisSourceAttempts).toEqual([1, 2]);
  expect(state.snapshot.attempts[0]!.synthesisSourceAttempts).toEqual([2, 1]);
  expect(JSON.stringify(state)).not.toContain("PRIVATE_");
  publishTeachingDraftStatus("synthesis", { ...snapshot, synthesisSourceAttempts: { text: "PRIVATE_TEXT" } } as unknown as TeachingDraftSnapshot);
  expect(getTeachingDraftStatus("synthesis")!.snapshot.synthesisSourceAttempts).toBeUndefined();
});

test("synthesis generation reports a coherent combination awaiting its own review", () => {
  publishTeachingDraftStatus("synthesis", { ...snapshot, phase: "revising", attempt: 3, synthesisSourceAttempts: [1, 2] });
  const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="synthesis" status={getTeachingDraftStatus("synthesis")} />);
  expect(html).toContain("Combining completed drafts");
  expect(html).toContain("one coherent response");
  expect(html).toContain("still awaits its own review");
  expect(html).toContain("Source attempts: 1, 2");
  expect(html).toContain("Attempt 3 of 3");
  expect(html).not.toContain("Response checked");
});

test("background policy diagnostics preserve only bounded preference metadata", () => {
  const backgroundActivity = { version: 1, policyCreatedAt: 1000, preferredKind: "question", target: "next-linked-objective-score", causal: false,
    privateText: "PRIVATE_BACKGROUND" };
  publishTeachingDraftStatus("background", { ...snapshot, backgroundActivity } as unknown as TeachingDraftSnapshot);
  expect(getTeachingDraftStatus("background")!.snapshot.backgroundActivity?.preferredKind).toBe("question");
  expect(JSON.stringify(getTeachingDraftStatus("background"))).not.toContain("PRIVATE_");
  publishTeachingDraftStatus("background", { ...snapshot, backgroundActivity: { ...backgroundActivity, preferredKind: "PRIVATE_KIND" } } as unknown as TeachingDraftSnapshot);
  expect(getTeachingDraftStatus("background")!.snapshot.backgroundActivity).toBeUndefined();
});

test("chat prediction diagnostics retain bounded scores and discard callback text", () => {
  const activityLearning = { version: 1, status: "active", target: "next-linked-objective-score", model: "v3.5_default", asOf: 1000,
    baselineAttempt: 1, selectedAttempt: 2, counts: { exposures: 30, labelled: 26, train: 20, validation: 6, candidates: 2, text: "PRIVATE_COUNTS" },
    validation: { kind: "squared-error", modelLoss: .1, baselineLoss: .2, passed: true, text: "PRIVATE_VALIDATION" },
    predictedScores: [{ attempt: 1, score: .4, text: "PRIVATE_REPLY" }, { attempt: 2, score: .6 }], reasons: [],
    scope: "chronological-within-learner", causal: false, unaidedLearning: "unknown", text: "PRIVATE_TOP" };
  publishTeachingDraftStatus("activity", { ...snapshot, activityLearning } as unknown as TeachingDraftSnapshot);
  expect(getTeachingDraftStatus("activity")!.snapshot.activityLearning?.selectedAttempt).toBe(2);
  expect(JSON.stringify(getTeachingDraftStatus("activity"))).not.toContain("PRIVATE_");
  publishTeachingDraftStatus("activity", { ...snapshot, activityLearning: { ...activityLearning, reasons: ["PRIVATE_REASON"] } } as unknown as TeachingDraftSnapshot);
  expect(getTeachingDraftStatus("activity")!.snapshot.activityLearning).toBeUndefined();
});

test("state diagnostics reconstruct nested fields, reject content and retain only 64 samples", () => {
  const state = measureStateComposition({ state: { turn: { learnerMessage: "PRIVATE_REQUEST" } }, questions: { check: { type: "noul", instructions: "Supported?" } } }, 2000);
  const dirty = { ...state, text: "PRIVATE_TOP", totalBytes: "PRIVATE_NUMBER", sections: { ...state.sections, conversation: { ...state.sections.conversation, text: "PRIVATE_HISTORY" }, PRIVATE_SECTION: { bytes: 99, text: "PRIVATE_TEXT" } }, pinned: { ...state.pinned, plan: "PRIVATE_PLAN", text: "PRIVATE_PINNED" } };
  publishTeachingDraftStatus("metrics", { ...snapshot, state: dirty,
    slides: [{ phase: "PRIVATE_PHASE", attempt: 0, elapsedMs: 1, turnsDropped: 2, before: dirty, after: dirty, text: "PRIVATE_SLIDE" }],
    stateHistory: Array.from({ length: 70 }, (_, index) => ({ phase: "checking", attempt: 1, elapsedMs: index, requestIndex: index + 1, state: dirty, reply: "PRIVATE_REPLY" })),
  } as unknown as TeachingDraftSnapshot);
  const projected = getTeachingDraftStatus("metrics")!.snapshot;
  expect(JSON.stringify(projected)).not.toContain("PRIVATE_");
  expect(projected.state!.totalBytes).toBe(0);
  expect(projected.state!.pinned.plan).toBe(false);
  expect(projected.stateHistory).toHaveLength(64);
  expect(projected.stateHistory![0]!.requestIndex).toBe(7);
  expect(projected.slides![0]!.phase).toBe("withheld");
});

test("planning request samples retain the same review id", () => {
  publishTeachingDraftStatus("planning", { ...snapshot, phase: "planning" });
  const id = getTeachingDraftStatus("planning")!.id;
  publishTeachingDraftStatus("planning", { ...snapshot, phase: "planning", elapsedMs: 1 });
  expect(getTeachingDraftStatus("planning")!.id).toBe(id);
});

test("draft review shows content-free progress with no preview", () => {
  publishTeachingDraftStatus("a", { ...snapshot, text: "PRIVATE_DRAFT", reasoningText: "PRIVATE_THOUGHT" } as TeachingDraftSnapshot);
  const state = getTeachingDraftStatus("a");
  expect(teachingDraftIsActive(state)).toBe(true);
  const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="a" status={state} />);
  expect(html).toContain("Reviewing the completed response");
  expect(html).toContain("Generation finished.");
  expect(html).toContain("Attempt 1 of 3");
  expect(html).not.toContain("PRIVATE_");
  expect(JSON.stringify(state)).not.toContain("PRIVATE_");
  expect(getTeachingDraftStatus("b")).toBeNull();
});

test("generation progress does not imply a completed or reviewed draft", () => {
  for (const phase of ["drafting", "revising"] as const) {
    const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="a" status={{ id: 1, feedback: null, snapshot: { ...snapshot, phase } }} />);
    expect(html).toContain(phase === "drafting" ? "Generating a response" : "Generating an improved response");
    expect(html).not.toContain("Generation finished.");
    expect(html).not.toContain("Reviewing the completed response");
  }
});

test("released review count excludes failed generations", () => {
  const attempt = { attempt: 1, reasoning: "low", standard: "concise", variant: "default", generationMs: 100, judgementMs: 0, checks: [] } as const;
  const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="a" status={{ id: 1, feedback: null, snapshot: {
    ...snapshot, phase: "released", selectedAttempt: 2, attempts: [
      { ...attempt, status: "generation-error" },
      { ...attempt, attempt: 2, status: "pass", judgementMs: 30 },
    ],
  } }} />);
  expect(html).toContain("1 draft reviewed.");
  expect(html).not.toContain("2 drafts reviewed.");
  expect(html).toContain("Attempt 1 · generation-error");
});

test("rejected attempts expose only rule diagnostics, and feedback targets the exact turn", () => {
  publishTeachingDraftStatus("a", { ...snapshot, phase: "withheld", reason: "no-approved-draft", attempts: [{
    attempt: 1, reasoning: "low", standard: "concise", generationMs: 100, judgementMs: 30, status: "fail", text: "PRIVATE_DRAFT",
    checks: [{ id: "retention_overclaimed", source: "jev", severity: "critical", status: "fail", probability: .99, explanation: "PRIVATE_DRAFT" }],
  }] } as unknown as TeachingDraftSnapshot);
  const state = getTeachingDraftStatus("a")!;
  const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="a" status={state} />);
  expect(html).toContain("could not be approved");
  expect(html).toContain("Claims needed stronger evidence");
  expect(html).toContain("Developer diagnostics");
  expect(html).toContain("retention_overclaimed");
  expect(html).not.toContain("PRIVATE_");
  expect(recordTeachingDraftFeedback("b", state.id, "too-strict")).toBe(false);
  expect(recordTeachingDraftFeedback("a", state.id, "too-strict")).toBe(true);
  expect(getTeachingDraftStatus("a")?.feedback).toBe("too-strict");
  publishTeachingDraftStatus("a", { ...snapshot, phase: "planning" });
  expect(recordTeachingDraftFeedback("a", state.id, "missed-problem")).toBe(false);
  expect(getTeachingDraftStatus("a")?.feedback).toBeNull();
});

test("stopped review has no publication or misleading approved status", () => {
  publishTeachingDraftStatus("a", { ...snapshot, phase: "cancelled" });
  const html = renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="a" status={getTeachingDraftStatus("a")} />);
  expect(html).toContain("Draft cancelled");
  expect(html).not.toContain("Response checked");
  expect(teachingDraftIsActive(getTeachingDraftStatus("a"))).toBe(false);
});

test("content-free diagnostics are bounded and newest sessions survive", () => {
  for (let n = 0; n < 21; n++) publishTeachingDraftStatus(`session-${n}`, snapshot);
  expect(getTeachingDraftStatus("session-0")).toBeNull();
  expect(getTeachingDraftStatus("session-20")).not.toBeNull();
});

test("the interaction summary and variants survive projection, but unknown ids and component names do not", () => {
  publishTeachingDraftStatus("a", { ...snapshot, planningMs: 420,
    interaction: { action: "create", paired: true, features: ["variable_relationship", "PRIVATE_FEATURE"],
      families: [{ family: "manipulable", components: ["Simulation", "PRIVATE_COMPONENT"] }], secret: "PRIVATE_EXTRA" },
    attempts: [{ attempt: 1, reasoning: "low", standard: "supported", generationMs: 1, judgementMs: 1, status: "pass", checks: [], variant: "prose" }],
  } as unknown as TeachingDraftSnapshot);
  const state = getTeachingDraftStatus("a")!;
  expect(state.snapshot.planningMs).toBe(420);
  expect(state.snapshot.interaction).toEqual({ action: "create", paired: true, features: ["variable_relationship"], families: [{ family: "manipulable", components: ["Simulation"] }] });
  expect(state.snapshot.attempts[0]!.variant).toBe("prose");
  expect(JSON.stringify(state)).not.toContain("PRIVATE_");
});

test("a plan review survives projection only with known trigger and action ids", () => {
  const publish = (planReview: unknown) => publishTeachingDraftStatus("p", { ...snapshot, planReview } as unknown as TeachingDraftSnapshot);
  publish({ trigger: "stalled-focus", action: "expand-item", note: "PRIVATE_NOTE" });
  expect(getTeachingDraftStatus("p")!.snapshot.planReview).toEqual({ trigger: "stalled-focus", action: "expand-item" });
  publish({ trigger: "PRIVATE_TRIGGER", action: "continue" });
  expect(getTeachingDraftStatus("p")!.snapshot.planReview).toBeUndefined();
  publish({ trigger: "graded-attempt", action: "PRIVATE_ACTION" });
  expect(JSON.stringify(getTeachingDraftStatus("p"))).not.toContain("PRIVATE_");
});

test("finished turns are tallied once, content-free, into session diagnostics", () => {
  clearTeachingDraftTally();
  clearDiagnostics();
  const check = (status: "pass" | "fail") => ({ id: "openui_valid", source: "deterministic", severity: "major", status, probability: null }) as const;
  const attempt = (n: number, variant: "interactive" | "prose", status: "pass" | "fail") => ({ attempt: n, reasoning: "low", standard: "supported",
    generationMs: 1, judgementMs: 1, status: "pass", checks: [check(status)], variant }) as const;
  const paired = { ...snapshot, phase: "released", selectedAttempt: 1, attempts: [attempt(1, "interactive", "pass"), attempt(2, "prose", "pass")],
    interaction: { action: "create", paired: true, features: [], families: [] }, planReview: { trigger: "graded-attempt", action: "suggest-advance" } } as TeachingDraftSnapshot;
  publishTeachingDraftStatus("a", { ...paired, phase: "checking" });
  publishTeachingDraftStatus("a", paired);
  publishTeachingDraftStatus("a", paired);
  publishTeachingDraftStatus("b", { ...snapshot, phase: "withheld", interaction: { action: "none", paired: false, features: [], families: [] } });
  publishTeachingDraftStatus("c", { ...snapshot, phase: "released", selectedAttempt: 1, attempts: [attempt(1, "prose", "fail")],
    interaction: { action: "none", paired: false, features: [], families: [] } });
  expect(getTeachingDraftTally()).toMatchObject({ turns: 3, released: 2, interactionActions: { create: 1, none: 2 }, paired: 1, pairedInteractiveSelected: 1,
    openuiChecked: 1, openuiValid: 1, planActions: { "suggest-advance": 1 } });
  const entries = getDiagnosticsSnapshot().filter(entry => entry.source === "teaching-drafts");
  expect(entries.map(entry => entry.metadata)).toEqual([
    { attempts: 2, bestEffort: false, interactionAction: "create", paired: true, interactiveSelected: true, openuiValid: true, planAction: "suggest-advance" },
    { attempts: 0, bestEffort: false, interactionAction: "none", paired: false, interactiveSelected: false, openuiValid: "unchecked", planAction: "none" },
    { attempts: 1, bestEffort: false, interactionAction: "none", paired: false, interactiveSelected: false, openuiValid: "unchecked", planAction: "none" },
  ]);});

 test("review progress and receipts stay out of default chat", () => {
  for (const phase of ["checking", "released", "revising", "cancelled"] as const) {
    const status = { id: 1, feedback: null, snapshot: { ...snapshot, phase } };
    expect(renderToStaticMarkup(<DraftReviewStatus sessionId="default" status={status} />)).toBe("");
    expect(renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="developer" status={status} />)).toContain("Response review");
  }
});

test("withheld reviews remain hidden in default chat", () => {
  const status = { id: 1, feedback: null, snapshot: { ...snapshot, phase: "withheld" as const, reason: "backend-payment-required" } };
  expect(renderToStaticMarkup(<DraftReviewStatus sessionId="recovery" status={status} />)).toBe("");
});

 test("review progress and receipts stay out of default chat", () => {
  for (const phase of ["checking", "released", "revising", "cancelled"] as const) {
    const status = { id: 1, feedback: null, snapshot: { ...snapshot, phase } };
    expect(renderToStaticMarkup(<DraftReviewStatus sessionId="default" status={status} />)).toBe("");
    expect(renderToStaticMarkup(<DraftReviewStatus showDeveloperDetails sessionId="developer" status={status} />)).toContain("Response review");
  }
});

test("withheld reviews remain hidden in default chat", () => {
  const status = { id: 1, feedback: null, snapshot: { ...snapshot, phase: "withheld" as const, reason: "backend-payment-required" } };
  expect(renderToStaticMarkup(<DraftReviewStatus sessionId="recovery" status={status} />)).toBe("");
});
