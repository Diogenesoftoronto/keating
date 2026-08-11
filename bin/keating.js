#!/usr/bin/env node
const MIN_NODE_VERSION = "20.19.0";

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let KEATING_VERSION;
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
  KEATING_VERSION = pkg.version;
} catch {
  KEATING_VERSION = "3.4.1";
}

function parseNodeVersion(version) {
  const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/, "").split(".");
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
  };
}

function compareNodeVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

if (compareNodeVersions(parseNodeVersion(process.versions.node), parseNodeVersion(MIN_NODE_VERSION)) < 0) {
  const isWindows = process.platform === "win32";
  console.error(`keating requires Node.js ${MIN_NODE_VERSION} or later (detected ${process.versions.node}).`);
  console.error(isWindows
    ? "Install a newer Node.js from https://nodejs.org, or use the standalone installer:"
    : "Switch to Node 20 with `nvm install 20 && nvm use 20`, or use the standalone installer:");
  console.error(isWindows
    ? "irm https://keating.help/install.ps1 | iex"
    : "curl -fsSL https://keating.help/install | bash");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "version")) {
  console.log(`keating ${KEATING_VERSION}`);
  process.exit(0);
}

if (args[0] === "tui" && !process.versions.bun) {
  const { handoffOpenTuiToBun } = await import(new URL("../dist/src/runtime/bun-handoff.js", import.meta.url).href);
  const handoff = handoffOpenTuiToBun({
    packageRoot: join(__dirname, ".."),
    entryPath: fileURLToPath(import.meta.url),
    args,
  });
  if (!handoff.launched) {
    console.error("keating tui requires Bun because OpenTUI uses Bun native FFI.");
    console.error("Install Bun from https://bun.sh or use the Keating standalone bundle, which includes a private Bun runtime.");
  }
  process.exit(handoff.exitCode);
}

await import(new URL("../dist/src/cli/main.js", import.meta.url).href);
