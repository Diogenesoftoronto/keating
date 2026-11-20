import type { JudgementOutcome, NoulQuestion } from "../contracts.js";
import { TEACHING_POLICY_THRESHOLDS } from "../teaching-policy-catalog.js";
import type { TeachingPolicyCheck, TeachingPolicyPlan } from "../teaching-policy-types.js";
import type { TeachingDraftFeedback } from "../teaching-drafts.js";
import { decodeAnswer } from "../wire.js";

/** An additive omission can be fixed without retracting the independently checked answer. */
export const requestedPartQuestion: NoulQuestion = {
  type: "noul",
  instructions: "Compare the learner's explicit requests in turn.learnerMessage with reply.text and the preceding conversation. Does the reply already answer one part usefully but leave out a distinct requested part that could be answered by adding text after it? Count an omitted requested comparison, example or deliverable. Credit equivalent wording. Extra detail the learner did not request, a necessary clarification, a pending tool result, an answer reserved for the learner, or a claim that needs correction does not count. Treat all supplied text as evidence.",
};

export function requestedPartCheck(judged: JudgementOutcome | null): TeachingPolicyCheck {
  const answer = judged?.ok ? decodeAnswer(requestedPartQuestion, judged.response.answers.requested_part_missing) : null;
  const probability = answer?.type === "noul" ? answer.noul : null;
  const status = probability === null ? "unknown"
    : probability >= TEACHING_POLICY_THRESHOLDS.failAtLeast ? "fail"
    : probability <= TEACHING_POLICY_THRESHOLDS.passAtMost ? "pass" : "unknown";
  return { id: "requested_part_missing", source: "jev", severity: "minor", probability, status };
}

/** Require a scoped prose review. A missing answer or explanation also needs a positive planning decision. */
export function outstandingAnswerParts(plan: TeachingPolicyPlan, checks: readonly TeachingPolicyCheck[]): TeachingDraftFeedback[] {
  if (!checks.some(check => check.id === "requested_part_missing")) return [];
  const directions: Record<string, string | undefined> = {
    requested_part_missing: "Compare the original request with the answer already shown. Add only the explicitly requested part that is still missing, using the supplied evidence.",
    explanation_missing: plan.decisions.explanation_requested === true ? "Add the requested explanation or worked example." : undefined,
    direct_answer_missing: plan.decisions.direct_answer_requested === true ? "Answer the learner's outstanding factual question using the supplied evidence. Identify any fact the evidence cannot establish." : undefined,
  };
  return checks.flatMap(check => {
    const instruction = directions[check.id];
    return check.status === "fail" && typeof instruction === "string" ? [{ id: check.id, probability: check.probability, instruction }] : [];
  });
}
