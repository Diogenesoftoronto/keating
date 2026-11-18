import { describe, expect, test } from "bun:test";
import type { ActiveWork } from "../src/judgement/active-work.js";
import { INTERACTION_AFFORDANCES, interactionDirectives, recommendInteraction } from "../src/judgement/interaction-affordances.js";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest } from "../src/judgement/teaching-policy.js";
import { interactionSummary } from "../src/judgement/teaching-drafts/policy.js";
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
    [["learner_response_due"], "question", ["Question"]],
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
    const used = new Set(INTERACTION_AFFORDANCES.flatMap((row) => typeof row.practice === "string" ? [...row.features, row.practice] : row.features));
    expect([...used].sort()).toEqual(TEACHING_INTERACTION_FEATURES.map(({ id }) => id).sort());
  });

  test("recall alone, without untaught-but-untested material, is not a quiz", () => {
    expect(recommendInteraction(features("discrete_recall"), teaching).action).toBe("none");
  });

  test("overuse traps: all features false, or not a learning task, give none", () => {
    expect(recommendInteraction(allFalse, teaching)).toEqual({ action: "none", families: [], reason: "no-supported-family" });
    expect(recommendInteraction(features("variable_relationship"), { learning_task: false, practice_requested: false }).action).toBe("none");
    expect(interactionDirectives(recommendInteraction(allFalse, teaching))).toEqual([]);
  });

  test("uncertain features and decisions count as false", () => {
    expect(recommendInteraction({ ...allFalse, variable_relationship: null }, teaching).action).toBe("none");
    expect(recommendInteraction(features("variable_relationship"), { learning_task: null }).action).toBe("none");
  });
});

