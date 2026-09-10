import { describe, expect, test } from "bun:test";
import { OfflineDownload, type OfflineFiles } from "../src/lib/offline-download";
import { OFFLINE_MODEL, assertOfflineMedia, offlineMessages } from "../src/lib/offline-model-contract";
import { requestOfflineRound, type OfflineRuntime } from "../src/lib/offline-inference";
import { settingsForProvider } from "../src/lib/provider-config";
import { BUILT_IN_MODEL_CATALOG, catalogSections, isCatalogModel, modelSupportsToolCalls } from "../src/lib/model-catalog";
import { presentedErrorMessage } from "../src/lib/error-messages";
import { buildProviderRequest } from "../src/lib/provider-client";
import { transcribeAudioUri } from "../src/lib/speech-to-text";
import type { ChatMessage } from "../src/lib/types";

const message: ChatMessage = { id: "u", role: "user", content: "Teach me fractions", createdAt: 1 };
function fixture(initial: number[] = []) {
  let data = new Uint8Array(initial);
  let ready = false;
  let free = 1e10;
  let failHash = false;
  let promotions = 0;
  const files: OfflineFiles = {
    async partialSize() { return data.length; }, async ready() { return ready; }, async freeBytes() { return free; },
    async append(bytes, offset) {
      expect(offset).toBe(data.length);
      data = new Uint8Array([...data, ...bytes]);
    },
    async verifyAndPromote() { if (failHash) throw new Error("Integrity check failed"); ready = true; promotions++; },
    async removePartial() { data = new Uint8Array(); },
    async removeAll() { data = new Uint8Array(); ready = false; },
  };
  const ranges: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const range = (init!.headers as Record<string, string>).Range!;
    ranges.push(range);
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
    return new Response(new Uint8Array(Array.from({ length: Number(end) - Number(start) + 1 }, (_, i) => Number(start) + i)), {
      status: 206, headers: { "Content-Range": `bytes ${start}-${end}/10` },
    });
  };
  return { files, fetcher, ranges, get data() { return data; }, get promotions() { return promotions; },
    lowSpace() { free = 0; }, badHash() { failHash = true; } };
}

describe("offline download recovery", () => {
  test("removal during verification waits for cancellation and clears saved bytes", async () => {
    const f = fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    f.files.verifyAndPromote = async (signal) => {
      enter(); await released;
      expect(signal.aborted).toBe(true);
      throw new DOMException("Paused", "AbortError");
    };
    const download = new OfflineDownload(f.files, f.fetcher, 10, 4);
    const running = download.start(); await entered;
    const removal = download.remove(true);
    await expect(download.start()).rejects.toThrow("Wait for model removal");
    release(); await running; await removal;
    expect(f.data.length).toBe(0); expect(f.promotions).toBe(0);
    expect(download.state.phase).toBe("absent");
  });
  test("full removal recovers a corrupt final model even when no partial bytes are reported", async () => {
    const f = fixture(); let corrupt = true;
    f.files.ready = async () => { if (corrupt) throw new Error("Integrity check failed"); return false; };
    f.files.removeAll = async () => { corrupt = false; };
    const download = new OfflineDownload(f.files, f.fetcher, 10, 4);
    await download.refresh(); expect(download.state.phase).toBe("error"); expect(download.state.bytes).toBe(0);
    await download.remove(true); expect(download.state.phase).toBe("absent"); expect(download.state.error).toBeNull();
  });
  test("resumes an existing partial file and promotes only after verification", async () => {
    const f = fixture([0, 1, 2]);
    const download = new OfflineDownload(f.files, f.fetcher, 10, 4);
    await download.refresh(); expect(download.state.phase).toBe("paused");
    await download.start();
    expect(f.ranges).toEqual(["bytes=3-6", "bytes=7-9"]);
    expect([...f.data]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(download.state.phase).toBe("ready"); expect(f.promotions).toBe(1);
  });
  test("new process resumes from committed bytes without a saved network token", async () => {
    const f = fixture();
    const first = new OfflineDownload(f.files, f.fetcher, 10, 4);
    first.subscribe(() => { if (first.state.bytes === 4) void first.pause(); });
    await first.start(); expect(first.state.phase).toBe("paused");
    const second = new OfflineDownload(f.files, f.fetcher, 10, 4);
    await second.start(); expect(f.ranges).toEqual(["bytes=0-3", "bytes=4-7", "bytes=8-9"]);
    expect(second.state.phase).toBe("ready");
  });
  test("refuses ignored Range before consuming a full model body", async () => {
    const f = fixture([0]); let cancelled = false;
    const download = new OfflineDownload(f.files, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 }), 10, 4);
    await download.start();
    expect(cancelled).toBe(true); expect(f.data.length).toBe(1); expect(download.state.phase).toBe("error");
  });
  test("refuses wrong offsets, short bodies, and oversized bodies without appending", async () => {
    for (const [header, bytes] of [["bytes 1-4/10", [1, 2, 3, 4]], ["bytes 0-3/10", [0]], ["bytes 0-3/10", [0, 1, 2, 3, 4]]] as const) {
      const f = fixture();
      const download = new OfflineDownload(f.files, async () => new Response(new Uint8Array(bytes), { status: 206, headers: { "content-range": header } }), 10, 4);
      await download.start(); expect(download.state.phase).toBe("error"); expect(f.data.length).toBe(0); expect(f.promotions).toBe(0);
    }
  });
  test("insufficient storage does not make a network request", async () => {
    const f = fixture(); f.lowSpace();
    const download = new OfflineDownload(f.files, f.fetcher, 10, 4);
    await download.start(); expect(f.ranges).toEqual([]); expect(download.state.error).toContain("storage");
  });
  test("failed integrity check never marks a model ready", async () => {
    const f = fixture(); f.badHash();
    const download = new OfflineDownload(f.files, f.fetcher, 10, 4);
    await download.start(); expect(download.state.phase).toBe("error"); expect(f.promotions).toBe(0);
    await download.remove(); expect(f.data.length).toBe(0);
  });
  test("duplicate starts share a download and completed models are not fetched again", async () => {
    const f = fixture(); const download = new OfflineDownload(f.files, f.fetcher, 10, 4);
    const running = download.start(); expect(download.start()).toBe(running); await running;
    await download.start(); expect(f.ranges).toHaveLength(3);
    await download.remove(true); expect(download.state.phase).toBe("absent");
  });
  test("network interruption preserves committed bytes for retry", async () => {
    const f = fixture(); let calls = 0;
    const download = new OfflineDownload(f.files, async (url, init) => {
      if (++calls === 2) throw new Error("connection lost");
      return f.fetcher(url, init);
    }, 10, 4);
    await download.start(); expect(f.data.length).toBe(4);
    await download.start(); expect(download.state.phase).toBe("ready");
  });
});

