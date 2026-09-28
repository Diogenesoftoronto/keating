import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function buildJuliaRuntime(destination = resolve(root, "dist/julia-native.js")) {
  await mkdir(dirname(destination), { recursive: true });
  const result = await Bun.build({ entrypoints: [resolve(root, "../shared/julia/desktop.ts")], target: "node", format: "esm", splitting: false, external: ["onnxruntime-node"] });
  if (!result.success || result.outputs.length !== 1) throw new Error("Desktop Julia module build failed.");
  await Bun.write(destination, result.outputs[0]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildJuliaRuntime();
