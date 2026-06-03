#!/usr/bin/env node
/**
 * Sync version numbers across the Keating monorepo.
 * Usage: node scripts/sync-version.mjs [--check]
 *   --check: exit 1 if any files are out of sync, 0 otherwise
 *   default: update all files to the version in package.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const webDir = join(rootDir, "web");
const browserAgentRuntimeDir = join(rootDir, "packages", "browser-agent-runtime");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readFile(path) {
  return readFileSync(path, "utf-8");
}

function writeFile(path, content) {
  writeFileSync(path, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Source of truth: root package.json
// ---------------------------------------------------------------------------
const rootPkg = readJson(join(rootDir, "package.json"));
const targetVersion = rootPkg.version;

if (!/^\d+\.\d+\.\d+/.test(targetVersion)) {
  console.error(`Invalid version in package.json: ${targetVersion}`);
  process.exit(1);
}

const files = [
  // Package manifests
  { path: join(webDir, "package.json"), pattern: /"version":\s*"[^"]+"/, replacement: `"version": "${targetVersion}"` },
  { path: join(browserAgentRuntimeDir, "package.json"), pattern: /"version":\s*"[^"]+"/, replacement: `"version": "${targetVersion}"` },

  // Extension / CLI
  { path: join(rootDir, "src/pi/hyperteacher-extension.ts"), pattern: /const KEATING_VERSION = "[^"]+"/, replacement: `const KEATING_VERSION = "${targetVersion}"` },

  // Web UI hardcoded strings
  { path: join(webDir, "index.html"), pattern: /"softwareVersion":\s*"[^"]+"/, replacement: `"softwareVersion": "${targetVersion}"` },
  { path: join(webDir, "src/components/ChatIntro.tsx"), pattern: /INIT SEQUENCE v[\d.]+/, replacement: `INIT SEQUENCE v${targetVersion}` },
  { path: join(webDir, "src/og-image.tsx"), pattern: /v[\d.]+<\/span>/, replacement: `v${targetVersion}</span>` },
];

let errors = 0;

for (const { path, pattern, replacement } of files) {
  const content = readFile(path);
  const match = content.match(pattern);
  if (!match) {
    console.error(`  ❌ No match for ${pattern} in ${path}`);
    errors++;
    continue;
  }

  const current = match[0];
  if (current !== replacement) {
    if (process.argv.includes("--check")) {
      console.error(`  ❌ Out of sync: ${path} has "${current}", expected "${replacement}"`);
      errors++;
    } else {
      const updated = content.replace(pattern, replacement);
      writeFile(path, updated);
      console.log(`  ✓ Updated ${path}`);
    }
  } else {
    console.log(`  ✓ OK     ${path}`);
  }
}

if (errors > 0) {
  console.error(`\n${errors} file(s) out of sync.`);
  process.exit(1);
} else {
  console.log(`\nAll files synced to ${targetVersion}.`);
}
