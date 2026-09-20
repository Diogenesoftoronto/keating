/** Node-target bundle only. Verified pinned bytes run in this dedicated worker, never the renderer. */
import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import { readManagedNeedleAssets, MANAGED_NEEDLE_MODEL } from "./needle-managed-runtime.js";
import { createNeedleWasmEngine, NEEDLE_WASM_IDENTITY } from "../../web/src/keating/browser-needle-worker.ts";

async function load() {
  if (typeof workerData?.directory !== "string" || MANAGED_NEEDLE_MODEL !== NEEDLE_WASM_IDENTITY) throw new Error("needle_worker_invalid");
  const assets = await readManagedNeedleAssets(workerData.directory);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(assets.js);
  const module = { exports: {} };
  const console = { log() {}, error() {}, warn() {} };
  // SHA verification above precedes evaluating the published UMD module. wasmBinary prevents engine fetches.
  runInNewContext(source, { module, exports: module.exports, require: createRequire(import.meta.url), process,
    __dirname: workerData.directory, __filename: join(workerData.directory, "needle.cjs"),
    console, TextDecoder, TextEncoder, WebAssembly, URL, Buffer, setTimeout, clearTimeout, performance }, { timeout: 1000 });
  if (typeof module.exports !== "function") throw new Error("needle_worker_invalid");
  const wasm = await module.exports({ wasmBinary: assets.wasm });
  return createNeedleWasmEngine(wasm, assets.weights);
}
let engine = null, busy = false;
parentPort?.on("message", async message => {
  if (!message || !Number.isSafeInteger(message.id)) return;
  if (busy) { parentPort.postMessage({ id: message.id, ok: false }); return; }
  busy = true;
  try {
    if (message.kind === "init" && !engine) { engine = await load(); parentPort.postMessage({ id: message.id, ok: true, value: MANAGED_NEEDLE_MODEL }); }
    else if (message.kind === "embed" && engine) parentPort.postMessage({ id: message.id, ok: true, value: engine.embed(message.texts) });
    else parentPort.postMessage({ id: message.id, ok: false });
  } catch { parentPort.postMessage({ id: message.id, ok: false }); }
  finally { busy = false; }
});
