import { describe, expect, test } from "bun:test";
import type { JudgementOutcome, JudgementRequest } from "../src/judgement/contracts.js";
import type { InteractionRecommendation } from "../src/judgement/interaction-affordances.js";
import { projectResourceReview, resourceReviewDirectives, RESOURCE_REVIEW_CADENCE, sessionResources, type SessionResources } from "../src/judgement/resource-review.js";
import { PROSE_DIRECTIVE, variantPrompt } from "../src/judgement/teaching-drafts/policy.js";
import { projectTeachingPolicyDecision, teachingPolicyAdherenceRequest, teachingPolicyDecisionRequest, teachingPolicyDeterministicChecks } from "../src/judgement/teaching-policy.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";

const none: Pick<InteractionRecommendation, "action" | "families"> = { action: "none", families: [] };
const offer = (family: InteractionRecommendation["families"][number]["family"], component: string): Pick<InteractionRecommendation, "action" | "families"> => ({
  action: "create", families: [{ family, components: [component], features: [] }],
});
const learning = { learning_task: true };
const resources = (patch: Partial<SessionResources> = {}): SessionResources => ({ learnerTurns: 1, plan: false, map: false, turnsSinceRetrieval: null, turnsSinceAwayWork: null, ...patch });
const gapAt = (turns: number, patch: Partial<SessionResources> = {}) => projectResourceReview(resources({ learnerTurns: turns, ...patch }), learning, { interaction: none })?.gap ?? null;

describe("session resource counts", () => {
  const times = [100, 200, 300, 400];

  test("an empty session has no plan and nothing shown", () => {
    expect(sessionResources([], times)).toEqual({ learnerTurns: 4, plan: false, map: false, turnsSinceRetrieval: null, turnsSinceAwayWork: null });
  });

  test("turns are counted from the latest presentation of each kind", () => {
    const counted = sessionResources([
      { component: "study-plan", presentedAt: 50 },
      { component: "quiz", presentedAt: 150 },
      { component: "deck", presentedAt: 250 },
      { component: "task", presentedAt: 350 },
    ], times);
    expect(counted).toEqual({ learnerTurns: 4, plan: true, map: false, turnsSinceRetrieval: 2, turnsSinceAwayWork: 1 });
  });

  test("a single question every turn does not count as a practice set", () => {
    const counted = sessionResources(times.map((time) => ({ component: "question", presentedAt: time + 1 })), times);
    expect(counted.turnsSinceRetrieval).toBeNull();
  });

  test("a concept map is recorded; other display components are not resources", () => {
    expect(sessionResources([{ component: "concept-map", presentedAt: 150 }], times).map).toBe(true);
    expect(sessionResources([{ component: "simulation", presentedAt: 150 }, { component: "image", presentedAt: 150 }], times))
      .toEqual({ learnerTurns: 4, plan: false, map: false, turnsSinceRetrieval: null, turnsSinceAwayWork: null });
  });
});

describe("when a missing resource is raised", () => {
  test("a plan is raised on two consecutive turns, then left alone for the rest of the cycle", () => {
    const { after, every } = RESOURCE_REVIEW_CADENCE.plan;
    const raised = Array.from({ length: after + every * 2 - 1 }, (_, index) => index + 1).filter((turn) => gapAt(turn, { map: true, turnsSinceRetrieval: 0, turnsSinceAwayWork: 0 }) === "plan");
    expect(raised).toEqual([after, after + 1, after + every, after + every + 1]);
  });

  test("a session with a plan moves on to practice, a map, then work the learner does alone", () => {
    expect(gapAt(RESOURCE_REVIEW_CADENCE.retrieval.after, { plan: true })).toBe("retrieval");
    expect(gapAt(RESOURCE_REVIEW_CADENCE.map.after, { plan: true, turnsSinceRetrieval: 1 })).toBe("map");
    expect(gapAt(RESOURCE_REVIEW_CADENCE.map.after, { plan: true, map: true, turnsSinceRetrieval: 1 })).toBeNull();
    expect(gapAt(RESOURCE_REVIEW_CADENCE["away-work"].after, { plan: true, map: true, turnsSinceRetrieval: 1 })).toBe("away-work");
    expect(gapAt(RESOURCE_REVIEW_CADENCE["away-work"].after, { plan: true, map: true, turnsSinceRetrieval: 1, turnsSinceAwayWork: 1 })).toBeNull();
  });

  test("an untouched session is offered each resource in turn, one per turn, without repeating inside a cycle", () => {
    const raised = Array.from({ length: 9 }, (_, index) => gapAt(index + 1));
    expect(raised).toEqual([null, null, "plan", "plan", "retrieval", "retrieval", "map", "away-work", "plan"]);
  });

  test("the widest gap wins when several are due", () => {
    const turn = RESOURCE_REVIEW_CADENCE.plan.after + RESOURCE_REVIEW_CADENCE.plan.every;
    expect(RESOURCE_REVIEW_CADENCE.retrieval.after).toBeLessThanOrEqual(turn);
    expect(gapAt(turn)).toBe("plan");
  });

  test("a stated goal asks for a plan at once, whatever the turn", () => {
    expect(projectResourceReview(resources(), { ...learning, project_goal_requested: true }, { interaction: none }))
      .toEqual({ gap: "plan", trigger: "goal-requested" });
    expect(projectResourceReview(resources({ plan: true }), { ...learning, project_goal_requested: true }, { interaction: none })).toBeNull();
  });
});

