/** Run argv directly, preserving exit status and bounded phase logs. */
import { writeFile } from "node:fs/promises";
import { OpsError } from "./args.js";

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  log?: string;
  quiet?: boolean;
  timeout?: number;
};

export async function run(args: string[], options: RunOptions = {}) {
  const env = { ...process.env, ...options.env };
  if (args[0] === "git") {
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
      delete env[key];
    }
  }
  const child = Bun.spawn(args, {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeout ?? 60 * 60_000);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const output = stdout + "\n" + stderr;
    if (options.log) await writeFile(options.log, output);
    if (!options.quiet) {
      const outcome = timedOut ? "timeout" : `exit ${code}`;
      const log = options.log ? ` (${options.log})` : "";
      console.log(`${args.join(" ")}: ${outcome}${log}`);
    }
    if (timedOut) {
      throw new OpsError(`${args[0]} timed out; inspect ${options.log ?? "the process"} before retrying.`, 3);
    }
    return { code, stdout, stderr, output };
  } finally {
    clearTimeout(timer);
  }
}

export async function must(args: string[], options: Parameters<typeof run>[1] = {}): Promise<string> {
  const result = await run(args, options);
  if (result.code) {
    throw new OpsError(`${args.join(" ")} failed (${result.code}).\n${result.output.slice(-6000)}`, 1);
  }
  return result.stdout.trim();
}
