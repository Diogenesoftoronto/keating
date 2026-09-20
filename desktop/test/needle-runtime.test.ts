import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { DesktopNeedleRuntime, type DesktopNeedleModule, type DesktopNeedleConfig } from "../src/needle-runtime.js";
import { NativeWorkspaceService } from "../src/native-runtime.js";
import { buildNeedleRuntime } from "../scripts/build-needle-runtime.mjs";

const config: DesktopNeedleConfig = { python: "/fixture/python", engine: "/fixture/engine", weights: "/fixture/weights",
  engineSha256: "a".repeat(64), weightsSha256: "b".repeat(64) };
const identity = (value: DesktopNeedleConfig) => `needle3/cactus-needle@3.0.1/sha256:${value.weightsSha256}/engine:${value.engineSha256}`;
function fixture(overrides: Partial<DesktopNeedleModule> = {}, timeoutMs = 100) {
  const module: DesktopNeedleModule = {
    loadNeedleConfig: async workspace => { expect(workspace).toBe("/workspace"); return structuredClone(config); },
    needleModelIdentity: identity,
    createNeedleCaller: () => async ({ texts }) => ({ model: identity(config), vectors: texts.map((_, index) => [index, 1]) }),
    ...overrides,
  };
  return new DesktopNeedleRuntime("/workspace", { loadModule: async () => module, assetsAvailable: async () => true, timeoutMs });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("native fixed operations use host configuration and return exact model vectors", async () => {
  const needle = fixture();
  const service = new NativeWorkspaceService("/workspace", async () => needle);
  expect(await service.execute("needle.status", {})).toMatchObject({ available: true, model: identity(config) });
  expect(await service.execute("needle.embed", { texts: ["First fact", "Second fact"] })).toEqual({ model: identity(config), dimensions: 2, vectors: [[0, 1], [1, 1]] });
  await service.stop();
});

test("renderer cannot set local executable/config/path or send unbounded text", async () => {
  let calls = 0;
  const runtime = fixture({ createNeedleCaller: () => { calls++; throw Error("must not call"); } });
  for (const payload of [null, [], {}, { texts: [] }, { texts: [1] }, { texts: Array(161).fill("a") },
    { texts: ["a".repeat(8193)] }, { texts: Array(33).fill("a".repeat(8192)) }, { texts: ["ok"], config },
    { texts: ["ok"], python: "/arbitrary" }, { texts: ["ok"], sources: [] }]) {
    await expect(runtime.embed(payload)).rejects.toThrow("needle_request_invalid");
  }
  await expect(runtime.status({ path: "/secret" })).rejects.toThrow("needle_request_invalid");
  expect(calls).toBe(0);
});

test("missing bundle, config, or assets are unavailable and module failures are redacted", async () => {
  for (const loadModule of [async () => null, async () => { throw Error("secret upstream path"); }]) {
    const runtime = new DesktopNeedleRuntime("/workspace", { loadModule });
    expect(await runtime.status()).toMatchObject({ available: false, model: null });
    expect(await runtime.embed({ texts: ["private"] })).toBeNull();
  }
  expect(await fixture({ loadNeedleConfig: async () => null }).status()).toMatchObject({ available: false, model: null });
  expect(await fixture({ createNeedleCaller: () => async () => { throw Error("private source text"); } }).embed({ texts: ["private"] })).toBeNull();
  const nonexistent = new DesktopNeedleRuntime("/workspace", { loadModule: async () => ({ loadNeedleConfig: async () => config,
    needleModelIdentity: identity, createNeedleCaller: () => async () => null }) });
  expect(await nonexistent.status()).toMatchObject({ available: false, model: null });
});

test("stale configuration and malformed outputs never reach retrieval", async () => {
  for (const output of [null, { model: "different", vectors: [[1, 2]] }, { model: identity(config), vectors: [] },
    { model: identity(config), vectors: [[NaN]] }, { model: identity(config), vectors: [Array(1)] }, { model: identity(config), vectors: [[]] },
    { model: identity(config), vectors: [Array(8193).fill(1)] }, { model: identity(config), vectors: [[1], [1]] }]) {
    const runtime = fixture({ createNeedleCaller: () => async () => output });
    expect(await runtime.embed({ texts: ["one"] })).toBeNull();
  }
  let reads = 0;
  const runtime = fixture({ loadNeedleConfig: async () => ({ ...config, weightsSha256: reads++ ? "c".repeat(64) : config.weightsSha256 }) });
  expect(await runtime.embed({ texts: ["one"] })).toBeNull();
});

test("only one native embedding runs and shutdown immediately invalidates late results", async () => {
  const started = deferred<void>(); const finish = deferred<{ model: string; vectors: number[][] }>(); let calls = 0;
  const runtime = fixture({ createNeedleCaller: () => async () => { calls++; started.resolve(); return finish.promise; } });
  const pending = runtime.embed({ texts: ["private"] }); await started.promise;
  expect(await runtime.embed({ texts: ["overlap"] })).toBeNull();
  runtime.stop(); expect(await pending).toBeNull();
  finish.resolve({ model: identity(config), vectors: [[1]] });
  expect(await runtime.status()).toEqual({ available: false, model: null }); expect(calls).toBe(1);
});

test("full deadline bounds noncooperative setup and prevents late inference", async () => {
  const loaded = deferred<DesktopNeedleConfig>(); let calls = 0;
  const runtime = fixture({ loadNeedleConfig: () => loaded.promise,
    createNeedleCaller: () => async () => { calls++; return { model: identity(config), vectors: [[1]] }; } }, 2);
  expect(await runtime.embed({ texts: ["private"] })).toBeNull();
  // The timed-out setup retains its lease, so no duplicate workload can start.
  expect(await runtime.embed({ texts: ["retry"] })).toBeNull();
  loaded.resolve(config); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(0);
});

test("generated bundle exports the real CLI host and loads under Node without inference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keating-needle-bundle-"));
  try {
    const path = await buildNeedleRuntime(join(directory, "needle-node-runtime.mjs"));
    const script = `const module = await import(${JSON.stringify(pathToFileURL(path).href)});
      if (module.NEEDLE_VERSION !== "3.0.1" || typeof module.createNeedleCaller !== "function" || typeof module.loadNeedleConfig !== "function") throw Error("missing runtime exports");
      if (await module.loadNeedleConfig(${JSON.stringify(directory)}) !== null) throw Error("unexpected config");
      process.stdout.write(module.needleModelIdentity(${JSON.stringify(config)}));`;
    expect(execFileSync("node", ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 })).toBe(identity(config));
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("workspace shutdown invalidates an in-flight Needle operation through the actual native dispatcher", async () => {
  const started = deferred<void>(); const done = deferred<{ model: string; vectors: number[][] }>();
  const needle = fixture({ createNeedleCaller: () => async () => { started.resolve(); return done.promise; } });
  const service = new NativeWorkspaceService("/workspace", async () => needle);
  const pending = service.execute("needle.embed", { texts: ["private"] });
  await started.promise; await service.stop();
  expect(await pending).toBeNull();
  done.resolve({ model: identity(config), vectors: [[1]] });
  await expect(service.execute("needle.status", {})).rejects.toThrow("shutting down");
});

