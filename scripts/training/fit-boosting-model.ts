#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_BOOSTING_BYTES, fitBoostingArtifact, readBoundedBoostingJson, serializeBoostingArtifact } from "../../src/judgement/boosting-artifact.js";
import { serializeBoostingDataset, validateBoostingDataset, type BoostingArtifact, type BoostingDataset } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";

// Pinned so the frozen fixture and a fresh fit describe the same trainer binary.
const DEFAULT_TRAINER = ["uv", "run", "--no-project", "--python", "3.13", "--with", "catboost==1.2.10", "--with", "numpy", "python"];
const TRAINER_SCRIPT = join(import.meta.dir, "boosting_model.py");
const TRAINER_FAILURE = "The CatBoost trainer failed; its output is withheld because it can echo dataset rows";

function usage(): never {
  throw new Error("Usage: bun scripts/training/fit-boosting-model.ts dataset.json NEW-output-directory [trainer-python]");
}

function spawnTrainer(command: readonly string[]) {
  try {
    return Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error(TRAINER_FAILURE);
  }
}

/** The dataset handoff is the only text the trainer receives; labels never travel back. */
export async function trainDataset(dataset: BoostingDataset, trainer: readonly string[] = DEFAULT_TRAINER): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "keating-boosting-"));
  try {
    const datasetPath = join(directory, "dataset.json");
    const exportPath = join(directory, "export.json");
    await writeFile(datasetPath, serializeBoostingDataset(dataset), { mode: 0o600 });
    const child = spawnTrainer([...trainer, TRAINER_SCRIPT, datasetPath, exportPath]);
    const [exitCode] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(TRAINER_FAILURE);
    const { value } = await readBoundedBoostingJson(exportPath);
    return value;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function composeBoostingArtifact(dataset: unknown, exported: unknown): { artifact: BoostingArtifact; serialized: string; sha256: string } {
  if (exported === null || typeof exported !== "object" || Array.isArray(exported)) throw new Error("Invalid boosting artifact");
  const { framework, model } = exported as { framework?: unknown; model?: unknown };
  const validated = validateBoostingDataset(dataset);
  const artifact = fitBoostingArtifact({ ...validated, framework, model });
  const serialized = serializeBoostingArtifact(artifact);
  if (Buffer.byteLength(serialized, "utf8") > MAX_BOOSTING_BYTES) throw new Error("Boosting artifact exceeds the size limit; the embedded evidence must fit the configured budget");
  return { artifact, serialized, sha256: createHash("sha256").update(serialized).digest("hex") };
}

function report(artifact: BoostingArtifact, sha256: string): string {
  const { dataset, framework } = artifact.input;
  return ["# Boosting artifact", "", `Artifact file SHA256: ${sha256}`, "", `Fitted boosting SHA256: ${artifact.boostingSha256}`, "", `Status: ${artifact.status}`, "",
    "The status is derived from the stored rows: an artifact is insufficient when either split has fewer rows or independent groups than the declared policy allows, and failed-validation when it loses to the incumbent constants or exceeds the declared ECE ceiling. Only a validated artifact may reorder work.", "",
    "Every metric below was recomputed from the embedded rows in the portable contract, not reported by the trainer. The trainer supplied the ensemble and nothing else.", "",
    `Trainer: catboost ${framework.version}`, "", `Parameters: ${JSON.stringify(framework.parameters)}`, "",
    `Rows: ${dataset.rowCount} (${dataset.positives} positive), groups: ${dataset.groupCount}, fit: ${dataset.fitRows} rows / ${dataset.fitGroups} groups, validation: ${dataset.validationRows} rows / ${dataset.validationGroups} groups`, "",
    "| Metric | Validation |", "| --- | --- |", `| Brier | ${artifact.metrics.brier.toFixed(4)} |`, `| Log loss | ${artifact.metrics.logLoss.toFixed(4)} |`,
    `| ECE | ${artifact.metrics.ece.toFixed(4)} |`, `| AUC | ${artifact.metrics.auc === null ? "not applicable" : artifact.metrics.auc.toFixed(4)} |`,
    `| Incumbent Brier | ${artifact.metrics.baselineBrier === null ? "no incumbent number supplied" : artifact.metrics.baselineBrier.toFixed(4)} |`,
    `| Beats incumbent | ${artifact.metrics.beatsBaseline === null ? "unknown" : artifact.metrics.beatsBaseline} |`, "",
    "| Bin | Count | Mean probability | Observed frequency |", "| --- | --- | --- | --- |",
    ...artifact.reliability.map(bin => `| ${bin.lower.toFixed(1)}-${bin.upper.toFixed(1)} | ${bin.count} | ${bin.meanProbability?.toFixed(4) ?? "none"} | ${bin.observedFrequency?.toFixed(4) ?? "none"} |`), "",
    "The embedded rows are the exact evidence for these numbers, so a holder of the artifact can rebuild them. A validated status is a measured association on held-out groups, not proof of learning, and it does not make any evolution candidate eligible for promotion. A fitted identity belongs to one dataset: never share these thresholds or this ensemble across surfaces, backends or refreshed rows.", ""].join("\n");
}

function reliabilityChart(artifact: BoostingArtifact): string {
  const dots = artifact.reliability.filter(bin => bin.count > 0)
    .map(bin => `<circle cx="${40 + bin.meanProbability! * 220}" cy="${250 - bin.observedFrequency! * 220}" r="5" fill="#2563eb"><title>n=${bin.count}; mean P=${bin.meanProbability!.toFixed(4)}; observed=${bin.observedFrequency!.toFixed(4)}</title></circle>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="490" height="290" viewBox="0 0 490 290" role="img" aria-label="Held-out boosting reliability plot"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="12" fill="#111"><text x="40" y="18">Held-out reliability (${artifact.status})</text><path d="M40 30V250H260" fill="none" stroke="#111"/><path d="M40 250L260 30" stroke="#999" stroke-dasharray="4 4"/>${dots}<text x="40" y="270">0</text><text x="250" y="270">1</text><text x="275" y="250">Predicted</text><text x="10" y="35">1</text><text x="10" y="250">0</text><text x="275" y="40">Observed frequency</text></g></svg>\n`;
}

async function main() {
  const [inputPath, outputDirectory, trainerPython, extra] = process.argv.slice(2);
  if (!inputPath || !outputDirectory || extra) usage();
  const { value } = await readBoundedBoostingJson(inputPath);
  const dataset = validateBoostingDataset(value);
  const trainer = trainerPython ? [trainerPython] : DEFAULT_TRAINER;
  const exported = await trainDataset(dataset, trainer);
  const { artifact, serialized, sha256 } = composeBoostingArtifact(dataset, exported);
  await mkdir(outputDirectory, { mode: 0o700 });
  for (const [name, content] of [["boosting-artifact.json", serialized], ["report.md", report(artifact, sha256)], ["reliability.svg", reliabilityChart(artifact)]]) {
    await writeFile(join(outputDirectory, name), content, { mode: 0o600, flag: "wx" });
  }
  process.stdout.write(JSON.stringify({ sha256, boostingSha256: artifact.boostingSha256, status: artifact.status, rows: artifact.input.dataset.rowCount, groups: artifact.input.dataset.groupCount }) + "\n");
  if (artifact.status === "insufficient") {
    process.stderr.write("No usable model: the dataset does not meet the declared independent-row and group minimums\n");
    process.exitCode = 1;
  }
}

if (import.meta.main) main().catch(error => { process.stderr.write((error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Boosting fit failed; no existing output was overwritten") + "\n"); process.exitCode = 1; });