describe("interaction modifiers", () => {
  test("architecture construction remains selectable for interview practice without widening ordinary recall", () => {
    const practice = { ...teaching, practice_requested: true };
    const rec = recommendInteraction(features("extended_production", "structure_relations", "variable_relationship"), practice);
    expect(rec.families.map(({ family }) => family)).toEqual(["manipulable"]);
    expect(rec.families[0]?.components).toEqual(["Diagram"]);
    expect(recommendInteraction(features("structure_relations"), practice).action).toBe("none");
    expect(recommendInteraction(features("extended_production"), practice).action).toBe("none");
    expect(recommendInteraction(features("discrete_recall", "untested_coverage"), practice).families[0]?.components).toEqual(["Quiz", "Flashcards"]);
  });
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
    expect(rec.families.map(({ family }) => family)).toEqual(["manipulable", "workspace"]);
    expect(rec.families.find(({ family }) => family === "manipulable")?.components).toEqual(["Diagram"]);
    expect(recommendInteraction(features("outside_observation"), { ...teaching, learner_stuck: true }).action).toBe("none");
  });

  test("a direct question is answered first, then the activity is offered", () => {
    const rec = recommendInteraction(features("variable_relationship"), { ...teaching, direct_answer_requested: true });
    expect(rec.lead).toBe("answer-first");
    expect(interactionDirectives(rec)[0]).toContain("Answer the learner's request first");
  });

  test("recall practice offers retrieval ahead of an incidental variable relationship", () => {
    const rec = recommendInteraction(features("discrete_recall", "untested_coverage", "variable_relationship"), { practice_requested: true });
    expect(rec.families.map(({ family }) => family)).toEqual(["retrieval"]);
  });

  test("a requested hands-on action preserves the supported practice surface without an incidental checkpoint", () => {
    const practice = { learning_task: true, practice_requested: true };
    for (const [signal, component] of [["variable_relationship", "Simulation"], ["structure_relations", "ConceptMap"], ["performed_skill", "AudioResponse"]] as const) {
      const rec = recommendInteraction(features(signal, "prediction_opportunity", "hands_on_requested"), practice);
      expect(rec.families.flatMap(x => x.components)).toContain(component);
      expect(rec.families.flatMap(x => x.components)).not.toContain("Question");
      expect(rec.families[0]?.features).toContain("hands_on_requested");
    }
    expect(recommendInteraction(features("hands_on_requested"), practice).action).toBe("none");
    expect(recommendInteraction(features("variable_relationship", "hands_on_requested"), { ...practice, plain_reply_requested: true }).action).toBe("none");
    const both = recommendInteraction(features("variable_relationship", "hands_on_requested", "learner_response_due"), practice);
    expect(both.families.flatMap(x => x.components)).toEqual(["Question", "Simulation"]);
  });

  test("practice preserves an ordering checkpoint, code repair, and a learner's choice or independent attempt", () => {
    const practice = { ...teaching, practice_requested: true, direct_answer_requested: true };
    for (const id of ["ordered_procedure", "learner_response_due"]) {
      const rec = recommendInteraction(features(id), practice);
      expect(rec.families).toEqual([{ family: "question", components: ["Question"], features: [id] }]);
      expect(rec.lead).toBeUndefined();
    }
    const code = recommendInteraction(features("executable_code"), practice);
    expect(code.families[0]?.components).toEqual(["CodingChallenge"]);
    expect(interactionDirectives(code).join(" ")).toContain("Preserve the requested language");
    expect(recommendInteraction(features("ordered_procedure"), { ...practice, explanation_requested: true }).lead).toBe("answer-first");
  });

  test("a text-only request suppresses activity even when the subject supports a prediction", () => {
    const decisions = { ...teaching, practice_requested: true, plain_reply_requested: true };
    expect(recommendInteraction(features("prediction_opportunity", "learner_response_due"), decisions).action).toBe("none");
    expect(recommendInteraction(features("prediction_opportunity"), decisions, {
      pendingSubmissions: [{ kind: "quiz", id: "q", questionIds: ["a"] }],
    }).action).toBe("grade-first");
  });

  test("declining an assessment suppresses response fields but preserves a visual explanation", () => {
    const decisions = { ...teaching, assessment_declined: true };
    expect(recommendInteraction(features("ordered_procedure", "learner_response_due"), decisions)).toMatchObject({action:"none", reason:"assessment-declined"});
    expect(recommendInteraction(features("visual_reference", "learner_response_due"), decisions).families.flatMap(f => f.components)).toEqual(["LearningImage"]);
    expect(recommendInteraction(features("visual_reference"), { ...decisions, practice_requested: true }).families.flatMap(f => f.components)).toEqual(["LearningImage"]);
    expect(recommendInteraction(features("variable_relationship", "hands_on_requested", "prediction_opportunity"), decisions).families.flatMap(f => f.components)).toEqual(["Simulation"]);
    expect(recommendInteraction(features("visual_reference"), { ...decisions, plain_reply_requested: true }).action).toBe("none");
    expect(recommendInteraction(features("ordered_procedure"), { ...teaching, assessment_declined: false }).families[0]?.components).toEqual(["Question"]);
    const uncertain = { ...decisions, learning_task: null };
    expect(recommendInteraction(features("variable_relationship", "hands_on_requested"), uncertain).families.flatMap(f => f.components)).toEqual(["Simulation"]);
    expect(recommendInteraction(features("variable_relationship"), uncertain).action).toBe("none");
    expect(recommendInteraction(features("variable_relationship", "hands_on_requested"), { ...uncertain, learning_task: false }).action).toBe("none");
    expect(recommendInteraction(features("hands_on_requested"), uncertain).action).toBe("none");
  });

  test("a grounded request to vary a subject quantity can recover only Simulation from a contrary learning judgment", () => {
    const study = { ...teaching, learning_task: false, assessment_declined: true };
    const subject = features("hands_on_requested", "variable_relationship", "structure_relations", "prediction_opportunity", "outside_observation");
    const priorTurn = { followsTutorTurn: true };
    const recovered = recommendInteraction(subject, study, priorTurn);
    expect(recovered).toMatchObject({action: "create", reason: "requested-variable-exploration"});
    expect(recovered.families.flatMap(f => f.components)).toEqual(["Simulation"]);
    expect(recommendInteraction(subject, {...study, plain_reply_requested: true}, priorTurn)).toMatchObject({action:"none", reason:"plain-reply"});
    expect(recommendInteraction(subject, study, {...priorTurn, pendingSubmissions: [{kind:"quiz", id:"q", questionIds:["p"]}]}))
      .toEqual({action:"grade-first", families:[]});
    // A quantity in a setting (e.g. paid seats) and an intention to change it can both be real.
    // Neither flag establishes a lesson, even if a support representative just replied.
    const setting = features("hands_on_requested", "variable_relationship");
    expect(recommendInteraction(setting, study, priorTurn)).toMatchObject({action:"none", reason:"not-learning"});
    expect(recommendInteraction(subject, study)).toMatchObject({action:"none", reason:"not-learning"});
    expect(recommendInteraction(subject, {...study, assessment_declined:false}, priorTurn)).toMatchObject({action:"none", reason:"not-learning"});
    expect(recommendInteraction(features("variable_relationship"), {learning_task:null}, priorTurn)).toMatchObject({action:"none", reason:"learning-uncertain"});
    // A named science lesson with a prediction distinguishes a fresh single-turn variable request.
    expect(recommendInteraction(features("hands_on_requested","variable_relationship","prediction_opportunity"),
      {learning_task:false}, {domain:"science"})).toMatchObject({action:"create", reason:"requested-variable-exploration"});
    expect(recommendInteraction(subject, teaching).reason).toBeUndefined();
  });

  test("directives offer at most one activity, allow prose, and keep the wait rule for questions only", () => {
    const question = interactionDirectives(recommendInteraction(features("prediction_opportunity"), teaching)).join(" ");
    expect(question).toContain("At most one OpenUI activity");
    expect(question).toContain("Prose is acceptable");
    expect(question).toContain("Do not answer it yourself");
    const sim = interactionDirectives(recommendInteraction(features("variable_relationship"), teaching)).join(" ");
    expect(sim).toContain("Simulation to let the learner change a variable");
    expect(sim).not.toContain("Do not answer it yourself");
    expect(sim).toContain("Put units and assumptions in the control");
    expect(sim).toContain("Include any explanation the learner explicitly requested");
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

  test("a stated text format suppresses a conflicting generic practice directive without widening tool permission", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const plan = projectTeachingPolicyDecision(turn, outcome(request, {
      learning_task: .95, plain_reply_requested: .95, practice_requested: .75, prediction_opportunity: .65,
    }));
    expect(plan.interaction.action).toBe("none");
    expect(plan.directives.join(" ")).toContain("requested plain reply");
    expect(plan.directives.join(" ")).not.toContain("Provide one requested OpenUI");
    expect(plan.directives).not.toContain(TEACHING_POLICY_DECISIONS.find(d => d.id === "learning_task")!.directive);
    expect(plan.allowedTools).toEqual([]);
  });

  test("a request to show the explanation after an independent attempt does not inject a conflicting answer-first directive", () => {
    const plan = projectTeachingPolicyDecision(turn, outcome(teachingPolicyDecisionRequest(turn), {
      learning_task: .95, learner_response_due: .95, explanation_requested: .8, direct_answer_requested: .7,
    }));
    expect(plan.interaction.action).toBe("create");
    expect(plan.interaction.lead).toBeUndefined();
    expect(plan.directives.join(" ")).not.toContain("before inviting an attempt");
    expect(plan.directives).toContain(TEACHING_POLICY_DECISIONS.find(d => d.id === "learning_task")!.directive);
  });

  test("brief facts and a declined checkpoint end cleanly while assessment and explicit practice keep their instructions", () => {
    const request = teachingPolicyDecisionRequest(turn);
    const generic = TEACHING_POLICY_DECISIONS.find(d => d.id === "learning_task")!.directive;
    const plan = (values: Record<string, number>) => projectTeachingPolicyDecision(turn, outcome(request, {learning_task:.94, ...values}));
    expect(plan({direct_answer_requested:.94}).directives).not.toContain(generic);
    expect(plan({assessment_declined:.94, variable_relationship:.94}).directives).not.toContain(generic);
    expect(plan({direct_answer_requested:.94, practice_requested:.94, learner_response_due:.94}).directives).toContain(generic);
    const assessed = {...turn, assessment:"assessed" as const};
    const held = projectTeachingPolicyDecision(assessed, outcome(teachingPolicyDecisionRequest(assessed), {plain_reply_requested:.95, learning_task:.95}));
    expect(held.directives.some(d => d.startsWith("This is assessed learner work"))).toBe(true);
    expect(held.directives).not.toContain(generic);
  });

  test("the real projector uses the preceding tutor turn to ground manipulation in relevant material", () => {
    const current: TeachingPolicyTurn = {...turn, domain:"unknown", learnerMessage:"Let me change it myself. No questions for now.",
      conversation:[{role:"assistant", content:"The valve setting changes the rate at which the tank drains."}]};
    const scores = {learning_task:.05, assessment_declined:.9, hands_on_requested:.91, variable_relationship:.88, structure_relations:.85};
    const result = projectTeachingPolicyDecision(current, outcome(teachingPolicyDecisionRequest(current),scores));
    expect(result.interaction).toMatchObject({action:"create", reason:"requested-variable-exploration"});
    expect(result.interaction.families.flatMap(f => f.components)).toEqual(["Simulation"]);
    expect(result.directives.join(" ")).toContain("Simulation to let the learner change a variable");
    const reset = {...current, conversation:[], learnerMessage:"I want to change the seat count for my subscription."};
    expect(projectTeachingPolicyDecision(reset, outcome(teachingPolicyDecisionRequest(reset),scores)).interaction)
      .toMatchObject({action:"none", reason:"not-learning"});
  });

  test("new coding exercises preserve the learner's language and only request a submission when it fits", () => {
    const coding = {...turn, learnerMessage:"Give me a Python loop to fix."};
    const values = {learning_task:.9, practice_requested:.9, executable_code:.94};
    const prepare = (current: TeachingPolicyTurn, extra: Record<string, number> = {}) =>
      projectTeachingPolicyDecision(current, outcome(teachingPolicyDecisionRequest(current),{...values,...extra}));
    const independent = prepare(coding);
    expect(independent.interaction).toMatchObject({action:"none", families:[], codePracticeLanguage:"python"});
    expect(interactionSummary(independent, false)).toMatchObject({action:"none", codePracticeLanguage:"python"});
    expect(independent.directives.join(" ")).toContain("editable fenced python code block");
    expect(independent.directives.join(" ")).not.toContain("Provide one requested OpenUI practice activity");
    const submitting = prepare(coding,{learner_response_due:.92});
    expect(submitting.interaction.families.flatMap(f => f.components)).toEqual(["Question"]);
    expect(submitting.directives.join(" ")).toContain("available hosted executor");
    for (const [language, code] of [["JavaScript","javascript"],["TypeScript","typescript"]] as const) {
      const selected = prepare({...coding,learnerMessage:`Give me a ${language} loop to fix.`});
      expect(selected.interaction.families.flatMap(f=>f.components)).toContain("CodingChallenge");
      expect(interactionSummary(selected, false).codePracticeLanguage).toBe(code);
      expect(selected.directives.join(" ")).toContain(`learner's requested ${language}`);
    }
    expect(prepare(coding,{plain_reply_requested:.95}).interaction).toMatchObject({action:"none", reason:"plain-reply"});
    expect(prepare({...coding,pendingSubmissions:[{kind:"quiz",id:"q",questionIds:["p"]}]}).interaction).toEqual({action:"grade-first",families:[]});
    expect(prepare(coding,{executable_code:.5}).interaction.codePracticeLanguage).toBeUndefined();
    expect(interactionSummary(prepare(coding,{executable_code:.5}), false)).not.toHaveProperty("codePracticeLanguage");
  });

  test("explicit self-directed Python practice gets its editor when the executable-control signal abstains", () => {
    const subject = {...turn, availableTools:["set_learner_goal"], learnerMessage:"Give me a short Python function to debug myself."};
    const signals = { learning_task:.99, practice_requested:.96,hands_on_requested:.93,executable_code:.5,project_goal_requested:.99 };
    const project = (current:TeachingPolicyTurn, scores:Record<string,number> = {}) =>
      projectTeachingPolicyDecision(current, outcome(teachingPolicyDecisionRequest(current),{...signals,...scores}));
    const editor = project(subject);
    expect(interactionSummary(editor,false)).toMatchObject({action:"none",families:[],codePracticeLanguage:"python"});
    expect(editor.interaction.reason).toBeUndefined();
    expect(editor.directives.join(" ")).toContain("editable fenced python");
    expect(editor.directives.join(" ")).not.toMatch(/one requested OpenUI practice|scaffold actionable prerequisite|then let the learner respond/);
    expect(editor.allowedTools).not.toContain("set_learner_goal");
    expect(project(subject,{learner_response_due:.94}).interaction.families.flatMap(f => f.components)).toEqual(["Question"]);
    expect(project({...subject,learnerMessage:"Explain the loop, and give me a short Python function to debug."},{explanation_requested:.99}).directives.join(" ")).toContain("requested explanation");
    const ordinary: TeachingPolicyTurn[] = [
      {...subject,learnerMessage:"Explain how this Python loop works."},
      {...subject,learnerMessage:"Compare Python and JavaScript loops. Give me a short script to debug."},
      {...subject,learnerMessage:"Give me a JavaScript function to debug myself."},
      {...subject,assessment:"assessed"},
      {...subject,pendingSubmissions:[{kind:"quiz",id:"s",questionIds:["q"]}]},
    ];
    for (const c of ordinary) expect(project(c).interaction.codePracticeLanguage).toBeUndefined();
    const unsuitable:Record<string,number>[] = [{plain_reply_requested:.99},{learning_task:.02},{assessment_declined:.99},{practice_requested:.5},{hands_on_requested:.5}];
    for (const scores of unsuitable) {
      expect(project(subject,scores).interaction.codePracticeLanguage).toBeUndefined();
    }
    const direct = project({...subject,learnerMessage:"In one sentence, how do I edit a Python file in the app?"},{direct_answer_requested:.99,practice_requested:.01});
    expect(direct.interaction.codePracticeLanguage).toBeUndefined();
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
