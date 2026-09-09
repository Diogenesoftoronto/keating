import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { ensureProjectScaffold } from "../src/core/project.js";
import { configDir, goalsStatePath, learnerMemoryPath, learnerStatePath, outputsDir, sessionsDir, stateDir } from "../src/core/paths.js";
import { loadLearnerState, recordFeedback, saveLearnerState } from "../src/core/learner-state.js";
import { learnerProfileEnvironment, parseLearnerProfileArgs, selectedLearnerProfile, withLearnerProfile } from "../src/core/learner-profile-selection.js";
import { buildGoal } from "../src/core/goals.js";
import { loadGoals, upsertGoal } from "../src/core/goal-state.js";
import { KeatingPtyRpcClient } from "../src/runtime/pty-rpc-client.js";
import { launchRpcClient } from "../src/runtime/pi.js";

const directories: string[] = [];
async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "keating-named-profile-test-"));
  directories.push(cwd);
  return cwd;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true }))); });

test("profile option is consumed before command dispatch and respects literal prompt arguments", () => {
  expect(parseLearnerProfileArgs(["--profile=ada", "tui", "Why?"])).toEqual({ name: "ada", args: ["tui", "Why?"] });
  expect(parseLearnerProfileArgs(["shell", "--profile", "bob", "Hello"])).toEqual({ name: "bob", args: ["shell", "Hello"] });
  expect(parseLearnerProfileArgs(["shell", "--", "--profile=literal"])).toEqual({ args: ["shell", "--", "--profile=literal"] });
  expect(parseLearnerProfileArgs(["profile", "--name=Ada"])).toEqual({ args: ["profile", "--name=Ada"] });
  for (const name of ["", "..", "../other", "a/b", "a\\b", "a b", "a\n", ".hidden", "a".repeat(65)]) {
    expect(() => parseLearnerProfileArgs([`--profile=${name}`])).toThrow();
  }
  expect(() => parseLearnerProfileArgs(["--profile"])).toThrow();
  expect(() => parseLearnerProfileArgs(["--profile=ada", "--profile=bob"])).toThrow();
});

test("named state, goals, sessions and output histories are isolated while default paths remain unchanged", async () => {
  const cwd = await workspace();
  const profilePath = join(cwd, ".keating", "profiles", "ada.json");
  await withLearnerProfile(cwd, "ada", async () => {
    await ensureProjectScaffold(cwd);
    expect(learnerStatePath(cwd)).toBe(profilePath);
    expect(stateDir(cwd)).toBe(join(cwd, ".keating", "profiles", "ada", "state"));
    expect(sessionsDir(cwd)).toBe(join(cwd, ".keating", "profiles", "ada", "sessions"));
    expect(outputsDir(cwd)).toBe(join(cwd, ".keating", "profiles", "ada", "outputs"));
    expect(learnerMemoryPath(cwd)).toBe(join(stateDir(cwd), "learner-memory.json"));
    expect(configDir(cwd)).toBe(join(cwd, ".keating", "pi-config"));
    const state = await loadLearnerState(profilePath);
    expect(state.profile.id).toBe("ada");
    recordFeedback(state, "fractions", "confused");
    await saveLearnerState(profilePath, state);
    await upsertGoal(goalsStatePath(cwd), buildGoal({ title: "Ada's only goal", steps: [{ title: "Try fractions" }] }));
  });
  await withLearnerProfile(cwd, "bob", async () => {
    await ensureProjectScaffold(cwd);
    expect((await loadLearnerState(learnerStatePath(cwd))).feedback).toEqual([]);
    expect(await loadGoals(goalsStatePath(cwd))).toEqual([]);
  });
  await withLearnerProfile(cwd, undefined, async () => {
    expect(learnerStatePath(cwd)).toBe(join(cwd, ".keating", "state", "learner.json"));
    expect(sessionsDir(cwd)).toBe(join(cwd, ".keating", "sessions"));
    expect((await loadLearnerState(learnerStatePath(cwd))).feedback).toEqual([]);
  });
  expect((await loadLearnerState(profilePath)).feedback[0]?.topic).toBe("fractions");
});

test("small user-edited profiles normalize defaults and invalid named files fail instead of resetting silently", async () => {
  const cwd = await workspace();
  await withLearnerProfile(cwd, "learner", async () => {
    await ensureProjectScaffold(cwd);
    const path = learnerStatePath(cwd);
    const source = JSON.stringify({ profile: { background: "I repair bicycles and am learning ratios." } });
    await writeFile(path, source);
    await ensureProjectScaffold(cwd);
    expect(await readFile(path, "utf8")).toBe(source);
    const state = await loadLearnerState(path);
    expect(state.profile.background).toBe("I repair bicycles and am learning ratios.");
    expect(state.profile.priorKnowledge).toBe(0.5);
    expect(state.feedback).toEqual([]);
    expect(state.coveredTopics).toEqual([]);
    for (const bad of ["{", "null", "[]", '{"profile":{"background":7}}', '{"feedback":{}}', '{"profile":{"anxiety":-1}}']) {
      await writeFile(path, bad);
      await expect(loadLearnerState(path)).rejects.toThrow();
    }
  });
});

