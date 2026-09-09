import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const scanner = new Bun.Transpiler({ loader: "ts" });
const jsxScanner = new Bun.Transpiler({ loader: "tsx" });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A snapshot may share only its explicitly linked installation, never arbitrary outside source. */
export function localizeHarnessDependency(root: string, path: string, dependencyRoot: string): string {
  const local = relative(root, path);
  if (local !== ".." && !local.startsWith("../") && !isAbsolute(local)) return path;
  const dependency = relative(dependencyRoot, path);
  if (dependency === ".." || dependency.startsWith("../") || isAbsolute(dependency)) throw new Error("harness_dependency_outside_installation");
  return join(root, "node_modules", dependency);
}

export interface HarnessSourceInventory {
  hashes: Record<string, string>;
  readonly_resources: Record<string, string>;
  unresolved_optional_imports: Array<{ from: string; specifier: string }>;
  scope: string;
}

/** Inventory literal transitive imports plus complete built trees for computed local imports. */
export async function captureHarnessSources(root: string): Promise<HarnessSourceInventory> {
  const dependencyRoot = await realpath(join(root, "node_modules"));
  const queue: string[] = [
    "scripts/training/benchmark_harness_v3.ts", "scripts/training/benchmark_harness_v3_extension.ts",
    "scripts/training/benchmark_harness_v3_provenance.ts", "dist/src/runtime/pi-rpc-entry.js",
    "dist/src/runtime/pi-pty-relay.js", "dist/src/pi/hyper-teacher/index.js", "SYSTEM.md", "package.json", "bun.lock",
  ].map((path) => join(root, path));
  const readonly_resources: Record<string, string> = {};
  async function tree(path: string, required = false): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => {
      if (required) throw new Error("harness_built_runtime_missing");
      return [];
    });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await tree(child);
      else if (entry.isFile() && !child.endsWith(".map") && !child.endsWith(".d.ts")) queue.push(child);
    }
  }
  for (const directory of ["dist/src", "dist/shared", "dist/packages", "pi/prompts", "pi/skills"]) await tree(join(root, directory), true);
  // Native bindings are located through computed paths rather than JS import statements.
  await tree(join(root, "node_modules/node-pty/build/Release"));
  await tree(join(root, "node_modules/node-pty/prebuilds"));
  const hashes: Record<string, string> = {};
  const seen = new Set<string>();
  const seenPackages = new Set<string>();
  const unresolved_optional_imports: HarnessSourceInventory["unresolved_optional_imports"] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = localizeHarnessDependency(root, resolve(queue[cursor]!), dependencyRoot);
    if (seen.has(path)) continue;
    seen.add(path);
    if (seen.size > 25_000) throw new Error("harness_source_inventory_limit");
    const name = relative(root, path);
    if (name.startsWith("../")) throw new Error("harness_dependency_outside_installation");
    const bytes = await readFile(path).catch(() => { throw new Error(name.startsWith("dist/") ? "harness_built_runtime_missing" : "harness_source_missing", { cause: name }); });
    hashes[name] = digest(bytes);
    if (name.startsWith("pi/skills/") || name.startsWith("pi/prompts/")) readonly_resources[path] = hashes[name]!;
    // Package metadata affects ESM/exports resolution; hash it along with the implementation.
    let parent = dirname(path);
    while (parent.startsWith(root) && !seenPackages.has(parent)) {
      seenPackages.add(parent);
      try { await readFile(join(parent, "package.json")); queue.push(join(parent, "package.json")); break; }
      catch { parent = dirname(parent); }
    }
    if (![".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(extname(path)) || path.endsWith(".d.ts")) continue;
    let imports: ReturnType<typeof scanner.scanImports>;
    try { imports = (path.endsWith(".tsx") || path.endsWith(".jsx") ? jsxScanner : scanner).scanImports(bytes.toString("utf8").replace(/^#![^\n]*\n/, "")); }
    catch { throw new Error("harness_source_scan_failed", { cause: name }); }
    for (const imported of imports) {
      const specifier = imported.path;
      if (builtins.has(specifier) || specifier.startsWith("node:") || specifier.startsWith("bun:")) continue;
      try {
        const resolved = Bun.resolveSync(specifier, dirname(path));
        if (!isAbsolute(resolved)) { unresolved_optional_imports.push({ from: name, specifier }); continue; }
        queue.push(resolved);
      }
      catch {
        if (!name.includes("node_modules/") && specifier.startsWith(".")) throw new Error("harness_local_dependency_missing");
        // Optional platform dependencies in shipped SDKs may be absent on this installation.
        unresolved_optional_imports.push({ from: name, specifier });
      }
    }
  }
  return { hashes: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))), readonly_resources,
    unresolved_optional_imports,
    scope: "Literal transitive JS/TS imports including installed dependencies, package metadata, complete built src/shared/packages trees, shipped prompts/skills, and node-pty native bindings. Computed external imports are not an exhaustive runtime module-load trace; unresolved optional platform imports are listed." };
}

export async function changedHarnessSources(root: string, hashes: Record<string, string>): Promise<string[]> {
  const changed: string[] = [];
  for (const [name, expected] of Object.entries(hashes)) {
    try { if (digest(await readFile(join(root, name))) !== expected) changed.push(name); }
    catch { changed.push(name); }
  }
  return changed;
}
