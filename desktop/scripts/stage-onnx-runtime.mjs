import { access, cp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(join(desktopRoot, "package.json"));

async function packageDirectory(name) {
  let directory = dirname(desktopRequire.resolve(name));
  while (true) {
    let manifest;
    try { manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); } catch {}
    if (manifest?.name === name) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate installed package ${name}`);
    directory = parent;
  }
}

/** Keep the real Electron target's complete native directory, plus JS and licenses. */
export async function stageOnnxRuntime({ appDirectory, platform = process.platform, arch = process.arch, packageDirectories } = {}) {
  if (!appDirectory || !["linux", "darwin", "win32"].includes(platform)) throw new Error("Invalid ONNX staging target.");
  const roots = packageDirectories ?? Object.fromEntries(await Promise.all(["onnxruntime-node", "onnxruntime-common"].map(async name => [name, await packageDirectory(name)])));
  const nativePrefix = `bin/napi-v6/${platform}/${arch}`;
  // Validate before replacing anything. Unsupported architectures must not ship a broken binding.
  await access(join(roots["onnxruntime-node"], ...nativePrefix.split("/"))).catch(() => { throw new Error(`ONNX Runtime 1.29.0 has no packaged native binding for ${platform}/${arch}.`); });
  for (const name of ["onnxruntime-node", "onnxruntime-common"]) {
    const from = roots[name], destination = join(appDirectory, "node_modules", name);
    // This is the generated staging directory, never the installed package or user data.
    await rm(destination, { recursive: true, force: true });
    await cp(from, destination, {
      recursive: true, dereference: true,
      filter: source => {
        if (name !== "onnxruntime-node") return true;
        const path = relative(from, source).split(sep).join("/");
        if (path !== "bin" && !path.startsWith("bin/")) return true;
        return path === nativePrefix || path.startsWith(nativePrefix + "/") || nativePrefix.startsWith(path + "/");
      },
    });
  }
}
