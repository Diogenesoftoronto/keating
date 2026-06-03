import { existsSync, statSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { FALLBACK_PI_MODELS, type KeatingConfig, loadKeatingConfig, mergePiDefaultsWithOverrides } from "../core/config.js";
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
      "",
      "Recover with one of:",
      "  npm install -g @earendil-works/pi-coding-agent",
      "  keating setup",
      "  edit keating.config.json and set pi.runtimePreference to prefer-standalone"
    ].join("\n");
  }

  if (report.preference === "embedded-only") {
    return [
      "Keating is configured for embedded-only but no embedded AI agent was found.",
      "",
      "Recover with one of:",
      "  npm install -g @earendil-works/pi-coding-agent",
      "  keating setup",
      "  npm install -g keating"
    ].join("\n");
  }

  return [
    "Could not find an AI runtime.",
    "",
    "Recover with one of:",
    "  npm install -g @earendil-works/pi-coding-agent",
    "  npm install -g keating",
    "  curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash"
  ].join("\n");
}

function resolveStandaloneAgent(): AiRuntimeDetails | null {
  const result = spawnSync("which", ["pi"], { encoding: "utf8", env: process.env });
  if (result.status === 0 && result.stdout.trim()) {
    const command = result.stdout.trim();
    const versionResult = spawnSync(command, ["--version"], { encoding: "utf8", env: process.env });
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
  ["@earendil-works", "pi-coding-agent"],
  ["@interleavelove", "keating-coding-agent"],
  ["@mariozechner", "pi-coding-agent"],
];

const ZYPHRA_PI_PROVIDER = {
  baseUrl: "https://api.zyphracloud.com/v1",
  api: "openai-completions",
  apiKey: "ZYPHRA_API_KEY",
  models: [
    { id: "zyphra/ZAYA1-8B", name: "ZAYA1-8B" }
  ]
} as const;

async function syncZyphraProvider(cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!env.ZYPHRA_API_KEY) return;

  const modelsPath = join(configDir(cwd), "models.json");
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(modelsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    existing = {};
  }

  const providers = (existing.providers as Record<string, unknown>) ?? {};
  const merged = { ...existing, providers: { ...providers, zyphra: ZYPHRA_PI_PROVIDER } };
  await mkdir(configDir(cwd), { recursive: true });
  await writeFile(modelsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

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

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  zyphra: ["ZYPHRA_API_KEY"]
};

const PROVIDER_SETUP_HINTS: Record<string, string[]> = {
  google: [
    "export GEMINI_API_KEY=your_google_ai_studio_key",
    "or run `keating setup` and choose another provider"
  ],
  openai: [
    "export OPENAI_API_KEY=your_openai_key",
    "or run `keating setup` and choose another provider"
  ],
  anthropic: [
    "export ANTHROPIC_API_KEY=your_anthropic_key",
    "or run `keating setup` and choose another provider"
  ],
  openrouter: [
    "export OPENROUTER_API_KEY=your_openrouter_key",
    "get a free key at https://openrouter.ai (free models available, no credit card required)",
    "or run `keating setup` and choose another provider"
  ],
  zyphra: [
    "export ZYPHRA_API_KEY=your_zyphra_key",
    "get a key at https://cloud.zyphra.com",
    "or run `keating setup` and choose another provider"
  ]
};

interface ProviderAuthSelection {
  provider?: string;
  model?: string;
  env: NodeJS.ProcessEnv;
  note?: string;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
}

function flagValue(args: string[], flag: string): string | undefined {
  const equalsArg = args.find((arg) => arg.startsWith(`${flag}=`));
  if (equalsArg) return equalsArg.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function authJsonHasProvider(cwd: string, provider: string): boolean {
  const path = join(configDir(cwd), "auth.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return Boolean(parsed?.[provider]);
  } catch {
    return false;
  }
}

function envHasProvider(env: NodeJS.ProcessEnv, provider: string): boolean {
  return (PROVIDER_ENV_KEYS[provider] ?? []).some((key) => Boolean(env[key]));
}

function providerIsConfigured(cwd: string, env: NodeJS.ProcessEnv, provider: string): boolean {
  return envHasProvider(env, provider) || authJsonHasProvider(cwd, provider);
}

function envWithProviderAliases(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.GEMINI_API_KEY && env.GOOGLE_API_KEY) {
    return { ...env, GEMINI_API_KEY: env.GOOGLE_API_KEY };
  }
  return { ...env };
}

function providerSetupMessage(provider: string): string {
  const hints = PROVIDER_SETUP_HINTS[provider] ?? [
    `set the API key expected by provider "${provider}"`,
    "or run `keating setup` and choose a configured provider"
  ];
  return [
    `No credentials found for provider "${provider}".`,
    "",
    "Recover with:",
    ...hints.map((hint) => `  ${hint}`),
    "  pi /login",
    "",
    "Then retry: keating shell"
  ].join("\n");
}

function selectAuthenticatedProvider(cwd: string, config: KeatingConfig, args: string[]): ProviderAuthSelection {
  const env = envWithProviderAliases(process.env);
  if (hasFlag(args, "--list-models") || hasFlag(args, "--list-providers")) return { env };

  const hasExplicitProvider = hasFlag(args, "--provider");
  const hasExplicitModel = hasFlag(args, "--model");
  const hasExplicitApiKey = hasFlag(args, "--api-key");
  const configuredProvider = config.pi.defaultProvider ?? "google";

  if (hasExplicitProvider) {
    const provider = flagValue(args, "--provider");
    if (provider && !hasExplicitApiKey && PROVIDER_ENV_KEYS[provider] && !providerIsConfigured(cwd, env, provider)) {
      throw new Error(providerSetupMessage(provider));
    }
    return { env };
  }

  const candidates = [configuredProvider, "google", "openai", "anthropic", "openrouter", "zyphra"].filter((provider, index, all) =>
    provider && all.indexOf(provider) === index
  );
  const selected = candidates.find((provider) => providerIsConfigured(cwd, env, provider));
  if (!selected) {
    throw new Error([
      providerSetupMessage(configuredProvider),
      "",
      "Keating also checked for OpenAI, Anthropic, OpenRouter, and Zyphra credentials and did not find them.",
      "Supported fallback env vars:",
      "  GEMINI_API_KEY or GOOGLE_API_KEY",
      "  OPENAI_API_KEY",
      "  ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN",
      "  OPENROUTER_API_KEY (free models available at https://openrouter.ai)",
      "  ZYPHRA_API_KEY (ZAYA1-8B via https://cloud.zyphra.com)"
    ].join("\n"));
  }

  if (selected === configuredProvider) return { env };

  return {
    provider: selected,
    model: hasExplicitModel ? undefined : FALLBACK_PI_MODELS[selected],
    env,
    note: `No credentials found for "${configuredProvider}". Using configured ${selected} credentials instead.`
  };
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
      const nmDirs = nmEntries.filter((e: any) => e.isDirectory() || (e.isSymbolicLink() && (() => { try { return statSync(join(nmDir, e.name)).isDirectory(); } catch { return false; } })()));
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
  await syncZyphraProvider(cwd, process.env);
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
    throw new Error([
      `Missing built extension: ${extensionPath}.`,
      "",
      "Recover with:",
      "  bun run build",
      "  npm run build",
      "",
      "If this came from an installed package, reinstall Keating:",
      "  npm install -g keating"
    ].join("\n"));
  }

  const promptDir = join(packageRoot, "pi", "prompts");
  const skillsDir = join(packageRoot, "pi", "skills");
  const systemPromptPath = join(packageRoot, "SYSTEM.md");
  const systemPrompt = readFileSync(systemPromptPath, "utf8");
  const authSelection = selectAuthenticatedProvider(cwd, config, args);
  if (authSelection.note) {
    console.error(authSelection.note);
  }

  const sharedArgs = mergePiDefaultsWithOverrides(config, [
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
  ], { provider: authSelection.provider, model: authSelection.model });

  const child =
    runtime.kind === "binary"
      ? spawn(runtime.command, sharedArgs, {
          cwd,
          stdio: "inherit",
          env: {
            ...authSelection.env,
            PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
            PI_CODING_AGENT_DIR: configDir(cwd)
          }
        })
      : spawn(runtime.command, [runtime.cliPath!, ...sharedArgs], {
          cwd,
          stdio: "inherit",
          env: {
            ...authSelection.env,
            PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
            PI_CODING_AGENT_DIR: configDir(cwd)
          }
        });

  return await new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code: number | null) => resolvePromise(code ?? 0));
  });
}
