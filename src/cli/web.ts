import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { access, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

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

  console.warn("\x1b[33mWarning: web sources are newer than web/.output.\x1b[0m");
  console.warn("`keating web` serves the last production build, not the live Vite source tree.");
  console.warn("Use `mise run web` for hot reload, or rebuild with `bun run --cwd web build` before launching.");
}

/**
 * Starts the Keating Web UI server using Nitro.
 * Port-incrementing logic is now handled by Nitro's runtime 
 * or can be passed via the PORT environment variable.
 */
export async function serveWeb(port = 3000): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Navigate from dist/src/cli/web.js to project root
  const pkgRoot = join(currentDir, "..", "..", "..");
  const nitroServerPath = join(pkgRoot, "web", ".output", "server", "index.mjs");

  try {
    await access(nitroServerPath);
  } catch (error) {
    console.error(`\x1b[31mError: Could not find Nitro server at ${nitroServerPath}\x1b[0m`);
    console.error("Please run the build command first:");
    console.error("  bun run --cwd web build");
    process.exit(1);
  }

  await warnIfWebBuildIsStale(pkgRoot, nitroServerPath);

  process.stdout.write(`\x1b[32m🚀 Starting Keating Nitro Server on port ${port}...\x1b[0m\n`);

  const env = { 
    ...process.env, 
    PORT: port.toString(),
    NITRO_PORT: port.toString()
  };

  // Run the Nitro server in a child process
  const child = spawn(process.execPath, [nitroServerPath], {
    env,
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error("\x1b[31mFailed to start Nitro server:\x1b[0m", err);
  });

  // Handle termination signals
  const cleanup = () => {
    child.kill();
    process.exit();
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