describe("native text tutor", () => {
  test("catalog advertises actual context, direct answers and no tool/vision support", () => {
    const model = BUILT_IN_MODEL_CATALOG.find((entry) => entry.provider === "litert")!;
    expect(isCatalogModel(model)).toBe(true); expect(model.contextWindow).toBe(4096); expect(model.vision).toBe(false);
    expect(model.reasoning).toBe(false); expect(modelSupportsToolCalls([model], settingsForProvider("litert"))).toBe(false);
    const sections = catalogSections([model], [], false);
    expect(sections.local).toEqual([model]); expect(sections.cloud).toEqual([]);
  });
  test("local requests cannot accidentally go through an HTTP provider", () => {
    expect(() => buildProviderRequest(settingsForProvider("litert"), "unused", [message])).toThrow("native LiteRT");
  });
  test("images, audio and PDFs fail with recovery even alongside ordinary text", () => {
    for (const [kind, mimeType, expected] of [["image", "image/png", "vision model"], ["document", "audio/mp4", "transcription"], ["document", "application/pdf", "extracted text"]] as const) {
      const input = { ...message, attachments: [{ id: "a", kind, name: "file", mimeType, size: 1 }] };
      try { assertOfflineMedia([input]); throw new Error("expected rejection"); }
      catch (error) { expect(presentedErrorMessage((error as Error).message, false)).toContain(expected); }
    }
  });
  test("prepared text documents are included; missing bytes are not silently dropped", () => {
    const file = { id: "a", kind: "document" as const, name: "notes.txt", mimeType: "text/plain", size: 3, encoding: "text" as const, data: "abc" };
    expect(offlineMessages([{ ...message, attachments: [file] }])[0]!.content).toContain("abc");
    expect(() => offlineMessages([{ ...message, attachments: [{ ...file, data: undefined }] }])).toThrow("Reattach");
  });
  test("unconfigured dictation explains online transcription and retains the retry path", async () => {
    await expect(transcribeAudioUri("file:///recording", "audio/mp4", "litert", { readKey: async () => null })).rejects.toThrow("type your message to stay offline");
  });
  test("native generation streams answer, releases listener, and never invents usage", async () => {
    let listener: ((event: { requestId: string; text: string }) => void) | undefined;
    let removed = false; const deltas: string[] = [];
    const runtime: OfflineRuntime = {
      addListener(_name, callback) { listener = callback; return { remove() { removed = true; } }; },
      async generateAsync(id, _uri, _system, history) {
        expect(JSON.parse(history)[0].content).toBe(message.content);
        listener?.({ requestId: "other-request", text: "ignore" });
        listener?.({ requestId: id, text: "One half" }); return "One half";
      }, cancelGeneration() {},
    };
    const result = await requestOfflineRound(settingsForProvider("litert"), [message], { onTextDelta: (delta) => deltas.push(delta) },
      (use) => use("file:///model", runtime));
    expect(result.text).toBe("One half"); expect(result.usage).toBeNull(); expect(result.calls).toEqual([]);
    expect(deltas).toEqual(["One half"]); expect(removed).toBe(true);
  });
  test("abort cancels native generation and removes the subscription", async () => {
    const controller = new AbortController(); let cancelled = false; let removed = false;
    const runtime: OfflineRuntime = {
      addListener() { return { remove() { removed = true; } }; },
      async generateAsync() { controller.abort(); return "partial"; },
      cancelGeneration() { cancelled = true; },
    };
    await expect(requestOfflineRound(settingsForProvider("litert"), [message], { signal: controller.signal }, (use) => use("file:///model", runtime))).rejects.toThrow("Response stopped");
    expect(cancelled).toBe(true); expect(removed).toBe(true);
  });
  test("unsupported media fails before leasing or loading the runtime", async () => {
    let loaded = false;
    await expect(requestOfflineRound(settingsForProvider("litert"), [{ ...message, attachments: [{ id: "i", name: "photo", kind: "image", mimeType: "image/png", size: 1 }] }], {},
      async () => { loaded = true; throw new Error("must not load"); })).rejects.toThrow("vision model");
    expect(loaded).toBe(false); expect(OFFLINE_MODEL.runtimeVersion).toBe("0.16.0");
  });
});
