/** Isolated Bun command-runner mutation tests, compatible with native TypeScript 7. */
import { mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { OpsError, type Options } from "./args.js";
import { run } from "./runner.js";

type StrykerConfig = {
  [key: string]: unknown;
  mutator?: { excludedMutations?: string[]; [key: string]: unknown };
  mutate?: string[];
  commandRunner?: { command: string };
  ignorePatterns?: string[];
};

type MutationConfigInput = {
  targets: string[];
  tests: string[];
  threshold: number;
  directory: string;
};

type PreparedStrykerConfig = StrykerConfig & {
  jsonReporter: { fileName: string };
  tsconfigFile: string;
};

type Mutant = {
  status: string;
  mutatorName: string;
  location: { start: { line: number } };
};

type MutationReport = {
  files: Record<string, { mutants: Mutant[] }>;
};

type LocatedMutant = { file: string; mutant: Mutant };

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build an isolated config without changing the base; explicit targets enable every mutator type. */
export function buildStrykerConfig(
  base: StrykerConfig,
  { targets, tests, threshold, directory }: MutationConfigInput,
): PreparedStrykerConfig {
  const config: PreparedStrykerConfig = {
    ...structuredClone(base),
    reporters: ["json", "clear-text"],
    jsonReporter: { fileName: join(directory, "report.json") },
    tempDirName: join(directory, "sandbox"),
    inPlace: false,
    concurrency: 2,
    thresholds: { high: Math.max(80, threshold), low: threshold, break: threshold },
    // TS 7.0.2 is the native port with no JS compiler API. Stryker's
    // TSConfigPreprocessor calls ts.parseConfigFileTextToJson and crashes.
    // Bun resolves imports itself; use a nonexistent config and typecheck separately.
    tsconfigFile: "stryker-no-tsconfig.json",
  };
  delete config.$schema;
  if (targets.length) {
    config.mutate = [...targets];
    if (config.mutator) delete config.mutator.excludedMutations;
  }
  if (tests.length) {
    const paths = tests.map(test => shellQuote(`./${test}`));
    config.commandRunner = { command: `bun test ${paths.join(" ")}` };
  }

  const ignored = new Set((config.ignorePatterns ?? []).map(path => {
    return path.startsWith("/") ? path : `/${path}`;
  }));
  const keep = new Set([...targets, ...tests].map(path => path.split("/")[0]));
  const optionalDirectories = [
    "web", "mobile", "desktop", "spikes", "video", "data", "analysis",
    "reports", "docs", "textbook", "presentations", "quint", "lexicons",
  ];
  for (const path of optionalDirectories) {
    if (!keep.has(path)) ignored.add(`/${path}`);
  }
  config.ignorePatterns = [...ignored];
  return config;
}

async function checkedPath(value: string, root: string): Promise<string> {
  const full = await realpath(resolve(value));
  const local = relative(root, full);
  const contained = local && !local.startsWith("../") && !local.startsWith("-");
  if (!contained || !/\.(?:ts|tsx)$/.test(local)) {
    throw new OpsError(`Expected a repository-contained TypeScript file: ${value}`);
  }
  return local;
}

function importsTarget(source: string, file: string, target: string): boolean {
  const imports = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)];
  return imports.some(match => {
    const specifier = match[1]!;
    const path = specifier.startsWith("@/")
      ? resolve("web/src", specifier.slice(2))
      : resolve(dirname(file), specifier);
    return path.replace(/\.(?:js|tsx?)$/, "") === resolve(target).replace(/\.tsx?$/, "");
  });
}

