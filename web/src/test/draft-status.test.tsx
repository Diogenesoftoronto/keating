import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { measureStateComposition, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { DraftReviewStatus } from "../components/DraftReviewStatus";
import { clearTeachingDraftStatuses, clearTeachingDraftTally, getTeachingDraftStatus, getTeachingDraftTally, publishTeachingDraftStatus, recordTeachingDraftFeedback, teachingDraftIsActive } from "../keating/judgement/draft-status";
import { clearDiagnostics, getDiagnosticsSnapshot } from "../lib/diagnostics";

const snapshot: TeachingDraftSnapshot = { phase: "checking", attempt: 1, maxAttempts: 3, reasoning: "low", standard: "concise",
  elapsedMs: 500, attempts: [], judgeModel: "jev-1.13.0", selectedAttempt: null, reason: null };
afterEach(clearTeachingDraftStatuses);

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
  const html = renderToStaticMarkup(<DraftReviewStatus sessionId="a" status={state} />);
  expect(html).toContain("Checking the draft");
  expect(html).toContain("Draft 1 of 3");
  expect(html).not.toContain("PRIVATE_");
  expect(JSON.stringify(state)).not.toContain("PRIVATE_");
  expect(getTeachingDraftStatus("b")).toBeNull();
});

test("rejected attempts expose only rule diagnostics, and feedback targets the exact turn", () => {
  publishTeachingDraftStatus("a", { ...snapshot, phase: "withheld", reason: "no-approved-draft", attempts: [{
    attempt: 1, reasoning: "low", standard: "concise", generationMs: 100, judgementMs: 30, status: "fail", text: "PRIVATE_DRAFT",
    checks: [{ id: "retention_overclaimed", source: "jev", severity: "critical", status: "fail", probability: .99, explanation: "PRIVATE_DRAFT" }],
  }] } as unknown as TeachingDraftSnapshot);
  const state = getTeachingDraftStatus("a")!;
  const html = renderToStaticMarkup(<DraftReviewStatus sessionId="a" status={state} />);
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
  const html = renderToStaticMarkup(<DraftReviewStatus sessionId="a" status={getTeachingDraftStatus("a")} />);
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
  expect(getTeachingDraftTally()).toEqual({ turns: 3, released: 2, interactionActions: { create: 1, none: 2 }, paired: 1, pairedInteractiveSelected: 1,
    openuiChecked: 1, openuiValid: 1, planActions: { "suggest-advance": 1 } });
  const entries = getDiagnosticsSnapshot().filter(entry => entry.source === "teaching-drafts");
  expect(entries.map(entry => entry.metadata)).toEqual([
    { interactionAction: "create", paired: true, interactiveSelected: true, openuiValid: true, planAction: "suggest-advance" },
    { interactionAction: "none", paired: false, interactiveSelected: false, openuiValid: "unchecked", planAction: "none" },
    { interactionAction: "none", paired: false, interactiveSelected: false, openuiValid: "unchecked", planAction: "none" },
  ]);
});
