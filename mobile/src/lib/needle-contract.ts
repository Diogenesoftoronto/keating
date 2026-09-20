import manifest from "../../modules/keating-needle/assets.json";
export const NEEDLE_NATIVE_REVISION = manifest.revision;
export const NEEDLE_NATIVE_PLATFORMS = Object.freeze(manifest.platforms);
export type NeedleNativePlatform = keyof typeof NEEDLE_NATIVE_PLATFORMS;
const filename = `needle3-${manifest.weights.sha256.slice(0, 16)}.cact`;
export const NEEDLE_MODEL = Object.freeze({ filename, partialFilename: `${filename}.part`, bytes: manifest.weights.bytes,
  sha256: manifest.weights.sha256,
  url: `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${manifest.weights.file}` });
export function needleNativeModelIdentity(platform: NeedleNativePlatform): string {
  return `needle3/native/${manifest.revision}/${platform}/engine:${manifest.platforms[platform].sha256}/weights:${manifest.weights.sha256}/header:${manifest.header.sha256}`;
}
export const NEEDLE_EMBED_LIMITS = Object.freeze({ items: 16, itemBytes: 4096, totalBytes: 16384, dimensions: 4096 });
/** Validate before entering a native worker; native checks repeat these bounds. */
export function validateNeedleTexts(texts: unknown): asserts texts is string[] {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > NEEDLE_EMBED_LIMITS.items) throw new Error("Needle accepts 1 to 16 texts at a time.");
  let total = 0;
  for (const text of texts) {
    if (typeof text !== "string" || !text.trim() || text.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Error("Needle needs nonempty valid text without NUL characters.");
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > NEEDLE_EMBED_LIMITS.itemBytes) throw new Error("A Needle text exceeds 4096 UTF-8 bytes.");
    total += bytes;
  }
  if (total > NEEDLE_EMBED_LIMITS.totalBytes) throw new Error("The Needle batch exceeds 16384 UTF-8 bytes.");
}
