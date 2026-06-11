#!/usr/bin/env bun
/**
 * sync-version.ts — Single-source-of-truth version synchroniser
 *
 * Reads the canonical version from the root package.json and writes it
 * into every tracked file that embeds the version string.
 *
 * Usage:
 *   bun scripts/sync-version.ts [--check]
 *
 * --check   : read-only; exits 1 if anything is out of sync
 * --verbose : print every file checked even if unchanged
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Files that must contain the root package.json version
// ---------------------------------------------------------------------------

interface Target {
  path: string;
  description: string;
  matcher: RegExp;
  replacer: (version: string) => string;
  optional?: boolean; // if the file is allowed to be missing (e.g. future files)
}

const targets: Target[] = [
  {
    path: "web/package.json",
    description: "Web package manifest",
    matcher: /"version":\s*"[\d.]+"/,
    replacer: (v) => `"version": "${v}"`,
  },
  {
    path: "packages/browser-agent-runtime/package.json",
    description: "Browser agent runtime package manifest",
    matcher: /"version":\s*"[\d.]+"/,
    replacer: (v) => `"version": "${v}"`,
  },
  {
    path: "src/core/version.ts",
    description: "Core version fallback",
    matcher: /return\s+"[\d.]+";/,
    replacer: (v) => `return "${v}";`,
  },
  {
    path: "bin/keating.js",
    description: "Binary entrypoint fallback",
    matcher: /KEATING_VERSION\s*=\s*"[\d.]+";/,
    replacer: (v) => `KEATING_VERSION = "${v}";`,
  },
  {
    path: "web/index.html",
    description: "Schema.org softwareVersion in HTML",
    matcher: /"softwareVersion":\s*"[\d.]+"/,
    replacer: (v) => `"softwareVersion": "${v}"`,
  },
  {
    path: "web/src/components/ChatIntro.tsx",
    description: "Terminal init-sequence banner",
    matcher: /INIT SEQUENCE v[\d.]+/,
    replacer: (v) => `INIT SEQUENCE v${v}`,
  },
  {
    path: "web/src/og-image.tsx",
    description: "OG image version badge",
    matcher: />v[\d.]+</,
    replacer: (v) => `>v${v}<`,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadRootVersion(): string {
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  if (!/^\d+\.\d+\.\d+/.test(pkg.version)) {
    throw new Error(`Invalid version in package.json: ${pkg.version}`);
  }
  return pkg.version;
}

function applySync(
  rootVersion: string,
  target: Target
): { changed: boolean; current: string | null; error?: string } {
  const fullPath = join(process.cwd(), target.path);
  let content: string;
  try {
    content = readFileSync(fullPath, "utf8");
  } catch (e) {
    if (target.optional) {
      return { changed: false, current: null, error: "file missing (optional)" };
    }
    return { changed: false, current: null, error: `file missing: ${fullPath}` };
  }

  if (!target.matcher.test(content)) {
    return { changed: false, current: null, error: `pattern not found` };
  }

  const nextContent = content.replace(target.matcher, target.replacer(rootVersion));
  if (nextContent === content) {
    const match = content.match(target.matcher);
    return { changed: false, current: match?.[0] ?? null };
  }

  writeFileSync(fullPath, nextContent, "utf8");
  const match = content.match(target.matcher);
  return { changed: true, current: match?.[0] ?? null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const checkMode = process.argv.includes("--check");
const verbose = process.argv.includes("--verbose");
const rootVersion = loadRootVersion();

let errors = 0;
let changed = 0;
let ok = 0;

console.log(`Canonical version: ${rootVersion}\n`);

for (const target of targets) {
  const result = applySync(rootVersion, target);

  if (result.error) {
    errors += 1;
    console.log(`  ${target.description}`);
    console.log(`    ${target.path}`);
    console.log(`    ${" ".repeat(4)}ERROR: ${result.error}`);
    continue;
  }

  const status = result.changed
    ? (checkMode ? "OUT OF SYNC" : "UPDATED")
    : "OK";

  if (result.changed) changed += 1;
  else ok += 1;

  if (checkMode && result.changed) {
    errors += 1;
    console.log(`  ${target.description}`);
    console.log(`    ${target.path}`);
    console.log(`    ${" ".repeat(4)}${status}  (was: ${result.current})`);
  } else if (result.changed || verbose) {
    console.log(`  ${target.description}`);
    console.log(`    ${target.path}`);
    console.log(`    ${" ".repeat(4)}${status}${result.current ? `  (${result.current})` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
if (errors > 0) {
  if (checkMode) {
    console.log(`${errors} file(s) out of sync. Run without --check to fix.`);
  } else {
    console.log(`${errors} file(s) had errors.`);
  }
  process.exit(1);
}

if (changed > 0) {
  console.log(`All syncd — ${changed} file(s) updated.`);
} else {
  console.log("All files already in sync.");
}
