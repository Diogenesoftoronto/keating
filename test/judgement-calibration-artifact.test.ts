import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitJudgementCalibrationArtifact, loadJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact, type CalibrationInput } from "../src/judgement/calibration-artifact.js";
import { verifyJudgementCalibrationText, prepareJudgementCalibrationArtifact } from "../packages/learner-contracts/src/judgement/calibration-artifact.js";
import { questionDigest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { resolveThresholds } from "../packages/learner-contracts/src/judgement/projections.js";

// Synthetic test fixtures exercise the observed-input schema; these are not production evidence/artifacts.
function fixture(): CalibrationInput {
  return { schemaVersion: 1, policy: { maxActionErrorRate: 0.1, maxFalsePositiveRate: 0.1, minSamples: 80, minActions: 40, minNegatives: 40 }, observations:
    (["fit", "validation"] as const).flatMap(split => Array.from({ length: 120 }, (_, i) => ({ observationId: `${split}-${i}`, sourceId: `source-${split}-${i}`, groupId: `${split}-independent-unit-${i}`, split, evidence: "observed" as const,
      backend: { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: "a".repeat(64) }, question: { type: "noul" as const, instructions: "Does demonstrated work meet prerequisites?" }, metricKind: "noul-probability" as const, value: i < 60 ? 0.1 : 0.9, label: i < 60 ? 0 as const : 1 as const }))) };
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

describe("observed judgement calibration", () => {
  test("multiline question instructions and criteria retain exact identity without allowing control characters in IDs", () => {
    const input = fixture();
    for (const row of input.observations) row.question = { type: "noul", instructions: "Use supplied work.\nDoes it meet prerequisites?", criteria: { true: "Demonstrates\nall prerequisites.", false: "Shows a gap.\nDo not guess." } };
    const artifact = fitJudgementCalibrationArtifact(input);
    expect(artifact.groups[0]!.status).toBe("validated");
    expect(artifact.groups[0]!.questionDigest).toBe(questionDigest(input.observations[0]!.question));
    expect(JSON.parse(serializeJudgementCalibrationArtifact(artifact)).input.observations[0].question).toEqual(input.observations[0]!.question);
    input.observations[0]!.sourceId = "invalid\nsource";
    expect(() => fitJudgementCalibrationArtifact(input)).toThrow("Invalid judgement calibration artifact");
  });
  test("fits only fit data, validates independent holdout, reports Noul reliability, and pins exact backend/question", () => {
    const input = fixture(), artifact = fitJudgementCalibrationArtifact(input), first = input.observations[0]!;
    const fittedBackend = { ...first.backend, calibrationSha256: artifact.calibrationSha256 };
    expect(artifact.groups[0]!.threshold).toBe(0.9);
    expect(artifact.groups[0]!.status).toBe("validated");
    expect(artifact.groups[0]!.reliability!.brier).toBeCloseTo(0.01);
    expect(artifact.groups[0]!.reliability!.ece).toBeCloseTo(0.1);
    expect(resolveThresholds(artifact.table, fittedBackend, questionDigest(first.question))?.actAtOrAbove).toBe(0.9);
    expect(resolveThresholds(artifact.table, first.backend, questionDigest(first.question))).toBeNull();
    expect(resolveThresholds(artifact.table, { ...fittedBackend, model: "jev-1.14.0" }, questionDigest(first.question))).toBeNull();
    expect(resolveThresholds(artifact.table, { ...first.backend, calibrationSha256: "b".repeat(64) }, questionDigest(first.question))).toBeNull();
    expect(resolveThresholds(artifact.table, fittedBackend, questionDigest({ ...first.question, instructions: "Edited" }))).toBeNull();
    input.observations[0]!.value = 0.5;
    expect(artifact.input.observations[0]!.value).toBe(0.1);
  });
  test("failed holdout emits no action threshold and never raises the fitted threshold to rescue it", () => {
    const input = fixture();
    for (const row of input.observations) if (row.split === "validation" && row.value === 0.9) { row.label = 0; row.value = 0.95; }
    const result = fitJudgementCalibrationArtifact(input);
    expect(result.groups[0]!.threshold).toBe(0.9);
    expect(result.groups[0]!.status).toBe("failed-validation");
    expect(result.table.entries).toEqual({});
  });
  test("empty, insufficient and one-class Noul observations abstain", () => {
    const input = fixture(); input.observations = [];
    expect(fitJudgementCalibrationArtifact(input).table.entries).toEqual({});
    input.observations = fixture().observations.slice(0, 10);
    expect(fitJudgementCalibrationArtifact(input).groups[0]!.status).toBe("insufficient-fit");
    input.observations = fixture().observations.filter(row => row.label === 1);
    expect(fitJudgementCalibrationArtifact(input).table.entries).toEqual({});
  });
  test("rejects overlapping split groups, repeated evidence, malformed questions, proxy rows, aliases and nonfinite numbers", () => {
    const mutations: ((input: any) => void)[] = [
      input => input.observations[120].groupId = input.observations[0].groupId,
      input => input.observations[1].groupId = input.observations[0].groupId,
      input => input.observations[120].sourceId = input.observations[0].sourceId,
      input => input.observations[120].observationId = input.observations[0].observationId,
      input => input.observations[0].evidence = "proxy",
      input => input.observations[0].backend.backend = "fixture",
      input => input.observations[0].backend.model = "jev-latest",
      input => input.observations[0].backend.calibrationSha256 = "invalid",
      input => input.observations[0].backend.calibrationSha256 = "b".repeat(64),
      input => input.observations[0].value = NaN,
      input => input.observations[0].question.criteria = { true: "yes" },
      input => input.observations[0].metricKind = "choice-confidence",
      input => input.policy.minActions = 1,
      input => input.observations[0].invented = "extra",
    ];
    for (const mutate of mutations) { const input = fixture(); mutate(input); expect(() => fitJudgementCalibrationArtifact(input)).toThrow("Invalid judgement calibration artifact"); }
  });
  test("confidence requires correctness labels and sufficient actions but is never reported as Noul probability calibration", () => {
    const input = fixture();
    for (const row of input.observations) { row.question = { type: "choice", instructions: "Select the supported next activity", criteria: { a: null, b: null } }; row.metricKind = "choice-confidence"; row.label = 1; row.value = 0.9; }
    const result = fitJudgementCalibrationArtifact(input);
    expect(result.groups[0]!.status).toBe("validated");
    expect(result.groups[0]!.reliability).toBeNull();
    for (const row of input.observations) if (row.split === "validation") row.label = 0;
    expect(fitJudgementCalibrationArtifact(input).table.entries).toEqual({});
  });
  test("loader pins exact bytes and recomputes metrics even when a tampered file is repinned", async () => {
    const dir = await mkdtemp(join(tmpdir(), "judgement-calibration-")), path = join(dir, "artifact.json");
    const artifact = fitJudgementCalibrationArtifact(fixture()), serialized = serializeJudgementCalibrationArtifact(artifact);
    await writeFile(path, serialized, { mode: 0o600 });
    expect((await loadJudgementCalibrationArtifact(path, hash(serialized))).table).toEqual(artifact.table);
    await expect(loadJudgementCalibrationArtifact(path, "f".repeat(64))).rejects.toThrow("Invalid judgement calibration artifact");
    artifact.groups[0]!.reliability!.brier = 0;
    const altered = serializeJudgementCalibrationArtifact(artifact); await writeFile(path, altered);
    await expect(loadJudgementCalibrationArtifact(path, hash(altered))).rejects.toThrow("Invalid judgement calibration artifact");
    await writeFile(path, "x".repeat(5 * 1024 * 1024 + 1));
    await expect(loadJudgementCalibrationArtifact(path, hash(""))).rejects.toThrow("Invalid judgement calibration artifact");
  });
  test("bootstraps from authentic null calibration provenance and derives a new identity for each dataset or policy", async () => {
    const input = fixture();
    for (const row of input.observations) row.backend.calibrationSha256 = null;
    const artifact = fitJudgementCalibrationArtifact(input);
    expect(artifact.calibrationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.groups[0]!.sourceBackend.calibrationSha256).toBeNull();
    expect(artifact.input.observations.every(row => row.backend.calibrationSha256 === null)).toBe(true);
    expect(artifact.groups[0]!.backend.calibrationSha256).toBe(artifact.calibrationSha256);
    expect(Object.keys(artifact.table.entries)).toHaveLength(1);
    expect(fitJudgementCalibrationArtifact(input).calibrationSha256).toBe(artifact.calibrationSha256);
    input.policy.maxActionErrorRate = 0.11;
    expect(fitJudgementCalibrationArtifact(input).calibrationSha256).not.toBe(artifact.calibrationSha256);
    input.policy.maxActionErrorRate = 0.1;
    input.observations[0]!.value = 0.2;
    expect(fitJudgementCalibrationArtifact(input).calibrationSha256).not.toBe(artifact.calibrationSha256);
    const dir = await mkdtemp(join(tmpdir(), "judgement-calibration-bootstrap-")), path = join(dir, "artifact.json");
    const serialized = serializeJudgementCalibrationArtifact(artifact);
    await writeFile(path, serialized, { mode: 0o600 });
    expect((await loadJudgementCalibrationArtifact(path, hash(serialized))).table).toEqual(artifact.table);
    artifact.calibrationSha256 = "c".repeat(64);
    const tampered = serializeJudgementCalibrationArtifact(artifact); await writeFile(path, tampered);
    await expect(loadJudgementCalibrationArtifact(path, hash(tampered))).rejects.toThrow("Invalid judgement calibration artifact");
  });
  test("CLI writes private standalone artifacts and never overwrites an existing directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "judgement-calibration-cli-")), input = join(dir, "input.json"), out = join(dir, "out");
    await writeFile(input, JSON.stringify(fixture()));
    const command = [process.execPath, "scripts/training/fit-judgement-calibration.ts", input, out];
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    const summary = JSON.parse(await new Response(proc.stdout).text());
    expect(summary.calibrationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(summary.calibrationSha256).not.toBe(summary.sha256);
    const loaded = await loadJudgementCalibrationArtifact(join(out, "calibration.json"), summary.sha256);
    expect(Object.keys(loaded.table.entries)).toHaveLength(1);
    expect((await stat(out)).mode & 0o777).toBe(0o700);
    for (const name of ["calibration.json", "report.md", "reliability.svg"]) expect((await stat(join(out, name))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(out, "reliability.svg"), "utf8")).toContain("<circle");
    const again = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    expect(await again.exited).toBe(1);
    expect((await loadJudgementCalibrationArtifact(join(out, "calibration.json"), summary.sha256)).sha256).toBe(summary.sha256);
  });
});


describe("portable artifact verification", () => {
  const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
  test("WebCrypto verification reproduces CLI identities and rejects repinned table and evidence changes", async () => {
    const fitted = fitJudgementCalibrationArtifact(fixture());
    const contents = serializeJudgementCalibrationArtifact(fitted);
    const verified = await verifyJudgementCalibrationText(contents, hash(contents), digest);
    expect(verified.artifact).toEqual(fitted);
    expect(verified.sha256).toBe(hash(contents));
    const altered = structuredClone(fitted);
    altered.table.entries[Object.keys(altered.table.entries)[0]!] = { deferBelow: 0.01, actAtOrAbove: 0.01 };
    const raw = serializeJudgementCalibrationArtifact(altered);
    await expect(verifyJudgementCalibrationText(raw, hash(raw), digest)).rejects.toThrow("Invalid judgement calibration artifact");
    const leakage = structuredClone(fitted);
    leakage.input.observations[120]!.groupId = leakage.input.observations[0]!.groupId;
    const leaked = serializeJudgementCalibrationArtifact(leakage);
    await expect(verifyJudgementCalibrationText(leaked, hash(leaked), digest)).rejects.toThrow("Invalid judgement calibration artifact");
  });
  test("portable verifier enforces byte pins and budgets before hashing and returns isolated results", async () => {
    const fitted = fitJudgementCalibrationArtifact(fixture()), contents = serializeJudgementCalibrationArtifact(fitted);
    await expect(verifyJudgementCalibrationText(contents + " ", hash(contents), digest)).rejects.toThrow("Invalid judgement calibration artifact");
    let calls = 0;
    await expect(verifyJudgementCalibrationText("😀".repeat(1_400_000), hash(contents), async text => { calls++; return digest(text); })).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(verifyJudgementCalibrationText(contents, "invalid", digest)).rejects.toThrow();
    const prepared = prepareJudgementCalibrationArtifact(fixture());
    const identity = await digest(prepared.identityInput);
    const first = prepared.complete(identity); first.groups[0]!.sourceBackend.model = "changed"; first.input.observations[0]!.label = 1;
    expect(prepared.complete(identity)).toEqual(fitted);
  });
  test("portable module bundles for browser with no Node polyfills", async () => {
    const built = await Bun.build({ entrypoints: ["./packages/learner-contracts/src/judgement/calibration-artifact.ts"], target: "browser" });
    expect(built.success).toBe(true);
    expect(built.outputs).toHaveLength(1);
    const js = await built.outputs[0]!.text();
    expect(js).not.toContain("node:");
    expect(js).toContain("verifyJudgementCalibrationText");
  });
});
