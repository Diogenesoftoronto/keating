import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

interface LearnerProfileSelection { cwd: string; name: string | undefined }
const selection = new AsyncLocalStorage<LearnerProfileSelection>();
const PROFILE_ENV = "KEATING_LEARNER_PROFILE";
const PROFILE_CWD_ENV = "KEATING_LEARNER_PROFILE_CWD";

function canonicalWorkspace(cwd: string): string {
  try { return realpathSync(cwd); } catch { return resolve(cwd); }
}

export function validateLearnerProfileName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new Error("Profile name must be 1–64 letters, digits, hyphens or underscores, starting with a letter or digit.");
  }
  return name;
}

/** A selection belongs to one workspace and async operation, never another concurrent launch. */
export function selectedLearnerProfile(cwd: string): string | undefined {
  const active = selection.getStore();
  if (active) return active.cwd === canonicalWorkspace(cwd) ? active.name : undefined;
  const name = process.env[PROFILE_ENV];
  if (!name || canonicalWorkspace(process.env[PROFILE_CWD_ENV] ?? cwd) !== canonicalWorkspace(cwd)) return undefined;
  return validateLearnerProfileName(name);
}

export function withLearnerProfile<T>(cwd: string, name: string | undefined, operation: () => T): T {
  if (name !== undefined) validateLearnerProfileName(name);
  return selection.run({ cwd: canonicalWorkspace(cwd), name }, operation);
}

/** Only the explicit child receives these values; the host's process.env stays untouched. */
export function learnerProfileEnvironment(cwd: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const name = selectedLearnerProfile(cwd);
  return { ...env, [PROFILE_ENV]: name ?? "", [PROFILE_CWD_ENV]: name ? canonicalWorkspace(cwd) : "" };
}

export function parseLearnerProfileArgs(args: readonly string[]): { name?: string; args: string[] } {
  const remaining: string[] = [];
  let name: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") { remaining.push(...args.slice(index)); break; }
    if (arg !== "--profile" && !arg.startsWith("--profile=")) { remaining.push(arg); continue; }
    if (name !== undefined) throw new Error("Choose --profile only once.");
    const value = arg === "--profile" ? args[++index] : arg.slice("--profile=".length);
    if (value === undefined) throw new Error("--profile needs a name.");
    name = validateLearnerProfileName(value);
  }
  return { ...(name !== undefined ? { name } : {}), args: remaining };
}

export function withLearnerProfileArgs<T>(cwd: string, args: readonly string[], operation: (args: string[]) => T): T {
  const parsed = parseLearnerProfileArgs(args);
  return withLearnerProfile(cwd, parsed.name ?? selectedLearnerProfile(cwd), () => operation(parsed.args));
}

/** Distinguishes explicit profile files from the unchanged legacy learner.json format. */
export function learnerProfileNameFromPath(path: string): string | undefined {
  const absolute = resolve(path);
  if (basename(dirname(absolute)) !== "profiles" || basename(dirname(dirname(absolute))) !== ".keating") return undefined;
  const filename = basename(absolute);
  if (!filename.endsWith(".json")) return undefined;
  return validateLearnerProfileName(filename.slice(0, -5));
}

export function assertProfileSessionPath(directory: string, path: string): void {
  const inside = relative(canonicalWorkspace(directory), canonicalWorkspace(path));
  if (!inside || isAbsolute(inside) || inside === ".." || inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("The session must belong to the selected learner profile.");
  }
}

/** Existing default-session paths remain valid; the new named namespace needs a selection. */
export function assertDefaultProfileSessionPath(profilesDirectory: string, path: string): void {
  const inside = relative(canonicalWorkspace(profilesDirectory), canonicalWorkspace(path));
  if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Named learner sessions require --profile=name.");
  }
}
