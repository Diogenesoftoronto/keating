#!/usr/bin/env bun
/** Offline target-specific fitting; never writes application state or changes installed policies. */
import { mkdir, mkdtemp, open, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDecisionPolicyDataset, readDecisionPolicySource, decisionPolicySha256 } from "../../src/judgement/decision-policy-dataset.js";
import { DECISION_POLICY_TARGETS, type DecisionPolicyTarget } from "../../packages/learner-contracts/src/judgement/decision-policy-data.js";
import { fitDecisionPolicy, serializeDecisionPolicyFit, decisionPolicyCanonical,
  type DecisionPolicyFitArtifact, type DecisionPolicyTrainingDataset } from "../../packages/learner-contracts/src/judgement/decision-policy-fit.js";
import { validateBoostingDataset } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";
import { trainQuizEnsemble } from "./fit-quiz-performance.js";

export async function trainDecisionPolicyEnsemble(dataset: DecisionPolicyTrainingDataset): Promise<unknown> {
  const { labelKind, ...binary } = dataset;
  if (labelKind === "observed-binary") return trainQuizEnsemble(validateBoostingDataset(binary));
  const directory = await mkdtemp(join(tmpdir(), "keating-soft-policy-fit-"));
  try {
    const input = join(directory, "dataset.json"), output = join(directory, "model.json");
    await writeFile(input, decisionPolicyCanonical(dataset), { flag: "wx", mode: 0o600 });
    const child = Bun.spawn(["uv", "run", "--no-project", "--python", "3.13", "--with", "catboost==1.2.10", "--with", "numpy", "python",
      join(import.meta.dir, "decision_policy_model.py"), input, output], { stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new Error("decision_policy_trainer_failed");
    return JSON.parse((await readDecisionPolicySource(output, 5_000_000)).text);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function exportDecisionPolicyFit(cwd: string, manifest: unknown, target: DecisionPolicyTarget, directory: string,
  options: { shallowOnly?: boolean; train?: (dataset: DecisionPolicyTrainingDataset) => Promise<unknown> } = {}) {
  if (!DECISION_POLICY_TARGETS.includes(target)) throw new Error("decision_policy_fit_invalid");
  // Existing output is refused before training; every file is private and exclusively created.
  await mkdir(directory, { mode: 0o700 });
  const before = await buildDecisionPolicyDataset(cwd, manifest);
  const artifact = await fitDecisionPolicy(before.binding, target, async text => decisionPolicySha256(text),
    options.shallowOnly ? {} : { train: options.train ?? trainDecisionPolicyEnsemble });
  const after = await buildDecisionPolicyDataset(cwd, before.manifest);
  if (after.bindingSha256 !== before.bindingSha256) throw new Error("decision_policy_fit_source_changed");
  const contents = serializeDecisionPolicyFit(artifact);
  const write = async (name: string, text: string) => {
    const handle = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  };
  await write("decision-policy.json", contents);
  await write("report.md", report(artifact));
  const handle = await open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
  return { target, selected: artifact.selected, status: artifact.status, fitSha256: artifact.fitSha256,
    fileSha256: decisionPolicySha256(contents), rows: artifact.dataset.rows.length,
    shallow: artifact.shallow.metrics, boosting: artifact.boosting?.evaluation.metrics ?? null };
}
function report(artifact: DecisionPolicyFitArtifact): string {
  const metrics = artifact.selected === "boosting" ? artifact.boosting!.evaluation.metrics : artifact.shallow.metrics;
  return `# ${artifact.target} policy fit\n\nStatus: ${artifact.status}. Selected: ${artifact.selected ?? "none; retain incumbent"}.\n\n`
    + `Target: ${artifact.domain}. Feature schema: ${artifact.featureSchema}. Label kind: ${artifact.dataset.labelKind}.\n\n`
    + `The fixed depth-3, minimum-leaf-8 tree is trained on fit groups only. A pinned CatBoost 1.2.10 ensemble is attempted only after the tree passes the independent validation gate. It replaces the tree only when it further reduces the same target loss.\n\n`
    + `Validation metric: ${metrics.metric}; independent-group mean candidate loss ${metrics.candidateLoss ?? "unknown"}, incumbent loss ${metrics.baselineLoss ?? "unknown"}. Comparable groups: ${metrics.comparableGroups}; matched ranking pairs: ${metrics.comparablePairs}.\n\n`
    + (artifact.target === "urgency" ? `The incumbent loss above is the mobile ordering; web ordering loss is ${metrics.webBaselineLoss ?? "unknown"}. Activation requires strictly beating both surface comparators.\n\n` : "")
    + `## Source provenance\n\nOrigins: ${[...new Set(artifact.source.sources.map(source => source.provenance.origin))].join(", ")}. `
    + `Datasets: ${[...new Set(artifact.source.sources.map(source => source.provenance.dataset))].join(", ")}. `
    + `Schedule provenance: ${[...new Set(artifact.source.sources.map(source => source.provenance.schedule))].join(", ")}.\n\n`
    + (artifact.dataset.labelKind === "judgement-probability"
      ? `This run measures agreement with saved target-specific model judgements. Each source retains its grounding packet, exact request, response, model, rubric and explicit simulated or trajectory-derived state. The probabilities are teacher estimates, not recorded learner outcomes.\n\n`
      : `This run uses recorded binary question or card-review outcomes from portable exports. Source hashes establish byte consistency; collection and independence declarations remain the source provider's responsibility.\n\n`)
    + `## Source verifier reconstruction rules\n\nThe shared verifier supports both observed-export and synthetic-judgement paths. The observed-path rules below describe observed exports where applicable; they do not relabel this run's ${artifact.dataset.labelKind} targets.\n\n${artifact.source.reconstruction.map(line => `- ${line}`).join("\n")}\n\n`
    + `These validation groups also select between the two fixed candidates; they are not a second untouched estimate of the selected model's generalization. Judgement probabilities remain soft targets: CrossEntropy trains agreement with those probabilities, without inventing binary learner outcomes. No human learning effect or causal review benefit is established. Raw source exports are embedded and may contain private learner data.\n\n`
    + `Fit identity: \`${artifact.fitSha256}\`. Installation additionally requires the exact file SHA-256 printed by this command.\n`;
}
async function main() {
  const [manifestPath, target, directory, option, extra] = process.argv.slice(2);
  if (!manifestPath || !DECISION_POLICY_TARGETS.includes(target as DecisionPolicyTarget) || !directory || extra || option && option !== "--shallow-only") {
    throw new Error("Usage: bun scripts/training/fit-decision-policy.ts manifest.json mastery|retention|urgency NEW-output-directory [--shallow-only]");
  }
  const manifest = JSON.parse((await readDecisionPolicySource(manifestPath, 1_000_000)).text);
  const result = await exportDecisionPolicyFit(process.cwd(), manifest, target as DecisionPolicyTarget, directory, { shallowOnly: option === "--shallow-only" });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.selected) process.exitCode = 1;
}
if (import.meta.main) main().catch(error => {
  process.stderr.write(`${error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Decision policy fit failed; no existing output was overwritten"}\n`);
  process.exitCode = 1;
});