test("concurrent selections and their child environments never mutate one another", async () => {
  const cwd = await workspace();
  const before = process.env.KEATING_LEARNER_PROFILE;
  const values = await Promise.all(["ada", "bob"].map((name, index) => withLearnerProfile(cwd, name, async () => {
    await pause(index ? 1 : 8);
    const env = learnerProfileEnvironment(cwd, { EXAMPLE: "kept" });
    return { name: selectedLearnerProfile(cwd), path: learnerStatePath(cwd), env, other: selectedLearnerProfile(join(cwd, "other")) };
  })));
  for (const [index, name] of ["ada", "bob"].entries()) {
    expect(values[index]?.name).toBe(name);
    expect(values[index]?.path).toBe(join(cwd, ".keating", "profiles", `${name}.json`));
    expect(values[index]?.env.KEATING_LEARNER_PROFILE).toBe(name);
    expect(values[index]?.env.KEATING_LEARNER_PROFILE_CWD).toBe(resolve(cwd));
    expect(values[index]?.env.EXAMPLE).toBe("kept");
    expect(values[index]?.other).toBeUndefined();
  }
  expect(process.env.KEATING_LEARNER_PROFILE).toBe(before);
});

test("named sessions reject cross-profile paths before any RPC/provider dispatch", async () => {
  const cwd = await workspace();
  let spawns = 0;
  const directory = join(cwd, ".keating", "profiles", "ada", "sessions");
  const client = new KeatingPtyRpcClient({ cwd, cliPath: "unused", relayPath: "unused", sessionDirectory: directory,
    spawnTransport: () => { spawns += 1; throw new Error("must not spawn"); } });
  const outside = join(cwd, ".keating", "sessions", "other.jsonl");
  await expect(client.restart({ sessionPath: outside })).rejects.toThrow("selected learner profile");
  await expect(client.switchSession(outside)).rejects.toThrow("selected learner profile");
  await expect(client.newSession(outside)).rejects.toThrow("selected learner profile");
  await expect(launchRpcClient(cwd, ["--profile=ada", "--session", outside])).rejects.toThrow("selected learner profile");
  await expect(launchRpcClient(cwd, ["--profile=ada", "--session-dir", join(cwd, ".keating", "sessions")])).rejects.toThrow("selected learner profile");
  await expect(launchRpcClient(cwd, ["--session", join(directory, "ada.jsonl")])).rejects.toThrow("--profile=name");
  const defaultClient = new KeatingPtyRpcClient({ cwd, cliPath: "unused", relayPath: "unused", profilesDirectory: join(cwd, ".keating", "profiles") });
  await expect(defaultClient.switchSession(join(directory, "ada.jsonl"))).rejects.toThrow("--profile=name");
  expect(spawns).toBe(0);
});

test("the actual child process receives the selected learner even through a workspace symlink", async () => {
  const cwd = await workspace();
  const alias = join(await workspace(), "alias");
  await symlink(cwd, alias, "dir");
  const env = withLearnerProfile(alias, "ada", () => learnerProfileEnvironment(alias, process.env));
  const script = `import { learnerStatePath } from ${JSON.stringify(resolve(import.meta.dir, "../src/core/paths.ts"))}; console.log(learnerStatePath(process.cwd()));`;
  const result = Bun.spawnSync([process.execPath, "-e", script], { cwd: alias, env, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString().trim()).toBe(join(cwd, ".keating", "profiles", "ada.json"));
});

test("actual CLI feedback writes the selected profile and leaves default learner history alone", async () => {
  const cwd = await workspace();
  const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../src/cli/main.ts"), "feedback", "confused", "fractions", "--profile=ada"],
    { cwd, env: { ...process.env, KEATING_LEARNER_PROFILE: "", KEATING_LEARNER_PROFILE_CWD: "" }, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const state = await loadLearnerState(join(cwd, ".keating", "profiles", "ada.json"));
  expect(state.feedback.some((entry) => entry.topic === "fractions" && entry.signal === "confused")).toBe(true);
  expect((await loadLearnerState(join(cwd, ".keating", "state", "learner.json"))).feedback).toEqual([]);
});
