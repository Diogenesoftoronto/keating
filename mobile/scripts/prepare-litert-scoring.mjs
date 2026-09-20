/** Prepare the official pinned C API (the Android JVM SDK has no scoring API). */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LITERT_SCORING_SDK = Object.freeze({ version: "0.16.0",
  sha256: "f0f3ae7b5730af783d1f018f7ad9a8de20c25fedf01af4e35fc11d4382246f7d",
  url: "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.16.0/litert_lm_c_api-0.1.0.zip" });
const exists = path => stat(path).then(value => value.isFile(), () => false);
async function hash(path) { const digest = createHash("sha256"); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest("hex"); }
export async function prepareLiteRTScoring() {
  const generated = join(root, "modules/keating-litert/.generated"), output = join(generated, LITERT_SCORING_SDK.version);
  await mkdir(output, { recursive: true });
  const desktopCache = resolve(root, "../desktop/dist/offline-cache/litert-0.16.0.zip");
  const archive = await exists(desktopCache) ? desktopCache : join(generated, "litert-0.16.0.zip");
  if (!await exists(archive)) {
    const response = await fetch(LITERT_SCORING_SDK.url);
    if (!response.ok || !response.body) throw new Error("Could not download pinned LiteRT scoring SDK");
    await pipeline(response.body, createWriteStream(archive, { flags: "wx" }));
  }
  if (await hash(archive) !== LITERT_SCORING_SDK.sha256) throw new Error("LiteRT scoring SDK digest mismatch");
  const result = spawnSync("cmake", ["-E", "tar", "xf", archive, "include", "lib/android_arm64", "lib/android_x86_64", "LICENSE", "licenses"], { cwd: output, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Could not extract pinned LiteRT scoring SDK");
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareLiteRTScoring();
