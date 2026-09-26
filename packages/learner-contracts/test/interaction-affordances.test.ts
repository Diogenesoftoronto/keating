import { describe, expect, test } from "bun:test";
import type { ActiveWork } from "../src/judgement/active-work.js";
import { INTERACTION_AFFORDANCES, interactionDirectives, recommendInteraction } from "../src/judgement/interaction-affordances.js";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest } from "../src/judgement/teaching-policy.js";
import { TEACHING_INTERACTION_FEATURES, TEACHING_POLICY_DECISIONS } from "../src/judgement/teaching-policy-catalog.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementOutcome, JudgementRequest } from "../src/judgement/contracts.js";
import { INTERACTION_FEATURE_CASES, INTERACTION_OVERUSE_TRAPS } from "./fixtures/interaction-features/cases.js";

const allFalse = Object.fromEntries(TEACHING_INTERACTION_FEATURES.map(({ id }) => [id, false]));
const features = (...ids: string[]) => ({ ...allFalse, ...Object.fromEntries(ids.map((id) => [id, true])) });
const teaching = { learning_task: true } as const;
const evidence = { presented: 1, attempted: 0, correct: 0, incorrect: 0, pendingGrade: 0, lastAttemptAt: null, independence: "unknown" as const };
const work = (overrides: Partial<ActiveWork> = {}): ActiveWork => ({
  plan: { documentId: "plan", revision: 1, title: "Cells", outline: [{ id: "organelles", title: "Organelles", status: "in_progress", depth: 0 }] },
  focus: { itemId: "organelles", title: "Organelles", outcomes: [], dependsOn: [], evidence },
  openInteractions: [],
  truncated: false,
  ...overrides,
});

describe("interaction affordance table", () => {
  const rows: [string[], string, string[]][] = [
    [["prediction_opportunity"], "question", ["Question"]],
    [["category_distinction"], "question", ["Question"]],
    [["ordered_procedure"], "question", ["Question"]],
    [["discrete_recall", "untested_coverage"], "retrieval", ["Quiz", "Flashcards"]],
    [["language_learning"], "retrieval", ["LanguagePractice"]],
    [["variable_relationship"], "manipulable", ["Simulation"]],
    [["executable_code"], "manipulable", ["CodingChallenge"]],
    [["performed_skill"], "perform", ["AudioResponse", "VideoResponse", "MusicLab"]],
    [["structure_relations"], "workspace", ["ConceptMap"]],
    [["visual_reference"], "workspace", ["LearningImage"]],
    [["extended_production"], "away", ["Assignment", "Draft"]],
    [["outside_observation"], "away", ["Fieldwork"]],
  ];
  for (const [ids, family, components] of rows) {
    test(`${ids.join(" + ")} → ${family}`, () => {
      const rec = recommendInteraction(features(...ids), teaching);
      expect(rec.action).toBe("create");
      expect(rec.families).toEqual([{ family: family as never, components, features: ids }]);
    });
  }

  test("every catalog feature is used by the table and every table feature exists", () => {
    const used = new Set(INTERACTION_AFFORDANCES.flatMap((row) => row.features));
    expect([...used].sort()).toEqual(TEACHING_INTERACTION_FEATURES.map(({ id }) => id).sort());
  });

  test("recall alone, without untaught-but-untested material, is not a quiz", () => {
    expect(recommendInteraction(features("discrete_recall"), teaching).action).toBe("none");
  });

  test("overuse traps: all features false, or not a learning task, give none", () => {
    expect(recommendInteraction(allFalse, teaching)).toEqual({ action: "none", families: [] });
    expect(recommendInteraction(features("variable_relationship"), { learning_task: false, practice_requested: false }).action).toBe("none");
    expect(interactionDirectives(recommendInteraction(allFalse, teaching))).toEqual([]);
  });

  test("uncertain features and decisions count as false", () => {
    expect(recommendInteraction({ ...allFalse, variable_relationship: null }, teaching).action).toBe("none");
    expect(recommendInteraction(features("variable_relationship"), { learning_task: null }).action).toBe("none");
  });
});

