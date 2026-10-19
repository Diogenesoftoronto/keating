/** Synchronize lock metadata without resolving dependencies or rewriting the lock. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Workspace = { version?: string };

function synchronizeBunLock(root: string, version: string, check: boolean): boolean {
  const lock = join(root, "bun.lock");
  if (!existsSync(lock)) return false;
  const content = readFileSync(lock, "utf8");
  // Bun's text lock permits trailing commas. Protect strings while removing them.
  const parsed = JSON.parse(content.replace(
    /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, close: string | undefined) => close ?? match,
  ));
  let next = content;
  const workspaces = Object.entries(parsed.workspaces ?? {}) as [string, Workspace][];
  for (const [workspace, metadata] of workspaces) {
    if (metadata.version === undefined) continue;
    const manifest = JSON.parse(readFileSync(join(root, workspace, "package.json"), "utf8"));
    const expected = workspace === "" ? version : manifest.version;
    if (typeof expected !== "string") {
      throw new Error(`Missing manifest version: ${workspace}`);
    }
    const escaped = JSON.stringify(workspace).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^    ${escaped}: \{[\\s\\S]*?"version":\\s*)"[^"\\n]*"`, "m");
    if (!pattern.test(next)) {
      throw new Error(`Unsupported bun.lock workspace formatting: ${workspace}`);
    }
    next = next.replace(pattern, `$1"${expected}"`);
  }
  if (next === content) return false;
  if (!check) writeFileSync(lock, next);
  return true;
}

function synchronizeNpmLock(root: string, version: string, check: boolean): boolean {
  const npm = join(root, "package-lock.json");
  if (!existsSync(npm)) return false;
  const content = readFileSync(npm, "utf8");
  const parsed = JSON.parse(content);
  const rootPackage = parsed.packages?.[""];
  const mismatchedRoot = rootPackage && rootPackage.version !== version;
  if (parsed.version === version && !mismatchedRoot) return false;

  let next = content.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  if (rootPackage) {
    next = next.replace(/(""\s*:\s*\{[\s\S]*?"version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  }
  if (!check) writeFileSync(npm, next);
  return true;
}

export function lockVersions(root: string, version: string, check: boolean): string[] {
  const changed: string[] = [];
  if (synchronizeBunLock(root, version, check)) changed.push("bun.lock");
  if (synchronizeNpmLock(root, version, check)) changed.push("package-lock.json");
  return changed;
}
