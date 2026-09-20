import type { NeedleEmbedding } from "@keating/learner-contracts";

export const BROWSER_NEEDLE_REVISION = "b274efcb211a9eef48c9a88da4b43bd569696a39";
export const BROWSER_NEEDLE_ASSETS = Object.freeze([
  Object.freeze({ name: "js", path: "/needle-wasm/needle.js", bytes: 62502, sha256: "d00ec67ec7e03e4720dfc6c3dad95a0540afd00169a983ce3fabcd7aeaa0fa93" } as const),
  Object.freeze({ name: "wasm", path: "/needle-wasm/needle.wasm", bytes: 688521, sha256: "77c6a38cacb8efbeebfd5202082ba9a0850a7c3066db40d4d0e80509cd137d9b" } as const),
  Object.freeze({ name: "weights", path: `https://huggingface.co/Cactus-Compute/needle3/resolve/${BROWSER_NEEDLE_REVISION}/needle3.cact`, bytes: 35335380, sha256: "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38" } as const),
] as const);
export const BROWSER_NEEDLE_MODEL = `needle3/wasm/${BROWSER_NEEDLE_REVISION}/engine:${BROWSER_NEEDLE_ASSETS[1].sha256}/weights:${BROWSER_NEEDLE_ASSETS[2].sha256}/js:${BROWSER_NEEDLE_ASSETS[0].sha256}`;
export type BrowserNeedleAssets = Record<"js" | "wasm" | "weights", ArrayBuffer>;
export interface BrowserNeedleProgress { loaded: number; total: number }
export interface BrowserNeedleStatus { available: boolean; model: string | null; downloaded: boolean }
export interface BrowserNeedleWorker {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface BrowserNeedleDependencies {
  supported(): boolean;
  store: { read(name: string): Promise<ArrayBuffer | null>; write(name: string, data: ArrayBuffer): Promise<void>; clear(): Promise<void> };
  fetch(input: string, init?: RequestInit): Promise<Response>;
  digest(data: ArrayBuffer): Promise<string>;
  worker(): BrowserNeedleWorker;
  timeoutMs?: number;
}

export function validBrowserNeedleTexts(texts: unknown): texts is readonly string[] {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 16) return false;
  let total = 0;
  for (const text of texts) {
    if (typeof text !== "string" || !text.trim() || text.includes("\0") || text.length > 4096
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) return false;
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > 4096) return false;
    total += bytes;
  }
  return total <= 16384;
}