async function discoverMutationTests(targets: string[]): Promise<string[]> {
  const tests: string[] = [];
  for (const target of targets) {
    const stem = basename(target).replace(/\.tsx?$/, "");
    const found = await run([
      "rg", "-l", "-F", stem, "--glob", "*.test.ts", "--glob", "*.test.tsx", ".",
    ], { quiet: true });
    if (found.code > 1) {
      throw new OpsError(`rg could not discover tests: ${found.stderr}`, 1);
    }
    for (const file of found.stdout.trim().split("\n").filter(Boolean)) {
      const source = await readFile(file, "utf8");
      if (importsTarget(source, file, target)) tests.push(file.replace(/^\.\//, ""));
    }
  }
  const unique = [...new Set(tests)].sort();
  if (!unique.length) {
    throw new OpsError("No test files directly import the target. Supply --tests FILE … explicitly.");
  }
  return unique;
}

async function resolveMutationTests(options: Options, targets: string[], root: string): Promise<string[]> {
  if (Array.isArray(options.flags.tests)) {
    return Promise.all(options.flags.tests.map(path => checkedPath(path, root)));
  }
  return targets.length ? discoverMutationTests(targets) : [];
}

function printMutationPlan(targets: string[], tests: string[], threshold: number): void {
  console.log(
    `Mutation plan: ${targets.join(", ") || "repository stryker.config.json defaults"}\n`
    + `Tests: ${tests.join(", ") || "repository command runner"}\n`
    + `Threshold ${threshold}%; isolated /tmp sandbox; JSON + clear-text reports; `
    + "native TS7 config preprocessing bypassed.",
  );
}

function warnDefaultExclusions(base: StrykerConfig): void {
  const exclusions = base.mutator?.excludedMutations?.length ?? 0;
  if (!exclusions) return;
  console.warn(
    "Warning: repository-wide default excludes most mutator types "
    + `(${exclusions} exclusions); targeted runs enable all mutator types.`,
  );
}

function reportMutants(report: MutationReport): LocatedMutant[] {
  const all: LocatedMutant[] = [];
  for (const [file, data] of Object.entries(report.files)) {
    for (const mutant of data.mutants) {
      all.push({ file, mutant });
    }
  }
  return all;
}

function printMutationSummary(report: MutationReport, threshold: number, directory: string): boolean {
  const all = reportMutants(report);
  const valid = all.filter(({ mutant }) => !["CompileError", "Ignored"].includes(mutant.status));
  const detected = valid.filter(({ mutant }) => ["Killed", "Timeout"].includes(mutant.status));
  const score = valid.length ? detected.length / valid.length * 100 : 0;
  console.log(
    `Mutation score: ${score.toFixed(2)}% (${detected.length}/${valid.length}); `
    + `threshold ${threshold}%. Reports: ${directory}`,
  );
  const survivors = all.filter(({ mutant }) => ["Survived", "NoCoverage"].includes(mutant.status));
  for (const { file, mutant } of survivors) {
    console.log(`${file}:${mutant.location.start.line} ${mutant.mutatorName} (${mutant.status})`);
  }
  return valid.length > 0 && score >= threshold;
}

/**
 * Discover tests, write an isolated Stryker config/report under /tmp, and run Bun mutation tests.
 * Returns 0 for a dry run/passing score, 1 for failure; throws usage/timeout errors (2/3).
 */
export async function mutate(options: Options): Promise<number> {
  const root = await realpath(process.cwd());
  const targets = await Promise.all(options.positional.map(path => checkedPath(path, root)));
  const tests = await resolveMutationTests(options, targets, root);
  const threshold = Number(options.flags.threshold ?? 60);
  printMutationPlan(targets, tests, threshold);
  const base: StrykerConfig = JSON.parse(await readFile("stryker.config.json", "utf8"));
  if (!targets.length) warnDefaultExclusions(base);
  if (options.flags["dry-run"]) return 0;

  const directory = await mkdtemp("/tmp/keating-stryker-");
  const config = buildStrykerConfig(base, { targets, tests, threshold, directory });
  if (existsSync(config.tsconfigFile)) {
    throw new OpsError(`Sentinel ${config.tsconfigFile} must not exist.`);
  }
  const configPath = join(directory, "stryker.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  const result = await run([
    "bun", "node_modules/@stryker-mutator/core/bin/stryker.js", "run", configPath,
  ], { log: join(directory, "run.log") });
  if (!existsSync(config.jsonReporter.fileName)) {
    throw new OpsError(
      `Mutation infrastructure failed; inspect ${directory}/run.log\n${result.output.slice(-4000)}`,
      1,
    );
  }
  const report: MutationReport = JSON.parse(await readFile(config.jsonReporter.fileName, "utf8"));
  const passed = printMutationSummary(report, threshold, directory);
  return result.code || !passed ? 1 : 0;
}
