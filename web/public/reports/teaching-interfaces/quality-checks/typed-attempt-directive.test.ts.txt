import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { JudgementAnswer, JudgementOutcome } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { projectTeachingPolicyDecision } from "../src/judgement/teaching-policy.js";
import { interactionDirectives } from "../src/judgement/interaction-affordances.js";
import { variantPrompt } from "../src/judgement/teaching-drafts/policy.js";

const folder = new URL("../../../docs/benchmarks/openui-audit-2026-11-18/final-review/study/classroom-v2.3.7/", import.meta.url);
const ledger = JSON.parse(readFileSync(new URL("ledger.json", folder), "utf8"));
const planning = ledger.entries[0];
const original: TeachingPolicyTurn = planning.request.state.turn;
const project = (turn: TeachingPolicyTurn, changes: Record<string,number> = {}) => {
  const answers: Record<string,JudgementAnswer> = {...planning.response.answers};
  for (const [id,p] of Object.entries(changes)) answers[id] = {type:"noul",noul:p};
  const outcome: JudgementOutcome = {ok:true,response:{backend:{backend:"fixture",model:"jev-1.14.0",calibrationSha256:null},answers}};
  return projectTeachingPolicyDecision(turn,outcome);
};

test("on the captured same-card plan all tutor variants give just the specific typed-answer direction", () => {
  const digest=createHash("sha256").update(JSON.stringify(planning.request)).digest("hex");
  expect(digest).toBe("0bdf4738bffd87d835c8c05f4e3dcb17185e627b3b49caaa812d50f0beb3b004");
  const plan=project(original);
  expect(plan.interaction).toMatchObject({action:"continue",continueInteraction:{
    documentId:original.previousQuestionPresentation!.documentId,nodeId:original.previousQuestionPresentation!.nodeId,typedAttempt:true}});
  expect(plan.directives).toHaveLength(1);
  const [directive]=plan.directives;
  expect(directive).toContain("Give concise feedback"); expect(directive).toContain("unless the learner explicitly requested another action");
  for (const variant of ["default","prose","interactive"] as const) {
    const prompt=variantPrompt(plan,variant);
    expect(prompt).toContain(directive!);
    expect(prompt).not.toContain("has not yet answered");
    expect(prompt).not.toContain("Choose one useful next learning step");
    expect(prompt).not.toContain("before choosing the next step");
  }
  expect(interactionDirectives(plan.interaction,"require")).toEqual(plan.directives as string[]);
  expect(plan.allowedTools).toEqual(project({...original,previousQuestionPresentation:undefined}).allowedTools);
});

test("true due, uncertain attempts, new practice and hands-on requests retain their ordinary behavior", () => {
  for (const changes of [{attempt_present:.5},{attempt_present:.1},{learner_response_due:.5},{learner_response_due:.91},{practice_requested:.5},
    {practice_requested:.9},{hands_on_requested:.5},{hands_on_requested:.95},{assessment_declined:.99}]) {
    const modified=Object.fromEntries(Object.entries(changes)) as Record<string,number>;
    const plan=project(original,modified);
    expect(plan.interaction.continueInteraction?.typedAttempt).toBeUndefined();
    expect(plan.directives).toEqual(project({...original,previousQuestionPresentation:undefined},modified).directives);
  }
  expect(project(original,{practice_requested:.98}).directives.some(line=>line.includes("Provide one requested OpenUI practice activity"))).toBe(true);
  const extra=project(original,{explanation_requested:.95});
  expect(extra.directives).toContain("Give the requested explanation or worked example openly before inviting an attempt.");
  expect(extra.directives.some(line=>line.includes("unless the learner explicitly requested another action"))).toBe(true);
  const motion=project(original,{motion_requested:.95});
  expect(motion.allowedTools).toContain("animate");
  expect(motion.directives.some(line=>line.includes("An available animation tool may be used for the requested motion"))).toBe(true);
});

test("unlinked, older, ambiguous, graded and assessed records retain the default directions", () => {
  const linked=original.previousQuestionPresentation!, work=original.activeWork!, item=work.openInteractions[0]!;
  for (const other of [
    {...original,previousQuestionPresentation:undefined}, {...original,previousQuestionPresentation:{...linked,nodeId:"other"}},
    {...original,previousQuestionPresentation:{...linked,assistantTurnIndex:0}}, {...original,assessment:"assessed" as const},
    {...original,activeWork:{...work,truncated:true}}, {...original,activeWork:{...work,openInteractions:[item,{...item,documentId:"elsewhere"}]}},
    {...original,activeWork:{...work,openInteractions:[{...item,state:"graded" as const}]}},
    {...original,pendingSubmissions:[{kind:"comprehension" as const,id:"s",questionIds:["q"]}]},
  ]) {
    const plan=project(other);
    expect(plan.interaction.continueInteraction?.typedAttempt).toBeUndefined();
    expect(plan.directives).toEqual(project({...other,previousQuestionPresentation:undefined}).directives);
  }
});
