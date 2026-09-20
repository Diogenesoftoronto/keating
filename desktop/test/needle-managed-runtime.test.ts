import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { ManagedDesktopNeedleRuntime, MANAGED_NEEDLE_ASSETS, MANAGED_NEEDLE_MODEL, type ManagedNeedleWorker } from "../src/needle-managed-runtime.js";
import { BROWSER_NEEDLE_MODEL, BROWSER_NEEDLE_ASSETS } from "../../web/src/keating/browser-needle-runtime";
import { buildManagedNeedleWorker } from "../scripts/build-needle-runtime.mjs";

const repository = resolve(import.meta.dir, "../..");
const weights = process.env.KEATING_NEEDLE_WASM_MODEL ?? join(repository, ".keating/tmp/needle/assets/needle3.cact");
const localAssets = [join(repository, "web/public/needle-wasm/needle.js"), join(repository, "web/public/needle-wasm/needle.wasm"), weights];
const available = localAssets.every(path => existsSync(path));
async function temporary() { return mkdtemp(join(tmpdir(), "keating-managed-needle-")); }
async function installed(directory: string) {
  await mkdir(join(directory, "installed"), { mode: 0o700 });
  for (const [index, asset] of MANAGED_NEEDLE_ASSETS.entries()) await copyFile(localAssets[index], join(directory, "installed", asset.file));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class FixtureWorker extends EventEmitter implements ManagedNeedleWorker {
  requests: any[] = []; terminated = false;
  constructor(private readonly response?: (value: any) => void) { super(); }
  postMessage(value: any) {
    this.requests.push(value);
    if (value.kind === "init") queueMicrotask(() => this.emit("message", { id: value.id, ok: true, value: MANAGED_NEEDLE_MODEL }));
    else this.response?.(value);
  }
  terminate() { this.terminated = true; }
}

test("desktop and browser use the same exact published model identity and pins", () => {
  expect(MANAGED_NEEDLE_MODEL).toBe(BROWSER_NEEDLE_MODEL);
  expect(MANAGED_NEEDLE_ASSETS.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })))
    .toEqual(BROWSER_NEEDLE_ASSETS.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })));
});
test("status and missing-asset embedding never download; renderer cannot supply unbounded inputs", async () => {
  const directory = await temporary(); let fetches = 0;
  const runtime = new ManagedDesktopNeedleRuntime(directory, { fetch: async () => { fetches++; throw Error("must not fetch"); } });
  try {
    expect(await runtime.status()).toMatchObject({ installed: false, available: false, downloading: false, managed: true });
    expect(await runtime.embed({ texts: ["private"] })).toBeNull();
    for (const payload of [null, { texts: [] }, { texts: Array(17).fill("a") }, { texts: ["a"], path: "/tmp/arbitrary" },
      { texts: ["😀".repeat(1025)] }, { texts: ["\ud800"] }, { texts: ["a\0b"] }, { texts: [" "] }, { texts: Array(5).fill("a".repeat(4096)) }]) {
      await expect(runtime.embed(payload)).rejects.toThrow("needle_request_invalid");
    }
    expect(fetches).toBe(0);
  } finally { runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});
test("cancel and remove bound a noncooperative download without publishing partial assets", async () => {
  const directory = await temporary(), started = deferred<void>(); let fetches = 0;
  const runtime = new ManagedDesktopNeedleRuntime(directory, { fetch: async () => { fetches++; started.resolve(); return new Promise<Response>(() => {}); } });
  try {
    const downloading = runtime.download(); await started.promise;
    expect((await runtime.status()).downloading).toBe(true);
    const cancelled = downloading.catch(error => error.message);
    await runtime.remove();
    expect(await cancelled).toBe("needle_download_cancelled");
    expect(await runtime.status()).toMatchObject({ installed: false, downloading: false, downloadedBytes: 0 });
    expect(existsSync(join(directory, "installed"))).toBe(false);
    expect(fetches).toBe(1);
  } finally { runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});
test("oversized or wrong-hash downloads stay unavailable and redact upstream failures", async () => {
  for (const response of [() => new Response("bad", { headers: { "content-length": "999999999" } }),
    () => new Response(new Uint8Array(MANAGED_NEEDLE_ASSETS[0].bytes)), () => { throw Error("private upstream diagnostic"); }]) {
    const directory = await temporary(), runtime = new ManagedDesktopNeedleRuntime(directory, { fetch: async () => response() });
    try {
      await expect(runtime.download()).rejects.toThrow("needle_download_failed");
      expect(await runtime.status()).toMatchObject({ installed: false, error: "needle_download_failed", downloading: false });
      expect(existsSync(join(directory, "installed"))).toBe(false);
    } finally { runtime.stop(); await rm(directory, { recursive: true, force: true }); }
  }
});
test.skipIf(!available)("status stays responsive during inference; queued work and late replies disappear on removal", async () => {
  const directory = await temporary(); await installed(directory);
  const started = deferred<any>(), worker = new FixtureWorker(value => started.resolve(value));
  const runtime = new ManagedDesktopNeedleRuntime(directory, { worker: () => worker });
  try {
    const first = runtime.embed({ texts: ["private first"] }); const message = await started.promise;
    const second = runtime.embed({ texts: ["private second"] });
    expect((await runtime.status()).installed).toBe(true);
    expect(worker.requests.filter(row => row.kind === "embed")).toHaveLength(1);
    await runtime.remove();
    expect(await first).toBeNull(); expect(await second).toBeNull(); expect(worker.terminated).toBe(true);
    worker.emit("message", { id: message.id, ok: true, value: { model: MANAGED_NEEDLE_MODEL, dimensions: 3072, vectors: [Array(3072).fill(1)] } });
    expect((await runtime.status()).available).toBe(false);
  } finally { runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});
test.skipIf(!available)("timeout terminates a stuck worker and changed local bytes invalidate the cached engine", async () => {
  const directory = await temporary(); await installed(directory);
  const worker = new FixtureWorker(), runtime = new ManagedDesktopNeedleRuntime(directory, { worker: () => worker, timeoutMs: 2 });
  try {
    expect(await runtime.embed({ texts: ["private"] })).toBeNull(); expect(worker.terminated).toBe(true);
    expect((await runtime.status()).installed).toBe(true);
    const path = join(directory, "installed", "needle.wasm"), bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes);
    expect((await runtime.status()).installed).toBe(false);
    expect(await runtime.embed({ texts: ["private"] })).toBeNull();
  } finally { runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});
test.skipIf(!available)("real Node worker installs from local pinned bytes, embeds, survives relaunch, and removes durably", async () => {
  const directory = await temporary();
  try {
    const runtimePath = join(directory, "managed-runtime.mjs");
    const bundle = await Bun.build({ entrypoints: [join(repository, "desktop/src/needle-managed-runtime.ts")], target: "node", format: "esm", splitting: false });
    expect(bundle.success).toBe(true); await Bun.write(runtimePath, bundle.outputs[0]);
    await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
    await buildManagedNeedleWorker(join(directory, "needle-managed-worker.js"));
    const script = `import {readFile,stat} from "node:fs/promises";import {writeSync} from "node:fs";
      const {ManagedDesktopNeedleRuntime,MANAGED_NEEDLE_ASSETS}=await import(${JSON.stringify(pathToFileURL(runtimePath).href)});
      const sources=${JSON.stringify(localAssets)}, cache=${JSON.stringify(join(directory, "cache"))};let downloads=0;
      const runtime=new ManagedDesktopNeedleRuntime(cache,{fetch:async url=>{downloads++;const i=MANAGED_NEEDLE_ASSETS.findIndex(a=>a.url===url);if(i<0)throw Error("unexpected url");return new Response(await readFile(sources[i]));}});
      if((await runtime.status()).installed)throw Error("unexpected installed state");
      await runtime.download();if(!(await runtime.status()).installed||downloads!==3)throw Error("installation failed");
      const result=await runtime.embed({texts:["I prefer worked examples.","I study French.","I prefer worked examples."]});
      if(!result||result.dimensions!==3072||result.vectors.length!==3||JSON.stringify(result.vectors[0])!==JSON.stringify(result.vectors[2])||JSON.stringify(result.vectors[0])===JSON.stringify(result.vectors[1]))throw Error("embedding mismatch");
      const mode=(await stat(cache+"/installed/needle3.cact")).mode&511;if(mode!==384)throw Error("private mode missing");
      runtime.stop();const restarted=new ManagedDesktopNeedleRuntime(cache,{fetch:async()=>{throw Error("must stay offline")}});
      if(!(await restarted.status()).installed||!(await restarted.embed({texts:["I study French."]})))throw Error("restart failed");
      await restarted.remove();if((await restarted.status()).installed)throw Error("remove failed");restarted.stop();
      writeSync(1,JSON.stringify({downloads,dimensions:result.dimensions,vectors:result.vectors.length,restarted:true,removed:true}));`;
    const child = Bun.spawn(["node", "--input-type=module", "-e", script], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 30_000);
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).finally(() => clearTimeout(timeout));
    expect({ code, error }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(output)).toEqual({ downloads: 3, dimensions: 3072, vectors: 3, restarted: true, removed: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 35_000);
