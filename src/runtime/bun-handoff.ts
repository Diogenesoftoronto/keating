import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";

type SpawnBun = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnSyncReturns<Buffer>;

export interface BunHandoffOptions {
  packageRoot: string;
  entryPath: string;
  args: readonly string[];
  platform?: NodeJS.Platform;
  spawn?: SpawnBun;
}

export interface BunHandoffResult {
  launched: boolean;
  exitCode: number;
  candidate?: string;
}

/**
 * OpenTUI currently requires Bun's native FFI. Released standalone bundles
 * carry a private Bun binary; npm/global installs may use Bun from PATH.
 */
export function handoffOpenTuiToBun(options: BunHandoffOptions): BunHandoffResult {
  const platform = options.platform ?? process.platform;
  const bundledName = platform === "win32" ? "bun.exe" : "bun";
  const candidates = [join(options.packageRoot, "runtime", bundledName), bundledName];
  const spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));

  for (const candidate of candidates) {
    const result = spawn(candidate, [options.entryPath, ...options.args], { stdio: "inherit" });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (result.error) return { launched: true, exitCode: 1, candidate };
    return { launched: true, exitCode: result.status ?? 1, candidate };
  }
  return { launched: false, exitCode: 1 };
}
