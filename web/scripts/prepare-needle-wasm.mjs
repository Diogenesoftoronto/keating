import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const revision = "b274efcb211a9eef48c9a88da4b43bd569696a39";
const directory = fileURLToPath(new URL("../public/needle-wasm/", import.meta.url));
const assets = [
  { file: "needle.js", bytes: 62502, sha256: "d00ec67ec7e03e4720dfc6c3dad95a0540afd00169a983ce3fabcd7aeaa0fa93" },
  { file: "needle.wasm", bytes: 688521, sha256: "77c6a38cacb8efbeebfd5202082ba9a0850a7c3066db40d4d0e80509cd137d9b" },
];
const valid = (bytes, asset) => bytes.length === asset.bytes && createHash("sha256").update(bytes).digest("hex") === asset.sha256;
await mkdir(directory, { recursive: true });
for (const asset of assets) {
  const target = `${directory}/${asset.file}`;
  const previous = await readFile(target).catch(() => null);
  if (previous && valid(previous, asset)) continue;
  const response = await fetch(`https://huggingface.co/Cactus-Compute/needle3/resolve/${revision}/wasm/${asset.file}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new Error("Needle runtime download failed");
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > asset.bytes) throw new Error("Needle runtime size mismatch");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (!valid(bytes, asset)) throw new Error("Needle runtime integrity mismatch");
  const temporary = `${target}.${process.pid}.part`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);
}
console.log(`Prepared pinned Needle browser runtime ${revision}; model weights remain an explicit user download.`);
