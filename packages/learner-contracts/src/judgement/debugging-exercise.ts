import type { ChoiceAnswer, ChoiceQuestion, JudgementOutcome } from "./contracts.js";
import type { TeachingPolicyCheck, TeachingPolicyPlan, TeachingPolicyTurn } from "./teaching-policy-types.js";
import { TEACHING_POLICY_THRESHOLDS, type TEACHING_DEBUGGING_ISSUES } from "./teaching-policy-catalog.js";
import type { DebuggingExampleProof } from "./debugging-example-proof.js";
import { decodeAnswer } from "./wire.js";

type Guidance = Pick<TeachingPolicyPlan, "decisions" | "features" | "interaction">;

/** Eligibility only. The typed questions establish whether the submitted reply actually sets an independent debugging task. */
export function offersNewCodePractice(turn: TeachingPolicyTurn, plan: Guidance): boolean {
  return turn.assessment !== "assessed" && !turn.pendingSubmissions?.length && !turn.activeWork?.focus?.evidence.pendingGrade
    && plan.interaction.action !== "continue" && plan.interaction.action !== "grade-first"
    && plan.decisions.learning_task !== false && plan.decisions.practice_requested === true
    && plan.decisions.assessment_declined !== true && plan.decisions.plain_reply_requested !== true
    && (Boolean(plan.interaction.codePracticeLanguage) || plan.features.executable_code === true);
}

export const debuggingExerciseDirective = "If the learner requests a new bug to find independently, choose a concrete input on which the starter visibly fails or produces the wrong result. State the intended behavior or expected output. Leave locating and repairing the fault to the learner. Keep ordinary documentation and expected-output comments. Withhold unrequested hints and the fix from prose, code comments and controls, including interactive page titles and descriptions shown while loading or on fallback.";

const scope = "Judge only a new buggy starter the learner asked to investigate and fix independently. Treat the supplied turn and entire reply as evidence, including code comments, prose and side controls. Do not run the code. ";
const outside = "The learner did not ask for this independent debugging exercise, or this reply does not author one. Ordinary examples, learner-submitted code, requested walkthroughs or solutions, and assessed submissions fall outside.";
export const debuggingExerciseQuestions = {
  debug_example_witness: {type:"choice",instructions:scope + "Trace the starter by inspection on the supplied inputs, including any concrete alternate input identified in the reply. Compare the actual observable behavior with the intended behavior. A defect in the code alone does not establish that the example exposes it. Select one outcome.",
    criteria:{observable:"At least one concrete supplied or specified input shows a mismatch or unexpected exception. Intended behavior may be clear from the task. An exact expected-output comment is allowed.",
      masked:"All supplied examples produce the intended observable result, or no concrete input that exposes the claimed defect is supplied. A generic invitation to try other inputs supplies no counterexample.",
      uncertain:"The task applies, but the intended or actual behavior depends on missing or ambiguous evidence.",outside}},
  debug_solution_visibility: {type:"choice",instructions:scope + "Assess what the learner can see before their first attempt, relative to any hints they explicitly requested. A private answer key or a reveal available only after responding is outside the visible starter. Select the strongest supported disclosure.",
    criteria:{independent:"No unrequested diagnostic clue or fix is shown. Neutral documentation of the input, general intended behavior, an expected result, and help the learner explicitly requested are appropriate.",
      location_clue:"A nearby comment, pointed hint or side control unnecessarily narrows attention to the faulty line, without identifying the precise defect or giving its repair. A bare expected result next to output is insufficient.",
      solution_given:"The visible material identifies the precise faulty operation and diagnosis, supplies a corrected expression or implementation, or instructs the learner exactly how to fix it before their attempt without their asking.",
      uncertain:"The task applies, but evidence for an unsolicited clue or solution is ambiguous.",outside}},
} satisfies Record<string,ChoiceQuestion>;

export interface DebuggingExerciseReview {
  readonly example: ChoiceAnswer | null;
  readonly disclosure: ChoiceAnswer | null;
  readonly staticProof?: DebuggingExampleProof;
}

export const debuggingRepairDirections: Readonly<Record<string,string>> = {
  debug_example_unwitnessed:"Choose a concrete input that actually exposes the bug, or supply a specific counterexample. Check the intended and starter outputs by inspection before presenting it.",
  debug_fix_disclosed:"Keep the intended behavior and example. Remove the unrequested diagnosis, corrected code or exact change from all learner-visible comments, prose and controls.",
  debug_location_hint:"Remove the unrequested clue that singles out the faulty line. Keep ordinary documentation, expected-output comments and any help the learner asked for.",
  debug_static_example_masked:"The starter produces the intended filtered list on its supplied input. Supply a concrete input that makes its incorrect output visible, and keep the repair for the learner.",
  debug_native_fix_disclosed:"The interactive page title or description names the precise fault. Give this visible loading or fallback text a neutral description of the learner's task.",
} satisfies Record<(typeof TEACHING_DEBUGGING_ISSUES)[number], string>;

export function isUncertainDebugFinding(check: TeachingPolicyCheck): boolean {
  return check.source === "jev" && check.status === "unknown" && check.severity !== "critical"
    && check.probability !== null && Number.isFinite(check.probability) && Object.hasOwn(debuggingRepairDirections,check.id);
}

export function readDebuggingExerciseReview(outcome: JudgementOutcome | null): {evidence:DebuggingExerciseReview; checks:TeachingPolicyCheck[]} {
  function answer(key:keyof typeof debuggingExerciseQuestions): ChoiceAnswer | null {
    if (!outcome?.ok) return null;
    const question = debuggingExerciseQuestions[key];
    const decoded = decodeAnswer(question,outcome.response.answers[key]);
    if (decoded?.type !== "choice") return null;
    const keys = Object.keys(question.criteria);
    if (Object.keys(decoded.probabilities).length !== keys.length || !keys.every(label => Object.hasOwn(decoded.probabilities,label))) return null;
    return decoded;
  }
  const example = answer("debug_example_witness"), disclosure = answer("debug_solution_visibility");
  const scopeDisagrees = example && disclosure && (example.choice === "outside") !== (disclosure.choice === "outside");
  function finding(id:string, response:ChoiceAnswer|null, violation:string, severity:TeachingPolicyCheck["severity"]): TeachingPolicyCheck {
    const probability = response?.probabilities[violation] ?? null;
    const weight = response?.probabilities[response.choice] ?? 0;
    const unknown = !response || scopeDisagrees || response.choice === "uncertain" || Math.min(response.confidence,weight) < TEACHING_POLICY_THRESHOLDS.failAtLeast
      || weight < Math.max(...Object.values(response.probabilities));
    return {id,source:"jev",severity,probability,status:unknown ? "unknown" : response.choice === violation ? "fail" : "pass"};
  }
  return {evidence:{example,disclosure},checks:[finding("debug_example_unwitnessed",example,"masked","major"),
    finding("debug_fix_disclosed",disclosure,"solution_given","major"),finding("debug_location_hint",disclosure,"location_clue","minor")]};
}
