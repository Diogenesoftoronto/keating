import { existsSync, statSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { loadKeatingConfig, mergePiDefaults } from "../core/config.js";
import { ensureProjectScaffold } from "../core/project.js";
import { sessionsDir, configDir } from "../core/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function resolveEmbeddedAgent(): Promise<AiRuntimeDetails | null> {
  const base = join(homedir(), ".local", "share", "keating");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry: any) => entry.isDirectory())
    .map((entry: any) => entry.name)
    .sort()
    .reverse();

  for (const name of dirs) {
    const appRoot = join(base, name, "app");
    for (const [scope, pkg] of CLI_AGENT_PACKAGES) {
      const cliPath = join(appRoot, "node_modules", scope, pkg, "dist", "cli.js");
      if (existsSync(cliPath)) {
        return { kind: "embedded-keating", command: process.execPath, cliPath };
      }
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
  const report = await detectAiRuntime(cwd);
  const runtime = report.selected;
  if (!runtime) {
    if (report.preference === "standalone-only") {
      throw new Error(
        "Keating is configured for standalone-only but no AI agent binary was found on PATH. Install `@mariozechner/pi-coding-agent` or change `pi.runtimePreference` in keating.config.json."
      );
    }
    throw new Error("Could not find an AI runtime matching the current Keating runtime preference.");
  }

  const isDist = __dirname.replace(/\\/g, "/").includes("/dist/src/runtime");
  // Resolve paths relative to package root
  const packageRoot = isDist ? join(__dirname, "..", "..", "..") : join(__dirname, "..", "..");

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
