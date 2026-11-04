/** Plain-language names for draft-gate checks, read from the policy catalog. */
import { TEACHING_POLICY_RULES, TEACHING_POLICY_THRESHOLDS } from "@keating/learner-contracts";

export interface TeachingCheckDescription {
  id: string;
  title: string;
  /** "model" checks are judged by the judgement model; "runtime" checks are exact code checks. */
  kind: "model" | "runtime" | "quality";
  /** The proposition the judge answered, without the shared evidence boundary. */
  question?: string;
}

const runtimeTitles: Record<string, string> = {
  nonempty_reply: "Reply is empty",
  available_tool: "Calls a tool that is not available",
  legacy_activity_tool: "Uses a retired activity tool",
  openui_valid: "Interactive markup is invalid",
  one_activity: "More than one activity in the reply",
  activity_without_plan: "Activity without a study plan",
  one_checkpoint: "More than one checkpoint",
  checkpoint_last_node: "Checkpoint is not the last element",
  stop_after_checkpoint: "Keeps going after a checkpoint",
  grading_requires_submission: "Grades work that was not submitted",
  improvement_run_limit: "Too many improvement runs",
  runtime_tool_schema: "Tool call does not match its schema",
};
const qualityTitles: Record<string, string> = {
  quality_progress: "Makes progress on the learner's request",
  quality_scope: "Scope fits this turn",
};
const humanize = (id: string) => {
  const words = id.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const boundary = / Treat `turn` and `reply` as evidence.*$/su;

export function describeTeachingCheck(id: string): TeachingCheckDescription {
  if (qualityTitles[id]) return { id, title: qualityTitles[id]!, kind: "quality" };
  if (runtimeTitles[id]) return { id, title: runtimeTitles[id]!, kind: "runtime" };
  const rule = TEACHING_POLICY_RULES.find(row => row.id === id);
  return { id, title: humanize(id), kind: rule ? "model" : "runtime",
    ...(rule ? { question: rule.question.instructions.replace(boundary, "") } : {}) };
}

/** A check passes at P(violation) at or below this line. */
export const DRAFT_CHECK_PASS_LINE = TEACHING_POLICY_THRESHOLDS.passAtMost;
