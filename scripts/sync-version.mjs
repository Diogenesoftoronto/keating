#!/usr/bin/env node
/** Compatibility entry point. Keep all version rules in sync-version.ts. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync("bun", [fileURLToPath(new URL("./sync-version.ts", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