/** All network access lives in explicit install(). Inference only sees verified local bytes. */
export function createBrowserNeedleRuntime(dependencies: BrowserNeedleDependencies) {
  let epoch = 0, sequence = 0;
  let assets: BrowserNeedleAssets | null = null;
  let reading: Promise<BrowserNeedleAssets | null> | null = null;
  let installing: Promise<void> | null = null;
  let removing: Promise<void> | null = null;
  let download: AbortController | null = null;
  let worker: BrowserNeedleWorker | null = null;
  let initialized = false, busy = false, disposed = false;
  const listeners = new Set<() => void>();
  const pending = new Map<number, { resolve(value: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* observers cannot own lifecycle */ } } };
  const stopWorker = () => {
    worker?.terminate(); worker = null; initialized = false;
    for (const item of pending.values()) { clearTimeout(item.timer); item.resolve(null); }
    pending.clear();
  };
  const invalidate = () => { epoch++; assets = null; reading = null; stopWorker(); notify(); };
  const verified = async (name: typeof BROWSER_NEEDLE_ASSETS[number], bytes: ArrayBuffer | null) =>
    bytes !== null && bytes.byteLength === name.bytes && await dependencies.digest(bytes) === name.sha256;
  const local = async (): Promise<BrowserNeedleAssets | null> => {
    if (disposed || !dependencies.supported() || installing || removing) return null;
    if (assets) return assets;
    if (reading) return reading;
    const generation = epoch;
    const work = (async () => {
      try {
        const result = {} as BrowserNeedleAssets;
        for (const spec of BROWSER_NEEDLE_ASSETS) {
          const bytes = await dependencies.store.read(spec.name);
          if (!await verified(spec, bytes) || epoch !== generation) return null;
          result[spec.name] = bytes!;
        }
        if (epoch !== generation) return null;
        assets = result;
        return result;
      } catch { return null; }
    })();
    reading = work;
    try { return await work; } finally { if (reading === work) reading = null; }
  };
  const request = (message: Record<string, unknown>, transfer: Transferable[] = []) => new Promise<unknown>(resolve => {
    if (!worker) { resolve(null); return; }
    const id = ++sequence;
    const timer = setTimeout(stopWorker, Math.max(1, Math.min(dependencies.timeoutMs ?? 30000, 60000)));
    pending.set(id, { resolve, timer });
    try { worker.postMessage({ ...message, id }, transfer); } catch { stopWorker(); }
  });
  const readyWorker = async (input: BrowserNeedleAssets, generation: number) => {
    if (initialized && worker) return true;
    worker = dependencies.worker();
    const owned = worker;
    owned.onmessage = event => {
      if (worker !== owned || !event.data || typeof event.data.id !== "number") return;
      const item = pending.get(event.data.id);
      if (!item) return;
      pending.delete(event.data.id); clearTimeout(item.timer);
      item.resolve(event.data.ok === true ? event.data.value : null);
    };
    owned.onerror = () => { if (worker === owned) stopWorker(); };
    const copies = { js: input.js.slice(0), wasm: input.wasm.slice(0), weights: input.weights.slice(0) };
    const result = await request({ kind: "init", assets: copies }, Object.values(copies));
    if (generation !== epoch || worker !== owned || result !== BROWSER_NEEDLE_MODEL) { if (worker === owned) stopWorker(); return false; }
    initialized = true;
    return true;
  };
  return {
    available: () => !disposed && dependencies.supported(),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async status(): Promise<BrowserNeedleStatus> {
      const ready = !!await local();
      return { available: ready, downloaded: ready, model: ready ? BROWSER_NEEDLE_MODEL : null };
    },
    install(onProgress?: (value: BrowserNeedleProgress) => void, signal?: AbortSignal): Promise<void> {
      if (installing) return installing;
      if (disposed || removing || !dependencies.supported()) return Promise.reject(new Error("Local recall is unavailable in this browser."));
      installing = Promise.resolve(); // Block observer-triggered cache reads before invalidation.
      invalidate();
      const generation = epoch;
      const controller = download = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 300000);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const current = () => { if (controller.signal.aborted || epoch !== generation) throw new Error("Local recall download cancelled."); };
      const total = BROWSER_NEEDLE_ASSETS.reduce((sum, spec) => sum + spec.bytes, 0);
      let loaded = 0;
      const progress = () => { try { onProgress?.({ loaded, total }); } catch { /* presentation only */ } };
      const work = (async () => {
        try {
          for (const spec of BROWSER_NEEDLE_ASSETS) {
            current();
            let bytes = await dependencies.store.read(spec.name);
            if (!await verified(spec, bytes)) {
              current();
              const response = await dependencies.fetch(spec.path, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
              if (!response.ok || !response.body) throw new Error("Local recall download failed.");
              const reader = response.body.getReader();
              const target = new Uint8Array(spec.bytes);
              let offset = 0;
              try {
                while (true) {
                  current();
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (offset + value.byteLength > target.byteLength) throw new Error("Local recall download has an unexpected size.");
                  target.set(value, offset); offset += value.byteLength; loaded += value.byteLength; progress();
                }
              } finally { await reader.cancel().catch(() => {}); }
              bytes = target.buffer;
              if (offset !== spec.bytes || !await verified(spec, bytes)) throw new Error("Local recall integrity check failed.");
              current();
              await dependencies.store.write(spec.name, bytes);
              current();
              if (!await verified(spec, await dependencies.store.read(spec.name))) throw new Error("Local recall could not be saved.");
            } else { loaded += spec.bytes; progress(); }
          }
          current();
        } finally { clearTimeout(deadline); signal?.removeEventListener("abort", abort); if (download === controller) download = null; }
      })();
      installing = work;
      void work.finally(() => { if (installing === work) installing = null; notify(); }).catch(() => {});
      return work;
    },
    remove(): Promise<void> {
      if (removing) return removing;
      removing = Promise.resolve();
      download?.abort(); invalidate();
      const work = (async () => { await installing?.catch(() => {}); await dependencies.store.clear(); })();
      removing = work;
      void work.finally(() => { if (removing === work) removing = null; notify(); }).catch(() => {});
      return work;
    },
    async embed(texts: readonly string[], signal?: AbortSignal): Promise<NeedleEmbedding | null> {
      if (disposed || busy || installing || removing || signal?.aborted || !validBrowserNeedleTexts(texts)) return null;
      const input = [...texts];
      const generation = epoch;
      busy = true;
      const abort = () => stopWorker();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const loaded = await local();
        if (!loaded || generation !== epoch || signal?.aborted || !await readyWorker(loaded, generation)) return null;
        if (signal?.aborted || generation !== epoch) return null;
        const result = await request({ kind: "embed", texts: input }) as NeedleEmbedding | null;
        if (signal?.aborted || generation !== epoch || result?.model !== BROWSER_NEEDLE_MODEL || result.dimensions !== 3072
          || !Array.isArray(result.vectors) || result.vectors.length !== input.length || result.vectors.some(vector =>
            !Array.isArray(vector) || vector.length !== 3072 || !vector.some(value => value !== 0)
            || vector.some(value => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e6))) return null;
        return { model: result.model, dimensions: result.dimensions, vectors: result.vectors.map(vector => [...vector]) };
      } catch { stopWorker(); return null; }
      finally { busy = false; signal?.removeEventListener("abort", abort); }
    },
    dispose() { disposed = true; download?.abort(); invalidate(); listeners.clear(); },
  };
}

