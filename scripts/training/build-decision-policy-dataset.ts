#!/usr/bin/env bun
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { buildDecisionPolicyDataset, decisionPolicyCanonical, readDecisionPolicySource } from "../../src/judgement/decision-policy-dataset.js";

export async function exportDecisionPolicyDataset(cwd: string, manifest: unknown, output: string) {
  const built = await buildDecisionPolicyDataset(cwd, manifest);
  await mkdir(output, { mode: 0o700 });
  const files: Array<[string, unknown]> = [["sources.json", built.binding], ["bundle.json", built]];
  for (const [target, dataset] of Object.entries(built.datasets)) files.push([`${target}.json`, dataset]);
  files.push(["audit.json", { schemaVersion: 1, bindingSha256: built.bindingSha256, datasetSha256: built.datasetSha256,
    targets: Object.fromEntries(Object.entries(built.datasets).map(([target, dataset]) => [target, { ...dataset.audit, omissions: dataset.omissions }])),
    limits: built.binding.reconstruction }]);
  for (const [name, value] of files) {
    const handle = await open(join(output, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(`${decisionPolicyCanonical(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  }
  return { bindingSha256: built.bindingSha256, datasetSha256: built.datasetSha256,
    targets: Object.fromEntries(Object.entries(built.datasets).map(([target, dataset]) => [target, dataset.audit])) };
}
async function main() {
  const [manifestPath, output, extra] = process.argv.slice(2);
  if (!manifestPath || !output || extra) throw new Error("Usage: bun scripts/training/build-decision-policy-dataset.ts manifest.json NEW-output-directory");
  const manifest = JSON.parse((await readDecisionPolicySource(manifestPath, 2_000_000)).text);
  process.stdout.write(`${JSON.stringify(await exportDecisionPolicyDataset(process.cwd(), manifest, output))}\n`);
}
if (import.meta.main) main().catch(error => {
  process.stderr.write(`${error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Decision policy dataset export failed; no existing output was overwritten."}\n`);
  process.exitCode = 1;
});
