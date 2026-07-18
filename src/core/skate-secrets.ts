import { spawnSync } from "node:child_process";

/**
 * Resolve a secret from the `skate` CLI (charmbracelet key-value store).
 * Names may target a db with the `key@db` form, e.g. "minimax@secrets".
 * Returns undefined when skate is missing, exits non-zero, or holds no value.
 */
export function resolveSkateSecret(name: string): string | undefined {
  try {
    const result = spawnSync("skate", ["get", name], { encoding: "utf8" });
    if (result.status !== 0) return undefined;
    const value = result.stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The MiniMax key used by the e2e harness: env var first, then the
 * shared Skate secrets db. Never throws.
 */
export function resolveMinimaxApiKey(): string | undefined {
  return process.env.MINIMAX_API_KEY || resolveSkateSecret("minimax@secrets");
}
