import type { NeedleEmbedding } from "@keating/learner-contracts";

// Independent pins are checked inside the worker before executing downloaded JS.
const pins = {
  js: [62502, "d00ec67ec7e03e4720dfc6c3dad95a0540afd00169a983ce3fabcd7aeaa0fa93"],
  wasm: [688521, "77c6a38cacb8efbeebfd5202082ba9a0850a7c3066db40d4d0e80509cd137d9b"],
  weights: [35335380, "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38"],
} as const;
export const NEEDLE_WASM_IDENTITY = `needle3/wasm/b274efcb211a9eef48c9a88da4b43bd569696a39/engine:${pins.wasm[1]}/weights:${pins.weights[1]}/js:${pins.js[1]}`;
export interface NeedleWasmModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _needle_load(pointer: number, size: bigint): number;
  _needle_embed(input: number, output: number, capacity: number): number;
  _needle_reset(): void;
}

/** The published C ABI, shared by the real worker and offline WASM execution checks. */
export function createNeedleWasmEngine(module: NeedleWasmModule, weights: Uint8Array) {
  const modelPointer = module._malloc(weights.byteLength);
  if (!modelPointer) throw new Error("Needle model allocation failed");
  module.HEAPU8.set(weights, modelPointer);
  if (module._needle_load(modelPointer, BigInt(weights.byteLength)) < 0) {
    module._free(modelPointer); throw new Error("Needle model load failed");
  }
  // Retain input bytes for the engine lifetime: published C API does not grant ownership transfer.
  const dimensions = module._needle_embed(0, 0, 0);
  if (dimensions !== 3072) throw new Error("Unexpected Needle embedding dimensions");
  return {
    embed(texts: readonly string[]): NeedleEmbedding {
      if (!Array.isArray(texts) || texts.length < 1 || texts.length > 16) throw new Error("Invalid Needle text count");
      let total = 0;
      const encoded = texts.map(text => {
        if (typeof text !== "string" || !text.trim() || text.includes("\0") || text.length > 4096
          || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Error("Invalid Needle text");
        const bytes = new TextEncoder().encode(text);
        total += bytes.byteLength;
        if (bytes.byteLength > 4096 || total > 16384) throw new Error("Needle text budget exceeded");
        return bytes;
      });
      const vectors = encoded.map(bytes => {
        const input = module._malloc(bytes.byteLength + 1), output = module._malloc(dimensions * 4);
        try {
          if (!input || !output) throw new Error("Needle text allocation failed");
          module.HEAPU8.set(bytes, input); module.HEAPU8[input + bytes.byteLength] = 0;
          module._needle_reset();
          if (module._needle_embed(input, output, dimensions) !== dimensions) throw new Error("Needle embedding failed");
          const vector = Array.from(new Float32Array(module.HEAPU8.buffer, output, dimensions));
          if (!vector.some(value => value !== 0) || vector.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error("Invalid Needle embedding");
          return vector;
        } finally { if (input) module._free(input); if (output) module._free(output); }
      });
      return { model: NEEDLE_WASM_IDENTITY, dimensions, vectors };
    },
  };
}

export async function loadBrowserNeedleEngine(assets: Record<"js" | "wasm" | "weights", ArrayBuffer>) {
  for (const name of ["js", "wasm", "weights"] as const) {
    const bytes = assets?.[name];
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== pins[name][0]) throw new Error("Invalid Needle asset");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== pins[name][1]) throw new Error("Invalid Needle asset hash");
  }
  // The pinned upstream file is UMD, not ESM. Append only an export to its exact verified bytes.
  const source = new TextDecoder("utf-8", { fatal: true }).decode(assets.js);
  const url = URL.createObjectURL(new Blob([source, "\nexport default createNeedle;\n"], { type: "text/javascript" }));
  try {
    const factory = (await import(/* @vite-ignore */ url)).default as (options: { wasmBinary: ArrayBuffer }) => Promise<NeedleWasmModule>;
    const module = await factory({ wasmBinary: assets.wasm });
    return createNeedleWasmEngine(module, new Uint8Array(assets.weights));
  } finally { URL.revokeObjectURL(url); }
}

const scope = globalThis as unknown as {
  document?: unknown; postMessage?: (message: unknown) => void;
  WorkerGlobalScope?: { prototype: object };
  onmessage?: (event: MessageEvent) => void;
};
// Importing the ABI helper in Node/Bun tests does not attach a worker listener.
if (scope.WorkerGlobalScope?.prototype.isPrototypeOf(globalThis) && typeof scope.postMessage === "function" && typeof scope.document === "undefined") {
  let engine: ReturnType<typeof createNeedleWasmEngine> | null = null;
  let busy = false;
  scope.onmessage = async event => {
    const message = event.data;
    if (!message || !Number.isSafeInteger(message.id)) return;
    if (busy) { scope.postMessage?.({ id: message.id, ok: false }); return; }
    busy = true;
    try {
      if (message.kind === "init" && !engine) {
        engine = await loadBrowserNeedleEngine(message.assets);
        scope.postMessage?.({ id: message.id, ok: true, value: NEEDLE_WASM_IDENTITY });
      } else if (message.kind === "embed" && engine) {
        scope.postMessage?.({ id: message.id, ok: true, value: engine.embed(message.texts) });
      } else scope.postMessage?.({ id: message.id, ok: false });
    } catch { scope.postMessage?.({ id: message.id, ok: false }); }
    finally { busy = false; }
  };
}
