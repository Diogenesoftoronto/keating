// Run `rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs` from the repository.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { hashFile, prepareTree, privatePath, read, restoreVersion21 } from "./replay-source/tree.mjs";

const audit = import.meta.dir, root = resolve(audit, "../../..");
const entries = new Map([
  ["jev", "policy-holdout/run.mjs"], ["jev-resume", "policy-holdout/resume.mjs"],
  ["gemini", "gemini-decision/run.mjs"], ["comparison", "gemini-decision/comparison.mjs"],
  ["frozen", "gemini-decision/frozen/replay.mjs"], ["perimeter", "gemini-decision/frozen/perimeter.mjs"],
  ["cue-paraphrases", "cue-paraphrases/run.mjs"], ["policy-v2.1", "policy-v2.1/run.mjs"],
  ["policy-v2", "policy-v2/run-followup.mjs"],
]);
const requested = process.argv.slice(2);
assert(requested.every(key => entries.has(key)), `Available offline checks: ${[...entries.keys()].join(", ")}`);
const checks = [...entries].filter(([key]) => requested.length === 0 || requested.includes(key));
const archive = mkdtempSync(join(tmpdir(), "keating-historical-openui-"));
const copiedAudit = join(archive, relative(root, audit));
function run(args, options = {}) {
  const result = Bun.spawnSync(args, { cwd: archive, stdout: "inherit", stderr: "inherit", ...options });
  assert.equal(result.exitCode, 0, `Historical check failed: ${args.at(-2)} ${args.at(-1)}`);
}

try {
  prepareTree(root, archive);
  const manifest = restoreVersion21(archive);
  const digest = manifest.diagnostic.sha256;

  for (const [key, script] of checks) {
    if (key === "policy-v2") {
      // This older runner requires its five original teaching-policy sources. Apply its
      // supplied patch only in the temporary tree, then check each restored source hash.
      const pins = read(join(copiedAudit, "policy-v2/evidence.json")).sourceHashes;
      for (const file of Object.keys(pins)) privatePath(archive, file);
      const patch = join(copiedAudit, "policy-v2.1/restore-v2.patch");
      assert.equal(hashFile(patch), "db358d4d742e270e31b71981fb16cf6879d1de65f24ac1a1fbea8c27ed6286de", "Historical restoration patch was modified");
      run(["rtk", "proxy", "git", "apply", "--no-index", patch]);
      for (const [file, pin] of Object.entries(pins)) assert.equal(hashFile(privatePath(archive, file)), pin, file);
    }
    const moduleReceipt = join(archive, `${key}-modules.json`);
    run([process.execPath, "--preload", join(copiedAudit, "replay-source/preload.mjs"), join(copiedAudit, script), "--verify"], {
      env: { ...process.env, KEATING_ARCHIVE_MODULE_RECEIPT: moduleReceipt, KEATING_AUDIT_RELEASE: "" },
    });
    if (["jev", "jev-resume", "gemini", "comparison"].includes(key)) {
      assert(existsSync(moduleReceipt), `Historical diagnostic module was not loaded by ${script}`);
      const loaded = read(moduleReceipt);
      assert.equal(loaded[manifest.diagnostic.path], digest);
      if (["jev","jev-resume","gemini"].includes(key)) {
        const source = "web/src/keating/judgement/draft-gate.ts";
        assert.equal(loaded[source], manifest.sourceSha256[source], "Historical web gate was not loaded");
      }
    }
    if (key === "cue-paraphrases") {
      const source = "packages/learner-contracts/src/judgement/teaching-policy.ts";
      assert.equal(read(moduleReceipt)[source], manifest.sourceSha256[source], "Historical planner was not loaded");
    }
    if (key === "policy-v2" || key === "policy-v2.1") {
      const summary = join(dirname(script), "summary.json");
      assert.equal(hashFile(join(copiedAudit, summary)), hashFile(join(audit, summary)), `Historical summary differs for ${key}`);
    }
  }
  console.log(`Verified ${checks.length} historical ${checks.length === 1 ? "check" : "checks"} offline. Diagnostic contract SHA-256 ${digest}.`);
} finally {
  rmSync(archive, { recursive: true, force: true });
}
