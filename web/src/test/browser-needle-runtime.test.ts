import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BROWSER_NEEDLE_ASSETS, BROWSER_NEEDLE_MODEL, createBrowserNeedleRuntime, validBrowserNeedleTexts,
  type BrowserNeedleDependencies, type BrowserNeedleWorker } from "../keating/browser-needle-runtime";
import { NEEDLE_WASM_IDENTITY, createNeedleWasmEngine, loadBrowserNeedleEngine } from "../keating/browser-needle-worker";

const bytes = new Map(BROWSER_NEEDLE_ASSETS.map(spec => [spec.name as string, new ArrayBuffer(spec.bytes)]));
const embedding = (count: number) => ({ model: BROWSER_NEEDLE_MODEL, dimensions: 3072,
  vectors: Array.from({ length: count }, () => Array.from({ length: 3072 }, (_, i) => i === 0 ? 1 : 0)) });
class FakeWorker implements BrowserNeedleWorker {
  onmessage: BrowserNeedleWorker["onmessage"] = null;
  onerror: BrowserNeedleWorker["onerror"] = null;
  terminated = false;
  held: Record<string, unknown> | null = null;
  hold = false;
  invalid = false;
  messages: Record<string, unknown>[] = [];
  postMessage(message: unknown) {
    const data = message as Record<string, unknown>;
    this.messages.push(data);
    if (data.kind === "embed" && this.hold) { this.held = data; return; }
    queueMicrotask(() => this.answer(data));
  }
  answer(data: Record<string, unknown>) {
    const value = data.kind === "init" ? BROWSER_NEEDLE_MODEL : this.invalid ? { ...embedding(1), model: "other-model" } : embedding((data.texts as string[]).length);
    this.onmessage?.({ data: { id: data.id, ok: true, value } } as MessageEvent);
  }
  terminate() { this.terminated = true; }
}
function setup(installed = true, extra: Partial<BrowserNeedleDependencies> = {}) {
  const saved = new Map(installed ? bytes : []);
  const workers: FakeWorker[] = [];
  const requests: { path: string; init?: RequestInit }[] = [];
  const dependencies: BrowserNeedleDependencies = {
    supported: () => true,
    store: { async read(name) { return saved.get(name) ?? null; }, async write(name, value) { saved.set(name, value); }, async clear() { saved.clear(); } },
    async fetch(path, init) {
      requests.push({ path, init });
      const spec = BROWSER_NEEDLE_ASSETS.find(asset => asset.path === path)!;
      return new Response(bytes.get(spec.name));
    },
    async digest(value) { return BROWSER_NEEDLE_ASSETS.find(asset => asset.bytes === value.byteLength)?.sha256 ?? "invalid"; },
    worker() { const worker = new FakeWorker(); workers.push(worker); return worker; },
    timeoutMs: 1000, ...extra,
  };
  return { saved, workers, requests, dependencies, runtime: createBrowserNeedleRuntime(dependencies) };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 0));
  expect(predicate()).toBe(true);
}

