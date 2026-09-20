/** Account-backed CLI review proposals. Never promotes an uncalibrated proposal into a final grade. */
import {
  gradeOpenResponses, proposeOpenResponses,
  type OpenResponseGradeInput, type OpenResponseGradeResult, type OpenResponseProposal,
} from "../../packages/learner-contracts/src/judgement/assessment.js";
import type { JudgementOutcome } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { createCliJudgementBackend, JUDGEMENT_MODEL_ENV, type CliJudgementOptions } from "./transport.js";

export const GRADING_JUDGE_ENV = "KEATING_GRADING_JUDGE";
export interface CliGradingOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly transport?: Pick<CliJudgementOptions, "fetch" | "loadCredential" | "now" | "retry" | "sleep">;
}
export function cliGradingEnabled(options: CliGradingOptions = {}): boolean {
  const mode = (options.env ?? process.env)[GRADING_JUDGE_ENV]?.trim() || "legacy";
  if (mode !== "legacy" && mode !== "notorganic") throw new Error("grading_judgement_invalid_mode");
  return mode === "notorganic";
}
export interface CliGradingReceipt {
  readonly schemaVersion: 1;
  readonly source: "proxy";
  readonly calibration: "uncalibrated";
  readonly grades: readonly OpenResponseGradeResult[];
  readonly proposals: readonly { id: string; proposal: OpenResponseProposal | null }[];
  readonly observations: readonly { id: string; outcome: JudgementOutcome }[];
  readonly status: "deterministic" | "review-required" | "backend-unavailable";
}

export async function reviewCliOpenResponses(
  cwd: string, inputs: readonly OpenResponseGradeInput[], options: CliGradingOptions = {}, signal?: AbortSignal,
): Promise<CliGradingReceipt> {
  // Reuse the shared exact/blank tier, with no synthetic calibration entries.
  const grades = await gradeOpenResponses(inputs, { tiers: [], calibration: { entries: {} } }, signal);
  const pending = inputs.filter((input) => grades.find((grade) => grade.id === input.id)?.grading === "pending");
  const observations: Array<{ id: string; outcome: JudgementOutcome }> = [];
  const base = { schemaVersion: 1 as const, source: "proxy" as const, calibration: "uncalibrated" as const, grades, observations };
  if (!pending.length) return { ...base, proposals: [], status: "deterministic" };
  if (!cliGradingEnabled(options)) return { ...base, proposals: [], status: "backend-unavailable" };
  const env = options.env ?? process.env;
  // Sharing transport/config with CLI evolution does not inherit direct-provider overrides.
  const backend = createCliJudgementBackend({ ...options.transport, cwd, env: { [JUDGEMENT_MODEL_ENV]: env[JUDGEMENT_MODEL_ENV] } });
  if (!backend) return { ...base, proposals: [], status: "backend-unavailable" };
  const proposals: Array<{ id: string; proposal: OpenResponseProposal | null }> = [];
  for (const input of pending) {
    proposals.push(...await proposeOpenResponses([input], async (request, abort) => {
      let outcome: JudgementOutcome;
      try { outcome = await backend.call(request, abort); }
      catch { outcome = { ok: false, error: { code: "backend-unavailable", retryable: false } }; }
      observations.push({ id: input.id, outcome });
      return outcome;
    }, signal));
  }
  return { ...base, proposals, status: "review-required" };
}
