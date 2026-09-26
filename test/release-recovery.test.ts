import { expect, test } from "bun:test";
import { validateReleaseRecovery, readReleaseRecoveryDiff, RECOVERY_SOURCE_SHA, RECOVERY_RUN_ID, REQUIRED_RECOVERY_JOBS, REQUIRED_RECOVERY_ARTIFACTS } from "../scripts/verify-release-recovery.mjs";
const input = { runId: RECOVERY_RUN_ID, repository: "Diogenesoftoronto/keating", sha: "a".repeat(40), ref: "refs/tags/v4.0.1", version: "4.0.1" };
function fixture() {
  const run = { repository: { full_name: input.repository }, head_repository: { full_name: input.repository }, path: ".github/workflows/release.yml", event: "push", status: "completed", conclusion: "failure", head_sha: RECOVERY_SOURCE_SHA, head_branch: "v4.0.1", run_attempt: 2 };
  const jobs = [...REQUIRED_RECOVERY_JOBS.map(name => ({ name, status: "completed", conclusion: "success" })),
    ...["build-desktop-macos", "build-native / build-desktop-windows", "publish-npm"].map(name => ({ name, status: "completed", conclusion: "skipped" })),
    { name: "release", status: "completed", conclusion: "failure" }];
  const artifacts = REQUIRED_RECOVERY_ARTIFACTS.map(name => ({ name, expired: false, size_in_bytes: 100 }));
  const paths: string[] = [];
  let files = ["desktop/scripts/sign-release.mjs"];
  const deps = { api: async (path: string) => { paths.push(path); return path.includes("/jobs?") ? { jobs, total_count: jobs.length } : path.includes("/artifacts?") ? { artifacts, total_count: artifacts.length } : run; }, changedFiles: async () => files };
  return { run, jobs, artifacts, deps, paths, setFiles: (value: string[]) => { files = value; } };
}
test("no recovery input performs no API or source checks", async () => {
  const f = fixture(); expect(await validateReleaseRecovery({ ...input, runId: "" }, f.deps)).toBe(""); expect(f.paths).toEqual([]);
});
test("source checkout must match GitHub SHA and descend from the donor before diffing", () => {
  const calls: string[][] = [];
  const execute = (args: string[]) => { calls.push(args); return args[0] === "rev-parse" ? input.sha + "\n" : args[0] === "diff" ? "desktop/scripts/sign-release.mjs\0" : ""; };
  expect(readReleaseRecoveryDiff(RECOVERY_SOURCE_SHA, input.sha, execute)).toEqual(["desktop/scripts/sign-release.mjs"]);
  expect(calls.map(args => args[0])).toEqual(["rev-parse", "merge-base", "diff"]);
  expect(() => readReleaseRecoveryDiff(RECOVERY_SOURCE_SHA, input.sha, () => "b".repeat(40))).toThrow("checkout HEAD");
  expect(() => readReleaseRecoveryDiff(RECOVERY_SOURCE_SHA, input.sha, args => { if (args[0] === "merge-base") throw Error("not ancestor"); return input.sha; })).toThrow("not ancestor");
  expect(() => readReleaseRecoveryDiff("HEAD", input.sha, execute)).toThrow("invalid source SHA");
});
test("approved source with all successful platform jobs accepts release-only failure using latest attempt", async () => {
  const f = fixture(); expect(await validateReleaseRecovery(input, f.deps)).toBe(RECOVERY_RUN_ID); expect(f.paths.some(path => path.includes("/attempts/2/jobs?"))).toBe(true);
});
test("unsafe run IDs and refs fail before API access", async () => {
  for (const runId of ["0", "-1", "1;echo", " 36274193715", "9007199254740992", "123"]) {
    const f = fixture(); await expect(validateReleaseRecovery({ ...input, runId }, f.deps)).rejects.toThrow(); expect(f.paths).toEqual([]);
  }
  for (const ref of ["refs/heads/main", "refs/tags/v4.0.0", "refs/tags/v4.0.1\n"]) await expect(validateReleaseRecovery({ ...input, ref }, fixture().deps)).rejects.toThrow();
  await expect(validateReleaseRecovery({ ...input, sha: "HEAD;evil" }, fixture().deps)).rejects.toThrow();
});
test("wrong repository, source SHA, workflow, event, or unfinished donor fails", async () => {
  for (const patch of [{ repository: { full_name: "attacker/keating" } }, { head_repository: { full_name: "attacker/keating" } }, { head_sha: "b".repeat(40) }, { head_branch: "v4.0.0" }, { path: ".github/workflows/other.yml" }, { event: "pull_request" }, { status: "in_progress" }]) {
    const f = fixture(); Object.assign(f.run, patch); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
  }
});
test("runtime and version differences or git verification failures refuse reuse", async () => {
  for (const file of ["package.json", "src/core/topics.ts", "desktop/main.ts", "web/src/App.tsx"]) {
    const f = fixture(); f.setFiles([file]); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow("source differs");
  }
  const f = fixture(); await expect(validateReleaseRecovery(input, { ...f.deps, changedFiles: async () => { throw Error("git unavailable"); } })).rejects.toThrow();
});
test("each platform matrix job is mandatory and successful", async () => {
  for (const name of REQUIRED_RECOVERY_JOBS) {
    const f = fixture(); f.jobs.splice(f.jobs.findIndex(row => row.name === name), 1); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
  }
  const f = fixture(); f.jobs[1].conclusion = "failure"; await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
});
test("duplicate or incomplete jobs and non-release failures are rejected", async () => {
  const f = fixture(); f.jobs.push({ ...f.jobs[0] }); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
  const g = fixture(); g.jobs[0].status = "in_progress"; await expect(validateReleaseRecovery(input, g.deps)).rejects.toThrow();
  const h = fixture(); h.jobs.push({ name: "unknown platform", status: "completed", conclusion: "failure" }); await expect(validateReleaseRecovery(input, h.deps)).rejects.toThrow();
});
test("every required artifact must be unique, present, nonempty, and unexpired", async () => {
  for (const name of REQUIRED_RECOVERY_ARTIFACTS) {
    const f = fixture(); f.artifacts.splice(f.artifacts.findIndex(row => row.name === name), 1); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
  }
  for (const patch of [{ expired: true }, { size_in_bytes: 0 }]) { const f = fixture(); Object.assign(f.artifacts[0], patch); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow(); }
  const f = fixture(); f.artifacts.push({ ...f.artifacts[0] }); await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
  const g = fixture(); g.artifacts.push({ name: "unchecked-extra-installer", expired: false, size_in_bytes: 500 }); await expect(validateReleaseRecovery(input, g.deps)).rejects.toThrow("unexpected donor artifacts");
  const h = fixture(); h.artifacts.push({ name: "keating-desktop-macos-arm64", expired: false, size_in_bytes: 500 }); await expect(validateReleaseRecovery(input, h.deps)).rejects.toThrow("unexpected donor artifacts");
});
test("optional signed desktops may be skipped; successful jobs require their artifacts", async () => {
  for (const [name, artifact] of [["build-desktop-macos", "keating-desktop-macos-arm64"], ["build-native / build-desktop-windows", "keating-desktop-windows-x64"]]) {
    const f = fixture(); f.jobs.find(row => row.name === name)!.conclusion = "success"; await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
    f.artifacts.push({ name: artifact, expired: false, size_in_bytes: 500 }); expect(await validateReleaseRecovery(input, f.deps)).toBe(RECOVERY_RUN_ID);
    f.jobs.find(row => row.name === name)!.conclusion = "failure"; await expect(validateReleaseRecovery(input, f.deps)).rejects.toThrow();
  }
});
test("pagination consumes all jobs and refuses incomplete metadata", async () => {
  const f = fixture(), first = f.jobs.slice(0, 4), rest = f.jobs.slice(4);
  const api = async (path: string) => path.includes("/jobs?") ? { jobs: path.endsWith("page=1") ? first : rest, total_count: f.jobs.length } : await f.deps.api(path);
  expect(await validateReleaseRecovery(input, { ...f.deps, api })).toBe(RECOVERY_RUN_ID);
  await expect(validateReleaseRecovery(input, { ...f.deps, api: async path => path.includes("/jobs?") ? { jobs: [], total_count: 99 } : await f.deps.api(path) })).rejects.toThrow();
});