describe("browser Needle local runtime", () => {
  test("missing assets abstain without downloading or constructing a worker", async () => {
    const { runtime, requests, workers } = setup(false);
    expect(await runtime.status()).toEqual({ available: false, model: null, downloaded: false });
    expect(await runtime.embed(["private learner text"])).toBeNull();
    expect(requests).toHaveLength(0); expect(workers).toHaveLength(0);
    runtime.dispose();
  });
  test("verified persistent assets start one worker and keep learner text out of fetch", async () => {
    const { runtime, requests, workers } = setup();
    expect(BROWSER_NEEDLE_MODEL).toBe(NEEDLE_WASM_IDENTITY);
    expect(await runtime.status()).toEqual({ available: true, model: BROWSER_NEEDLE_MODEL, downloaded: true });
    expect(await runtime.embed(["first learner quote", "second quote"])).toEqual(embedding(2));
    expect(await runtime.embed(["follow-up"])).toEqual(embedding(1));
    expect(workers).toHaveLength(1);
    expect(workers[0].messages.map(row => row.kind)).toEqual(["init", "embed", "embed"]);
    expect(requests).toHaveLength(0);
    runtime.dispose(); expect(workers[0].terminated).toBe(true);
  });
  test("bad cached hashes fail before worker execution", async () => {
    const { runtime, workers, requests } = setup(true, { digest: async () => "tampered" });
    expect((await runtime.status()).downloaded).toBe(false);
    expect(await runtime.embed(["private"])).toBeNull();
    expect(workers).toHaveLength(0); expect(requests).toHaveLength(0);
    runtime.dispose();
  });
  test("explicit installation verifies readback and removal clears every cached asset", async () => {
    const { runtime, requests, saved } = setup(false);
    const progress: number[] = [];
    runtime.subscribe(() => { throw new Error("bad UI listener"); });
    await runtime.install(value => progress.push(value.loaded));
    expect(requests.map(request => request.path)).toEqual(BROWSER_NEEDLE_ASSETS.map(asset => asset.path));
    expect(requests.every(request => request.init?.credentials === "omit" && request.init.referrerPolicy === "no-referrer" && request.init.body === undefined)).toBe(true);
    expect(progress.at(-1)).toBe(BROWSER_NEEDLE_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0));
    expect((await runtime.status()).available).toBe(true);
    await runtime.remove();
    expect(saved.size).toBe(0); expect((await runtime.status()).available).toBe(false);
    runtime.dispose();
  });
  test("persistence failure is explicit and partial caches are unavailable", async () => {
    const { dependencies } = setup(false);
    const runtime = createBrowserNeedleRuntime({ ...dependencies, store: { ...dependencies.store, async write() { throw new Error("quota"); } } });
    await expect(runtime.install()).rejects.toThrow("quota");
    expect((await runtime.status()).available).toBe(false);
    runtime.dispose();
  });
  test("remove terminates an active embedding and ignores its late reply", async () => {
    const { runtime, workers } = setup();
    await runtime.embed(["warmup"]); workers[0].hold = true;
    const pending = runtime.embed(["private ongoing work"]);
    await until(() => !!workers[0].held);
    await runtime.remove();
    expect(await pending).toBeNull(); expect(workers[0].terminated).toBe(true);
    workers[0].answer(workers[0].held!);
    expect((await runtime.status()).available).toBe(false);
    runtime.dispose();
  });
  test("external cancellation terminates work; disposal prevents later use", async () => {
    const { runtime, workers } = setup();
    await runtime.embed(["warmup"]); workers[0].hold = true;
    const controller = new AbortController();
    const pending = runtime.embed(["ongoing"], controller.signal);
    await until(() => !!workers[0].held); controller.abort();
    expect(await pending).toBeNull(); expect(workers[0].terminated).toBe(true);
    runtime.dispose();
    expect(runtime.available()).toBe(false); expect(await runtime.embed(["later"])).toBeNull();
    await expect(runtime.install()).rejects.toThrow("unavailable");
  });
  test("removal waits for an in-progress cache write before deleting it", async () => {
    const { dependencies, saved } = setup(false);
    let release!: () => void, writing = false;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const runtime = createBrowserNeedleRuntime({ ...dependencies, store: { ...dependencies.store,
      async write(name, data) { writing = true; await blocked; saved.set(name, data); } } });
    const install = runtime.install();
    await until(() => writing);
    const removal = runtime.remove(); release();
    await expect(install).rejects.toThrow("cancelled"); await removal;
    expect(saved.size).toBe(0); expect((await runtime.status()).downloaded).toBe(false);
    runtime.dispose();
  });
  test("bounded input and malformed output abstain", async () => {
    const { runtime, workers } = setup();
    for (const texts of [[], [""], ["a\0b"], ["\ud800"], ["é".repeat(4096)], Array(17).fill("a")]) {
      expect(validBrowserNeedleTexts(texts)).toBe(false); expect(await runtime.embed(texts)).toBeNull();
    }
    await runtime.embed(["warmup"]); workers[0].invalid = true;
    expect(await runtime.embed(["next"])).toBeNull();
    runtime.dispose();
  });
  test("worker independently rejects unpinned executable bytes", async () => {
    await expect(loadBrowserNeedleEngine({ js: bytes.get("js")!, wasm: bytes.get("wasm")!, weights: bytes.get("weights")! })).rejects.toThrow("asset hash");
  });
  test.skipIf(!process.env.KEATING_NEEDLE_WASM_MODEL)("published WASM computes real repeatable 3072-dimensional embeddings", async () => {
    const js = new URL("../../public/needle-wasm/needle.js", import.meta.url);
    const wasm = await readFile(new URL("../../public/needle-wasm/needle.wasm", import.meta.url));
    const model = await readFile(process.env.KEATING_NEEDLE_WASM_MODEL!);
    for (const [data, spec] of [[await readFile(js), BROWSER_NEEDLE_ASSETS[0]], [wasm, BROWSER_NEEDLE_ASSETS[1]], [model, BROWSER_NEEDLE_ASSETS[2]]] as const) {
      expect(data.byteLength).toBe(spec.bytes);
      expect(createHash("sha256").update(data).digest("hex")).toBe(spec.sha256);
    }
    const factory = createRequire(import.meta.url)(js.pathname);
    const engine = createNeedleWasmEngine(await factory({ wasmBinary: wasm }), model);
    const result = engine.embed(["The learner is practicing fractions.", "The learner is practicing fractions.", "A musical phrase in three beats."]);
    expect(result.dimensions).toBe(3072); expect(result.vectors).toHaveLength(3);
    expect(result.vectors.every(vector => vector.every(Number.isFinite))).toBe(true);
    expect(result.vectors[0]).toEqual(result.vectors[1]); expect(result.vectors[0]).not.toEqual(result.vectors[2]);
  });
});
