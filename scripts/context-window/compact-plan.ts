#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, SUITE_VERSION, type Trial } from "./cases.js";
import { measureStateComposition } from "../../packages/learner-contracts/src/judgement/state-metrics.js";

interface FrozenPlan {
  version: string; createdAt: string; profile: string; selection: string; trials: Trial[];
  providers: unknown[]; repetitions: number; maxCalls: number; maxEstimatedInputTokens: number;
  excluded: { file: string; reason: string }[]; sha256: string;
}
export function compactDiagnosticPlan(original: FrozenPlan): FrozenPlan & { parentPlanSha256: string } {
  const { sha256, ...body } = original;
  if (original.version !== SUITE_VERSION || digest(body) !== sha256 || !Array.isArray(original.trials)
    || original.trials.some(row => row.requestSha256 !== digest(row.request))) throw Error("plan-integrity-failed");
  const selected = original.trials.filter(row => row.kind === "context" && row.caseId.startsWith("hard-") && row.family.startsWith("hard-"));
  if (![18, 50].includes(selected.length) || new Set(selected.map(x => x.caseId)).size !== selected.length
    || selected.some(x => x.path !== "full" || x.placement !== "pinned" || x.targetFill !== 0.25)
    || original.providers.length !== 3 || original.repetitions !== 1) throw Error("requires-frozen-18-or-50-question-three-provider-pilot");
  const trials = selected.map((source): Trial => {
    const row = structuredClone(source), request = row.request;
    const state = request.state as { turn?: Record<string, unknown> };
    if (!state?.turn || !Array.isArray(state.turn.conversation) || !Array.isArray(state.turn.learnerEvidence)) throw Error("missing-recorded-turn");
    state.turn.conversation = [];
    const measured = measureStateComposition(request, row.after.budgetTokens);
    const hash = digest(request);
    return { ...row, id: `${row.id}/compact`, request, requestSha256: hash, fullRequestSha256: hash,
      before: measured, after: measured, targetFill: measured.fillRatio ?? 0, turnsDropped: 0 };
  });
  const plannedTokens = trials.reduce((n, row) => n + row.after.estimatedRequestTokens, 0) * original.providers.length;
  const tokenCap = selected.length === 18 ? 150_000 : 400_000;
  if (plannedTokens > tokenCap) throw Error("compact-plan-exceeds-reservation");
  const result = { ...structuredClone(body), createdAt: new Date().toISOString(),
    profile: "compact-paired-diagnostic", parentPlanSha256: sha256,
    selection: `Post-hoc paired diagnostic, not a new holdout or the main run. Exactly the original ${selected.length} hard claims and all three unchanged provider configurations. Only distractor conversation is cleared; pinned records, learner message, questions and labels are unchanged. No selection by provider outcome. Compare against the parent plan within the same families.`,
    trials, maxCalls: selected.length * original.providers.length, maxEstimatedInputTokens: tokenCap };
  return { ...result, sha256: digest(result) };
}
export async function writeCompactDiagnosticPlan(planPath: string, outputDirectory: string): Promise<string> {
  const original = JSON.parse(await readFile(planPath, "utf8")) as FrozenPlan;
  const plan = compactDiagnosticPlan(original);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const output = resolve(outputDirectory, "plan.json");
  await writeFile(output, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return output;
}
if (import.meta.main) {
  const [planPath, outputDirectory] = process.argv.slice(2);
  if (!planPath || !outputDirectory || process.argv.length !== 4) throw Error("Usage: bun compact-plan.ts ORIGINAL_PLAN OUTPUT_DIRECTORY");
  const path = await writeCompactDiagnosticPlan(planPath, outputDirectory);
  const output = JSON.parse(await readFile(path, "utf8")) as FrozenPlan;
  console.log(JSON.stringify({ plan: path, diagnostic: "post-hoc paired compact context", maxCalls: output.maxCalls, maxEstimatedInputTokens: output.maxEstimatedInputTokens }));
}
