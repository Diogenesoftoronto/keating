import { lstat, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const platforms = new Set(["android", "darwin", "freebsd", "ios", "linux", "openbsd", "win32"]);
const architectures = new Set(["ia32", "x64", "arm", "armv7l", "arm64", "ppc64", "s390x", "riscv64", "loong64", "universal"]);

async function assertDirectory(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Native staging directory must not be a symlink: ${path}`);
}

/** Prune generated copies only; never traverse links into installed dependencies. */
export async function pruneNativePrebuilds({ directories, platform, arch }) {
  if (!platforms.has(platform) || !architectures.has(arch) || !Array.isArray(directories) || directories.length === 0) {
    throw new Error("Invalid native prebuild staging target.");
  }
  const removals = [];
  // Check every ancestor: a real directory below a linked staging root is unsafe too.
  for (const directory of directories) {
    for (let path = resolve(directory); ; path = dirname(path)) {
      await assertDirectory(path);
      if (dirname(path) === path) break;
    }
  }
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      // Reject rather than dereference staged links. A linked dependency must be
      // materialized by staging before its native contents can be target-filtered.
      if (entry.isSymbolicLink()) throw new Error(`Native staging cannot traverse a symlink: ${path}`);
      if (!entry.isDirectory()) continue;
      if (entry.name === "prebuilds") {
        for (const tuple of await readdir(path, { withFileTypes: true })) {
          if (tuple.isSymbolicLink()) throw new Error(`Native staging cannot traverse a symlink: ${join(path, tuple.name)}`);
          if (!tuple.isDirectory()) continue;
          const match = /^([^-]+)-(.+)$/.exec(tuple.name);
          if (!match || !platforms.has(match[1])) {
            throw new Error(`Unrecognized native prebuild target: ${join(path, tuple.name)}`);
          }
          // Foreign platform tuples can have platform-specific architecture tags
          // (e.g. ios-x64-simulator); they are irrelevant to this build target.
          if (match[1] !== platform) { removals.push(join(path, tuple.name)); continue; }
          const tupleArchitectures = match[2].split("+");
          if (!tupleArchitectures.every(value => architectures.has(value))) throw new Error(`Unrecognized native prebuild architecture: ${join(path, tuple.name)}`);
          if (!tupleArchitectures.includes(arch)) removals.push(join(path, tuple.name));
          // Keep the entire matching subtree: ABI/NAPI variants and companion DLLs.
        }
      } else if (basename(directory) === "bin" && /^napi-v\d+$/.test(entry.name)) {
        for (const target of await readdir(path, { withFileTypes: true })) {
          if (target.isSymbolicLink()) throw new Error(`Native staging cannot traverse a symlink: ${join(path, target.name)}`);
          if (!target.isDirectory()) continue;
          if (!platforms.has(target.name)) throw new Error(`Unrecognized Node-API platform: ${join(path, target.name)}`);
          if (target.name !== platform) { removals.push(join(path, target.name)); continue; }
          for (const variant of await readdir(join(path, target.name), { withFileTypes: true })) {
            if (variant.isSymbolicLink()) throw new Error(`Native staging cannot traverse a symlink: ${join(path, target.name, variant.name)}`);
            if (!variant.isDirectory()) continue;
            if (!architectures.has(variant.name)) throw new Error(`Unrecognized Node-API architecture: ${join(path, target.name, variant.name)}`);
            if (variant.name !== arch) removals.push(join(path, target.name, variant.name));
          }
        }
      } else await walk(path);
    }
  }
  // Collect before removing: malformed layouts/links leave generated inputs unchanged.
  for (const directory of directories) await walk(resolve(directory));
  for (const path of removals) await rm(path, { recursive: true });
}
