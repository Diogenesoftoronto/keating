import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const manifestDigest = "cc2bb453616816a0d0a72b96e3869c741f062e35a01ff37b798343090e8cfa0e";
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const hashFile = path => sha(readFileSync(path));
export const read = path => JSON.parse(readFileSync(path, "utf8"));
export const auditPath = "docs/benchmarks/openui-audit-2026-11-18";

/** All writable source, fixture and module-receipt paths have real directories under this scratch root. */
export function privatePath(root, file) {
  assert(file && !isAbsolute(file) && normalize(file) === file && !file.split(sep).includes(".."), "Unsafe replay path");
  const actualRoot = realpathSync(root);
  let dest = actualRoot;
  for (const part of file.split(sep)) {
    dest = join(dest, part);
    assert(!lstatSync(dest, {throwIfNoEntry:false})?.isSymbolicLink(), "Replay write crosses a symbolic link");
  }
  return dest;
}

function copyTo(root, file, source) {
  const dest = privatePath(root, file);
  mkdirSync(dirname(dest), {recursive:true});
  cpSync(source, dest, {recursive:true, dereference:true, mode:constants.COPYFILE_FICLONE,
    filter:path => !path.endsWith("/preview")});
}

export function prepareTree(source, dest) {
  const sourceFiles = [
    "packages/learner-contracts/src", "packages/learner-contracts/test/fixtures", "packages/learner-contracts/package.json",
    "packages/runtime-config", "web/src", "web/package.json", "shared", "package.json", "tsconfig.json",
    "scripts/openui-diagnostics/gemini-decision.ts", "scripts/prompt-adherence",
    "scripts/training/benchmarks/teaching-v1/cases.json", "scripts/training/benchmarks/teaching-v2/cases.json",
  ];
  if (existsSync(join(source,"web/styled-system"))) sourceFiles.push("web/styled-system");
  const studyFiles = ["policy-holdout","gemini-decision","policy-v2.1","policy-v2","cue-paraphrases","evidence","replay-source","scenarios.json","verify-historical.mjs"];
  for (const file of [...sourceFiles, ...studyFiles.map(name => join(auditPath,name))]) copyTo(dest,file,join(source,file));
  // Bun normally realpaths an installed workspace alias back into the live checkout.
  // Rebuild those two aliases against private sources for both module-resolution roots.
  for (const modules of ["node_modules","web/node_modules"]) {
    mkdirSync(privatePath(dest,join(modules,"@keating")),{recursive:true});
    for (const pkg of readdirSync(join(source,modules))) {
      if (pkg !== "@keating") symlinkSync(join(source,modules,pkg),privatePath(dest,join(modules,pkg)));
    }
    for (const pkg of readdirSync(join(source,modules,"@keating"))) {
      const local = pkg === "learner-contracts" || pkg === "runtime-config";
      const target = local ? privatePath(dest,join("packages",pkg)) : join(source,modules,"@keating",pkg);
      symlinkSync(target,privatePath(dest,join(modules,"@keating",pkg)),"dir");
    }
  }
}

export function restoreVersion21(root) {
  const store = privatePath(root, join(auditPath,"replay-source"));
  const path = join(store,"source-manifest.json");
  assert.equal(hashFile(path), manifestDigest, "Historical source manifest was modified");
  const manifest = read(path);
  assert.equal(hashFile(join(store,manifest.bundle)), manifest.bundleSha256, "Historical source archive was modified");
  const sources = JSON.parse(gunzipSync(readFileSync(join(store,manifest.bundle))).toString("utf8"));
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(manifest.sourceSha256).sort(), "Historical source set changed");
  for (const [file,content] of Object.entries(sources)) {
    assert.equal(sha(content), manifest.sourceSha256[file], "Historical source bytes differ for " + file);
    writeFileSync(privatePath(root,file), content);
  }
  const diagnostic = manifest.diagnostic;
  const bytes = readFileSync(join(store,diagnostic.source));
  assert.equal(sha(bytes), diagnostic.sha256, "Historical OpenUI diagnostic snapshot was modified");
  writeFileSync(privatePath(root,diagnostic.path), bytes);
  return manifest;
}
