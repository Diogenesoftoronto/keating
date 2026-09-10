import { File, Paths } from "expo-file-system";
import { fetch as nativeFetch } from "expo/fetch";
import { AppState } from "react-native";
import { nativeLiteRT } from "../../modules/keating-litert/src";
import { OfflineDownload, type OfflineFiles } from "./offline-download";
import { OFFLINE_MODEL } from "./offline-model-contract";

const filename = `minicpm5-${OFFLINE_MODEL.sha256.slice(0, 16)}.litertlm`;
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
async function files() {
  directory ??= native().getDirectoryAsync();
  const root = await directory;
  return { model: new File(root, filename), partial: new File(root, `${filename}.part`), marker: new File(root, `${filename}.verified`) };
}
const storage: OfflineFiles = {
  async ready() {
    const { model, marker } = await files();
    if (!model.exists) return false;
    if (model.size !== OFFLINE_MODEL.bytes) throw new Error("The offline model is incomplete. Remove it in Settings and download it again.");
    if (!marker.exists || await marker.text() !== OFFLINE_MODEL.sha256) {
      if (await native().sha256Async(model.uri) !== OFFLINE_MODEL.sha256) throw new Error("The offline model failed its integrity check. Remove it and download it again.");
      await native().createFileAsync(marker.uri);
      marker.write(OFFLINE_MODEL.sha256);
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
    if (partial.size !== OFFLINE_MODEL.bytes || await native().sha256Async(partial.uri) !== OFFLINE_MODEL.sha256) {
      throw new Error("The download failed its integrity check. Cancel the download, then download it again.");
    }
    if (signal.aborted) throw new DOMException("Download paused.", "AbortError");
    partial.rename(model.name);
    await native().createFileAsync(marker.uri);
    marker.write(OFFLINE_MODEL.sha256);
  },
  async removePartial() { const { partial } = await files(); if (partial.exists) partial.delete(); },
  async removeAll() {
    await native().unloadAsync();
    const { model, marker, partial } = await files();
    for (const file of [model, marker, partial]) if (file.exists) file.delete();
  },
};
export const offlineDownload = new OfflineDownload(storage, nativeFetch as typeof fetch);
if (!nativeLiteRT || nativeLiteRT.supported === false) offlineDownload.state = { phase: "unavailable", bytes: 0, freeBytes: 0,
  error: nativeLiteRT?.supported === false ? "Offline tutoring requires a 64-bit device. Your online models remain available." : null };
else {
  // Foreground download by design; explicit Resume after backgrounding or relaunch.
  AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      void offlineDownload.pause();
      if (!inferenceBusy) void native().unloadAsync().catch(() => undefined);
    }
  });
}
export async function removeOfflineModel(all: boolean) {
  if (inferenceBusy) throw new Error("Stop the current response before removing the offline model.");
  if (removing) return;
  removing = true;
  try { await offlineDownload.remove(all); } finally { removing = false; }
}
export async function withOfflineModel<T>(use: (uri: string, runtime: NonNullable<typeof nativeLiteRT>) => Promise<T>): Promise<T> {
  if (inferenceBusy || removing) throw new Error("The offline tutor is busy. Wait for the current operation to finish.");
  inferenceBusy = true;
  try {
    const runtime = native();
    if (offlineDownload.state.phase === "downloading" || offlineDownload.state.phase === "verifying" || !await storage.ready()) {
      throw new Error("Download the offline tutor in Settings → Offline tutor before using MiniCPM5. You can also choose a configured online model.");
    }
    return await use((await files()).model.uri, runtime);
  } finally {
    if (AppState.currentState !== "active") await nativeLiteRT?.unloadAsync().catch(() => undefined);
    inferenceBusy = false;
  }
}
