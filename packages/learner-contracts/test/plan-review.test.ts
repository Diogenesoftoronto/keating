import { describe, expect, test } from "bun:test";
import type { ActiveWork } from "../src/judgement/active-work.js";
import { advancePlanReview, applyPlanRevision, EMPTY_PLAN_REVIEW_MEMORY, planReviewDirectives, projectPlanReview, STALLED_FOCUS_TURNS } from "../src/judgement/plan-review.js";
import { UI_CONTRACT_VERSION, validateUiDocument, type UiDocument, type UiStudyPlanNode } from "../src/ui.js";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest } from "../src/judgement/teaching-policy.js";
import { TEACHING_PLAN_REVIEW_QUESTIONS, TEACHING_POLICY_DECISIONS } from "../src/judgement/teaching-policy-catalog.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementOutcome, JudgementRequest } from "../src/judgement/contracts.js";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import { PLAN_REVIEW_CASES, PLAN_REVIEW_LABEL_IDS } from "./fixtures/plan-review/cases.js";

const evidence = { presented: 1, attempted: 0, correct: 0, incorrect: 0, pendingGrade: 0, lastAttemptAt: null, independence: "unknown" as const };
const work = (itemId = "groups", graded = { correct: 0, incorrect: 0 }): ActiveWork => ({
  plan: { documentId: "plan", revision: 1, title: "Division", outline: [{ id: itemId, title: "Equal groups", status: "in_progress", depth: 0 }] },
  focus: { itemId, title: "Equal groups", outcomes: [], dependsOn: [], evidence: { ...evidence, ...graded } },
  openInteractions: [], truncated: false,
});
const turn: TeachingPolicyTurn = { learnerMessage: "Explain division.", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
const outcome = (request: JudgementRequest, values: Record<string, number>): JudgementOutcome => ({ ok: true, response: {
  backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
  answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul", noul: values[id] ?? 0.01 }])),
} });

describe("plan review host triggers", () => {
  test("no plan or no focus keeps empty memory and never triggers", () => {
    expect(advancePlanReview(null)).toEqual({ trigger: null, memory: EMPTY_PLAN_REVIEW_MEMORY });
    expect(advancePlanReview({ ...work(), focus: null }).trigger).toBeNull();
  });

  test("a newly graded attempt on the focus item triggers once", () => {
    let { memory } = advancePlanReview(work());
    const graded = advancePlanReview(work("groups", { correct: 1, incorrect: 0 }), memory);
    expect(graded.trigger).toBe("graded-attempt");
    memory = graded.memory;
    expect(advancePlanReview(work("groups", { correct: 1, incorrect: 0 }), memory).trigger).toBeNull();
  });

  test(`${STALLED_FOCUS_TURNS} learner turns on one focus without a new grade trigger a stall review, then the count restarts`, () => {
    let memory = EMPTY_PLAN_REVIEW_MEMORY;
    const triggers: (string | null)[] = [];
    for (let index = 0; index < STALLED_FOCUS_TURNS * 2; index++) {
      const next = advancePlanReview(work(), memory);
      triggers.push(next.trigger);
      memory = next.memory;
    }
    expect(triggers.filter(Boolean)).toEqual(["stalled-focus", "stalled-focus"]);
    expect(triggers.indexOf("stalled-focus")).toBe(STALLED_FOCUS_TURNS - 1);
  });

  test("a focus change resets the count and does not count as a grade", () => {
    const { memory } = advancePlanReview(work("groups", { correct: 2, incorrect: 0 }));
    const moved = advancePlanReview(work("sharing", { correct: 3, incorrect: 0 }), memory);
    expect(moved).toEqual({ trigger: null, memory: { itemId: "sharing", graded: 3, learnerTurns: 1 } });
  });
});

describe("plan action projection", () => {
  const all = { focus_demonstrated: true, prerequisite_gap: true, focus_underspecified: true, goal_diverged: true };
  test("first match wins, from the widest change to the narrowest", () => {
    expect(projectPlanReview(work(), "graded-attempt", {}, all)?.action).toBe("propose-new-plan");
    expect(projectPlanReview(work(), "graded-attempt", {}, { ...all, goal_diverged: false })?.action).toBe("insert-prerequisite");
    expect(projectPlanReview(work(), "graded-attempt", {}, { focus_underspecified: true, focus_demonstrated: true })?.action).toBe("expand-item");
    expect(projectPlanReview(work(), "graded-attempt", {}, { focus_demonstrated: true })?.action).toBe("suggest-advance");
    expect(projectPlanReview(work(), "graded-attempt", {}, { focus_demonstrated: null })?.action).toBe("continue");
  });

  test("decision triggers apply when the host has none; no trigger or no plan gives no review", () => {
    expect(projectPlanReview(work(), null, { progression_requested: true }, {})?.trigger).toBe("progression-requested");
    expect(projectPlanReview(work(), null, { project_goal_requested: true }, {})?.trigger).toBe("goal-requested");
    expect(projectPlanReview(work(), "stalled-focus", { progression_requested: true }, {})?.trigger).toBe("stalled-focus");
    expect(projectPlanReview(work(), null, { progression_requested: null }, all)).toBeNull();
    expect(projectPlanReview(null, "graded-attempt", {}, all)).toBeNull();
  });

  test("autonomous directives (the default) revise through the tool and report the change", () => {
    expect(planReviewDirectives({ trigger: "graded-attempt", action: "continue" }, work())).toEqual([]);
    const advance = planReviewDirectives({ trigger: "graded-attempt", action: "suggest-advance" }, work()).join(" ");
    expect(advance).toContain("revise_study_plan");
    expect(advance).toContain("complete-item");
    expect(advance).toContain("applies immediately");
    for (const [action, op] of [["insert-prerequisite", "insert-prerequisite"], ["expand-item", "expand-item"]] as const) {
      const text = planReviewDirectives({ trigger: "graded-attempt", action }, work()).join(" ");
      expect(text).toContain(op);
      expect(text).toContain("tell the learner");
    }
    expect(planReviewDirectives({ trigger: "goal-requested", action: "propose-new-plan" }, work()).join(" ")).toContain("Author a new StudyPlan");
  });

  test("approval directives propose through the tool and wait for Accept", () => {
    for (const action of ["suggest-advance", "insert-prerequisite", "expand-item"] as const) {
      const text = planReviewDirectives({ trigger: "graded-attempt", action }, work(), "approval").join(" ");
      expect(text).toContain("revise_study_plan");
      expect(text).toContain("Accept/Decline");
      expect(text).not.toContain("applies immediately");
    }
    expect(planReviewDirectives({ trigger: "goal-requested", action: "propose-new-plan" }, work(), "approval").join(" ")).toContain("ask before authoring");
  });
});

describe("applyPlanRevision", () => {
  const plan = (): UiDocument => ({ schemaVersion: UI_CONTRACT_VERSION, id: "plan-doc", revision: 2, lifecycle: "ready", supportedSurfaces: ["web"],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [{ type: "study-plan", id: "plan", title: "Limits", items: [
      { id: "a", title: "Intuition", status: "done" },
      { id: "b", title: "Epsilon-delta", status: "in_progress", dependsOn: ["a"] },
    ] }] });
  const items = (doc: UiDocument | null) => (doc?.nodes[0] as UiStudyPlanNode | undefined)?.items ?? [];

  test("complete-item marks the item done as a new, valid revision", () => {
    const next = applyPlanRevision(plan(), { op: "complete-item", itemId: "b" }, "2026-02-01T00:00:00.000Z");
    expect(next?.revision).toBe(3);
    expect(next?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(items(next).find(item => item.id === "b")?.status).toBe("done");
    expect(validateUiDocument(next)).toBe(true);
  });

  test("insert-prerequisite adds a step before the target and makes the target depend on it", () => {
    const next = applyPlanRevision(plan(), { op: "insert-prerequisite", beforeItemId: "b", item: { id: "abs", title: "Absolute value" } });
    expect(items(next).map(item => item.id)).toEqual(["a", "abs", "b"]);
    expect(items(next)[1]).toEqual({ id: "abs", title: "Absolute value", status: "not_started", dependsOn: ["a"] });
    expect(items(next)[2]!.dependsOn).toEqual(["a", "abs"]);
    expect(items(next)[2]!.status).toBe("not_started");
  });

  test("expand-item nests bounded sub-items under the target", () => {
    const next = applyPlanRevision(plan(), { op: "expand-item", itemId: "b", children: [{ id: "b1", title: "Pick delta", outcomes: ["choose delta"] }] });
    expect(items(next)[1]!.children).toEqual([{ id: "b1", title: "Pick delta", status: "not_started", outcomes: ["choose delta"] }]);
    const tooMany = Array.from({ length: 9 }, (_, n) => ({ id: `c${n}`, title: "x" }));
    expect(applyPlanRevision(plan(), { op: "expand-item", itemId: "b", children: tooMany })).toBeNull();
  });

  test("a missing target or an invalid result is refused, never partially applied", () => {
    expect(applyPlanRevision(plan(), { op: "complete-item", itemId: "missing" })).toBeNull();
    expect(applyPlanRevision(plan(), { op: "insert-prerequisite", beforeItemId: "b", item: { id: "a", title: "Duplicate id" } })).toBeNull();
  });
});

describe("plan review in the planning request", () => {
  test("plan questions ride along only when a plan has a focus", () => {
    const ids = TEACHING_PLAN_REVIEW_QUESTIONS.map(({ id }) => id);
    expect(Object.keys(teachingPolicyDecisionRequest(turn).questions)).not.toContain(ids[0]);
    expect(Object.keys(teachingPolicyDecisionRequest({ ...turn, activeWork: { ...work(), focus: null } }).questions)).not.toContain(ids[0]);
    const withFocus = Object.keys(teachingPolicyDecisionRequest({ ...turn, activeWork: work() }).questions);
    for (const id of ids) expect(withFocus).toContain(id);
    expect(withFocus).toContain("progression_requested");
  });

  test("answers only matter when a trigger fires, and add a proposal directive", () => {
    const planned = { ...turn, activeWork: work() };
    const request = teachingPolicyDecisionRequest(planned);
    const values = { learning_task: 0.95, focus_demonstrated: 0.95 };
    expect(projectTeachingPolicyDecision(planned, outcome(request, values)).planReview).toBeNull();
    const reviewed = projectTeachingPolicyDecision(planned, outcome(request, values), { planReview: "graded-attempt" });
    expect(reviewed.planReview).toEqual({ trigger: "graded-attempt", action: "suggest-advance" });
    expect(reviewed.directives.join(" ")).toContain("complete-item");
    expect(projectTeachingPolicyDecision(planned, outcome(request, { ...values, progression_requested: 0.95 })).planReview?.trigger).toBe("progression-requested");
  });

  test("the draft receipt records the trigger and plan action", async () => {
    const result = await runTeachingDrafts({
      turn: { ...turn, activeWork: work() }, planReview: "stalled-focus",
      judge: async (request) => outcome(request, request.questions.focus_underspecified ? { learning_task: 0.95, focus_underspecified: 0.95 } : {}) as never,
      generate: async () => ({ reply: { text: "Division splits a quantity into equal groups.", toolCalls: [] }, value: "ok" }),
    });
    expect(result.receipt.planReview).toEqual({ trigger: "stalled-focus", action: "expand-item" });
  });
});

describe("plan review fixtures", () => {
  test("each label has at least three positive and three negative cases in each split", () => {
    for (const split of ["development", "holdout"] as const) {
      const cases = PLAN_REVIEW_CASES.filter((entry) => entry.split === split);
      for (const id of PLAN_REVIEW_LABEL_IDS) {
        const values = cases.map((entry) => entry.expectedDecisions[id]).filter((value) => value !== undefined);
        expect({ split, id, positive: values.filter(Boolean).length >= 3, negative: values.filter((value) => !value).length >= 3 })
          .toEqual({ split, id, positive: true, negative: true });
      }
    }
  });

  test("ids are unique, labels are known, and every case has an active plan with a focus", () => {
    expect(new Set(PLAN_REVIEW_CASES.map(({ id }) => id)).size).toBe(PLAN_REVIEW_CASES.length);
    const known = new Set([...TEACHING_PLAN_REVIEW_QUESTIONS.map(({ id }) => id), ...TEACHING_POLICY_DECISIONS.map(({ id }) => id)]);
    for (const entry of PLAN_REVIEW_CASES) {
      for (const id of Object.keys(entry.expectedDecisions)) expect(known.has(id)).toBe(true);
      expect(entry.turn.activeWork?.plan && entry.turn.activeWork.focus).toBeTruthy();
    }
  });
});
