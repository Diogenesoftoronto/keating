#!/usr/bin/env node
// Measurement script: across all css({...}) call sites in web/src, produce
// histograms of:
//   - property key frequency (what keys appear at all)
//   - top property values per key (e.g. most common borderRadius values)
//   - key-cluster frequency (which unique sets of keys appear most often)
//
// Goal: discover actual repeating shapes so we can decide whether recipes
// earn their complexity, and if so design them to match real clusters.

import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components", "src/pages"];

const keyFreq = Object.create(null);
const valueFreqByKey = Object.create(null);
const clusterFreq = Object.create(null);
let totalSites = 0;
const fileCount = { src: 0 };

for (const file of walk(".", ROOTS)) {
  if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
  const src = readFileSync(file, "utf8");
  if (!src.includes("css({")) continue;

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  ts.forEachChild(sf, walk);

  function walk(node) {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if (ts.isIdentifier(e) && e.text === "css" && node.arguments.length === 1) {
        const arg = node.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) {
          totalSites++;
          const propNames = [];
          for (const prop of arg.properties) {
            if (ts.isPropertyAssignment(prop)) {
              const n = getName(prop.name);
              if (!n) continue;
              propNames.push(n);
              keyFreq[n] = (keyFreq[n] || 0) + 1;
              const val = src.slice(prop.initializer.getStart(), prop.initializer.getEnd());
              valueFreqByKey[n] = valueFreqByKey[n] || Object.create(null);
              valueFreqByKey[n][val] = (valueFreqByKey[n][val] || 0) + 1;
            }
          }
          const cluster = propNames.slice().sort().join(",");
          if (cluster) {
            clusterFreq[cluster] = (clusterFreq[cluster] || 0) + 1;
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  }
}

const top = (m, n = 10) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);

console.log("Total css({...}) sites scanned:", totalSites);
console.log("\n=== Top 25 keys by frequency ===");
console.log(top(keyFreq, 25).map(([k, v]) => `${k.padEnd(24)} ${v}`).join("\n"));

console.log("\n=== Top 6 values per key (heuristics for tokens) ===");
for (const [k] of top(keyFreq, 12)) {
  const topV = top(valueFreqByKey[k], 6);
  console.log(`-- ${k} --`);
  for (const [v, c] of topV) {
    const display = v.length > 60 ? v.slice(0, 57) + "..." : v;
    console.log(`  ${String(c).padStart(4)}  ${display}`);
  }
}

console.log("\n=== Top 20 key-clusters (potential recipe shapes) ===");
const clusters = top(clusterFreq, 20);
for (const [set, c] of clusters) {
  console.log(`  ${String(c).padStart(4)}  ${set}`);
}

function getName(n) {
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n)) return n.text;
  return null;
}

function walk(cwd, roots) {
  const out = [];
  for (const root of roots) {
    const stack = [join(cwd, root)];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        const p = join(dir, name);
        let s;
        try { s = statSync(p); } catch { continue; }
        if (s.isDirectory()) {
          if (name === "node_modules" || name === ".output" || name === "dist") continue;
          stack.push(p);
        } else {
          out.push(p);
        }
      }
    }
  }
  return out;
}
