/** Strict argv and Devenv JSON decoding; task values never become shell code. */
export class OpsError extends Error {
  constructor(message: string, public code = 2) {
    super(message);
  }
}

export const usage: Record<string, string> = {
  worktree: "worktree <path> [--branch NAME] [--base origin/main] [--yes]",
  verify: "verify [--only root,contracts,web,mobile,flue,typecheck] [--dry-run]",
  release: "release <patch|minor|major|X.Y.Z> [--title TITLE] [--notes FILE] [--yes]\n  release --push [--yes]",
  status: "status [--tag vX.Y.Z] [--wait] [--timeout 30m] [--interval 30s] [--dry-run]",
  "deploy-staging": "deploy-staging [--yes]",
  promote: "promote [--now] [--yes]",
  mutate: "mutate [target.ts …] [--tests files …] [--threshold 60] [--dry-run]",
};

const allowed: Record<string, string[]> = {
  worktree: ["branch", "base", "yes"],
  verify: ["only"],
  release: ["title", "notes", "push", "yes"],
  status: ["tag", "wait", "timeout", "interval"],
  "deploy-staging": ["yes"],
  promote: ["now", "yes"],
  mutate: ["tests", "threshold"],
};
const booleans = new Set(["yes", "now", "push", "wait", "help", "dry-run"]);
const positionalCommands: Record<string, string> = { path: "worktree", version: "release", target: "mutate" };

export type Options = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function readTaskInput(raw: string): Record<string, unknown> {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new OpsError("DEVENV_TASK_INPUT must be a JSON object.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OpsError("DEVENV_TASK_INPUT must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function taskFlagArgs(command: string, key: string, value: unknown): string[] {
  if (!(allowed[command] ?? []).includes(key) && !["help", "dry-run"].includes(key)) {
    throw new OpsError(`Unexpected task field: ${key}`);
  }
  if (booleans.has(key)) {
    if (value !== true && value !== "true" && value !== "false") {
      throw new OpsError(`${key} must be boolean.`);
    }
    return value === true || value === "true" ? [`--${key}`] : [];
  }
  if (key === "tests") {
    if (!isStringArray(value)) {
      throw new OpsError("tests must be an array of file paths.");
    }
    return value.length ? ["--tests", ...value] : [];
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new OpsError(`${key} must be a string or number.`);
  }
  return [`--${key}`, String(value)];
}

export function taskArgs(command: string, raw: string): string[] {
  const input = readTaskInput(raw);
  const result: string[] = [];
  const positional: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === false || value === undefined) continue;
    if (key === "args") {
      if (!isStringArray(value)) {
        throw new OpsError("Task args must be a JSON array of strings.");
      }
      result.push(...value);
      continue;
    }
    if (["path", "version", "target"].includes(key)) {
      if (positionalCommands[key] !== command) {
        throw new OpsError(`Unexpected task field: ${key}`);
      }
      if (typeof value !== "string" && !isStringArray(value)) {
        throw new OpsError(`${key} must be a string or string array.`);
      }
      positional.push(...(Array.isArray(value) ? value : [value]));
      continue;
    }
    result.push(...taskFlagArgs(command, key, value));
  }
  return [...positional, ...result];
}

function validateOperands(options: Options): void {
  const { command, positional, flags } = options;
  const requiresOperand = command === "worktree" || (command === "release" && !flags.push);
  const min = requiresOperand ? 1 : 0;
  let max = 0;
  if (["worktree", "release"].includes(command)) max = 1;
  if (command === "mutate") max = Infinity;
  if (positional.length < min || positional.length > max) {
    throw new OpsError(`Usage: ${usage[command]}`);
  }
  if (command === "release" && flags.push && positional.length) {
    throw new OpsError("Prepare first, then use release --push --yes.");
  }
  if (command === "release" && positional[0] && !/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(positional[0])) {
    throw new OpsError("Release version must be patch, minor, major or X.Y.Z.");
  }
  if (command === "status" && flags.wait && !flags.tag) {
    throw new OpsError("--wait requires --tag vX.Y.Z.");
  }
}

function validateValues(flags: Options["flags"]): void {
  if (flags.tag && !/^v\d+\.\d+\.\d+$/.test(String(flags.tag))) {
    throw new OpsError("--tag must be vX.Y.Z.");
  }
  for (const key of ["timeout", "interval"]) {
    if (flags[key]) duration(String(flags[key]));
  }
  const threshold = Number(flags.threshold);
  if (flags.threshold && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)) {
    throw new OpsError("--threshold must be in [0, 100].");
  }
}

export function parseArgs(argv: string[], taskInput = "{}"): Options {
  const [command = "--help", ...provided] = argv;
  if (command === "--help" || command === "-h") {
    return { command: "", positional: [], flags: { help: true } };
  }
  if (!(command in usage)) throw new OpsError(`Unknown command: ${command}`);
  const args = provided.includes("--task-input")
    ? [...provided.filter(arg => arg !== "--task-input"), ...taskArgs(command, taskInput)]
    : provided;
  const flags: Options["flags"] = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (value === "-h") {
      flags.help = true;
      continue;
    }
    if (!value.startsWith("--")) {
      if (value.startsWith("-")) throw new OpsError(`Unknown flag: ${value}`);
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (![...(allowed[command] ?? []), "help", "dry-run"].includes(key)) {
      throw new OpsError(`Unknown flag for ${command}: ${value}`);
    }
    if (flags[key] !== undefined) throw new OpsError(`Duplicate flag: ${value}`);
    if (booleans.has(key)) {
      flags[key] = true;
      continue;
    }
    if (key === "tests") {
      const tests: string[] = [];
      while (args[index + 1] && !args[index + 1]!.startsWith("-")) {
        tests.push(args[++index]!);
      }
      if (!tests.length) throw new OpsError("--tests requires at least one path.");
      flags.tests = tests;
      continue;
    }
    const next = args[++index];
    if (!next || next.startsWith("--")) throw new OpsError(`${value} requires a value.`);
    flags[key] = next;
  }

  const options = { command, positional, flags };
  if (!flags.help) {
    validateOperands(options);
    validateValues(flags);
  }
  return options;
}

export function duration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  const factor: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  const ms = match ? Number(match[1]) * factor[match[2]!]! : 0;
  if (!Number.isFinite(ms) || ms < 1 || ms > 7 * 24 * 3_600_000) {
    throw new OpsError(`Invalid duration: ${value} (use 30s, 30m or 8h; maximum 7d).`);
  }
  return ms;
}
