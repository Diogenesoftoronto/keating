#!/usr/bin/env bun
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { buildCliQuizBoostingDataset } from "../../src/judgement/quiz-boosting-dataset.js";
import { cliQuizPerformanceCanonical } from "../../src/judgement/quiz-performance-store.js";

/** Explicit private export. Never trains, overwrites a directory, or enables a model. */
export async function exportCliQuizBoostingDataset(cwd: string, selection: unknown, output: string, options: { now?: () => number } = {}) {
  const built = await buildCliQuizBoostingDataset(cwd, selection, options);
  await mkdir(output, { mode: 0o700 });
  for (const [name, value] of [["dataset.json", built.dataset], ["binding.json", built.binding]] as const) {
    const handle = await open(join(output, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(`${cliQuizPerformanceCanonical(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
  }
  const directory = await open(output, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { await directory.sync(); } finally { await directory.close(); }
  return { rows: built.dataset.observations.length, datasetSha256: built.binding.datasetSha256,
    bindingSha256: built.binding.bindingSha256, target: built.binding.target };
}

async function main() {
  const [selectionFile, output, extra] = process.argv.slice(2);
  if (!selectionFile || !output || extra) throw new Error("Usage: bun scripts/training/build-quiz-boosting-dataset.ts selection.json NEW-output-directory");
  const handle = await open(selectionFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let selection: unknown;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("selection-invalid");
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
    let offset = 0;
    while (offset < bytes.length) { const r = await handle.read(bytes, offset, bytes.length - offset, null); if (!r.bytesRead) break; offset += r.bytesRead; }
    if (offset === bytes.length) throw new Error("selection-invalid");
    selection = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
  } finally { await handle.close(); }
  process.stdout.write(`${JSON.stringify(await exportCliQuizBoostingDataset(process.cwd(), selection, output))}\n`);
}
if (import.meta.main) main().catch(error => {
  process.stderr.write(`${error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Quiz dataset export failed; existing output was not overwritten"}\n`);
  process.exitCode = 1;
});
