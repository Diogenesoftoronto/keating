#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_CALIBRATION_BYTES, fitJudgementCalibrationArtifact, readBoundedCalibrationJson, serializeJudgementCalibrationArtifact } from "../../src/judgement/calibration-artifact.js";

async function main() {
  const [inputPath, outputDirectory, extra] = process.argv.slice(2);
  if (!inputPath || !outputDirectory || extra) throw new Error("Usage: bun scripts/training/fit-judgement-calibration.ts input.json NEW-output-directory");
  const { value } = await readBoundedCalibrationJson(inputPath);
  const artifact = fitJudgementCalibrationArtifact(value);
  const serialized = serializeJudgementCalibrationArtifact(artifact);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CALIBRATION_BYTES) throw new Error("Calibration artifact exceeds size limit");
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  const report = ["# Judgement calibration", "", `Artifact file SHA256: ${sha256}`, "", `Fitted calibration SHA256: ${artifact.calibrationSha256}`, "",
    "Thresholds are fitted using only the fit split. The independent validation split accepts or rejects the frozen threshold; it never retunes it. Wilson 95% upper bounds apply to the action error rate, and additionally to the false positive rate for Noul. These are measured associations, not proof of learning effectiveness.", "",
    "Noul reliability compares P(yes) with observed yes/no labels. Choice/Score confidence is distribution concentration; selected-answer correctness labels support an empirical action threshold, not a claim that confidence is a calibrated probability. No Brier/ECE is reported for confidence.", "",
    "| Group | Metric | Status | Frozen fit threshold | Fit actions | Validation actions | Validation error upper | Brier | ECE |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...artifact.groups.map((group, i) => `| ${i + 1} | ${group.metricKind} | ${group.status} | ${group.threshold ?? "none"} | ${group.fit?.actions ?? 0} | ${group.validation?.actions ?? 0} | ${group.validation?.actionErrorUpper.toFixed(4) ?? "unknown"} | ${group.reliability?.brier.toFixed(4) ?? "not applicable"} | ${group.reliability?.ece.toFixed(4) ?? "not applicable"} |`), "",
    ...artifact.groups.flatMap((group, i) => [`## Group ${i + 1}`, "", `Fitted backend: ${JSON.stringify(group.backend)}`, "", `Original observed backend: ${JSON.stringify(group.sourceBackend)}`, "", "Exact question:", "", "```json", group.questionDigest, "```", ""]),
    "Input declarations must come from real independently observed labels. Schema validation cannot establish whether an operator truthfully labelled evidence. Split groups should reflect dependence (for example learner/cohort), not arbitrary row IDs. Repeatedly inspecting and refitting against the same validation split invalidates its independence; use new heldout groups for a changed fit policy.", ""].join("\n");
  const charts = artifact.groups.filter(group => group.reliability);
  const height = Math.max(1, charts.length) * 290;
  const plots = charts.map((group, i) => {
    const dots = group.reliability!.bins.filter(bin => bin.count > 0).map(bin => `<circle cx="${40 + bin.meanProbability! * 220}" cy="${250 - bin.observedFrequency! * 220}" r="5" fill="#2563eb"><title>n=${bin.count}; mean P(yes)=${bin.meanProbability!.toFixed(4)}; observed yes=${bin.observedFrequency!.toFixed(4)}</title></circle>`).join("");
    return `<g transform="translate(0,${i * 290})"><text x="40" y="18">Noul group ${artifact.groups.indexOf(group) + 1}: heldout reliability</text><path d="M40 30V250H260" fill="none" stroke="#111"/><path d="M40 250L260 30" stroke="#999" stroke-dasharray="4 4"/>${dots}<text x="40" y="270">0</text><text x="250" y="270">1</text><text x="275" y="250">P(yes)</text><text x="10" y="35">1</text><text x="10" y="250">0</text><text x="275" y="40">Observed yes frequency</text></g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="490" height="${height}" viewBox="0 0 490 ${height}" role="img" aria-label="Heldout Noul reliability plots"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="12" fill="#111">${plots || '<text x="20" y="40">No heldout Noul rows; no reliability plot available.</text>'}</g></svg>\n`;
  await mkdir(outputDirectory, { mode: 0o700 });
  for (const [name, content] of [["calibration.json", serialized], ["report.md", report], ["reliability.svg", svg]]) await writeFile(join(outputDirectory, name!), content!, { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ sha256, calibrationSha256: artifact.calibrationSha256, observations: artifact.input.observations.length, validatedThresholds: Object.keys(artifact.table.entries).length }) + "\n");
}

main().catch(error => { process.stderr.write((error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Judgement calibration failed; no existing output was overwritten") + "\n"); process.exitCode = 1; });
