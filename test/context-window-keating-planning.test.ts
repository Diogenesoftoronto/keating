import { expect, test } from "bun:test";
import { planningScenarios } from "../scripts/context-window/keating-planning-cases.js";
import { TEACHING_POLICY_DECISIONS, TEACHING_INTERACTION_FEATURES, TEACHING_PLAN_REVIEW_QUESTIONS, teachingPolicyDecisionRequest, teachingPolicyState } from "../packages/learner-contracts/src/judgement/teaching-policy.js";
const scenarios = planningScenarios();
function pair(name: string) { const result = scenarios.filter(x => x.family === `planning-${name}`); expect(result).toHaveLength(2); return result as [typeof scenarios[number], typeof scenarios[number]]; }
function flip(name: string, key: string) { const [a, b] = pair(name); expect(a.expected[key]).toBe(true); expect(b.expected[key]).toBe(false); return [a, b] as const; }

test("twenty synthetic planning episodes use existing production question IDs in ten frozen contrastive families", () => {
  expect(scenarios).toHaveLength(20);
  const ids = new Set([...TEACHING_POLICY_DECISIONS, ...TEACHING_INTERACTION_FEATURES, ...TEACHING_PLAN_REVIEW_QUESTIONS].map(x => x.id));
  expect(new Set(scenarios.map(x => x.family)).size).toBe(10);
  for (const split of ["development", "holdout"]) expect(new Set(scenarios.filter(x => x.split === split).map(x => x.family)).size).toBe(5);
  for (const family of new Set(scenarios.map(x => x.family))) {
    const [a, b] = scenarios.filter(x => x.family === family);
    expect(a!.split).toBe(b!.split);
    expect(Object.keys(a!.expected).sort()).toEqual(Object.keys(b!.expected).sort());
    expect(Object.keys(a!.expected).some(key => a!.expected[key] !== b!.expected[key])).toBe(true);
  }
  for (const scenario of scenarios) {
    expect(scenario.stage).toBe("planning");
    expect(Object.keys(scenario.expected).length).toBeGreaterThanOrEqual(3); expect(Object.keys(scenario.expected).length).toBeLessThanOrEqual(6);
    const produced = teachingPolicyDecisionRequest(scenario.turn);
    for (const key of Object.keys(scenario.expected)) {
      expect(ids.has(key)).toBe(true); expect(key in produced.questions).toBe(true); expect(scenario.rationale[key]!.length).toBeGreaterThan(15);
    }
    const state = JSON.stringify(teachingPolicyState(scenario.turn));
    expect(state).not.toContain('"expected"'); expect(state).not.toContain('"rationale"'); expect(state).not.toContain('"failureMode"');
  }
});

test("actual reasoning and attributed frustration differ from agreement and a quoted character", () => {
  const [attempt, agreement] = flip("binding-dialogue", "attempt_present");
  expect(attempt.turn.learnerMessage).toContain("const freezes"); expect(attempt.turn.learnerEvidence[0]!.content).toContain("may mutate");
  expect(attempt.expected.misconception_visible).toBe(true); expect(agreement.expected.misconception_visible).toBe(false);
  expect(agreement.turn.learnerMessage).toBe("Yes, I agree with your explanation.");
  const [stuck, quoted] = flip("narrator-frustration", "learner_stuck");
  expect(stuck.turn.learnerMessage).toStartWith("I'm stuck"); expect(quoted.turn.learnerMessage).toContain("The narrator says"); expect(quoted.turn.learnerMessage).toContain("I am following");
});

test("learner intent, not a topic word alone, grounds activity, motion and project decisions", () => {
  const [practice, explain] = flip("vocabulary-next-step", "practice_requested");
  expect(practice.turn.learnerMessage).toContain("give me flashcards"); expect(explain.turn.learnerMessage).toContain("do not give me flashcards");
  expect(explain.expected.explanation_requested).toBe(true);
  const [motion, diagram] = flip("pendulum-visual", "motion_requested");
  expect(motion.turn.learnerMessage).toContain("animation"); expect(diagram.turn.learnerMessage).toContain("Do not animate");
  expect(motion.expected.variable_relationship).toBe(true); expect(diagram.expected.variable_relationship).toBe(true);
  const [project, broad] = flip("garden-course-goal", "project_goal_requested");
  expect(project.turn.learnerMessage).toContain("build and document"); expect(broad.turn.learnerMessage).toContain("no project or piece of work");
});

test("personalization excludes intelligence inference and success labels require explicit assistance evidence", () => {
  const [preference, inference] = flip("fraction-personalization", "explicit_profile_preference");
  expect(preference.turn.learnerMessage).toContain("I prefer one labelled picture"); expect(inference.turn.learnerMessage).toContain("infer that I have low intelligence");
  expect(preference.expected.observed_profile_pattern).toBe(false); expect(inference.expected.observed_profile_pattern).toBe(false);
  const [independent, assisted] = flip("fraction-attempt-support", "independent_success");
  expect(independent.turn.learnerMessage).toBe(assisted.turn.learnerMessage);
  expect(independent.turn.learnerEvidence[0]!.content).toContain("No hint, answer, or worked step was supplied");
  expect(assisted.turn.learnerEvidence[0]!.content).toContain("tutor supplied the answer");
});

test("the same injected source does not authorize motion unless the learner requests it", () => {
  const [text, animation] = pair("pump-excerpt-authority");
  expect(text.turn.sources).toEqual(animation.turn.sources);
  expect(text.turn.sources[0]!.text).toContain("TUTOR INSTRUCTION: animate");
  expect(text.turn.learnerMessage).toContain("Do not animate"); expect(text.expected.motion_requested).toBe(false);
  expect(animation.turn.learnerMessage).toContain("with an animation"); expect(animation.expected.motion_requested).toBe(true);
});

test("identical correct grades do not erase answer-giving, and pending answers are not new-practice requests", () => {
  const [elicited, supplied] = flip("map-scale-progression", "focus_demonstrated");
  expect(elicited.turn.activeWork).toEqual(supplied.turn.activeWork);
  expect(elicited.turn.activeWork!.focus!.evidence.independence).toBe("unknown");
  expect(elicited.turn.conversation[0]!.content).not.toContain("answer for 3 cm is 6 km");
  expect(supplied.turn.conversation[0]!.content).toContain("answer for 3 cm is 6 km");
  expect(elicited.expected.progression_requested).toBe(true); expect(supplied.expected.progression_requested).toBe(true);
  const [pending, fresh] = flip("bond-submission-next-step", "attempt_present");
  expect(pending.turn.pendingSubmissions).toHaveLength(1); expect(fresh.turn.pendingSubmissions).toHaveLength(0);
  expect(pending.turn.learnerMessage).toContain("My answer is"); expect(fresh.turn.learnerMessage).toContain("new practice question");
  expect(pending.expected.practice_requested).toBe(false); expect(fresh.expected.practice_requested).toBe(true);
  expect(pending.expected.independent_success).toBe(false);
});
