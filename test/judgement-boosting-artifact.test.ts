import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBoostingArtifact } from "../src/judgement/boosting-artifact.js";
import { composeBoostingArtifact, trainDataset } from "../scripts/training/fit-boosting-model.js";
import { validateBoostingDataset } from "../packages/learner-contracts/src/judgement/boosting-artifact.js";

// Frozen synthetic fixture, not learner evidence. See scripts/training/boosting_fixture.py.
const FIXTURE = join(import.meta.dir, "fixtures", "boosting");
const CLI = join(import.meta.dir, "..", "scripts", "training", "fit-boosting-model.ts");
const readFixture = async (name: string): Promise<any> => JSON.parse(await readFile(join(FIXTURE, name), "utf8"));

async function exportedTrainerResult(): Promise<unknown> {
  return { framework: (await readFixture("expected.json")).framework, model: await readFixture("catboost-model.json") };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function copyTrainer(directory: string, result: unknown): Promise<string> {
  const exportPath = join(directory, "trainer-export.json");
  const shim = join(directory, "fake-python");
  await writeFile(exportPath, JSON.stringify(result), { mode: 0o600 });
  await writeFile(shim, `#!/usr/bin/env bash\nset -eu\ncp '${exportPath}' "$3"\n`, { mode: 0o700 });
  await chmod(shim, 0o700);
  return shim;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const child = Bun.spawnSync([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

describe("a fitted boosting model is pinned, rebuilt and written as evidence", () => {
  test("the artifact carries every declared row and rebuilds its own evidence", async () => {
    const dataset = await readFixture("dataset.json");
    const { artifact, serialized, sha256 } = composeBoostingArtifact(dataset, await exportedTrainerResult());
    expect(artifact.status).toBe("validated");
    expect(artifact.boostingSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(serialized).input.observations).toHaveLength(180);
    const directory = await temporaryDirectory("boosting-loader-");
    const path = join(directory, "boosting-artifact.json");
    await writeFile(path, serialized, { mode: 0o600 });
    expect((await loadBoostingArtifact(path, sha256)).artifact).toEqual(artifact);
    await expect(loadBoostingArtifact(path, "f".repeat(64))).rejects.toThrow("Invalid boosting artifact");
    const tampered = JSON.parse(serialized);
    tampered.metrics.brier = 0;
    const tamperedText = `${JSON.stringify(tampered)}\n`;
    await writeFile(path, tamperedText);
    await expect(loadBoostingArtifact(path, hash(tamperedText))).rejects.toThrow("Invalid boosting artifact");
    await writeFile(path, "x".repeat(5 * 1024 * 1024 + 1));
    await expect(loadBoostingArtifact(path, hash(""))).rejects.toThrow("Invalid boosting artifact");
  });

  test("a trainer result that is not an object or not the declared dataset is refused", async () => {
    const dataset = await readFixture("dataset.json");
    const result = await exportedTrainerResult();
    expect(() => composeBoostingArtifact(dataset, null)).toThrow("Invalid boosting artifact");
    expect(() => composeBoostingArtifact(dataset, "model")).toThrow("Invalid boosting artifact");
    expect(() => composeBoostingArtifact({ ...dataset, observations: [] }, result)).toThrow("Invalid boosting artifact");
    const unknownFeature = { ...dataset, observations: dataset.observations.map((row: any, index: number) => index === 0 ? { ...row, features: { ...row.features, invented: 1 } } : row) };
    expect(() => composeBoostingArtifact(unknownFeature, result)).toThrow("Invalid boosting artifact");
  });

  test("the fitter writes an artifact, a report and a reliability chart through an injected trainer", async () => {
    const directory = await temporaryDirectory("boosting-fit-");
    const datasetPath = join(directory, "dataset.json");
    await writeFile(datasetPath, JSON.stringify(await readFixture("dataset.json")), { mode: 0o600 });
    const shim = await copyTrainer(directory, await exportedTrainerResult());
    const output = join(directory, "out");
    const result = run([datasetPath, output, shim]);
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.status).toBe("validated");
    expect(summary.groups).toBe(24);
    const artifactText = await readFile(join(output, "boosting-artifact.json"), "utf8");
    expect(JSON.parse(artifactText).boostingSha256).toBe(summary.boostingSha256);
    expect((await loadBoostingArtifact(join(output, "boosting-artifact.json"), summary.sha256)).artifact.metrics.validationRows).toBe(60);
    const report = await readFile(join(output, "report.md"), "utf8");
    expect(report).toContain("Status: validated");
    expect(report).toContain("Only a validated artifact may reorder work.");
    expect(await readFile(join(output, "reliability.svg"), "utf8")).toContain("Held-out reliability");
    expect((await stat(join(output, "boosting-artifact.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect(run([datasetPath, output, shim]).exitCode).toBe(1);
  });

  test("a dataset below the declared minimums is written as insufficient and exits without a model", async () => {
    const directory = await temporaryDirectory("boosting-insufficient-");
    const dataset = await readFixture("dataset.json");
    const datasetPath = join(directory, "dataset.json");
    await writeFile(datasetPath, JSON.stringify({ ...dataset, observations: dataset.observations.slice(0, 6) }), { mode: 0o600 });
    const shim = await copyTrainer(directory, await exportedTrainerResult());
    const output = join(directory, "out");
    const result = run([datasetPath, output, shim]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe("insufficient");
    expect(JSON.parse(await readFile(join(output, "boosting-artifact.json"), "utf8")).status).toBe("insufficient");
  });

  test("trainer failures never surface the trainer's own output", async () => {
    const directory = await temporaryDirectory("boosting-failure-");
    const datasetPath = join(directory, "dataset.json");
    await writeFile(datasetPath, JSON.stringify(await readFixture("dataset.json")), { mode: 0o600 });
    const shim = join(directory, "failing-python");
    await writeFile(shim, "#!/usr/bin/env bash\necho 'learner wrote: a private answer' >&2\nexit 3\n", { mode: 0o700 });
    await chmod(shim, 0o700);
    const result = run([datasetPath, join(directory, "out"), shim]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("private answer");
    expect(result.stderr).toContain("Boosting fit failed");
  });

  test("usage and unreadable input fail closed", async () => {
    expect(run([]).exitCode).toBe(1);
    expect(run([]).stderr).toContain("Usage:");
    const directory = await temporaryDirectory("boosting-missing-");
    expect(run([join(directory, "absent.json"), join(directory, "out")]).exitCode).toBe(1);
    const dataset = await readFixture("dataset.json");
    expect(trainDataset(validateBoostingDataset(dataset), ["/nonexistent-python"] as const)).rejects.toThrow("The CatBoost trainer failed");
  });
});