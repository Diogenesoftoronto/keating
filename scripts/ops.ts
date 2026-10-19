#!/usr/bin/env bun
/** One entry point for local preparation, release plans and deployment monitoring. */
import { parseArgs, usage, OpsError, type Options } from "./ops/args.js";
import { worktree } from "./ops/worktree.js";
import { verify } from "./ops/verify.js";
import { release } from "./ops/release.js";
import { status } from "./ops/status.js";
import { deploy, promote } from "./ops/deploy.js";
import { mutate } from "./ops/mutate.js";

function printHelp(options: Options): void {
  const syntax = options.command ? usage[options.command] : "<command> [options]";
  const commands = options.command ? "" : Object.values(usage).map(command => `  ${command}`).join("\n");
  console.log(
    `Usage: bun scripts/ops.ts ${syntax}\n${commands}\n`
    + "All commands support --help and --dry-run. Outward actions require --yes; otherwise print a plan.\n"
    + "Devenv tasks pass structured DEVENV_TASK_INPUT via --task-input.\n"
    + "Exit: 0 OK/plan; 1 failed; 2 usage/precondition; 3 timeout/pending.\n"
    + "See docs/operations.md.",
  );
}

/**
 * Dispatch one operations command; side effects and confirmation belong to that command.
 * Returns its 0/1/3 result, or throws errors mapped to failure/usage/timeout exits (1/2/3) below.
 */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv, process.env.DEVENV_TASK_INPUT);
  if (options.flags.help) {
    printHelp(options);
    return 0;
  }
  const commands = {
    worktree,
    verify,
    release,
    status,
    "deploy-staging": deploy,
    promote,
    mutate,
  };
  return commands[options.command as keyof typeof commands](options);
}

function errorExitCode(error: unknown): number {
  if (error instanceof OpsError) return error.code;
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 2;
  if (/timed out/i.test(String(error))) return 3;
  return 1;
}

if (import.meta.main) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = errorExitCode(error);
  });
}
