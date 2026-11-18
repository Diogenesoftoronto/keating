import { expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest } from "../src/judgement/teaching-policy.js";
import { type TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import { compileOpenUISourceToSharedDocument } from "../src/openui-source.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const turn = { ...teachingDraftTurn, learnerMessage: "Let me explore how the rate changes delivery time. No test this time." };
const positive = { assessment_declined:.98, hands_on_requested:.98, variable_relationship:.97, learning_task:.99 };
const invitation = "Adjust the rate slider and watch the delivery time.";
const checkpoint = "First, write down your prediction about the delivery time.";

function simulation(brief: string, format = "openui", title = "Delivery model"): string {
  const program = 'root = LearningSurface([lab], "Rate lab", "Distance stays fixed.", "ephemeral")\n'
    + 'lab = Simulation("delivery", ' + JSON.stringify(title) + ', [{id:"rate",label:"Distance per hour",unit:"km/h",min:1,max:10,value:2}], '
    + '[{id:"time",label:"Duration",unit:"h",expr:"20/rate"}], "ephemeral", ' + JSON.stringify(brief) + ')';
  const body = format === "openui" ? program : JSON.stringify(compileOpenUISourceToSharedDocument(program, {documentId:"delivery", createdAt:"2026-01-01T00:00:00.000Z"}));
  return "The route is 20 km.\n\n```" + format + " lifecycle=ephemeral id=delivery\n" + body + "\n```\n\nRoad conditions can change the journey.";
}

async function run(text: string, options: { planning?:Record<string,number>; review?:number; subject?:TeachingPolicyTurn; hostFail?:boolean } = {}) {
  const reviewed: string[] = [], checked: string[] = [];
  const judge = makeTeachingDraftJudge((request): Record<string,number> => {
    if (request.questions.learning_task) return { ...positive, ...options.planning };
    if (request.questions.declined_assessment_imposed) reviewed.push((request.state as { reply:{text:string} }).reply.text);
    return { declined_assessment_imposed:options.review ?? .01 };
  });
  const result = await runTeachingDrafts({ turn:options.subject ?? turn, maxAttempts:1, ruleIds:["sensitive_inference"], judge,
    check:reply => {
      checked.push(reply.text);
      return options.hostFail ? [{id:"host_check", source:"deterministic", severity:"critical", status:"fail",probability:1}] : [];
    }, generate:async () => ({reply:{text,toolCalls:[]},value:text}) });
  return {result,reviewed,checked};
}

test.each(["openui","keating-ui","ui-document","openui-json"])("review and release a repaired %s Simulation, preserving its source format and all useful copy", async format => {
  const original = simulation(checkpoint + " " + invitation, format);
  const {result, reviewed, checked} = await run(original);
  const expected = original.replace(checkpoint + " ", "");
  expect(result.status).toBe("released");
  expect(result.reply?.text).toBe(expected);
  expect(reviewed).toEqual([expected]);
  expect(checked).toEqual([expected]);
  expect(result.receipt.attempts[0]?.repairedAssessmentBrief).toBe(true);
});

test("ordinary controls, voluntary reflection, learner-requested predictions and earlier grading keep their source bytes", async () => {
  for (const [brief, planning, subject, expectedReview] of [
    [invitation, {}, turn, true],
    ["If you like, guess how long the trip takes.", {}, turn, true],
    ["A prediction interval measures uncertainty. " + invitation, {}, turn, true],
    [checkpoint, {learner_response_due:.99, prediction_opportunity:.99}, {...turn,learnerMessage:"Skip the quiz, but let me predict first."}, true],
    [checkpoint, {assessment_declined:.02}, {...turn,learnerMessage:"Test me on the model."}, false],
    [checkpoint, {}, {...turn,assessment:"assessed"}, false],
    [checkpoint, {}, {...turn,pendingSubmissions:[{kind:"comprehension",id:"g",questionIds:["x"]}]}, false],
  ] as const) {
    const text = simulation(brief);
    const {result,reviewed} = await run(text,{planning,subject});
    expect(result.reply?.text).toBe(text);
    expect(result.receipt.attempts[0]?.repairedAssessmentBrief).toBeUndefined();
    expect(reviewed.length).toBe(expectedReview ? 1 : 0);
  }
});

test("mixed safety instructions, substantive context and ambiguous source positions earn revision without being deleted", async () => {
  for (const text of [
    simulation("Predict the total, but make sure the guard stays closed."),
    simulation("Check the warning light first. " + checkpoint),
    simulation("Predict your result because the schedule assumes no delays."),
    simulation(checkpoint, "openui", checkpoint),
  ]) {
    const {result, reviewed} = await run(text);
    expect(reviewed).toEqual([text]);
    expect(result.status).toBe("withheld");
    expect(result.receipt.attempts[0]?.checks).toContainEqual(expect.objectContaining({id:"declined_assessment_structure",status:"fail"}));
  }
});

test("a forced quiz, a missed semantic violation, a failed host check or an uncertain preference review cannot use best-effort release", async () => {
  const quiz = '```openui\nroot = LearningSurface([q])\nq = Quiz("q","Rate",[{id:"p",question:"How many?",type:"short_answer",level:"application",correctAnswer:"One",explanation:"There is one parcel."}])\n```';
  const imposed = await run(quiz);
  expect(imposed.result.status).toBe("withheld");
  expect(imposed.result.receipt.attempts[0]?.checks).toContainEqual(expect.objectContaining({id:"declined_assessment_structure",status:"fail"}));
  for (const [brief, options] of [[invitation,{review:.94}],[invitation,{review:.5}],[checkpoint,{hostFail:true}]] as const) {
    const {result} = await run(simulation(brief), options);
    expect(result.status).toBe("withheld");
    expect(result.reply).toBeUndefined();
  }
  const prose = await run("The journey takes four hours.", {review:.99});
  expect(prose.reviewed).toEqual([]);
  expect(prose.result.status).toBe("released");
});

test("goal capture and pacing need an in-scope learning project or an actual plan", async () => {
  const project = {...turn,availableTools:["set_learner_goal"]};
  const request = teachingPolicyDecisionRequest(project);
  const plan = async (details: Record<string,number>, target = project) => {
    const outcome = await makeTeachingDraftJudge(() => ({project_goal_requested:.99,progression_requested:.99,...details}))(request as JudgementRequest);
    return projectTeachingPolicyDecision(target,outcome);
  };
  const controls: Record<string,number>[] = [
    {learning_task:.99,direct_answer_requested:.99}, {learning_task:.99,plain_reply_requested:.99},
    {learning_task:.02,hands_on_requested:.99,variable_relationship:.99}, positive,
  ];
  for (const flags of controls) {
    const p = await plan(flags);
    expect(p.decisions.project_goal_requested).toBe(true);
    expect(p.directives.join(" ")).not.toMatch(/scaffold actionable prerequisite|pacing request against the active plan/);
    expect(p.allowedTools).not.toContain("set_learner_goal");
  }
  const extended = await plan({...positive, extended_production:.99}, {...project,learnerMessage:"Help me plan a semester-long engineering project to build and calibrate my own model."});
  expect(extended.directives.join(" ")).toContain("scaffold actionable prerequisite");
  expect(extended.allowedTools).toContain("set_learner_goal");
});
