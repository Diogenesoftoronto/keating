import { existsSync, statSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { type KeatingConfig, loadKeatingConfig, mergePiDefaults } from "../core/config.js";
import { ensureProjectScaffold } from "../core/project.js";
import { sessionsDir, configDir } from "../core/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePackageRoot(): string {
  const override = process.env.KEATING_PACKAGE_ROOT_OVERRIDE;
  if (override) return resolve(override);

  const normalizedDir = __dirname.replace(/\\/g, "/");
  return normalizedDir.includes("/dist/src/runtime")
    ? join(__dirname, "..", "..", "..")
    : join(__dirname, "..", "..");
}

export interface AiRuntimeDetails {
  kind: "binary" | "embedded-keating";
  command: string;
  cliPath?: string;
}

export interface AiRuntimeReport {
  selected: AiRuntimeDetails | null;
  standalone: AiRuntimeDetails | null;
  embedded: AiRuntimeDetails | null;
  preference: "standalone-only" | "prefer-standalone" | "embedded-only";
}

function missingRuntimeMessage(report: AiRuntimeReport): string {
  if (report.preference === "standalone-only") {
    return [
      "Keating is configured for standalone-only but no `pi` AI agent binary was found on PATH.",
      "Install it with `npm install -g @mariozechner/pi-coding-agent`, or change `pi.runtimePreference` in keating.config.json to `prefer-standalone` after installing an embedded agent."
    ].join(" ");
  }

  if (report.preference === "embedded-only") {
    return [
      "Keating is configured for embedded-only but no embedded AI agent was found.",
      "For a source checkout, install a standalone agent with `npm install -g @mariozechner/pi-coding-agent` and set `pi.runtimePreference` to `prefer-standalone` in keating.config.json.",
      "After the runtime is found, set your model provider API key as usual."
    ].join(" ");
  }

  return [
    "Could not find an AI runtime.",
    "Install `pi` with `npm install -g @mariozechner/pi-coding-agent`, or install Keating from a standalone release bundle that includes an embedded agent."
  ].join(" ");
}

