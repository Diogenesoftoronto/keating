import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NEEDLE_MODEL, NEEDLE_NATIVE_REVISION, NEEDLE_NATIVE_PLATFORMS, needleNativeModelIdentity, validateNeedleTexts } from "../src/lib/needle-contract";
// The build script is deliberately runnable under Node without app dependencies.
import { modelIdentity, manifest, prepareAsset, prepareNeedleAssets } from "../scripts/prepare-needle.mjs";

test("native identities include exact engine, header and weights independently of Python", () => {
  for (const platform of Object.keys(NEEDLE_NATIVE_PLATFORMS) as Array<keyof typeof NEEDLE_NATIVE_PLATFORMS>) {
    expect(needleNativeModelIdentity(platform)).toBe(modelIdentity(platform));
    expect(needleNativeModelIdentity(platform)).toContain(NEEDLE_NATIVE_PLATFORMS[platform].sha256);
    expect(needleNativeModelIdentity(platform)).toContain(manifest.header.sha256);
    expect(needleNativeModelIdentity(platform)).toContain(NEEDLE_MODEL.sha256);
  }
  expect(NEEDLE_MODEL.url).toContain(NEEDLE_NATIVE_REVISION);
  expect(NEEDLE_MODEL.partialFilename).toBe(`${NEEDLE_MODEL.filename}.part`);
});

test("embedding limits count UTF-8 bytes and reject ambiguous native C-string input", () => {
  expect(() => validateNeedleTexts(["é".repeat(2048)])).not.toThrow();
  expect(() => validateNeedleTexts(["😀".repeat(1024)])).not.toThrow();
  for (const texts of [[], [""], ["   "], ["has\0suffix"], ["\ud800"], ["\udc00"], ["é".repeat(2049)], Array(17).fill("x"), Array(5).fill("x".repeat(4096)), [4]]) {
    expect(() => validateNeedleTexts(texts)).toThrow();
  }
});

test("asset preparation commits only exact pinned bytes and repairs corrupt cached files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-needle-native-"));
  try {
    const target = join(dir, "libneedle.a");
    const good = Buffer.from("an inert test archive");
    const asset = { bytes: good.length, sha256: createHash("sha256").update(good).digest("hex") };
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(good); };
    await prepareAsset(target, asset, "https://fixture.invalid/asset", { fetchImpl });
    expect(await readFile(target)).toEqual(good);
    await prepareAsset(target, asset, "https://fixture.invalid/asset", { fetchImpl, checkOnly: true }); expect(calls).toBe(1);
    await writeFile(target, Buffer.alloc(good.length));
    await expect(prepareAsset(target, asset, "https://fixture.invalid/asset", { fetchImpl, checkOnly: true })).rejects.toThrow();
    await prepareAsset(target, asset, "https://fixture.invalid/asset", { fetchImpl }); expect(calls).toBe(2);
    expect(await readFile(target)).toEqual(good);
    for (const bytes of [Buffer.alloc(good.length), Buffer.alloc(good.length + 1)]) {
      const absent = join(dir, `bad-${bytes.length}`);
      await expect(prepareAsset(absent, asset, "https://fixture.invalid/asset", { fetchImpl: async () => new Response(bytes) })).rejects.toThrow();
      await expect(readFile(absent)).rejects.toThrow();
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unknown platforms cannot become artifact URLs or write build output", async () => {
  let calls = 0;
  await expect(prepareNeedleAssets(["../../unexpected"], { fetchImpl: async () => { calls++; throw new Error("must not run"); } })).rejects.toThrow("Unsupported Needle platform");
  expect(calls).toBe(0);
});
