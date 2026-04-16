import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { loadKeatingConfig, mergePiDefaults } from "../core/config.js";
import { ensureProjectScaffold } from "../core/project.js";
import { sessionsDir } from "../core/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PiRuntimeDetails {
  kind: "binary" | "embedded-keating";
  command: string;
  cliPath?: string;
}

export interface PiRuntimeReport {
  selected: PiRuntimeDetails | null;
  standalone: PiRuntimeDetails | null;
  embedded: PiRuntimeDetails | null;
  preference: "standalone-only" | "prefer-standalone" | "embedded-only";
}

function resolveStandalonePi(): PiRuntimeDetails | null {
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

async function resolveEmbeddedPi(): Promise<PiRuntimeDetails | null> {
  const base = join(homedir(), ".local", "share", "keating");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry: any) => entry.isDirectory())
    .map((entry: any) => entry.name)
    .sort()
    .reverse();

  for (const name of dirs) {
    const appRoot = join(base, name, "app");
    const cliPath = join(appRoot, "node_modules", "@interleavelove", "keating-coding-agent", "dist", "cli.js");
    if (existsSync(cliPath)) {
      return {
        kind: "embedded-keating",
        command: process.execPath,
        cliPath
      };
    }
  }

  return null;
}

export async function detectPiRuntime(cwd: string): Promise<PiRuntimeReport> {
  const config = await loadKeatingConfig(cwd);
  const standalone = resolveStandalonePi();
  const embedded = await resolveEmbeddedPi();

  let selected: PiRuntimeDetails | null = null;
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

export async function launchPi(cwd: string, args: string[]): Promise<number> {
  await ensureProjectScaffold(cwd);
  const config = await loadKeatingConfig(cwd);
  const report = await detectPiRuntime(cwd);
  const runtime = report.selected;
  if (!runtime) {
    if (report.preference === "standalone-only") {
      throw new Error(
        "Keating is configured for a fresh standalone Pi install, but no `pi` binary was found on PATH. Install `@mariozechner/pi-coding-agent` or change `pi.runtimePreference` in keating.config.json."
      );
    }
    throw new Error("Could not find a Pi runtime matching the current Keating runtime preference.");
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
            PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1"
          }
        })
      : spawn(runtime.command, [runtime.cliPath!, ...sharedArgs], {
          cwd,
          stdio: "inherit",
          env: {
            ...process.env,
            PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1"
          }
        });

  return await new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code: number | null) => resolvePromise(code ?? 0));
  });
}
