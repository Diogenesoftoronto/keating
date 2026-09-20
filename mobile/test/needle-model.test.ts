import { describe, expect, test } from "bun:test";
import { createNeedleModel, type NeedleEmbeddingResult, type NeedleRuntime } from "../src/lib/needle-model";
import { NEEDLE_MODEL, NEEDLE_NATIVE_REVISION, needleNativeModelIdentity } from "../src/lib/needle-contract";
import { OfflineDownload, type OfflineFiles } from "../src/lib/offline-download";
import { OFFLINE_MODEL } from "../src/lib/offline-model-contract";

function fixture(options: { ready?: boolean; partialBytes?: number } = {}) {
  let present = options.ready ?? true;
  let partialBytes = options.partialBytes ?? 0;
  let integrity = true;
  let calls = 0;
  let verificationCalls = 0;
  const modelUri = `file:///private/${NEEDLE_MODEL.filename}`;
  const partialUri = `file:///private/${NEEDLE_MODEL.partialFilename}`;
  const runtime: NeedleRuntime = {
    supported: true, runtimeRevision: NEEDLE_NATIVE_REVISION, modelIdentity: needleNativeModelIdentity("android-arm64"),
    async getModelDirectoryAsync() { return "file:///private"; },
    async createModelFileAsync() { return partialUri; },
    async verifyModelFileAsync() { verificationCalls++; return integrity; },
    async embedAsync(_uri, texts) { calls++; return { model: runtime.modelIdentity!, dimensions: 2, vectors: texts.map(() => [1, 0]) }; },
  };
  const urls: string[] = [];
  const files = async () => ({
    model: { uri: modelUri, name: NEEDLE_MODEL.filename, get exists() { return present; }, size: NEEDLE_MODEL.bytes,
      open() { throw new Error("must not write final model"); }, rename() { throw new Error("must not rename final model"); }, delete() { present = false; } },
    partial: { uri: partialUri, name: NEEDLE_MODEL.partialFilename, get exists() { return partialBytes > 0; }, get size() { return partialBytes; },
      open() { return { get size() { return partialBytes; }, offset: 0, writeBytes(bytes: Uint8Array) { partialBytes += bytes.length; }, close() {} }; },
      rename(name: string) { expect(name).toBe(NEEDLE_MODEL.filename); present = true; partialBytes = 0; }, delete() { partialBytes = 0; } },
  });
  const model = createNeedleModel({ runtime: async () => runtime, platform: async () => "android", files, freeBytes: async () => 1e9,
    fetch: async (input, init) => {
      urls.push(String(input));
      const range = (init!.headers as Record<string, string>).Range!;
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return new Response(new Uint8Array(Number(end) - Number(start) + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${NEEDLE_MODEL.bytes}` } });
    },
  });
  return { model, runtime, urls, get calls() { return calls; }, get verificationCalls() { return verificationCalls; },
    get present() { return present; }, badIntegrity() { integrity = false; } };
}

describe("Needle native model lease", () => {
  test("only a pinned, verified ready model embeds; returned vectors are detached", async () => {
    const f = fixture();
    const vector = [0.25, 0.75];
    f.runtime.embedAsync = async (_uri, texts) => ({ model: f.runtime.modelIdentity!, dimensions: 2, vectors: texts.map(() => vector) });
    const result = await f.model.embed(["Earlier reasoning"]);
    expect(f.verificationCalls).toBe(1);
    expect(result?.vectors).toEqual([[0.25, 0.75]]);
    vector[0] = 10;
    expect(result?.vectors[0]?.[0]).toBe(0.25);
  });
  test("missing, corrupt, unsupported and changed runtime models never infer", async () => {
    const absent = fixture({ ready: false }); expect(await absent.model.embed(["text"])).toBeNull(); expect(absent.calls).toBe(0);
    const corrupt = fixture(); corrupt.badIntegrity(); expect(await corrupt.model.embed(["text"])).toBeNull(); expect(corrupt.calls).toBe(0);
    const unsupported = fixture(); unsupported.runtime.supported = false; expect(await unsupported.model.embed(["text"])).toBeNull(); expect(unsupported.verificationCalls).toBe(0);
    const changed = fixture(); changed.runtime.modelIdentity = "other"; expect(await changed.model.embed(["text"])).toBeNull(); expect(changed.calls).toBe(0);
  });
  test("rejects invalid input before native verification", async () => {
    const f = fixture();
    for (const input of [[], [""], ["\0"], ["x".repeat(4097)], Array.from({ length: 17 }, () => "x")]) expect(await f.model.embed(input)).toBeNull();
    expect(f.verificationCalls).toBe(0);
    expect(f.calls).toBe(0);
  });
  test("aborted noncooperative inference retains lease until native completion", async () => {
    const f = fixture();
    let enter!: () => void, finish!: (value: NeedleEmbeddingResult) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<NeedleEmbeddingResult>(resolve => { finish = resolve; });
    f.runtime.embedAsync = async () => { enter(); return pending; };
    const controller = new AbortController();
    const first = f.model.embed(["text"], controller.signal);
    await entered;
    expect(await f.model.embed(["overlap"])).toBeNull();
    controller.abort();
    expect(await first).toBeNull();
    await expect(f.model.remove(true)).rejects.toThrow("still working");
    await expect(f.model.download.remove(true)).rejects.toThrow("still working");
    finish({ model: f.runtime.modelIdentity!, dimensions: 2, vectors: [[1, 0]] });
    await new Promise(resolve => setTimeout(resolve, 0));
    await f.model.remove(true);
    expect(f.present).toBe(false);
    expect(await f.model.embed(["removed"])).toBeNull();
  });
  test("model drift and malformed output cannot enter retrieval", async () => {
    for (const result of [
      { model: "wrong", dimensions: 2, vectors: [[1, 0]] },
      { model: needleNativeModelIdentity("android-arm64"), dimensions: 2, vectors: [[1]] },
      { model: needleNativeModelIdentity("android-arm64"), dimensions: 2, vectors: [[NaN, 0]] },
    ]) {
      const f = fixture(); f.runtime.embedAsync = async () => result;
      expect(await f.model.embed(["text"])).toBeNull();
    }
    const f = fixture(); f.runtime.embedAsync = async () => {
      f.runtime.runtimeRevision = "changed";
      return { model: f.runtime.modelIdentity!, dimensions: 2, vectors: [[1, 0]] };
    };
    expect(await f.model.embed(["text"])).toBeNull();
  });
  test("resumes Needle bytes from its pinned URL and requires integrity before promotion", async () => {
    const f = fixture({ ready: false, partialBytes: NEEDLE_MODEL.bytes - 3 });
    await f.model.download.refresh(); expect(f.model.download.state.phase).toBe("paused");
    await f.model.download.start(); expect(f.model.download.state.phase).toBe("ready");
    expect(f.urls).toEqual([NEEDLE_MODEL.url]); expect(f.present).toBe(true);
    const corrupt = fixture({ ready: false, partialBytes: NEEDLE_MODEL.bytes - 3 }); corrupt.badIntegrity();
    await corrupt.model.download.start(); expect(corrupt.model.download.state.phase).toBe("error"); expect(corrupt.present).toBe(false);
  });
  test("unconfigured downloader callers retain the offline tutor URL", async () => {
    let seen = "";
    const files: OfflineFiles = { async ready() { return false; }, async partialSize() { return 0; }, async freeBytes() { return 1e9; }, async append() {}, async verifyAndPromote() {}, async removePartial() {}, async removeAll() {} };
    const downloader = new OfflineDownload(files, async input => { seen = String(input); return new Response(new Uint8Array([1]), { status: 206, headers: { "Content-Range": "bytes 0-0/1" } }); }, 1, 1);
    await downloader.start(); expect(seen).toBe(OFFLINE_MODEL.url); expect(downloader.state.phase).toBe("ready");
  });
});
