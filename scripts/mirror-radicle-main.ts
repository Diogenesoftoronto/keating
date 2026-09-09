import { resolve } from "node:path";

type Environment = Record<string, string | undefined>;
type Run = (args: string[]) => string;

const run: Run = (args) => {
  const result = Bun.spawnSync(args, {
    cwd: resolve(import.meta.dir, ".."),
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${args[0]} ${args[1]} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
  }
  return result.stdout.toString().trim();
};

export function mirrorRadicleMain(env: Environment = process.env, execute: Run = run): boolean {
  // Use the actual destination and object from prek, not the checked-out branch.
  const commit = env.PRE_COMMIT_TO_REF;
  if (env.PRE_COMMIT_REMOTE_BRANCH !== "refs/heads/main" || !commit || /^0+$/.test(commit)) return false;
  if (env.PRE_COMMIT_REMOTE_NAME === "rad" || env.PRE_COMMIT_REMOTE_URL?.startsWith("rad://")) return false;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error("Missing valid pre-push commit ID.");
  execute(["git", "cat-file", "-e", `${commit}^{commit}`]);

  const remotes = execute(["git", "remote"]).split(/\s+/);
  if (!remotes.includes("rad")) {
    // Explicit visibility and no prompts: never publish private history by default.
    execute(["rad", "init", "--name", "keating", "--description", "Keating teaching app",
      "--default-branch", "main", "--private", "--no-confirm", "--no-seed"]);
  }
  const url = execute(["git", "remote", "get-url", "--push", "rad"]);
  if (!url.startsWith("rad://")) throw new Error("The rad remote must be a Radicle repository.");
  execute(["rad", "inspect"]);
  const tags = execute(["git", "tag", "--merged", commit, "--list", "v[0-9]*"])
    .split(/\s+/).filter(Boolean);
  execute(["git", "-c", "core.hooksPath=/dev/null", "push", "rad",
    `${commit}:refs/heads/main`, ...tags.map(tag => `refs/tags/${tag}:refs/tags/${tag}`)]);
  console.log("Radicle: mirrored main and reachable release tags. Peer replication is separate.");
  return true;
}

if (import.meta.main) {
  try {
    if (!mirrorRadicleMain()) console.log("Radicle: no main update to mirror; skipped.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Radicle mirror failed.");
    console.error("Push stopped. Check rad auth and the rad remote, then retry.");
    process.exitCode = 1;
  }
}
