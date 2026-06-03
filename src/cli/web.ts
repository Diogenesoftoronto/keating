import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { access, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { color } from "../core/theme.js";

export type WebAgentRuntimeMode = "browser-only" | "remote" | "cloud";

export interface ServeWebOptions {
  agentRuntimeMode?: WebAgentRuntimeMode;
  remoteProvider?: string;
  remoteEndpoint?: string;
  remoteRegion?: string;
  remoteSnapshot?: string;
  remoteCpu?: string;
  remoteMemory?: string;
  remoteDisk?: string;
  cloudEndpoint?: string;
}

const WEB_SOURCE_PATHS = [
  "src",
  "public",
  "index.html",
  "package.json",
  "vite.config.ts",
  "nitro.config.ts",
];

async function newestMtimeMs(path: string): Promise<number> {
  try {
    const entry = await stat(path);
    if (!entry.isDirectory()) return entry.mtimeMs;

    let newest = entry.mtimeMs;
    const children = await readdir(path, { withFileTypes: true });
    for (const child of children) {
      newest = Math.max(newest, await newestMtimeMs(join(path, child.name)));
    }
    return newest;
  } catch {
    return 0;
  }
}

async function warnIfWebBuildIsStale(pkgRoot: string, nitroServerPath: string): Promise<void> {
  const buildMtimeMs = (await stat(nitroServerPath)).mtimeMs;
  const webRoot = join(pkgRoot, "web");

  let newestSourceMtimeMs = 0;
  for (const relativePath of WEB_SOURCE_PATHS) {
    newestSourceMtimeMs = Math.max(newestSourceMtimeMs, await newestMtimeMs(join(webRoot, relativePath)));
  }

  if (newestSourceMtimeMs <= buildMtimeMs) return;

  console.warn(`${color.warn}Warning: web sources are newer than web/.output.${color.reset}`);
  console.warn("`keating web` serves the last production build, not the live Vite source tree.");
  console.warn("Use `mise run web` for hot reload, or rebuild with `bun run --cwd web build` before launching.");
}

async function resolvePackageRoot(currentDir: string): Promise<string> {
  const candidates = [
    join(currentDir, "..", "..", ".."), // dist/src/cli/web.js -> project root
    join(currentDir, "..", ".."), // src/cli/web.ts -> project root
  ];

  for (const candidate of candidates) {
    const nitroServerPath = join(candidate, "web", ".output", "server", "index.mjs");
    try {
      await access(nitroServerPath);
      return candidate;
    } catch {
      // Keep looking; source and compiled entrypoints sit at different depths.
    }
  }

  return candidates[0];
}

/**
 * Starts the Keating Web UI server using Nitro.
 * Port-incrementing logic is now handled by Nitro's runtime 
 * or can be passed via the PORT environment variable.
 */
export async function serveWeb(port = 3000, options: ServeWebOptions = {}): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = await resolvePackageRoot(currentDir);
  const nitroServerPath = join(pkgRoot, "web", ".output", "server", "index.mjs");

  try {
    await access(nitroServerPath);
  } catch (error) {
    console.error(`${color.err}Error: Could not find Nitro server at ${nitroServerPath}${color.reset}`);
    console.error("Please run the build command first:");
    console.error("  bun run --cwd web build");
    process.exit(1);
  }

  await warnIfWebBuildIsStale(pkgRoot, nitroServerPath);

  const mode = options.agentRuntimeMode ?? "browser-only";
  process.stdout.write(`${color.ok}${color.bold} Keating Web Server ${color.reset}  ${color.parchment}port ${port}${color.reset}  ${color.sepia}agent=${mode}${color.reset}\n`);

  const env = { 
    ...process.env, 
    PORT: port.toString(),
    NITRO_PORT: port.toString(),
    KEATING_WEB_AGENT_MODE: mode,
    KEATING_WEB_REMOTE_PROVIDER: options.remoteProvider ?? process.env.KEATING_WEB_REMOTE_PROVIDER ?? "",
    KEATING_WEB_REMOTE_ENDPOINT: options.remoteEndpoint ?? process.env.KEATING_WEB_REMOTE_ENDPOINT ?? "",
    KEATING_WEB_REMOTE_REGION: options.remoteRegion ?? process.env.KEATING_WEB_REMOTE_REGION ?? "",
    KEATING_WEB_REMOTE_SNAPSHOT: options.remoteSnapshot ?? process.env.KEATING_WEB_REMOTE_SNAPSHOT ?? "",
    KEATING_WEB_REMOTE_CPU: options.remoteCpu ?? process.env.KEATING_WEB_REMOTE_CPU ?? "",
    KEATING_WEB_REMOTE_MEMORY: options.remoteMemory ?? process.env.KEATING_WEB_REMOTE_MEMORY ?? "",
    KEATING_WEB_REMOTE_DISK: options.remoteDisk ?? process.env.KEATING_WEB_REMOTE_DISK ?? "",
    KEATING_WEB_CLOUD_ENDPOINT: options.cloudEndpoint ?? process.env.KEATING_WEB_CLOUD_ENDPOINT ?? "https://keating.help"
  };

  // Run the Nitro server in a child process
  const child = spawn(process.execPath, [nitroServerPath], {
    env,
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error(`${color.err}Failed to start Nitro server:${color.reset}`, err);
  });

  // Handle termination signals
  const cleanup = () => {
    child.kill();
    process.exit();
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
