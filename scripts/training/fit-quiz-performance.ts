#!/usr/bin/env bun
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedBoostingJson, type BoostingDataset } from "../../src/judgement/boosting-artifact.js";
import { fitCliQuizPerformance } from "../../src/judgement/quiz-boosting-fit.js";
import { cliQuizPerformanceCanonical as canonical } from "../../src/judgement/quiz-performance-store.js";

export async function trainQuizEnsemble(dataset: BoostingDataset): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "keating-quiz-fit-"));
  try {
    const input = join(directory, "dataset.json"), output = join(directory, "model.json");
    await writeFile(input, canonical(dataset), { mode: 0o600, flag: "wx" });
    const child = Bun.spawn(["uv", "run", "--no-project", "--python", "3.13", "--with", "catboost==1.2.10", "--with", "numpy", "python",
      join(import.meta.dir, "quiz_boosting_model.py"), input, output], { stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new Error("quiz_fit_trainer_failed");
    return (await readBoundedBoostingJson(output)).value;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function exportCliQuizPerformanceFit(cwd: string, selection: unknown, output: string,
  options: { now?: () => number; train?: (dataset: BoostingDataset) => Promise<unknown> } = {}) {
  // Refuse an existing destination before spending time on a fit.
  await mkdir(output, { mode: 0o700 });
  const result = await fitCliQuizPerformance(cwd, selection, { ...options, train: options.train ?? trainQuizEnsemble });
  const contents = `${canonical(result)}\n`;
  const file = await open(join(output, "quiz-fit.json"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
  const directory = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
  return { selected: result.selected, shallowStatus: result.shallow.status, boostingStatus: result.boosting?.status ?? null,
    fitSha256: result.fitSha256, fileSha256: digestText(contents), rows: result.dataset.observations.length };
}

// The store's digest hashes canonical values; a file pin must hash its exact bytes.
function digestText(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function main() {
  const [selectionPath, output, extra] = process.argv.slice(2);
  if (!selectionPath || !output || extra) throw new Error("Usage: bun scripts/training/fit-quiz-performance.ts selection.json NEW-output-directory");
  const { value } = await readBoundedBoostingJson(selectionPath);
  const result = await exportCliQuizPerformanceFit(process.cwd(), value, output);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.selected === null) process.exitCode = 1;
}
if (import.meta.main) main().catch(error => {
  process.stderr.write(`${error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Quiz fit failed; no existing output was overwritten"}\n`);
  process.exitCode = 1;
});
