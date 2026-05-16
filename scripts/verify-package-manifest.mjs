#!/usr/bin/env node
import { readFileSync } from "node:fs";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: node scripts/verify-package-manifest.mjs <npm-pack-json>");
  process.exit(1);
}

const rawManifest = readFileSync(manifestPath, "utf8").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

function extractJsonArray(text) {
  for (let start = text.indexOf("["); start !== -1; start = text.indexOf("[", start + 1)) {
    let next = start + 1;
    while (/\s/.test(text[next] ?? "")) next += 1;
    if (text[next] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }

      if (char === "\"") inString = true;
      else if (char === "[") depth += 1;
      else if (char === "]") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

const json = extractJsonArray(rawManifest);
if (!json) {
  console.error(`Could not find npm pack JSON in ${manifestPath}.`);
  process.exit(1);
}

const pack = JSON.parse(json);
const files = new Set(pack.flatMap((entry) => entry.files.map((file) => file.path)));

const required = [
  "bin/keating.js",
  "dist/src/cli/main.js",
  "dist/src/pi/hyperteacher-extension.js",
  "pi/prompts/learn.md",
  "SYSTEM.md",
  "package.json",
];

const forbidden = [
  "bin/keating.config.json",
  "bin/.keating/pi-config/auth.json",
  "bin/.keating/pi-config/settings.json",
];

const missing = required.filter((path) => !files.has(path));
const leaked = [...files].filter((path) =>
  forbidden.includes(path) ||
  path.startsWith("bin/.keating/") ||
  path.startsWith(".keating/") ||
  path.endsWith("/.env") ||
  path.endsWith("/.env.local")
);

if (missing.length > 0 || leaked.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing package files:\n${missing.map((path) => `  - ${path}`).join("\n")}`);
  }
  if (leaked.length > 0) {
    console.error(`Forbidden package files:\n${leaked.map((path) => `  - ${path}`).join("\n")}`);
  }
  process.exit(1);
}

console.log(`Package manifest ok (${files.size} files).`);
