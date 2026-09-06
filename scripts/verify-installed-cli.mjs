import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(process.argv[2]);
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const workspace = mkdtempSync(join(tmpdir(), "keating-install-check-"));
const run = (...args) => execFileSync(process.execPath, [join(packageRoot, "bin/keating.js"), ...args], {
  cwd: workspace,
  encoding: "utf8",
  timeout: 30_000,
});
try {
  assert.equal(run("version").trim(), `keating ${version}`);
  run("plan", "fractions");
  run("learning-check", "start", "fractions", "--learner", "install-fixture");
  const checks = readdirSync(join(workspace, ".keating/state/learning-checks")).filter((name) => name.endsWith(".json"));
  assert.equal(checks.length, 1);
  run("learning-check", "list");
  console.log(`Installed Keating ${version}: lesson generation and persisted learning checks passed.`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
