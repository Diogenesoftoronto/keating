#!/usr/bin/env node
/** Prepare checksum-pinned SDK artifacts only. Never download model weights here. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, stat, rename, unlink, access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../modules/keating-needle");
export const manifest = JSON.parse(await readFile(join(moduleRoot, "assets.json"), "utf8"));
export const defaultDirectory = join(moduleRoot, ".generated", manifest.revision);
export function modelIdentity(platform) {
  const engine = manifest.platforms[platform];
  if (!engine) throw new Error("Unsupported Needle platform");
  return `needle3/native/${manifest.revision}/${platform}/engine:${engine.sha256}/weights:${manifest.weights.sha256}/header:${manifest.header.sha256}`;
}
export function verifyAsset(bytes, asset) {
  if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Needle asset integrity check failed");
}
export async function prepareAsset(target, asset, url, { fetchImpl = fetch, checkOnly = false } = {}) {
  try {
    if ((await stat(target)).size === asset.bytes) { verifyAsset(await readFile(target), asset); return; }
  } catch (error) { if (error.code && error.code !== "ENOENT") throw error; }
  if (checkOnly) throw new Error("Needle native assets are missing or corrupt; run mobile/scripts/prepare-needle.mjs.");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("Could not download the pinned Needle native asset");
  const chunks = []; let count = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length;
      if (count > asset.bytes) throw new Error("Needle asset exceeded its pinned size");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks); verifyAsset(bytes, asset);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.partial`;
  try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, target); }
  finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
export async function prepareNeedleAssets(platforms, options = {}) {
  verifyAsset(await readFile(join(moduleRoot, "cpp/needle.h")), manifest.header);
  const directory = options.directory ?? defaultDirectory;
  for (const platform of platforms) {
    if (!Object.hasOwn(manifest.platforms, platform)) throw new Error("Unsupported Needle platform");
    const base = `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${platform}`;
    await prepareAsset(join(directory, platform, "libneedle.a"), manifest.platforms[platform], `${base}/libneedle.a`, options);
    await prepareAsset(join(directory, platform, "needle.h"), manifest.header, `${base}/needle.h`, options);
  }
  const filename = `needle3-${manifest.weights.sha256.slice(0, 16)}.cact`;
  const constants = ["#pragma once", `#define KEATING_NEEDLE_REVISION "${manifest.revision}"`,
    `#define KEATING_NEEDLE_MODEL_BYTES ${manifest.weights.bytes}`, `#define KEATING_NEEDLE_MODEL_SHA "${manifest.weights.sha256}"`,
    `#define KEATING_NEEDLE_FILENAME "${filename}"`, `#define KEATING_NEEDLE_PARTIAL "${filename}.part"`,
    ...Object.keys(manifest.platforms).map(platform => `#define KEATING_NEEDLE_ID_${platform.replaceAll("-", "_").toUpperCase()} "${modelIdentity(platform)}"`), ""].join("\n");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "needle_assets.h"), constants);
  return directory;
}
async function verifiedIosFramework(directory, framework) {
  const thin = join(directory, `verify-${randomUUID()}.a`);
  try {
    const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(framework, "Info.plist")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    if (info.AvailableLibraries?.length !== 2) return false;
    const variants = new Set();
    for (const entry of info.AvailableLibraries) {
      if (entry.SupportedPlatform !== "ios" || !/^[a-zA-Z0-9_-]+$/.test(entry.LibraryIdentifier)
        || !/^[a-zA-Z0-9_.-]+$/.test(entry.LibraryPath) || entry.HeadersPath !== "Headers") return false;
      const variant = entry.SupportedPlatformVariant ?? "device";
      if (variants.has(variant)) return false;
      variants.add(variant);
      const folder = join(framework, entry.LibraryIdentifier);
      verifyAsset(await readFile(join(folder, "Headers/needle.h")), manifest.header);
      const library = join(folder, entry.LibraryPath);
      if (entry.SupportedPlatformVariant === "simulator") {
        if (JSON.stringify([...entry.SupportedArchitectures].sort()) !== JSON.stringify(["arm64", "x86_64"])) return false;
        execFileSync("xcrun", ["lipo", library, "-thin", "arm64", "-output", thin], { stdio: "ignore" });
        verifyAsset(await readFile(thin), manifest.platforms["ios-sim-arm64"]);
      } else {
        if (entry.SupportedPlatformVariant || JSON.stringify(entry.SupportedArchitectures) !== JSON.stringify(["arm64"])) return false;
        verifyAsset(await readFile(library), manifest.platforms["ios-arm64"]);
      }
    }
    return true;
  } catch { return false; }
  finally { await unlink(thin).catch(() => {}); }
}
async function prepareIosFramework(directory) {
  if (process.platform !== "darwin") throw new Error("The iOS XCFramework must be assembled on macOS with Xcode.");
  const framework = join(directory, "Needle.xcframework");
  if (await verifiedIosFramework(directory, framework)) return;
  const temporary = join(directory, `Needle-${randomUUID()}.xcframework`);
  const stub = join(directory, "unsupported.c");
  await writeFile(stub, "const int keating_needle_unsupported = 1;\n");
  execFileSync("xcrun", ["--sdk", "iphonesimulator", "clang", "-target", "x86_64-apple-ios16.4-simulator", "-c", stub, "-o", join(directory, "unsupported.o")], { stdio: "inherit" });
  execFileSync("xcrun", ["libtool", "-static", "-o", join(directory, "unsupported.a"), join(directory, "unsupported.o")], { stdio: "inherit" });
  execFileSync("xcrun", ["lipo", "-create", join(directory, "ios-sim-arm64/libneedle.a"), join(directory, "unsupported.a"), "-output", join(directory, "libneedle-simulator.a")], { stdio: "inherit" });
  const headers = join(directory, "include"); await mkdir(headers, { recursive: true });
  await writeFile(join(headers, "needle.h"), await readFile(join(directory, "ios-arm64/needle.h")));
  execFileSync("xcodebuild", ["-create-xcframework", "-library", join(directory, "ios-arm64/libneedle.a"), "-headers", headers,
    "-library", join(directory, "libneedle-simulator.a"), "-headers", headers, "-output", temporary], { stdio: "inherit" });
  if (!await verifiedIosFramework(directory, temporary)) throw new Error("Assembled Needle framework failed verification");
  try { await access(framework); await rename(framework, `${framework}.invalid-${randomUUID()}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await rename(temporary, framework);
}
export async function main(args = process.argv.slice(2)) {
  const platforms = []; let checkOnly = false; let ios = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--platform" && args[index + 1]) platforms.push(args[++index]);
    else if (args[index] === "--check") checkOnly = true;
    else if (args[index] === "--ios-xcframework") ios = true;
    else throw new Error("Usage: prepare-needle.mjs --platform android-arm64|ios-arm64|ios-sim-arm64 [--check] [--ios-xcframework]");
  }
  if (ios) platforms.push("ios-arm64", "ios-sim-arm64");
  if (!platforms.length) throw new Error("Select an explicit Needle platform");
  const directory = await prepareNeedleAssets([...new Set(platforms)], { checkOnly });
  if (ios) await prepareIosFramework(directory);
  return directory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(directory => console.log(`Verified Needle native assets: ${directory}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
