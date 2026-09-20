import { OfflineDownload, type OfflineFiles } from "./offline-download";
import { NEEDLE_MODEL, NEEDLE_NATIVE_REVISION, NEEDLE_NATIVE_PLATFORMS, needleNativeModelIdentity, validateNeedleTexts, type NeedleNativePlatform } from "./needle-contract";

export interface NeedleEmbeddingResult { model: string; dimensions: number; vectors: number[][] }
export interface NeedleRuntime {
  supported: boolean;
  runtimeRevision: string;
  modelIdentity: string | null;
  getModelDirectoryAsync(): Promise<string>;
  createModelFileAsync(): Promise<string>;
  verifyModelFileAsync(uri: string): Promise<boolean>;
  embedAsync(modelUri: string, texts: string[]): Promise<NeedleEmbeddingResult>;
}
interface NeedleFile {
  readonly uri: string; readonly name: string; readonly exists: boolean; readonly size: number;
  open(): { readonly size: number | null; offset: number | null; writeBytes(bytes: Uint8Array): void; close(): void };
  rename(name: string): void;
  delete(): void;
}
export interface NeedleModelDependencies {
  runtime(): Promise<NeedleRuntime | null>;
  platform(): Promise<"android" | "ios" | null>;
  files(directory: string): Promise<{ model: NeedleFile; partial: NeedleFile }>;
  freeBytes(): Promise<number>;
  fetch: typeof fetch;
}

/** The injected boundary keeps native files and inference out of deterministic tests. */
export function createNeedleModel(dependencies: NeedleModelDependencies) {
  let embedding = false;
  let removing = false;
  const runtime = async () => {
    const [native, platform] = await Promise.all([dependencies.runtime(), dependencies.platform()]);
    const platformIdentities = (Object.keys(NEEDLE_NATIVE_PLATFORMS) as NeedleNativePlatform[])
      .filter(key => platform !== null && key.startsWith(`${platform}-`)).map(needleNativeModelIdentity);
    if (!native?.supported || !platform || native.runtimeRevision !== NEEDLE_NATIVE_REVISION
      || !platformIdentities.includes(native.modelIdentity ?? "")) {
      throw new Error("Local recall needs a compatible native Keating build with Needle. It is unavailable in Expo Go and the web preview.");
    }
    return native;
  };
  const files = async (native: NeedleRuntime) => dependencies.files(await native.getModelDirectoryAsync());
  const ready = async (native: NeedleRuntime) => {
    const { model } = await files(native);
    if (!model.exists) return false;
    if (model.size !== NEEDLE_MODEL.bytes || !await native.verifyModelFileAsync(model.uri)) {
      throw new Error("The local recall model failed its integrity check. Remove it and download it again.");
    }
    return true;
  };
  const canRemove = () => {
    if (embedding) throw new Error("Local recall is still working. Wait for it to finish before removing the model.");
  };
  const storage: OfflineFiles = {
    async ready() { return ready(await runtime()); },
    async partialSize() { const { partial } = await files(await runtime()); return partial.exists ? partial.size : 0; },
    freeBytes: dependencies.freeBytes,
    async append(bytes, offset) {
      const native = await runtime();
      const { partial } = await files(native);
      if (!partial.exists && await native.createModelFileAsync() !== partial.uri) throw new Error("Needle returned an unexpected download path.");
      const handle = partial.open();
      try {
        if (handle.size !== offset) throw new Error("The saved download changed. Resume it to recover.");
        handle.offset = offset;
        handle.writeBytes(bytes);
      } finally { handle.close(); }
    },
    async verifyAndPromote(signal) {
      const native = await runtime();
      const { partial, model } = await files(native);
      if (partial.size !== NEEDLE_MODEL.bytes || !await native.verifyModelFileAsync(partial.uri)) {
        throw new Error("The local recall download failed its integrity check. Remove the download and try again.");
      }
      if (signal.aborted) throw new Error("Download paused.");
      partial.rename(model.name);
    },
    async removePartial() { canRemove(); const { partial } = await files(await runtime()); canRemove(); if (partial.exists) partial.delete(); },
    async removeAll() {
      canRemove();
      const { model, partial } = await files(await runtime());
      canRemove();
      for (const file of [model, partial]) if (file.exists) file.delete();
    },
  };
  const download = new OfflineDownload(storage, dependencies.fetch, NEEDLE_MODEL.bytes, 4 * 1024 * 1024, NEEDLE_MODEL.url);
  async function remove(all = false): Promise<void> {
    canRemove();
    if (removing) return;
    removing = true;
    try { await download.remove(all); } finally { removing = false; }
  }
  async function embed(texts: readonly string[], signal?: AbortSignal): Promise<NeedleEmbeddingResult | null> {
    if (signal?.aborted || embedding || removing || ["downloading", "verifying"].includes(download.state.phase)) return null;
    const input = [...texts];
    try { validateNeedleTexts(input); } catch { return null; }
    embedding = true;
    const work = (async () => {
      try {
        const native = await runtime();
        const identity = native.modelIdentity;
        if (signal?.aborted || !await ready(native) || signal?.aborted) return null;
        const { model } = await files(native);
        if (signal?.aborted) return null;
        const result = await native.embedAsync(model.uri, input);
        if (signal?.aborted || await runtime() !== native || native.modelIdentity !== identity || result.model !== identity
          || !Number.isInteger(result.dimensions) || result.dimensions < 1 || result.dimensions > 4096
          || !Array.isArray(result.vectors) || result.vectors.length !== input.length
          || result.vectors.some(vector => !Array.isArray(vector) || vector.length !== result.dimensions
            || vector.some(value => typeof value !== "number" || !Number.isFinite(value)))) return null;
        return { model: result.model, dimensions: result.dimensions, vectors: result.vectors.map(vector => [...vector]) };
      } catch { return null; }
      finally { embedding = false; }
    })();
    if (!signal) return work;
    let abort!: () => void;
    const cancelled = new Promise<null>(resolve => { abort = () => resolve(null); signal.addEventListener("abort", abort, { once: true }); });
    if (signal.aborted) abort();
    // Native inference may finish after cancellation. Keep its lease until work
    // settles, so another call or file removal cannot overlap that native call.
    try { return await Promise.race([work, cancelled]); }
    finally { signal.removeEventListener("abort", abort); }
  }
  return { download, remove, embed };
}

let foregroundListenerInstalled = false;
const nativeModel = createNeedleModel({
  async runtime() {
    if (!foregroundListenerInstalled) {
      foregroundListenerInstalled = true;
      const { AppState } = await import("react-native");
      AppState.addEventListener("change", state => { if (state !== "active") void needleDownload.pause(); });
    }
    return (await import("../../modules/keating-needle/src")).nativeNeedle;
  },
  async platform() { const { Platform } = await import("react-native"); return Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : null; },
  async files(directory) {
    const { File } = await import("expo-file-system");
    return { model: new File(directory, NEEDLE_MODEL.filename), partial: new File(directory, NEEDLE_MODEL.partialFilename) };
  },
  async freeBytes() { return (await import("expo-file-system")).Paths.availableDiskSpace; },
  fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    (await import("expo/fetch")).fetch(input, init)) as unknown as typeof fetch,
});
export const needleDownload = nativeModel.download;
export const removeNeedleModel = nativeModel.remove;
export const embedNeedleTexts = nativeModel.embed;
