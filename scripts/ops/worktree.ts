/** Prepare an independent checkout with native and generated prerequisites. */
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { OpsError, type Options } from "./args.js";
import { must, run } from "./runner.js";

const cleanCompilerEnv = ["env", "-u", "CPLUS_INCLUDE_PATH", "-u", "C_INCLUDE_PATH", "-u", "LIBRARY_PATH"];

function printWorktreePlan(destination: string, branch: string, base: string): void {
  console.log(
    `Worktree ${destination}\nBranch ${branch}; base ${base}\n`
    + "Fetch origin; git worktree add; sanitized root install; validate/rebuild node-pty; "
    + "web install + Panda; frozen Flue install; root TypeScript build + templates.",
  );
}

async function installRootDependencies(destination: string): Promise<void> {
  const install = await run([...cleanCompilerEnv, "bun", "install"], { cwd: destination });
  const artifact = resolve(destination, "node_modules/node-pty/build/Release/pty.node");
  if (install.code && !/node-pty|pty\.node/i.test(install.output)) {
    throw new OpsError(`Root install failed.\n${install.output.slice(-4000)}`, 1);
  }
  if (!install.code && existsSync(artifact)) return;

  await must([...cleanCompilerEnv, "bun", "install", "--ignore-scripts"], { cwd: destination });
  const native = resolve(destination, "node_modules/node-pty");
  const rebuild = await run([...cleanCompilerEnv, "bun", "x", "node-gyp", "rebuild"], { cwd: native });
  if (rebuild.code || !existsSync(artifact)) {
    throw new OpsError(
      "node-pty is not built. In a Devenv shell, run exactly:\n"
      + `cd ${JSON.stringify(native)}\n`
      + "env -u CPLUS_INCLUDE_PATH -u C_INCLUDE_PATH -u LIBRARY_PATH bun x node-gyp rebuild\n"
      + `Then verify ${artifact}. No native artifact was copied from another checkout.\n`
      + rebuild.output.slice(-2000),
      1,
    );
  }
}

async function prepareWorktree(destination: string): Promise<void> {
  await installRootDependencies(destination);
  await must(["bun", "install"], { cwd: resolve(destination, "web") });
  await must(["bun", "run", "panda"], { cwd: resolve(destination, "web") });
  await must(["bun", "install", "--frozen-lockfile"], { cwd: resolve(destination, "spikes/flue-host") });
  await must(["bun", "x", "tsc", "-p", "tsconfig.json"], { cwd: destination });
  await must(["bun", "scripts/copy-core-templates.ts"], { cwd: destination });
}

/**
 * Plan a new checkout; --yes fetches, creates it, installs dependencies and builds prerequisites.
 * Returns 0 on a plan/completion; throws failures, preconditions or timeouts (1/2/3).
 */
export async function worktree(options: Options): Promise<number> {
  const destination = resolve(options.positional[0]!);
  const branch = String(options.flags.branch ?? `work/${basename(destination)}`);
  const base = String(options.flags.base ?? "origin/main");
  if (existsSync(destination)) {
    throw new OpsError(`Worktree path already exists: ${destination}`);
  }
  if (base.startsWith("-") || branch.startsWith("-")) {
    throw new OpsError("Branch/base cannot start with a dash.");
  }
  const validBranch = await run(["git", "check-ref-format", "--branch", branch], { quiet: true });
  if (validBranch.code) throw new OpsError(`Invalid branch name: ${branch}`);

  printWorktreePlan(destination, branch, base);
  if (!options.flags.yes || options.flags["dry-run"]) {
    console.log("Plan only. Add --yes to create and install.");
    return 0;
  }
  await must(["git", "fetch", "origin"]);
  await must(["git", "worktree", "add", "-b", branch, destination, base]);
  await prepareWorktree(destination);
  console.log(
    `Ready: ${destination}\nBranch: ${branch}\n`
    + "Native pty.node exists; root dist/templates, web Panda and Flue dependencies prepared. Tests have not run.",
  );
  return 0;
}
