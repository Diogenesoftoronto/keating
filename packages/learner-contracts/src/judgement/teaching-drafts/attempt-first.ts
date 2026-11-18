/** Narrow best-effort admission for a reviewed Question when the learner asked to answer first. */
import type { TeachingPolicyCheck, TeachingPolicyPlan, TeachingPolicyReply } from "../teaching-policy-types.js";

/** At or above this a repetition finding is a confident violation, matching the advisory ceiling in `blocksDraft`. */
export const ATTEMPT_FIRST_REPETITION_CEILING = 0.8;
const MUST_PASS = ["checkpoint_answer_leaked", "checkpoint_continued", "quality_progress", "quality_scope"] as const;
const UI_FENCE = /^```(?:openui|openui-lang|keating-ui)(?:[ \t][^\n]*)?\r?\n([\s\S]*?)\n```[ \t]*$/gmu;

/** The reply holds exactly one compiled-language surface whose only components are the surface and Question. */
export function isLoneQuestionSurface(text: string): boolean {
  const fences = [...text.matchAll(UI_FENCE)];
  if (fences.length !== 1 || (text.match(/`{3,}|~{3,}/gu)?.length ?? 0) !== 2) return false;
  // Component names inside learner-facing strings are content, not constructors.
  const source = fences[0]![1]!.replace(/"(?:[^"\\]|\\[\s\S])*"/gu, '""');
  if (source.trimStart().startsWith("{")) return false;
  const components = new Set([...source.matchAll(/\b([A-Z][A-Za-z0-9]*)\s*\(/gu)].map(match => match[1]!));
  return components.has("Question") && [...components].every(name => name === "Question" || name === "LearningSurface");
}

function presentationOnly(check: TeachingPolicyCheck): boolean {
  return check.id === "checkpoint_repeated" && check.source === "jev" && check.severity === "minor"
    && check.probability !== null && Number.isFinite(check.probability)
    && check.probability >= 0 && check.probability < ATTEMPT_FIRST_REPETITION_CEILING;
}

/** The learner asked to answer before being told, the plan offered a Question, and the reply is that one tool-free Question. */
function answersAttemptFirstRequest(reply: TeachingPolicyReply, plan: TeachingPolicyPlan): boolean {
  const { decisions, features, interaction } = plan;
  return plan.status === "guided" && interaction.action === "create" && features.learner_response_due === true
    && decisions.assessment_declined === false && decisions.plain_reply_requested === false
    && interaction.families.some(({ family, components }) => family === "question" && components.includes("Question"))
    && reply.toolCalls.length === 0 && isLoneQuestionSurface(reply.text);
}

function mandatoryPassed(checks: readonly TeachingPolicyCheck[]): boolean {
  return !checks.some(check => check.status !== "pass" && (check.source !== "jev" || check.severity === "critical"))
    && MUST_PASS.every(id => checks.some(check => check.id === id) && checks.every(check => check.id !== id || check.status === "pass"));
}

/**
 * A rejected checkpoint normally never reaches best-effort release. The single
 * exception: the learner asked to answer first, the reply is the offered
 * Question, every structural, host, critical, leak, continuation and usefulness
 * check passed on this exact text, and the only release blocker is that the
 * introduction may repeat it. It is still published as unverified.
 */
export function retainsAttemptFirstCheckpoint(reply: TeachingPolicyReply, plan: TeachingPolicyPlan,
  checks: readonly TeachingPolicyCheck[], blocking: readonly TeachingPolicyCheck[]): boolean {
  return answersAttemptFirstRequest(reply, plan) && blocking.length > 0 && blocking.every(presentationOnly) && mandatoryPassed(checks);
}

/** An approved reply that supplies the answer field the learner asked for. */
export function approvesAttemptFirstCheckpoint(reply: TeachingPolicyReply, plan: TeachingPolicyPlan,
  checks: readonly TeachingPolicyCheck[]): boolean {
  return answersAttemptFirstRequest(reply, plan) && mandatoryPassed(checks);
}

/** Review found this approved reply asks for the learner's answer in prose. */
export function asksInProse(checks: readonly TeachingPolicyCheck[]): boolean {
  return checks.some(check => check.id === "checkpoint_not_interactive" && check.source === "jev" && check.status === "fail");
}
