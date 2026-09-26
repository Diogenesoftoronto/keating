#!/usr/bin/env bun
/** Fixed 0.5 diagnostic only; never fit thresholds to these benchmark labels. */
import { readFile, writeFile } from "node:fs/promises";
import { digest } from "./cases.js";
import { completeSchedule, summarize, type Receipt } from "./benchmark.js";

const [planPath, tapePath, output] = process.argv.slice(2);
if (!planPath || !tapePath || !output) throw Error("requires plan tape output");
const plan = JSON.parse(await readFile(planPath, "utf8"));
const { sha256, ...body } = plan;
if (sha256 !== digest(body)) throw Error("plan-integrity-failed");
const saved: Receipt[] = (await readFile(tapePath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const rows = completeSchedule(plan.trials, plan.providers, plan.repetitions, saved);
const forced = structuredClone(rows);
for (const row of forced) if (row.outcome.status === "ok") {
  for (const answer of Object.values(row.outcome.answers)) {
    if (answer.probabilities && Object.keys(answer.probabilities).length === 2 && Object.hasOwn(answer.probabilities, "true") && Object.hasOwn(answer.probabilities, "false")) {
      answer.value = answer.probabilities.true! > 0.5;
    }
  }
}
const result = { parentPlanSha256: sha256, policy: "Fixed diagnostic: false at p<=0.5, true at p>0.5. No threshold fitting; raw hard-label references and non-boolean answers unchanged. Errors stay in denominator.",
  production: summarize(plan.trials, rows), fixedCutoff: summarize(plan.trials, forced),
  productionByStage: Object.fromEntries(["planning", "adherence", "grading"].map(stage => [stage, summarize(plan.trials.filter((t: any) => t.stage === stage), rows.filter(r => plan.trials.find((t: any) => t.id === r.trialId)?.stage === stage))])),
  fixedCutoffByStage: Object.fromEntries(["planning", "adherence", "grading"].map(stage => [stage, summarize(plan.trials.filter((t: any) => t.stage === stage), forced.filter(r => plan.trials.find((t: any) => t.id === r.trialId)?.stage === stage))])),
};
await writeFile(output, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output, receipts: rows.length, modelCalls: 0 }));
