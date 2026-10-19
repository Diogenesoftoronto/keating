/** Sequential verification with exact, visible known-failure matching. */
import { mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { OpsError, type Options } from "./args.js";
import { must, run } from "./runner.js";
import { parseTestOutput, matchFailures, type KnownFailure } from "./results.js";
import known from "./known-failures.json" with { type: "json" };

type SummaryRow = {
  suite: string;
  pass: number | string;
  fail: number;
  known: number;
  result: string;
};

type Verification = {
  root: string;
  packages: string[];
  logs: string;
  phase: number;
  rows: SummaryRow[];
  failed: boolean;
};

type Suite = {
  suite: string;
  cwd: string;
  args: string[];
};

function nextLog(state: Verification, name: string): string {
  state.phase++;
  return join(state.logs, `${state.phase}-${name}.log`);
}

async function prepareVerification(state: Verification, selected: readonly string[]): Promise<void> {
  const prepare = (args: string[], cwd = state.root) => {
    return must(args, { cwd, log: nextLog(state, "prepare") });
  };

  await prepare(["bun", "run", "panda"], resolve("web"));
  // The Nitro dev-asset test mounts web/dist, which only a client build creates.
  if (selected.includes("web") && !existsSync("web/dist/index.html")) {
    console.log("web/dist missing: building the web client for the Nitro asset test.");
    await prepare(["bun", "x", "vite", "build"], resolve("web"));
  }
  const boot = "web/src/keating/nodepod-boot-files.ts";
  const before = existsSync(boot) ? await readFile(boot, "utf8") : "";
  await prepare(["bun", "scripts/generate-nodepod-boot-files.ts"]);
  const unchanged = before === await readFile(boot, "utf8");
  const outcome = unchanged ? "unchanged" : "CHANGED — review generated source before release";
  console.log(`NodePod boot files: ${outcome}`);

  await prepare(["bun", "x", "tsc", "-p", "tsconfig.json"]);
  await prepare(["bun", "scripts/copy-core-templates.ts"]);
}

async function runTypechecks(state: Verification): Promise<void> {
  const directories = [
    state.root,
    resolve("web"),
    resolve("mobile"),
    ...state.packages.map(name => resolve("packages", name)),
  ];

  for (const cwd of directories) {
    const result = await run(["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.json"], {
      cwd,
      log: nextLog(state, "typecheck"),
    });
    const failed = result.code !== 0;
    const label = cwd === state.root ? "root" : cwd.slice(state.root.length + 1);
    state.failed ||= failed;
    state.rows.push({
      suite: `typecheck:${label}`,
      pass: failed ? 0 : "OK",
      fail: failed ? 1 : 0,
      known: 0,
      result: failed ? "FAILED" : "OK",
    });
  }
}

async function verificationSuites(state: Verification): Promise<Suite[]> {
  const contracts = state.packages
    .filter(name => existsSync(join("packages", name, "test")))
    .map(name => ({
      suite: "contracts",
      cwd: resolve("packages", name),
      args: ["bun", "test", "./test"],
    }));
  const flueTests = (await readdir("spikes/flue-host/test"))
    .filter(file => file.endsWith(".test.ts"))
    .map(file => `test/${file}`);

  return [
    { suite: "root", cwd: state.root, args: ["bun", "run", "test"] },
    ...contracts,
    { suite: "web", cwd: resolve("web"), args: ["bun", "test"] },
    { suite: "mobile", cwd: resolve("mobile"), args: ["bun", "run", "test"] },
    {
      suite: "flue",
      cwd: resolve("spikes/flue-host"),
      args: [
        "node",
        "--experimental-strip-types",
        "--test",
        "--test-reporter=tap",
        "--test-concurrency=1",
        ...flueTests,
      ],
    },
    { suite: "flue", cwd: resolve("spikes/flue-host"), args: ["bun", "run", "test:contracts"] },
  ];
}

function suitePassed(
  code: number,
  parsed: ReturnType<typeof parseTestOutput>,
  accepted: number,
): boolean {
  if (parsed.errors !== 0 || !parsed.hasSummary) return false;
  if (code === 0) return parsed.failed === 0;

  // A failed process without exact test evidence remains an infrastructure failure.
  return parsed.failed > 0
    && parsed.failed === parsed.failures.length
    && accepted === parsed.failed;
}

async function runSuites(state: Verification, selected: string[]): Promise<void> {
  const suites = await verificationSuites(state);
  for (const { suite, cwd, args } of suites.filter(item => selected.includes(item.suite))) {
    const result = await run(args, { cwd, log: nextLog(state, suite) });
    const parsed = parseTestOutput(result.output);
    const matches = matchFailures(suite, parsed.failures, known as KnownFailure[]);
    const accepted = matches.filter(match => match.known);
    const ok = suitePassed(result.code, parsed, accepted.length);
    let outcome = "FAILED";
    if (ok) outcome = accepted.length ? "KNOWN ONLY" : "OK";

    state.failed ||= !ok;
    const label = cwd === state.root ? "." : cwd.slice(state.root.length + 1);
    state.rows.push({
      suite: `${suite}:${label}`,
      pass: parsed.passes,
      fail: parsed.failed,
      known: accepted.length,
      result: outcome,
    });
    for (const match of matches) {
      const category = match.known ? "KNOWN" : "NEW";
      const reason = match.known ? ` — ${match.known.reason}` : "";
      console.log(`${category} ${suite}: ${match.name}${reason}`);
    }
  }
}

function printSummary(state: Verification): number {
  console.table(state.rows);
  console.log(`Logs: ${state.logs}`);
  return state.failed ? 1 : 0;
}

/**
 * Prepare generated/build files and run checks sequentially, writing phase logs.
 * Returns 0 for a plan or only expected failures, 1 for failures; throws usage/timeout errors (2/3).
 */
export async function verify(options: Options): Promise<number> {
  const selected = String(options.flags.only ?? "root,contracts,web,mobile,flue,typecheck").split(",");
  const allowed = ["root", "contracts", "web", "mobile", "flue", "typecheck"];
  if (selected.some(suite => !allowed.includes(suite))) {
    throw new OpsError("Unknown --only suite. Use root,contracts,web,mobile,flue,typecheck.");
  }
  const root = process.cwd();
  const packages = (await readdir("packages"))
    .filter(name => existsSync(join("packages", name, "tsconfig.json")))
    .sort();
  console.log(
    `Verify sequentially: ${selected.join(", ")}\n`
    + "Prerequisites: web Panda; web client build when web/dist is missing; "
    + "regenerate NodePod boot files (report changes); root build + templates.\n"
    + "Typechecks cover root, web, mobile and packages when typecheck is selected. "
    + "Contracts covers package tests; Flue covers standalone and persistence contracts. "
    + "Browser NodePod/E2E and native platform builds are separate.",
  );
  if (options.flags["dry-run"]) return 0;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logs = join(root, ".keating/ops", `verify-${timestamp}`);
  await mkdir(logs, { recursive: true });
  const state: Verification = { root, packages, logs, phase: 0, rows: [], failed: false };

  await prepareVerification(state, selected);
  if (selected.includes("typecheck")) {
    await runTypechecks(state);
  }
  await runSuites(state, selected);
  return printSummary(state);
}
