import { describe, expect, test } from "bun:test";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
// Packaging scripts deliberately execute directly in Node/Electron Builder.
// @ts-expect-error JavaScript build script has no declaration file.
import { pruneNativePrebuilds } from "../scripts/prune-native-prebuilds.mjs";

const require = createRequire(import.meta.url);
let matcherPath: string | undefined;
try { matcherPath = require.resolve("app-builder-lib/out/fileMatcher.js"); } catch {}
if (process.env.KEATING_REQUIRE_PACKAGER_TEST === "1") {
  if (!matcherPath) throw new Error("Required Electron Builder copy-filter integration is unavailable.");
  for (const name of ["electron-builder", "app-builder-lib"]) {
    if (require(`${name}/package.json`).version !== "25.1.8") throw new Error(`Required ${name} version is 25.1.8.`);
  }
}

async function put(path: string, contents = path) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keating-native-prebuilds-"));
  const installed = join(root, "installed", "node_modules", "@scope", "native");
  const tuples = ["win32-x64", "win32-arm64", "win32-x64+arm64", "linux-x64", "linux-arm64", "darwin-arm64", "android-arm", "ios-arm64", "ios-arm64-simulator", "ios-x64-simulator"];
  for (const tuple of tuples) {
    await put(join(installed, "prebuilds", tuple, "binding.node"), tuple);
    await put(join(installed, "prebuilds", tuple, "napi-v3", "binding.node"), `${tuple}/napi`);
    await put(join(installed, "prebuilds", tuple, "node-v127", "binding.node"), `${tuple}/abi`);
    await put(join(installed, "prebuilds", tuple, "dependency.dll"), `${tuple}/dll`);
  }
  for (const version of ["napi-v3", "napi-v6"]) {
    for (const target of ["win32/x64", "win32/arm64", "linux/x64", "linux/arm64", "darwin/arm64"]) {
      await put(join(installed, "bin", version, target, "binding.node"), target);
      await put(join(installed, "bin", version, target, "dependency.dll"), `${target}/dll`);
    }
    await put(join(installed, "bin", version, "README.txt"), "napi documentation");
  }
  await put(join(installed, "index.js"), "module.exports = {};");
  await put(join(installed, "LICENSE"), "license");
  const directories = [join(root, "generated", "dist", "app"), join(root, "generated", "dist", "nitro")];
  for (const directory of directories) {
    await cp(join(root, "installed"), directory, { recursive: true });
  }
  return { root, installed, directories, tuples };
}

