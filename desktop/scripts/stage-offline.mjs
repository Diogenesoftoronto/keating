import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkHash = "f0f3ae7b5730af783d1f018f7ad9a8de20c25fedf01af4e35fc11d4382246f7d";
const sdkUrl = "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.16.0/litert_lm_c_api-0.1.0.zip";
export const targets = {
  "linux-x64": "linux_x86_64/liblitert-lm.so",
  "linux-arm64": "linux_arm64/liblitert-lm.so",
  "darwin-arm64": "macos_arm64/liblitert-lm.dylib",
  "win32-x64": "windows_x86_64/lib/litert-lm.lib",
};
async function hash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
async function download(url, path, sha256) {
  if (await stat(path).then(() => true, () => false) && await hash(path) === sha256) return;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${url} (${response.status})`);
  await pipeline(response.body, createWriteStream(path));
  if (await hash(path) !== sha256) { await rm(path, { force: true }); throw new Error(`SHA-256 mismatch: ${url}`); }
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
}
export async function stageOffline(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!targets[target]) throw new Error(`Official LiteRT 0.16.0 has no desktop prebuilt for ${target}. Supported: ${Object.keys(targets).join(", ")}`);
  if (platform !== process.platform || arch !== process.arch) throw new Error(`Build ${target} on a matching native runner; cross compilation is not configured.`);
  const cache = join(root, "dist/offline-cache");
  const sdk = join(cache, "sdk");
  const output = join(root, "dist/offline");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, "litert-0.16.0.zip");
  await download(sdkUrl, archive, sdkHash);
  await mkdir(sdk, { recursive: true });
  run("cmake", ["-E", "tar", "xf", archive], sdk);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const build = join(cache, target);
  run("cmake", ["-S", join(root, "native"), "-B", build, `-DLITERT_SDK=${sdk}`, `-DLITERT_LIBRARY=${join(sdk, "lib", targets[target])}`, "-DCMAKE_BUILD_TYPE=Release"]);
  run("cmake", ["--build", build, "--config", "Release"]);
  run("cmake", ["--install", build, "--config", "Release", "--prefix", output]);
  const library = platform === "win32" ? "windows_x86_64/bin/litert-lm.dll" : targets[target];
  // The official Mach-O dylib's LC_ID_DYLIB is @rpath/liblitert-lm.so.
  await cp(join(sdk, "lib", library), join(output, platform === "darwin" ? "liblitert-lm.so" : library.split("/").at(-1)));
  await cp(join(sdk, "licenses"), join(output, "licenses"), { recursive: true });
  // Fail the installer build if the native runtime cannot load its dependencies.
  run(join(output, platform === "win32" ? "keating-offline.exe" : "keating-offline"), ["--probe"]);
  if (process.env.KEATING_OFFLINE_EDITION === "1") {
    const { OFFLINE_MODEL } = await import("../dist/offline-contract.js");
    const model = join(cache, OFFLINE_MODEL.file);
    await download(OFFLINE_MODEL.url, model, OFFLINE_MODEL.sha256);
    await cp(model, join(output, OFFLINE_MODEL.file));
    const card = await fetch("https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT/raw/02e8a867ae318e633f2372ac81fc78dc4d8448e7/README.md");
    if (!card.ok) throw new Error("Could not bundle model license documentation.");
    await writeFile(join(output, "MODEL-CARD.md"), await card.text());
  }
  await writeFile(join(output, "runtime.json"), JSON.stringify({ version: "0.16.0", target, sdkSha256: sdkHash, offlineEdition: process.env.KEATING_OFFLINE_EDITION === "1" }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stageOffline();
