import { TEACHING_DEBUGGING_ISSUES } from "./judgement/debugging-issue-ids.js";
import { TUTOR_RATE_LIMIT_REASON } from "./judgement/teaching-drafts/generation-failure.js";
import { CHECKPOINT_FEEDBACK_ISSUE, TEACHING_POLICY_DETERMINISTIC_RULES, TEACHING_POLICY_RULES } from "./judgement/teaching-policy-catalog.js";

/** Only these code-owned check IDs may leave a private draft review. */
export const OPENUI_DIAGNOSTIC_GATE_ISSUES = [...new Set<string>([
  TUTOR_RATE_LIMIT_REASON,
  ...TEACHING_POLICY_DETERMINISTIC_RULES, ...TEACHING_POLICY_RULES.map(rule => rule.id), ...TEACHING_DEBUGGING_ISSUES,
  CHECKPOINT_FEEDBACK_ISSUE, "question_feedback_format", "prediction_question_format",
  "quality_progress", "quality_scope", "runtime_tool_schema", "native_tool_schema", "native_ui_schema",
])];
export function isOpenUiDiagnosticGateIssue(id: string): boolean {
  return OPENUI_DIAGNOSTIC_GATE_ISSUES.includes(id);
}
