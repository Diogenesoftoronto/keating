#!/usr/bin/env bun
/** Offline, inspectable source map for every question; no inference or credentials. */
import { TEACHING_INTERACTION_FEATURES, TEACHING_PLAN_REVIEW_QUESTIONS, TEACHING_POLICY_DECISIONS, TEACHING_POLICY_RULES, TEACHING_POLICY_DETERMINISTIC_RULES, TEACHING_POLICY_THRESHOLDS, TEACHING_POLICY_VERSION } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";

export function describeTeachingPolicy(): string {
  const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const question = (text: string): string => text.split(" Treat `turn` and `reply`")[0]!;
  return [
    `# ${TEACHING_POLICY_VERSION}`, "",
    `${TEACHING_POLICY_DECISIONS.length} independent input judgments, ${TEACHING_POLICY_RULES.length} reply checks, and ${TEACHING_POLICY_DETERMINISTIC_RULES.length} deterministic checks.`, "",
    "Input judgments share one request; output checks share a second request after the tutor replies. No question can read another answer. Each output probability means the named violation is present. Code combines the answers; any violation fails the reply, and unresolved checks keep the result unknown.", "",
    `Experimental thresholds: pass at or below ${TEACHING_POLICY_THRESHOLDS.passAtMost}; fail at or above ${TEACHING_POLICY_THRESHOLDS.failAtLeast}; otherwise unknown. These are authored, uncalibrated cutoffs.`, "",
    "## Input decisions", "", "| ID | Question | Code-selected instruction | Source |", "| --- | --- | --- | --- |",
    ...TEACHING_POLICY_DECISIONS.map((entry) => `| ${entry.id} | ${cell(question(entry.question.instructions))} | ${cell(entry.directive)} | ${entry.source} |`), "",
    "## Interaction features", "", "Properties of the material, asked in the same input request. Code maps true features to OpenUI components (`interaction-affordances.ts`); the judge never sees component names.", "",
    "| ID | Question | Purpose | Source |", "| --- | --- | --- | --- |",
    ...TEACHING_INTERACTION_FEATURES.map((entry) => `| ${entry.id} | ${cell(question(entry.question.instructions))} | ${cell(entry.purpose)} | ${entry.source} |`), "",
    "## Plan review questions", "", "Asked in the same input request only when the learner has a plan with a current focus. Code reads the answers only when a plan review is triggered (a graded attempt, a stalled item, a pacing request or a new goal) and turns them into one proposal; the learner decides, and nothing changes the plan automatically (`plan-review.ts`).", "",
    "| ID | Question |", "| --- | --- |",
    ...TEACHING_PLAN_REVIEW_QUESTIONS.map((entry) => `| ${entry.id} | ${cell(question(entry.question.instructions))} |`), "",
    "## Reply checks", "", "| ID | One violation to check | Severity | Source |", "| --- | --- | --- | --- |",
    ...TEACHING_POLICY_RULES.map((entry) => `| ${entry.id} | ${cell(question(entry.question.instructions))} | ${entry.severity}${entry.global ? "; always checked" : ""} | ${entry.source} |`), "",
    "## Code checks", "", ...TEACHING_POLICY_DETERMINISTIC_RULES.map((id) => `- ${id}`), "",
    "The host still owns tool argument validation, authorization, account authority, grading evidence IDs, workspace transactions/rollback, and independent teaching-revision activation gates. A Jev answer does not replace any of these.", "",
  ].join("\n");
}

if (import.meta.main) console.log(describeTeachingPolicy());
