import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

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
    console.error("  cd web && bun run build");
    process.exit(1);
  }

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