test("desktop installer uses fixed operations, prefers persistent managed assets and preserves legacy config", async () => {
  let installed = false, cancelled = 0, stopped = 0, legacyCalls = 0;
  const managed = {
    status: async () => ({ available: installed, installed, model: installed ? "managed-pinned-model" : null,
      downloading: false, downloadedBytes: installed ? 36 : 0, totalBytes: 36, managed: true as const }),
    download: async () => { installed = true; }, cancelDownload: () => { cancelled++; },
    remove: async () => { installed = false; }, stop: () => { stopped++; },
    embed: async ({ texts }: { texts: string[] }) => ({ model: "managed-pinned-model", dimensions: 2, vectors: texts.map(() => [1, 2]) }),
  };
  const runtime = new DesktopNeedleRuntime("/workspace", { managed, assetsAvailable: async () => true,
    loadModule: async () => ({ loadNeedleConfig: async () => config, needleModelIdentity: identity,
      createNeedleCaller: () => async ({ texts }) => { legacyCalls++; return { model: identity(config), vectors: texts.map(() => [2, 1]) }; } }) });
  const service = new NativeWorkspaceService("/workspace", async () => runtime);
  expect(await service.execute("needle.status", {})).toMatchObject({ installed: false, available: true, managed: false });
  for (const operation of ["needle.install", "needle.remove", "needle.cancelDownload"]) {
    await expect(service.execute(operation, { directory: "/arbitrary" })).rejects.toThrow("needle_request_invalid");
  }
  expect(await service.execute("needle.install", {})).toEqual({ ok: true });
  expect(await service.execute("needle.status", {})).toMatchObject({ installed: true, available: true, managed: true });
  expect(await service.execute("needle.embed", { texts: ["Recall this"] })).toEqual({ model: "managed-pinned-model", dimensions: 2, vectors: [[1, 2]] });
  expect(legacyCalls).toBe(0);
  await service.execute("needle.cancelDownload", {}); expect(cancelled).toBe(1);
  await service.execute("needle.remove", {});
  expect(await service.execute("needle.embed", { texts: ["Recall this"] })).toMatchObject({ model: identity(config) });
  expect(legacyCalls).toBe(1);
  await service.stop(); expect(stopped).toBe(1);
  await expect(service.execute("needle.install", {})).rejects.toThrow("shutting down");
});