const cacheName = `keating-needle-wasm-${BROWSER_NEEDLE_REVISION}`;
const key = (name: string) => new URL(`/__keating_needle_cache__/${name}`, globalThis.location.origin).href;
const runtime = createBrowserNeedleRuntime({
  supported: () => typeof window !== "undefined" && typeof Worker !== "undefined" && typeof caches !== "undefined"
    && typeof WebAssembly !== "undefined" && !!globalThis.crypto?.subtle,
  store: {
    async read(name) {
      const spec = BROWSER_NEEDLE_ASSETS.find(asset => asset.name === name);
      if (!spec) return null;
      const result = await (await caches.open(cacheName)).match(key(name));
      if (!result?.body) return null;
      const reader = result.body.getReader(), bytes = new Uint8Array(spec.bytes);
      let offset = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (offset + value.byteLength > bytes.byteLength) return null;
          bytes.set(value, offset); offset += value.byteLength;
        }
        return offset === spec.bytes ? bytes.buffer : null;
      } finally { await reader.cancel().catch(() => {}); }
    },
    async write(name, data) { await (await caches.open(cacheName)).put(key(name), new Response(data)); },
    async clear() { await caches.delete(cacheName); },
  },
  fetch: (...args) => fetch(...args),
  async digest(bytes) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join(""); },
  worker: () => new Worker(new URL("./browser-needle-worker.ts", import.meta.url), { type: "module", name: "keating-local-recall" }),
});
export const browserNeedleAvailable = runtime.available;
export const browserNeedleStatus = runtime.status;
export const installBrowserNeedle = runtime.install;
export const removeBrowserNeedle = runtime.remove;
export const browserNeedleEmbed = runtime.embed;
export const subscribeBrowserNeedle = runtime.subscribe;