describe("interaction modifiers", () => {
  test("pending submissions take precedence: grade first", () => {
    const rec = recommendInteraction(features("prediction_opportunity"), teaching, { pendingSubmissions: [{ kind: "quiz", id: "q", questionIds: ["a"] }] });
    expect(rec.action).toBe("grade-first");
    expect(interactionDirectives(rec).join(" ")).toContain("Grade it before");
  });

  test("a pending grade on the focus item also means grade first", () => {
    const rec = recommendInteraction(features("prediction_opportunity"), teaching, { activeWork: work({ focus: { ...work().focus!, evidence: { ...evidence, pendingGrade: 1 } } }) });
    expect(rec.action).toBe("grade-first");
  });

  test("an awaiting question on the focus item is continued, not duplicated", () => {
    const open = { documentId: "d1", nodeId: "q1", component: "question", presentedAt: 1, itemId: "organelles", state: "awaiting" as const };
    const rec = recommendInteraction(features("prediction_opportunity"), teaching, { activeWork: work({ openInteractions: [open] }) });
    expect(rec.action).toBe("continue");
    expect(rec.continueInteraction).toEqual({ documentId: "d1", nodeId: "q1", component: "question" });
    expect(interactionDirectives(rec).join(" ")).toContain("open question q1");
  });

  test("an open interaction for another item or family does not force continuation", () => {
    const other = { documentId: "d1", nodeId: "q1", component: "question", presentedAt: 1, itemId: "membranes", state: "awaiting" as const };
    expect(recommendInteraction(features("prediction_opportunity"), teaching, { activeWork: work({ openInteractions: [other] }) }).action).toBe("create");
    const quiz = { ...other, component: "quiz", itemId: "organelles" };
    expect(recommendInteraction(features("prediction_opportunity"), teaching, { activeWork: work({ openInteractions: [quiz] }) }).action).toBe("create");
  });

  test("a stuck learner is not sent away from the chat", () => {
    const rec = recommendInteraction(features("extended_production", "structure_relations"), { ...teaching, learner_stuck: true });
    expect(rec.families.map(({ family }) => family)).toEqual(["workspace"]);
    expect(recommendInteraction(features("outside_observation"), { ...teaching, learner_stuck: true }).action).toBe("none");
  });

  test("a direct question is answered first, then the activity is offered", () => {
    const rec = recommendInteraction(features("variable_relationship"), { ...teaching, direct_answer_requested: true });
    expect(rec.lead).toBe("answer-first");
    expect(interactionDirectives(rec)[0]).toContain("Answer the learner's request first");
  });

  test("a practice request restricts to retrieval", () => {
    const rec = recommendInteraction(features("discrete_recall", "untested_coverage", "variable_relationship"), { practice_requested: true });
    expect(rec.families.map(({ family }) => family)).toEqual(["retrieval"]);
  });

  test("directives offer at most one activity, allow prose, and keep the wait rule for questions only", () => {
    const question = interactionDirectives(recommendInteraction(features("prediction_opportunity"), teaching)).join(" ");
    expect(question).toContain("At most one OpenUI activity");
    expect(question).toContain("Prose is acceptable");
    expect(question).toContain("Do not answer it yourself");
    const sim = interactionDirectives(recommendInteraction(features("variable_relationship"), teaching)).join(" ");
    expect(sim).toContain("Simulation to let the learner change a variable");
    expect(sim).not.toContain("Do not answer it yourself");
    expect(interactionDirectives(recommendInteraction(features("ordered_procedure"), teaching)).join(" ")).toContain("an ordering question");
  });
});

describe("policy projection", () => {
  const turn: TeachingPolicyTurn = { learnerMessage: "Why does a longer pendulum swing more slowly?", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "science" };
  const outcome = (request: JudgementRequest, values: Record<string, number>): JudgementOutcome => ({ ok: true, response: {
    backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
    answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul", noul: values[id] ?? 0.01 }])),
  } });

  test("the judge sees properties of the material, never component names", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const text = JSON.stringify(TEACHING_INTERACTION_FEATURES.map(({ id }) => request.questions[id]));
    for (const component of INTERACTION_AFFORDANCES.flatMap((row) => row.components)) expect(text).not.toContain(component);
  });

  test("features come from the same planning outcome and drive the directive", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const plan = projectTeachingPolicyDecision(turn, outcome(request, { learning_task: 0.95, variable_relationship: 0.95 }));
    expect(plan.features.variable_relationship).toBe(true);
    expect(plan.interaction.action).toBe("create");
    expect(plan.directives.join(" ")).toContain("Simulation");
  });

  test("feature uncertainty does not change abstention, which is about decisions", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const values = Object.fromEntries(TEACHING_POLICY_DECISIONS.map(({ id }) => [id, 0.5]));
    expect(projectTeachingPolicyDecision(turn, outcome(request, values)).status).toBe("abstained");
    expect(projectTeachingPolicyDecision(turn, outcome(request, { ...values, learning_task: 0.95 })).status).toBe("guided");
  });
});

describe("interaction feature fixtures", () => {
  test("each feature has at least three positive and three negative labels in each split", () => {
    for (const split of ["development", "holdout"] as const) {
      const cases = INTERACTION_FEATURE_CASES.filter((entry) => entry.split === split);
      for (const { id } of TEACHING_INTERACTION_FEATURES) {
        const labels = cases.map((entry) => entry.expectedDecisions[id]).filter((value) => value !== undefined);
        expect({ split, id, positive: labels.filter(Boolean).length >= 3, negative: labels.filter((value) => !value).length >= 3 })
          .toEqual({ split, id, positive: true, negative: true });
      }
    }
  });

  test("ids are unique, labels name real features, and overuse traps map to none", () => {
    expect(new Set(INTERACTION_FEATURE_CASES.map(({ id }) => id)).size).toBe(INTERACTION_FEATURE_CASES.length);
    const known = new Set(TEACHING_INTERACTION_FEATURES.map(({ id }) => id));
    for (const entry of INTERACTION_FEATURE_CASES) for (const id of Object.keys(entry.expectedDecisions)) expect(known.has(id)).toBe(true);
    for (const id of INTERACTION_OVERUSE_TRAPS) {
      const entry = INTERACTION_FEATURE_CASES.find((candidate) => candidate.id === id)!;
      const labeled = Object.fromEntries(Object.entries(entry.expectedDecisions).map(([key, value]) => [key, value ? true : false]));
      expect(recommendInteraction({ ...allFalse, ...labeled }, teaching).action).toBe("none");
    }
  });
});
