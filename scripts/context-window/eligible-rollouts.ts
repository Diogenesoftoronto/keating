import type { BenchmarkCase } from "./cases.js";
import type { JudgementQuestion } from "../../packages/learner-contracts/src/judgement/contracts.js";

export const SAVED_GATE_PROTOCOL = "keating-saved-gates/v2" as const;
const PARSE_GATES = ["one_activity", "activity_without_plan", "one_checkpoint", "checkpoint_last_node", "stop_after_checkpoint"] as const;
const PARSED_FACT = "Host observation: All marked UI blocks in every candidate in this case passed the host's shared UI parser. Treat their syntax as valid. This observation does not establish whether the candidate passes the stated behavioral gate or has good teaching quality.";
export interface RolloutDiagnostic { case: BenchmarkCase; reason: "full-schema-not-supplied" | "parse-validity-not-established" }

/** Future-protocol projection only. Frozen input cases, labels and raw receipt hashes remain untouched. */
export function eligibleRolloutCases(input: readonly BenchmarkCase[]): { cases: BenchmarkCase[]; diagnostics: RolloutDiagnostic[]; protocol: typeof SAVED_GATE_PROTOCOL } {
  const cases: BenchmarkCase[] = [], diagnostics: RolloutDiagnostic[] = [];
  const parsed = new Map<string, BenchmarkCase>();
  for (const row of input) if (row.kind === "rollout" && row.labelSource === "deterministic-gate" && row.id.endsWith("-openui_valid")) parsed.set(row.id.slice(0, -"-openui_valid".length), row);
  for (const row of input) {
    if (row.kind !== "rollout" || row.labelSource !== "deterministic-gate") { cases.push(row); continue; }
    if (row.id.endsWith("-openui_valid")) { diagnostics.push({ case: row, reason: "full-schema-not-supplied" }); continue; }
    const gate = PARSE_GATES.find(name => row.id.endsWith(`-${name}`));
    if (!gate) { cases.push(row); continue; }
    // The importer omits unknown parse-dependent outcomes. Verify its proof here:
    // each included candidate must have an independently computed openui_valid pass.
    const proof = parsed.get(row.id.slice(0, -gate.length - 1));
    const ids = Object.keys(row.request.questions);
    if (!proof || !ids.length || ids.some(id => proof.expected[id] !== false)) {
      diagnostics.push({ case: row, reason: "parse-validity-not-established" }); continue;
    }
    const cloned = structuredClone(row);
    const questions: Record<string, JudgementQuestion> = {};
    for (const [id, question] of Object.entries(cloned.request.questions)) questions[id] = { ...question, instructions: `${PARSED_FACT}\n\n${question.instructions}` };
    cases.push({ ...cloned, id: `${cloned.id}/parsed-valid-v2`, request: { ...cloned.request, questions } });
  }
  return { cases, diagnostics, protocol: SAVED_GATE_PROTOCOL };
}