describe("target-aware native prebuild packaging", () => {
  test.skipIf(!matcherPath).each(["win32/x64", "win32/arm64", "linux/arm64", "darwin/arm64"])("configured afterExtract excludes hoisted %s foreign prebuilds before copying", async target => {
    const f = await fixture();
    try {
      const [platform, arch] = target.split("/");
      const desktop = fileURLToPath(new URL("..", import.meta.url));
      const config = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"));
      expect(config.build.beforePack).toBe("scripts/offline-before-pack.cjs");
      expect(config.build.afterExtract).toBe("scripts/native-after-extract.cjs");
      // Reproduce the failed order: filtering before dependency installation
      // cannot prevent the rebuild step from restoring foreign prebuilds.
      await pruneNativePrebuilds({ directories: f.directories, platform, arch });
      for (const directory of f.directories) {
        await cp(join(f.root, "installed"), directory, { recursive: true });
        await access(join(directory, "node_modules", "@scope", "native", "prebuilds", "linux-x64", "binding.node"));
      }
      // Execute the actual configured hook; the collector applies its negative
      // patterns even when dep.dir is a hoisted, unmodified installed package.
      const project = join(f.root, "generated");
      await mkdir(join(project, "scripts"), { recursive: true });
      await cp(join(desktop, config.build.afterExtract), join(project, config.build.afterExtract));
      const hook = require(join(project, config.build.afterExtract));
      const options = { files: ["!**/unrelated.txt"] };
      await hook({ arch: ["ia32", "x64", "armv7l", "arm64"].indexOf(arch!), electronPlatformName: platform, packager: { platformSpecificBuildOptions: options } });
      expect(options.files[0]).toBe("!**/unrelated.txt");
      const { FileMatcher, getNodeModuleFileMatcher } = require(matcherPath!);
      const collector = getNodeModuleFileMatcher(f.directories[0], join(f.root, "packed"), (value: string) => value, options, {
        config: config.build, debugLogger: { isEnabled: false },
      });
      // Same realSource rebasing as locked25 computeNodeModuleFileSets.
      const matcher = new FileMatcher(join(f.root, "installed"), join(f.root, "packed"), (value: string) => value, collector.patterns);
      const filter = matcher.createFilter();
      for (const metadata of ["prebuilds/README.txt", "prebuilds/LICENSE", "bin/napi-v3/README.txt", "bin/napi-v6/README.txt"]) {
        const path = join(f.installed, metadata);
        await put(path, "metadata");
        expect(filter(path, await stat(path))).toBe(true);
      }
      for (const tuple of f.tuples) {
        const [os, arches] = tuple.split("-");
        const retained = os === platform && arches!.split("+").includes(arch!);
        for (const suffix of ["", "binding.node", "dependency.dll", "napi-v3/binding.node", "node-v127/binding.node"]) {
          const path = join(f.installed, "prebuilds", tuple, suffix);
          // Foreign tuple directories remain traversable, but their contents
          // are excluded. Direct README/LICENSE siblings are preserved.
          expect(filter(path, await stat(path))).toBe(suffix === "" || retained);
        }
      }
      for (const version of ["napi-v3", "napi-v6"]) {
        for (const variant of ["win32/x64", "win32/arm64", "linux/x64", "linux/arm64", "darwin/arm64"]) {
          const path = join(f.installed, "bin", version, variant, "dependency.dll");
          expect(filter(path, await stat(path))).toBe(variant === target);
        }
      }
      for (const file of ["index.js", "LICENSE"]) expect(filter(join(f.installed, file), await stat(join(f.installed, file)))).toBe(true);
      await put(join(f.installed, "unrelated.txt"));
      expect(filter(join(f.installed, "unrelated.txt"), await stat(join(f.installed, "unrelated.txt")))).toBe(false);
      // Hook copy filters leave generated and installed directories untouched.
      for (const directory of f.directories) await access(join(directory, "node_modules", "@scope", "native", "prebuilds", "linux-x64", "binding.node"));
      expect((await readdir(join(f.installed, "prebuilds"), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()).toEqual(f.tuples.sort());
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test.each(["win32/x64", "win32/arm64", "linux/arm64", "darwin/arm64"])("keeps complete %s subtrees in app and Nitro only", async target => {
    const f = await fixture();
    try {
      const [platform, arch] = target.split("/");
      await pruneNativePrebuilds({ directories: f.directories, platform, arch });
      const expected = f.tuples.filter(tuple => {
        const [os, arches] = tuple.split("-");
        return os === platform && arches!.split("+").includes(arch!);
      });
      for (const directory of f.directories) {
        const native = join(directory, "node_modules", "@scope", "native");
        expect((await readdir(join(native, "prebuilds"))).sort()).toEqual(expected.sort());
        for (const tuple of expected) {
          expect(await readFile(join(native, "prebuilds", tuple, "napi-v3", "binding.node"), "utf8")).toBe(`${tuple}/napi`);
          expect(await readFile(join(native, "prebuilds", tuple, "node-v127", "binding.node"), "utf8")).toBe(`${tuple}/abi`);
          expect(await readFile(join(native, "prebuilds", tuple, "dependency.dll"), "utf8")).toBe(`${tuple}/dll`);
        }
        for (const version of ["napi-v3", "napi-v6"]) {
          expect((await readdir(join(native, "bin", version))).sort()).toEqual(["README.txt", platform!].sort());
          expect(await readdir(join(native, "bin", version, platform!))).toEqual([arch!]);
          expect(await readFile(join(native, "bin", version, platform!, arch!, "dependency.dll"), "utf8")).toBe(`${target}/dll`);
        }
        expect(await readFile(join(native, "index.js"), "utf8")).toContain("module.exports");
        expect(await readFile(join(native, "LICENSE"), "utf8")).toBe("license");
      }
      // Installed package/cache contents must remain unchanged.
      expect((await readdir(join(f.installed, "prebuilds"))).sort()).toEqual(f.tuples.sort());
      expect(await readFile(join(f.installed, "prebuilds", "linux-x64", "binding.node"), "utf8")).toBe("linux-x64");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("rejects invalid target and unknown layouts before removing foreign files", async () => {
    const f = await fixture();
    try {
      await expect(pruneNativePrebuilds({ directories: f.directories, platform: "win32", arch: undefined })).rejects.toThrow("Invalid native prebuild");
      const prebuilds = join(f.directories[1]!, "node_modules", "@scope", "native", "prebuilds");
      await put(join(prebuilds, "unknown-format", "binding.node"));
      await expect(pruneNativePrebuilds({ directories: f.directories, platform: "win32", arch: "x64" })).rejects.toThrow("Unrecognized native prebuild target");
      for (const directory of f.directories) await access(join(directory, "node_modules", "@scope", "native", "prebuilds", "linux-x64", "binding.node"));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("rejects a linked root or ancestor without modifying installed dependencies", async () => {
    const f = await fixture();
    try {
      const linked = join(f.root, "linked-cache");
      await symlink(join(f.root, "installed"), linked, process.platform === "win32" ? "junction" : "dir");
      for (const directory of [linked, join(linked, "node_modules", "@scope", "native")]) {
        await expect(pruneNativePrebuilds({ directories: [directory], platform: "win32", arch: "x64" })).rejects.toThrow("must not be a symlink");
      }
      expect((await readdir(join(f.installed, "prebuilds"))).sort()).toEqual(f.tuples.sort());
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("rejects a staged dependency link before applying any pruning", async () => {
    const f = await fixture();
    try {
      await symlink(f.installed, join(f.directories[1]!, "cache-link"), process.platform === "win32" ? "junction" : "dir");
      await expect(pruneNativePrebuilds({ directories: f.directories, platform: "win32", arch: "x64" })).rejects.toThrow("cannot traverse a symlink");
      for (const directory of f.directories) await access(join(directory, "node_modules", "@scope", "native", "prebuilds", "linux-x64", "binding.node"));
      expect((await readdir(join(f.installed, "prebuilds"))).sort()).toEqual(f.tuples.sort());
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
