/** Bundle the shared CLI Needle host for Electron without importing outside desktop/src at typecheck time. */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function buildNeedleRuntime(destination = resolve(desktopRoot, "dist/needle-node-runtime.js")) {
  if (!globalThis.Bun?.build) throw new Error("Build the desktop Needle module with Bun.");
  await mkdir(dirname(destination), { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(desktopRoot, "../src/retrieval/needle-runtime.ts")],
    target: "node", format: "esm", splitting: false,
  });
  if (!result.success || result.outputs.length !== 1) throw new Error("Desktop Needle module build failed.");
  await Bun.write(destination, result.outputs[0]);
  await buildManagedNeedleWorker(resolve(dirname(destination), "needle-managed-worker.js"));
  return destination;
}
export async function buildManagedNeedleWorker(destination = resolve(desktopRoot, "dist/needle-managed-worker.js")) {
  if (!globalThis.Bun?.build) throw new Error("Build the desktop Needle worker with Bun.");
  await mkdir(dirname(destination), { recursive: true });
  const result = await Bun.build({ entrypoints: [resolve(desktopRoot, "src/needle-managed-worker.mjs")], target: "node", format: "esm", splitting: false });
  if (!result.success || result.outputs.length !== 1) throw new Error("Desktop Needle worker build failed.");
  await Bun.write(destination, result.outputs[0]);
  return destination;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildNeedleRuntime();