function resolveStandaloneAgent(): AiRuntimeDetails | null {
  const result = spawnSync("which", ["pi"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) {
    const command = result.stdout.trim();
    const versionResult = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (versionResult.status === 0 && /^\d+\.\d+\.\d+/.test(versionResult.stdout.trim())) {
      return {
        kind: "binary",
        command
      };
    }
  }
  return null;
}

const CLI_AGENT_PACKAGES = [
  ["@interleavelove", "keating-coding-agent"],
  ["@mariozechner", "pi-coding-agent"],
];

async function syncPiSettings(cwd: string, config: KeatingConfig): Promise<void> {
  const agentDir = configDir(cwd);
  const settingsPath = join(agentDir, "settings.json");
  let settings: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      settings = parsed as Record<string, unknown>;
    }
  } catch {
    settings = {};
  }

  const quietStartup = !config.debug.consoleSummary;
  if (settings.quietStartup === quietStartup) return;

  await mkdir(agentDir, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify({ ...settings, quietStartup }, null, 2)}\n`, "utf8");
}

function resolveAgentInNodeModules(nodeModulesDir: string): AiRuntimeDetails | null {
  for (const [scope, pkg] of CLI_AGENT_PACKAGES) {
    const cliPath = join(nodeModulesDir, scope, pkg, "dist", "cli.js");
    if (existsSync(cliPath)) {
      return { kind: "embedded-keating", command: process.execPath, cliPath };
    }
  }

  return null;
}

async function resolveEmbeddedAgent(packageRoot = resolvePackageRoot()): Promise<AiRuntimeDetails | null> {
  const local = resolveAgentInNodeModules(join(packageRoot, "node_modules"));
  if (local) return local;

  const base = join(homedir(), ".local", "share", "keating");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry: any) => entry.isDirectory())
    .map((entry: any) => entry.name)
    .sort()
    .reverse();

  for (const name of dirs) {
    for (const root of [join(base, name), join(base, name, "app")]) {
      const embedded = resolveAgentInNodeModules(join(root, "node_modules"));
      if (embedded) return embedded;
    }
  }

  for (const [scope, pkg] of CLI_AGENT_PACKAGES) {
    const globalPrefix = join(homedir(), ".local", "share", "mise", "installs", "node");
    const versionEntries = await readdir(globalPrefix, { withFileTypes: true }).catch(() => []);
    const versionDirs = versionEntries
      .filter((e: any) => e.isDirectory())
      .map((e: any) => e.name)
      .sort()
      .reverse();

    for (const ver of versionDirs) {
      const cliPath = join(globalPrefix, ver, "lib", "node_modules", scope, pkg, "dist", "cli.js");
      if (existsSync(cliPath)) {
        return { kind: "embedded-keating", command: process.execPath, cliPath };
      }
      const nmDir = join(globalPrefix, ver, "lib", "node_modules");
      const nmEntries = await readdir(nmDir, { withFileTypes: true }).catch(() => []);
      const nmDirs = nmEntries.filter((e: any) => e.isDirectory() || (e.isSymbolicLink() && statSync(join(nmDir, e.name)).isDirectory()));
      for (const nmEntry of nmDirs) {
        const nested = join(nmDir, nmEntry.name, "node_modules", scope, pkg, "dist", "cli.js");
        if (existsSync(nested)) {
          return { kind: "embedded-keating", command: process.execPath, cliPath: nested };
        }
      }
    }

    const bunGlobal = join(homedir(), ".bun", "install", "global", "node_modules", scope, pkg, "dist", "cli.js");
    if (existsSync(bunGlobal)) {
      return { kind: "embedded-keating", command: process.execPath, cliPath: bunGlobal };
    }
  }

  return null;
}

export async function detectAiRuntime(cwd: string): Promise<AiRuntimeReport> {
  const config = await loadKeatingConfig(cwd);
  const standalone = resolveStandaloneAgent();
  const embedded = await resolveEmbeddedAgent();

  let selected: AiRuntimeDetails | null = null;
  switch (config.pi.runtimePreference) {
    case "embedded-only":
      selected = embedded;
      break;
    case "prefer-standalone":
      selected = standalone ?? embedded;
      break;
    case "standalone-only":
    default:
      selected = standalone;
      break;
  }

  return {
    selected,
    standalone,
    embedded,
    preference: config.pi.runtimePreference
  };
}

export async function launchShell(cwd: string, args: string[]): Promise<number> {
  await ensureProjectScaffold(cwd);
  const config = await loadKeatingConfig(cwd);
  await syncPiSettings(cwd, config);
  const report = await detectAiRuntime(cwd);
  const runtime = report.selected;
  if (!runtime) {
    throw new Error(missingRuntimeMessage(report));
  }

  const packageRoot = resolvePackageRoot();
  const isDist = __dirname.replace(/\\/g, "/").includes("/dist/src/runtime");

  const extensionPath = isDist
    ? join(__dirname, "..", "pi", "hyperteacher-extension.js")
    : join(packageRoot, "dist", "src", "pi", "hyperteacher-extension.js");

  if (!existsSync(extensionPath)) {
    throw new Error(`Missing built extension: ${extensionPath}. Run npm run build first.`);
  }

  const promptDir = join(packageRoot, "pi", "prompts");
  const skillsDir = join(packageRoot, "pi", "skills");
  const systemPromptPath = join(packageRoot, "SYSTEM.md");
  const systemPrompt = readFileSync(systemPromptPath, "utf8");
  const sharedArgs = mergePiDefaults(config, [
    "--session-dir",
    sessionsDir(cwd),
    "--extension",
    extensionPath,
    "--prompt-template",
    promptDir,
    "--skill",
    skillsDir,
    "--append-system-prompt",
    systemPrompt,
    "--tools",
    "read,bash,edit,write,grep,find,ls",
    ...args
  ]);

  const child =
    runtime.kind === "binary"
      ? spawn(runtime.command, sharedArgs, {
          cwd,
          stdio: "inherit",
          env: {
            ...process.env,
            PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
            PI_CODING_AGENT_DIR: configDir(cwd)
          }
        })
      : spawn(runtime.command, [runtime.cliPath!, ...sharedArgs], {
          cwd,
          stdio: "inherit",
          env: {
            ...process.env,
            PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
            PI_CODING_AGENT_DIR: configDir(cwd)
          }
        });

  return await new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code: number | null) => resolvePromise(code ?? 0));
  });
}
