// Damage only the disposable fixture. Verify that the operator's sources and evidence survive every outcome.
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { auditPath, hashFile, prepareTree, privatePath, read, restoreVersion21 } from "./tree.mjs";

const root = resolve(import.meta.dir, "../../../..");
const fixture = mkdtempSync(join(tmpdir(), "keating-openui-integrity-"));
const scratch = join(fixture, "scratch");
const local = file => privatePath(fixture, file);
const study = file => join(auditPath, file);
const wrapper = join(fixture, study("verify-historical.mjs"));
const bun = process.execPath;

function check(args, expectedError) {
  const result = Bun.spawnSync(args, {cwd:fixture, stdout:"pipe", stderr:"pipe", env:{...process.env, TMPDIR:scratch}});
  const log = result.stdout.toString() + result.stderr.toString();
  if (expectedError) {
    assert.notEqual(result.exitCode, 0, "A tampered input was accepted");
    assert.ok(log.includes(expectedError), log);
  } else {
    assert.equal(result.exitCode, 0, log);
    assert.match(log, /Verified 1 historical check offline/);
  }
  assert.deepEqual(readdirSync(scratch), [], "Temporary replay directory was retained");
}

const activeSources = [
  "packages/learner-contracts/src/openui-diagnostic-turn.ts",
  "packages/learner-contracts/src/judgement/teaching-policy.ts",
  "web/src/keating/judgement/draft-gate.ts",
  "web/src/keating/prompts/operational-protocol.md",
];
const tamperTests = [
  ["replay-source/openui-diagnostic-turn.ts", "gemini", "Historical OpenUI diagnostic snapshot was modified"],
  ["replay-source/source-manifest.json", "gemini", "Historical source manifest was modified"],
  ["replay-source/policy-v2.1-sources.json.gz", "gemini", "Historical source archive was modified"],
  ["policy-v2.1/restore-v2.patch", "policy-v2", "Historical restoration patch was modified"],
  ["gemini-decision/journal.mjs", "cue-paraphrases", "Frozen protocol, runner, requests or planner source changed."],
  ["gemini-decision/ledger.json", "cue-paraphrases", "Earlier accounting changed."],
];
const receipt = study("gemini-decision/turn-receipts/MiniMax-M2.7-highspeed--spinner.json");
const observed = [...activeSources, ...tamperTests.map(([file])=>study(file)), receipt];
const actualHashes = () => observed.map(path => hashFile(join(root, path)));
const before = actualHashes();

try {
  prepareTree(root, fixture);
  mkdirSync(scratch);
  const broken = "throw Error('an active source escaped the archive');\n";
  for (const source of activeSources) writeFileSync(local(source), broken);
  const fixtureHashes = activeSources.map(file => hashFile(local(file)));
  check([bun, wrapper, "gemini"]);
  assert.deepEqual(activeSources.map(file => hashFile(local(file))), fixtureHashes);

  for (const [name, mode, expected] of tamperTests) {
    const file = study(name);
    appendFileSync(local(file), "\n");
    check([bun, wrapper, mode], expected);
    copyFileSync(join(root, file), local(file));
  }
  const value = read(local(receipt));
  value.public.text += " Extra word.";
  writeFileSync(local(receipt), JSON.stringify(value));
  check([bun, wrapper, "gemini"], "Adjudication must bind to exact selected text");

  check([bun, wrapper, "--execute"], "Available offline checks");
  const noop = local("noop.mjs");
  writeFileSync(noop, "throw Error('Unexpected execution entrypoint');\n");
  check([bun, "--preload", local(study("replay-source/preload.mjs")), noop, "--execute"], "available only to verify-historical.mjs");

  assert.throws(() => privatePath(fixture, "../outside"), /Unsafe replay path/);
  const detachedWeb = local("detached-web");
  renameSync(local("web"), detachedWeb);
  symlinkSync(detachedWeb, join(fixture, "web"), "dir");
  assert.throws(() => restoreVersion21(fixture), /Replay write crosses a symbolic link/);
  assert.equal(hashFile(join(detachedWeb, "src/keating/judgement/draft-gate.ts")), fixtureHashes[2]);
  assert.deepEqual(actualHashes(), before, "Active checkout sources or evidence changed");
  console.log("Verified archived execution after four source changes, seven independent tamper rejections, two execution-mode rejections, symlink containment, checkout integrity and scratch cleanup.");
} finally {
  rmSync(fixture, {recursive:true, force:true});
}
