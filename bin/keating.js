#!/usr/bin/env node
const MIN_NODE_VERSION = "20.19.0";

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

await import(new URL("../dist/src/cli/main.js", import.meta.url).href);
