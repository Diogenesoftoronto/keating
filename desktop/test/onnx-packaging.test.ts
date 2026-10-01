import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Packaging scripts deliberately run directly in Node/Electron Builder.
// @ts-expect-error JavaScript build script has no declaration file.
import { stageOnnxRuntime } from "../scripts/stage-onnx-runtime.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keating-ort-packaging-"));
  const packageDirectories: Record<string, string> = {};
  for (const name of ["onnxruntime-node", "onnxruntime-common"]) {
    const directory = join(root, "installed", name);
    packageDirectories[name] = directory;
    await mkdir(join(directory, "dist"), { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name }));
    await writeFile(join(directory, "LICENSE"), "license");
    await writeFile(join(directory, "dist", "index.js"), "module.exports = {};");
  }
  const targets: Record<string, string[]> = {
    "linux/x64": ["onnxruntime_binding.node", "libonnxruntime.so.1"],
    "linux/arm64": ["onnxruntime_binding.node", "libonnxruntime.so.1"],
    "win32/x64": ["onnxruntime_binding.node", "onnxruntime.dll", "DirectML.dll", "dxcompiler.dll", "dxil.dll"],
    "win32/arm64": ["onnxruntime_binding.node", "onnxruntime.dll", "DirectML.dll", "dxcompiler.dll", "dxil.dll"],
    "darwin/arm64": ["onnxruntime_binding.node", "libonnxruntime.1.dylib", "libonnxruntime.1.29.0.dylib"],
  };
  for (const [target, files] of Object.entries(targets)) {
    const directory = join(packageDirectories["onnxruntime-node"]!, "bin", "napi-v6", target);
    await mkdir(directory, { recursive: true });
    for (const file of files) await writeFile(join(directory, file), `${target}/${file}`);
  }
  return { root, packageDirectories, targets, appDirectory: join(root, "generated") };
}

describe("target-specific ONNX desktop packaging", () => {
  test("retains every target dependency, JS, common and licenses; removes foreign binaries", async () => {
    const f = await fixture();
    try {
      // Reusing a generated app must also handle cross-target builds without stale binaries.
      for (const [target, files] of Object.entries(f.targets)) {
        const [platform, arch] = target.split("/");
        await stageOnnxRuntime({ ...f, platform, arch });
        const node = join(f.appDirectory, "node_modules", "onnxruntime-node");
        expect(await readdir(join(node, "bin", "napi-v6"))).toEqual([platform!]);
        expect(await readdir(join(node, "bin", "napi-v6", platform!))).toEqual([arch!]);
        expect((await readdir(join(node, "bin", "napi-v6", target))).sort()).toEqual([...files].sort());
        expect(await readFile(join(node, "dist", "index.js"), "utf8")).toContain("module.exports");
        expect(await readFile(join(node, "LICENSE"), "utf8")).toBe("license");
        await access(join(f.appDirectory, "node_modules", "onnxruntime-common", "dist", "index.js"));
      }
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("rejects unsupported targets before changing the generated app", async () => {
    const f = await fixture();
    try {
      await stageOnnxRuntime({ ...f, platform: "linux", arch: "x64" });
      await expect(stageOnnxRuntime({ ...f, platform: "darwin", arch: "x64" })).rejects.toThrow("no packaged native binding");
      const binding = join(f.appDirectory, "node_modules", "onnxruntime-node", "bin", "napi-v6", "linux", "x64", "onnxruntime_binding.node");
      expect(await readFile(binding, "utf8")).toBe("linux/x64/onnxruntime_binding.node");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
