import { File, Paths } from "expo-file-system";
import { fetch as nativeFetch } from "expo/fetch";
import { AppState } from "react-native";
import { nativeLiteRT } from "../../modules/keating-litert/src";
import { OfflineDownload, type OfflineFiles } from "./offline-download";
import { OFFLINE_MODEL, OFFLINE_MODELS, getOfflineModel, type OfflineModelSpec } from "./offline-model-contract";


let directory: Promise<string> | undefined;
let inferenceBusy = false;
let removing = false;
const native = () => {
  if (nativeLiteRT?.supported === false) throw new Error("Offline tutoring requires a 64-bit device. Choose a configured online model on this device.");
  if (!nativeLiteRT || nativeLiteRT.runtimeVersion !== OFFLINE_MODEL.runtimeVersion) {
    throw new Error("Offline tutoring needs an updated native Keating build with LiteRT 0.16.0. It is not available in Expo Go or the mobile web preview.");
  }
  return nativeLiteRT;
};
function modelStorage(spec: OfflineModelSpec) {
  async function files() {
    const filename = `${spec.id === OFFLINE_MODEL.id ? "minicpm5" : "gemma4"}-${spec.sha256.slice(0, 16)}.litertlm`;
    directory ??= native().getDirectoryAsync();
    const root = await directory;
    return { model: new File(root, filename), partial: new File(root, `${filename}.part`), marker: new File(root, `${filename}.verified`) };
  }
  const storage: OfflineFiles = {
    async ready() {
      const { model, marker } = await files();
      if (!model.exists) return false;
      if (model.size !== spec.bytes) throw new Error("The offline model is incomplete. Remove it in Settings and download it again.");
      if (!marker.exists || await marker.text() !== spec.sha256) {
        if (await native().sha256Async(model.uri) !== spec.sha256) throw new Error("The offline model failed its integrity check. Remove it and download it again.");
        await native().createFileAsync(marker.uri);
        marker.write(spec.sha256);
      }
      return true;
    },
    async partialSize() { const { partial } = await files(); return partial.exists ? partial.size : 0; },
    async freeBytes() { return Paths.availableDiskSpace; },
    async append(bytes, offset) {
      const { partial } = await files();
      // Expo's external-path permission check cannot create a new noBackupFilesDir
      // file, so let our scoped native module create it before opening the handle.
      if (!partial.exists) await native().createFileAsync(partial.uri);
      const handle = partial.open();
      try {
        if (handle.size !== offset) throw new Error("The download changed while writing. Resume it to recover.");
        handle.offset = offset;
        handle.writeBytes(bytes);
      } finally { handle.close(); }
    },
    async verifyAndPromote(signal) {
      const { partial, model, marker } = await files();
      if (partial.size !== spec.bytes || await native().sha256Async(partial.uri) !== spec.sha256) {
        throw new Error("The download failed its integrity check. Cancel the download, then download it again.");
      }
      if (signal.aborted) throw new DOMException("Download paused.", "AbortError");
      partial.rename(model.name);
      await native().createFileAsync(marker.uri);
      marker.write(spec.sha256);
    },
    async removePartial() { const { partial } = await files(); if (partial.exists) partial.delete(); },
    async removeAll() {
      await native().unloadAsync();
      const { model, marker, partial } = await files();
      for (const file of [model, marker, partial]) if (file.exists) file.delete();
    },
  };
  return { storage, download: new OfflineDownload(storage, nativeFetch as unknown as typeof fetch, spec.bytes, 4 * 1024 * 1024, spec.url), files };

}
const models = new Map(OFFLINE_MODELS.map(model => [model.id as string, modelStorage(model)]));
export const offlineDownload = models.get(OFFLINE_MODEL.id)!.download;
export function offlineDownloadFor(id: string) { return models.get(getOfflineModel(id).id)!.download; }
if (!nativeLiteRT || nativeLiteRT.supported === false) for (const { download } of models.values()) download.state = { phase: "unavailable", bytes: 0, freeBytes: 0,
  error: nativeLiteRT?.supported === false ? "Offline tutoring requires a 64-bit device. Your online models remain available." : null };
else {
  // Foreground download by design; explicit Resume after backgrounding or relaunch.
  AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      for (const { download } of models.values()) void download.pause();
      if (!inferenceBusy) void native().unloadAsync().catch(() => undefined);
    }
  });
}
export async function removeOfflineModel(all: boolean, modelId: string = OFFLINE_MODEL.id) {
  if (inferenceBusy) throw new Error("Stop the current response before removing the offline model.");
  if (removing) return;
  removing = true;
  try { await offlineDownloadFor(modelId).remove(all); } finally { removing = false; }
}
export async function withOfflineModel<T>(use: (uri: string, runtime: NonNullable<typeof nativeLiteRT>) => Promise<T>, modelId: string = OFFLINE_MODEL.id): Promise<T> {
  if (inferenceBusy || removing) throw new Error("The offline tutor is busy. Wait for the current operation to finish.");
  inferenceBusy = true;
  try {
    const runtime = native();
    const model = getOfflineModel(modelId);
    const { storage, download, files } = models.get(model.id)!;
    if (download.state.phase === "downloading" || download.state.phase === "verifying" || !await storage.ready()) {
      throw new Error(`Download ${model.name} in Settings → Offline tutor before using it. You can also choose a configured online model.`);
    }
    return await use((await files()).model.uri, runtime);
  } finally {
    if (AppState.currentState !== "active") await nativeLiteRT?.unloadAsync().catch(() => undefined);
    inferenceBusy = false;
  }
}
