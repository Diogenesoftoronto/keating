import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const RECOVERY_SOURCE_SHA = "da92214745b8a2a975ee6d16c7466cd126f8fb6f";
export const RECOVERY_RUN_ID = "36274193715";
export const RECOVERY_ALLOWED_FILES = new Set([
  ".github/workflows/release.yml", "desktop/scripts/sign-release.mjs",
  "desktop/test/rpm-signing-smoke.mjs", "desktop/test/release-signing.test.ts",
  "scripts/verify-release-recovery.mjs", "test/release-recovery.test.ts",
]);
export const REQUIRED_RECOVERY_JOBS = [
  "validate", "build (linux, arm64, ubuntu-24.04-arm)", "build (linux, x64, ubuntu-latest)",
  "build (darwin, x64, macos-15-intel)", "build (darwin, arm64, macos-latest)",
  "build-desktop-linux (x64, standard, ubuntu-latest, amd64, x86_64, x86_64)",
  "build-desktop-linux (arm64, standard, ubuntu-24.04-arm, arm64, aarch64, arm64)",
  "build-desktop-linux (x64, offline, ubuntu-latest, amd64, x86_64, x86_64)",
  "build-desktop-linux (arm64, offline, ubuntu-24.04-arm, arm64, aarch64, arm64)",
  "build-native / validate-native-version", "build-native / build-android",
];
export const REQUIRED_RECOVERY_ARTIFACTS = [
  "keating-linux-arm64", "keating-linux-x64", "keating-darwin-arm64", "keating-darwin-x64",
  "keating-desktop-linux-x64-standard", "keating-desktop-linux-arm64-standard",
  "keating-desktop-linux-x64-offline", "keating-desktop-linux-arm64-offline", "keating-android-universal",
];
const optionalJobs = [
  ["build-desktop-macos", "keating-desktop-macos-arm64"],
  ["build-native / build-desktop-windows", "keating-desktop-windows-x64"],
];
function requireValid(condition, message) { if (!condition) throw new Error(`Release recovery refused: ${message}`); }