describe("when a missing resource is not raised", () => {
  const dueForPlan = resources({ learnerTurns: RESOURCE_REVIEW_CADENCE.plan.after });
  const dueForPractice = resources({ learnerTurns: RESOURCE_REVIEW_CADENCE.retrieval.after, plan: true });
  const dueForMap = resources({ learnerTurns: RESOURCE_REVIEW_CADENCE.map.after, plan: true, turnsSinceRetrieval: 1 });

  test("only on a turn positively identified as learning", () => {
    expect(projectResourceReview(dueForPlan, { learning_task: null }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForPlan, { learning_task: false }, { interaction: none })).toBeNull();
    expect(projectResourceReview(null, learning, { interaction: none })).toBeNull();
  });

  test("never over a plain reply, a stuck learner or assessed work", () => {
    expect(projectResourceReview(dueForPlan, { ...learning, plain_reply_requested: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForPlan, { ...learning, learner_stuck: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForPlan, learning, { interaction: none, assessment: "assessed" })).toBeNull();
  });

  test("never while work is waiting to be graded or answered, or a plan change is in progress", () => {
    expect(projectResourceReview(dueForPlan, learning, { interaction: { action: "grade-first", families: [] } })).toBeNull();
    expect(projectResourceReview(dueForPlan, learning, { interaction: { action: "continue", families: [] } })).toBeNull();
    expect(projectResourceReview(dueForPractice, learning, { interaction: none, planReview: { trigger: "graded-attempt", action: "suggest-advance" } })).toBeNull();
    expect(projectResourceReview(dueForPractice, learning, { interaction: none, planReview: { trigger: "graded-attempt", action: "continue" } })?.gap).toBe("retrieval");
  });

  test("a bounded question is answered without a plan, but a stated goal still earns one", () => {
    expect(projectResourceReview(dueForPlan, { ...learning, direct_answer_requested: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForPlan, { ...learning, direct_answer_requested: true, project_goal_requested: true }, { interaction: none })?.gap).toBe("plan");
  });

  test("a plan never shares a turn with a quiz or deck", () => {
    expect(projectResourceReview(dueForPlan, learning, { interaction: offer("retrieval", "Quiz") })).toBeNull();
    expect(projectResourceReview(dueForPlan, { ...learning, practice_requested: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForPlan, learning, { interaction: offer("question", "Question") })?.gap).toBe("plan");
  });

  test("a learner who declined testing is not handed a quiz or an assignment, and may still get a plan or a map", () => {
    expect(projectResourceReview(dueForPractice, { ...learning, assessment_declined: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForPlan, { ...learning, assessment_declined: true }, { interaction: none })?.gap).toBe("plan");
    expect(projectResourceReview(dueForMap, { ...learning, assessment_declined: true }, { interaction: none })?.gap).toBe("map");
  });

  test("a map is not suggested over a bounded question, a requested practice, or a map already on offer", () => {
    expect(projectResourceReview(dueForMap, learning, { interaction: none })?.gap).toBe("map");
    expect(projectResourceReview(dueForMap, { ...learning, direct_answer_requested: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForMap, { ...learning, practice_requested: true }, { interaction: none })).toBeNull();
    expect(projectResourceReview(dueForMap, learning, { interaction: offer("workspace", "ConceptMap") })).toBeNull();
    expect(projectResourceReview(dueForMap, learning, { interaction: offer("question", "Question") })?.gap).toBe("map");
  });

  test("practice is not suggested twice, and a single question on offer does not hide it", () => {
    expect(projectResourceReview(dueForPractice, learning, { interaction: offer("retrieval", "Quiz") })).toBeNull();
    expect(projectResourceReview(dueForPractice, learning, { interaction: offer("question", "Question") })?.gap).toBe("retrieval");
  });
});

describe("resource directives in the turn plan", () => {
  const turn: TeachingPolicyTurn = { learnerMessage: "Keep going with eigenvectors.", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "mathematics" };
  const outcome = (request: JudgementRequest, values: Record<string, number>): JudgementOutcome => ({ ok: true, response: {
    backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
    answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul", noul: values[id] ?? 0.01 }])),
  } });
  const judged = (values: Record<string, number>) => outcome(teachingPolicyDecisionRequest(turn), values);
  const due = resources({ learnerTurns: RESOURCE_REVIEW_CADENCE.plan.after });

  test("each gap has one directive that names when to leave it out", () => {
    for (const gap of ["plan", "retrieval", "map", "away-work"] as const) {
      const [directive, ...rest] = resourceReviewDirectives({ gap, trigger: "session-length" });
      expect(rest).toEqual([]);
      expect(directive).toMatch(/Leave (it|the plan|the map) out/);
    }
    expect(resourceReviewDirectives(null)).toEqual([]);
  });

  test("a due plan reaches the tutor as a turn decision and is recorded on the plan", () => {
    const plan = projectTeachingPolicyDecision(turn, judged({ learning_task: 0.95 }), { resources: due });
    expect(plan.resourceReview).toEqual({ gap: "plan", trigger: "session-length" });
    expect(plan.directives).toContain(resourceReviewDirectives(plan.resourceReview)[0]!);
  });

  test("without session counts the plan is unchanged", () => {
    const answers = judged({ learning_task: 0.95 });
    const without = projectTeachingPolicyDecision(turn, answers);
    expect(without.resourceReview).toBeUndefined();
    expect(projectTeachingPolicyDecision(turn, answers, { resources: null })).toEqual(without);
    expect(projectTeachingPolicyDecision(turn, answers, { resources: resources() })).toEqual(without);
  });

  test("when two drafts compete, the prose draft carries the suggestion and the interactive draft keeps its one activity", () => {
    const plan = projectTeachingPolicyDecision(turn, judged({ learning_task: 0.95 }), { resources: due });
    const directive = resourceReviewDirectives(plan.resourceReview)[0]!;
    expect(variantPrompt(plan, "default")).toContain(directive);
    expect(variantPrompt(plan, "prose")).toContain(directive);
    expect(variantPrompt(plan, "prose")).not.toContain(PROSE_DIRECTIVE);
    expect(variantPrompt(plan, "interactive")).not.toContain(directive);
    // With nothing due, the prose draft is plain prose as before.
    const quiet = projectTeachingPolicyDecision(turn, judged({ learning_task: 0.95 }));
    expect(variantPrompt(quiet, "prose")).toContain(PROSE_DIRECTIVE);
  });

  test("an invited practice set is not reviewed as unsolicited; any other quiz still is", () => {
    const reply = { text: "Here is a short quiz.", toolCalls: [] };
    expect(Object.keys(teachingPolicyAdherenceRequest(turn, reply)!.questions)).toContain("unsolicited_assessment");
    const invited = Object.keys(teachingPolicyAdherenceRequest(turn, reply, undefined, { practiceInvited: true })!.questions);
    expect(invited).not.toContain("unsolicited_assessment");
    expect(invited).toContain("checkpoint_answer_leaked");
    expect(Object.keys(teachingPolicyAdherenceRequest(turn, reply, ["unsolicited_assessment"], { practiceInvited: true })!.questions)).toContain("unsolicited_assessment");
  });

  test("a reply that follows the plan directive passes the structural checks", () => {
    const reply = { toolCalls: [], text: [
      "An eigenvector keeps its direction under the map.",
      "```openui lifecycle=workspace id=eigen-plan",
      'root = LearningSurface([plan, check], "Eigenvectors", "The path from here.", "workspace")',
      'plan = StudyPlan("eigen-plan", "Eigenvectors", [{ id: "a", title: "Find eigenvalues of a 2x2 matrix" }, { id: "b", title: "Solve for an eigenvector", dependsOn: ["a"] }, { id: "c", title: "Diagonalize a matrix", dependsOn: ["b"] }], "workspace")',
      'check = Question([{ question: "Which step feels least familiar?", type: "text" }], "ephemeral")',
      "```",
    ].join("\n") };
    const failed = teachingPolicyDeterministicChecks(turn, reply).filter((check) => check.status !== "pass").map((check) => check.id);
    expect(failed).toEqual([]);
  });
});
