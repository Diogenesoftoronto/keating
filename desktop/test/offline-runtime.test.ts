import { test, expect, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfflineRuntime, responseText } from "../src/offline-runtime.js";
import { offlineRequest, offlineMessages } from "../src/offline-contract.js";
const data = Buffer.from("verified model fixture");
const model = { file: "model.litertlm", url: "https://example.test/model", bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(fetcher: (url: unknown, init?: RequestInit) => Promise<Response>, bundledModel?: string) {
  const directory = await mkdtemp(join(tmpdir(), "keating-offline-test-"));
  directories.push(directory);
  const options = { directory, executable: "/unused-test-boundary", model, fetch: fetcher as typeof fetch, probe: async () => {}, bundledModel };
  return { directory, options, runtime: new OfflineRuntime(options) };
}
test("download installs only verified bytes and persists across runtime recreation", async () => {
  const { runtime, options } = await setup(async () => new Response(data));
  await runtime.download();
  expect(await runtime.status()).toMatchObject({ available: true, installed: true, downloading: false, downloadedBytes: data.length });
  expect((await new OfflineRuntime(options).status()).installed).toBe(true);
});
test("resumes persisted partial bytes with an exact range", async () => {
  const { runtime, directory } = await setup(async (_, init) => {
    expect(new Headers(init?.headers).get("range")).toBe("bytes=5-");
    return new Response(data.subarray(5), { status: 206, headers: { "content-range": `bytes 5-${data.length - 1}/${data.length}` } });
  });
  await writeFile(join(directory, model.file + ".partial"), data.subarray(0, 5));
  await runtime.download();
  expect(await readFile(join(directory, model.file))).toEqual(data);
});
test("server ignoring range restarts rather than appending", async () => {
  const { runtime, directory } = await setup(async () => new Response(data));
  await writeFile(join(directory, model.file + ".partial"), data.subarray(0, 5));
  await runtime.download();
  expect((await runtime.status()).installed).toBe(true);
});
test("bad range preserves partial data and rejects installation", async () => {
  const { runtime, directory } = await setup(async () => new Response(data, { status: 206, headers: { "content-range": "bytes 0-1/2" } }));
  await writeFile(join(directory, model.file + ".partial"), data.subarray(0, 5));
  await expect(runtime.download()).rejects.toThrow("invalid resume range");
  expect((await runtime.status()).downloadedBytes).toBe(5);
});
test("wrong hash deletes corrupt partial model and reports actionable error", async () => {
  const { runtime } = await setup(async () => new Response(Buffer.alloc(data.length)));
  await expect(runtime.download()).rejects.toThrow("verification failed");
  expect(await runtime.status()).toMatchObject({ installed: false, downloadedBytes: 0 });
});
test("cancellation aborts fetch and retains partial bytes for next download", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { runtime, directory } = await setup(async (_, init) => {
    started();
    return await new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  await writeFile(join(directory, model.file + ".partial"), data.subarray(0, 5));
  const download = runtime.download();
  const rejected = download.catch(error => error);
  await ready;
  await runtime.cancelDownload();
  expect((await rejected).message).toContain("cancelled");
  expect(await runtime.status()).toMatchObject({ installed: false, downloading: false, downloadedBytes: 5 });
});
test("complete partial file is verified without another HTTP request", async () => {
  const { runtime, directory } = await setup(async () => { throw new Error("Unexpected HTTP"); });
  await writeFile(join(directory, model.file + ".partial"), data);
  await runtime.download();
  expect((await runtime.status()).installed).toBe(true);
});
test("offline edition uses bundled model in place and explains immutable removal", async () => {
  const { runtime, directory, options } = await setup(async () => new Response(data));
  const bundledModel = join(directory, "bundled.litertlm");
  await writeFile(bundledModel, data);
  const bundled = new OfflineRuntime({ ...options, bundledModel });
  expect((await bundled.status()).installed).toBe(true);
  expect((await bundled.status()).bundled).toBe(true);
  await expect(readFile(join(directory, model.file))).rejects.toThrow();
  await expect(bundled.remove()).rejects.toThrow("standard edition");
  await runtime.stop();
});
test("downloaded model removal clears complete and partial bytes persistently", async () => {
  const { runtime, options } = await setup(async () => new Response(data));
  await runtime.download();
  await runtime.remove();
  expect(await new OfflineRuntime(options).status()).toMatchObject({ installed: false, bundled: false, downloadedBytes: 0 });
});
test("text contract rejects media, oversized input, invalid tokens and temperatures", () => {
  for (const value of [{ prompt: "hi", image: "data" }, { prompt: "x".repeat(24001) }, { prompt: "hi", maxTokens: 1.5 }, { prompt: "hi", temperature: NaN }]) expect(() => offlineRequest(value)).toThrow();
  expect(offlineRequest({ prompt: "hi", temperature: 0 })).toEqual({ prompt: "hi", maxTokens: 1024, temperature: 0 });
});
test("response parser returns answer text and excludes thought channels", () => {
  expect(responseText(JSON.stringify({ content: [{ type: "text", text: "private", channel: "thought" }, { type: "text", text: "Hello" }] }))).toBe("Hello");
  expect(() => responseText('{"content":[]}')).toThrow("no answer");
});
test("coordinator envelope preserves system and history as structured messages", () => {
  const wire = offlineMessages(JSON.stringify({ system: "Teach clearly", conversation: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "next" }] })).split("\n").map(value => JSON.parse(value));
  expect(wire[0]).toBe("Teach clearly");
  expect(wire[1]).toHaveLength(2);
  expect(wire[2].content[0].text).toBe("next");
  expect(() => offlineMessages('{"conversation":[{"role":"user","content":[]}]}')).toThrow("text only");
});
