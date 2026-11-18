/** Read-only replay of the two saved prediction cases through today's actual gate. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { projectTeachingDraftSelection } from "../../../../../packages/learner-contracts/src/judgement/teaching-selection";

const root = resolve(import.meta.dir, "../../../../..");
const source = join(root, "packages/learner-contracts/src/judgement");
const script = resolve(import.meta.dir, "../prediction-replay/replay.ts");
const temp = mkdtempSync(join(tmpdir(), "keating-selection-proof-"));
const evidenceFile = join(temp, "selected.json");
try {
  const moduleDir = join(temp, "src/judgement");
  mkdirSync(moduleDir, { recursive: true });
  // The recorded study replay accepts a contracts directory. Observe its real result
  // without changing any of its inputs, its source, or its original artifacts.
  writeFileSync(join(moduleDir, "teaching-drafts.ts"), [
    `import { runTeachingDrafts as run } from ${JSON.stringify(join(source, "teaching-drafts.ts"))};`,
    `import { projectTeachingDraftSelection as project } from ${JSON.stringify(join(source, "teaching-selection.ts"))};`,
    'import { writeFileSync } from "node:fs";',
    'globalThis.fetch = async () => { throw new Error("Offline replay"); };',
    'export async function runTeachingDrafts(options) {',
    '  const result = await run(options);',
    `  writeFileSync(${JSON.stringify(evidenceFile)}, JSON.stringify(project(result.receipt) ?? null));`,
    '  return result;',
    '}',
  ].join("\n"));
  const observed: Record<string, unknown> = {};
  const cases = [
    ["target/jev-best-effort", { attempt: 1, review: "best-effort", rule: "presentation-only-checkpoint-retained" }],
    ["target/google-approved-choice", { attempt: 2, review: "verified", rule: "requested-prediction-over-prose" }],
    ["guard/google-prose-not-a-question", { attempt: 1, review: "verified", rule: "none" }],
  ] as const;
  for (const [name, expected] of cases) {
    writeFileSync(evidenceFile, "null");
    const job = Bun.spawnSync([process.execPath, script, temp], { env: { PATH: process.env.PATH, REPLAY_ONLY: name }, stdout: "pipe", stderr: "pipe" });
    assert.equal(job.exitCode, 0, `Replay failed for ${name}`);
    const choice = JSON.parse(readFileSync(evidenceFile, "utf8"));
    assert.deepEqual(choice, expected, name);
    observed[name] = choice;
  }
  // The actual historical live gate had a terminal choice and no prediction-rule instrumentation.
  const { snapshot } = JSON.parse(readFileSync(join(import.meta.dir, "live-stage-light/browser-gate.json"), "utf8"));
  observed["historical/live-stage-light"] = projectTeachingDraftSelection(snapshot);
  assert.deepEqual(observed["historical/live-stage-light"], { attempt: 2, review: "best-effort" });
  console.log(JSON.stringify(observed, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