/** All inputs are public metadata. No output is written until every gate succeeds. */
export async function validateReleaseRecovery({ runId, repository, sha, ref, version }, { api, changedFiles }) {
  if (runId === undefined || runId === "") return "";
  requireValid(typeof runId === "string" && /^[1-9]\d*$/.test(runId) && Number.isSafeInteger(Number(runId)), "invalid artifact run ID");
  requireValid(runId === RECOVERY_RUN_ID, "artifact run is not the approved donor");
  requireValid(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "invalid repository");
  requireValid(typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha), "invalid current source SHA");
  requireValid(ref === `refs/tags/v${version}`, "recovery must target the current package version tag");
  const base = `repos/${repository}/actions/runs/${runId}`;
  const run = await api(base);
  requireValid(run?.repository?.full_name === repository, "donor repository mismatch");
  requireValid(run?.head_repository?.full_name === repository, "donor source repository mismatch");
  requireValid(run?.path === ".github/workflows/release.yml" && run.event === "push" && run.status === "completed", "donor is not a completed tag release workflow");
  requireValid(run.head_branch === `v${version}`, "donor tag version mismatch");
  requireValid(run.head_sha === RECOVERY_SOURCE_SHA && /^[a-f0-9]{40}$/.test(run.head_sha), "donor source SHA mismatch");
  requireValid(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "invalid donor attempt");
  const files = await changedFiles(run.head_sha, sha);
  requireValid(Array.isArray(files) && files.every(file => RECOVERY_ALLOWED_FILES.has(file)), "source differs outside approved release recovery files");
  async function pages(path, key) {
    const rows = [];
    for (let page = 1; ; page++) {
      requireValid(page <= 1000, "metadata pagination exceeds bounds");
      const response = await api(`${path}?per_page=100&page=${page}`);
      requireValid(Array.isArray(response?.[key]) && Number.isSafeInteger(response.total_count) && response.total_count >= 0, "invalid paginated metadata");
      rows.push(...response[key]);
      if (rows.length >= response.total_count) break;
      requireValid(response[key].length > 0, "incomplete metadata pagination");
    }
    return rows;
  }
  const jobs = await pages(`${base}/attempts/${run.run_attempt}/jobs`, "jobs");
  requireValid(jobs.every(row => typeof row.name === "string") && new Set(jobs.map(row => row.name)).size === jobs.length, "duplicated or invalid job names");
  const job = name => {
    const matches = jobs.filter(row => row.name === name);
    requireValid(matches.length === 1 && matches[0].status === "completed", `missing, duplicated, or incomplete job: ${name}`);
    return matches[0];
  };
  for (const name of REQUIRED_RECOVERY_JOBS) requireValid(job(name).conclusion === "success", `required job did not succeed: ${name}`);
  const artifactsNeeded = [...REQUIRED_RECOVERY_ARTIFACTS];
  for (const [name, artifact] of optionalJobs) {
    const conclusion = job(name).conclusion;
    requireValid(conclusion === "success" || conclusion === "skipped", `optional desktop job failed: ${name}`);
    if (conclusion === "success") artifactsNeeded.push(artifact);
  }
  requireValid(run.conclusion === "success" || run.conclusion === "failure", "donor conclusion is not recoverable");
  const failed = jobs.filter(row => row.conclusion === "failure");
  requireValid(jobs.every(row => row.status === "completed" && ["success", "skipped", "failure"].includes(row.conclusion)), "donor has unfinished or cancelled jobs");
  requireValid(failed.every(row => row.name === "release") && (run.conclusion !== "failure" || failed.some(row => row.name === "release")), "donor failed outside the release signing job");
  const artifacts = await pages(`${base}/artifacts`, "artifacts");
  requireValid(artifacts.every(row => typeof row.name === "string") && new Set(artifacts.map(row => row.name)).size === artifacts.length, "duplicated or invalid artifact names");
  requireValid(artifacts.length === artifactsNeeded.length && artifacts.every(row => artifactsNeeded.includes(row.name)), "unexpected donor artifacts");
  for (const name of artifactsNeeded) {
    const matches = artifacts.filter(row => row.name === name);
    requireValid(matches.length === 1 && matches[0].expired === false && Number.isSafeInteger(matches[0].size_in_bytes) && matches[0].size_in_bytes > 0, `missing, expired, empty, or duplicated artifact: ${name}`);
  }
  return runId;
}

export function readReleaseRecoveryDiff(from, to, execute = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) {
  requireValid(/^[a-f0-9]{40}$/.test(from) && /^[a-f0-9]{40}$/.test(to), "invalid source SHA");
  requireValid(execute(["rev-parse", "HEAD"]).trim() === to, "checkout HEAD differs from GitHub source SHA");
  // A failed ancestry check throws before any artifact authority is granted.
  execute(["merge-base", "--is-ancestor", from, to]);
  return execute(["diff", "--name-only", "--no-renames", "-z", from, to, "--"]).split("\0").filter(Boolean);
}

export async function runReleaseRecovery(env = process.env) {
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const runId = await validateReleaseRecovery({ runId: env.ARTIFACT_RUN_ID, repository: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA, ref: env.GITHUB_REF, version }, {
    api: path => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 })),
    changedFiles: readReleaseRecoveryDiff,
  });
  requireValid(typeof env.GITHUB_OUTPUT === "string" && env.GITHUB_OUTPUT.length > 0, "missing GitHub output path");
  appendFileSync(env.GITHUB_OUTPUT, `artifact_run_id=${runId}\n`);
  return runId;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  runReleaseRecovery().catch(error => {
    // Child-process stderr and environment can contain credentials. Print only our gates.
    console.error(error instanceof Error && error.message.startsWith("Release recovery refused:") ? error.message : "Release recovery refused: metadata or source verification failed");
    process.exitCode = 1;
  });
}
