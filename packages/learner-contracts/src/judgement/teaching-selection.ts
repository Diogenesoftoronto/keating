import type { TeachingDraftSnapshot } from "./teaching-drafts.js";

export const TEACHING_DRAFT_SELECTION_RULES = ["none", "requested-prediction-over-prose", "presentation-only-checkpoint-retained"] as const;
export type TeachingDraftSelectionRule = typeof TEACHING_DRAFT_SELECTION_RULES[number];
export interface TeachingDraftSelection {
  /** One-based attempt within the final draft session, including on a multi-round turn. */
  attempt: number;
  review: "verified" | "best-effort";
  /** Absent when the receipt predates branch instrumentation. */
  rule?: TeachingDraftSelectionRule;
}

export function isTeachingDraftSelection(value: unknown): value is TeachingDraftSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every(key => ["attempt", "review", "rule"].includes(key))
    && typeof item.attempt === "number" && Number.isInteger(item.attempt) && item.attempt >= 1 && item.attempt <= 10
    && (item.review === "verified" || item.review === "best-effort")
    && (item.rule === undefined || item.rule === "none"
      || (item.review === "verified" && item.rule === "requested-prediction-over-prose")
      || (item.review === "best-effort" && item.rule === "presentation-only-checkpoint-retained"));
}

/** Only an actual release and its matching review identify the selected attempt. */
export function projectTeachingDraftSelection(snapshot: Pick<TeachingDraftSnapshot, "phase" | "selectedAttempt" | "reason" | "attempts" | "selectionRule">): TeachingDraftSelection | undefined {
  if (snapshot.phase !== "released" || snapshot.selectedAttempt === null) return;
  const attempt = snapshot.attempts.find(item => item.attempt === snapshot.selectedAttempt);
  if (!attempt || attempt.status === "generation-error") return;
  const bestEffort = snapshot.reason === "best-effort-draft";
  if (!bestEffort && attempt.status !== "pass") return;
  const selected: TeachingDraftSelection = { attempt: attempt.attempt, review: bestEffort ? "best-effort" : "verified" };
  if (!isTeachingDraftSelection(selected)) return;
  if (snapshot.selectionRule && isTeachingDraftSelection({ ...selected, rule: snapshot.selectionRule })) selected.rule = snapshot.selectionRule;
  return selected;
}
