import { File, Paths } from "expo-file-system";
import { fetch as nativeFetch } from "expo/fetch";
import { AppState, Platform } from "react-native";
import { nativeLiteRT } from "../../../modules/keating-litert/src";
import { OfflineDownload, type OfflineFiles } from "../offline-download";
import { JULIA_ARTIFACTS } from "../../../../shared/julia/manifest";

export const mobileJuliaSupported = Platform.OS === "android" && !!nativeLiteRT && nativeLiteRT.supported !== false;
async function files(name: string) {
  if (!mobileJuliaSupported || !nativeLiteRT) throw new Error("Julia needs an updated native Android build; it is unavailable in Expo Go and mobile web.");
  const root = await nativeLiteRT.getDirectoryAsync();
  return { file: new File(root, name), partial: new File(root, `${name}.part`), marker: new File(root, `${name}.verified`) };
}
export const juliaDownloads = JULIA_ARTIFACTS.map(artifact => {
  const storage: OfflineFiles = {
    async ready() {
      const { file, marker } = await files(artifact.file);
      if (!file.exists) return false;
      if (file.size !== artifact.bytes) throw new Error("Julia is incomplete. Remove its files and download again.");
      if (!marker.exists || await marker.text() !== artifact.sha256) {
        if (await nativeLiteRT!.sha256Async(file.uri) !== artifact.sha256) throw new Error("Julia integrity check failed. Remove its files and download again.");
        await nativeLiteRT!.createFileAsync(marker.uri); marker.write(artifact.sha256);
      }
      return true;
    },
    async partialSize() { const { partial } = await files(artifact.file); return partial.exists ? partial.size : 0; },
    async freeBytes() { return Paths.availableDiskSpace; },
    async append(bytes, offset) {
      const { partial } = await files(artifact.file);
      if (!partial.exists) await nativeLiteRT!.createFileAsync(partial.uri);
      const handle = partial.open();
      try { if (handle.size !== offset) throw new Error("Julia download changed while writing."); handle.offset = offset; handle.writeBytes(bytes); }
      finally { handle.close(); }
    },
    async verifyAndPromote(signal) {
      const { partial, file, marker } = await files(artifact.file);
      if (partial.size !== artifact.bytes || await nativeLiteRT!.sha256Async(partial.uri) !== artifact.sha256) throw new Error("Julia download failed its SHA256 check.");
      if (signal.aborted) throw new Error("Julia download paused.");
      partial.rename(file.name); await nativeLiteRT!.createFileAsync(marker.uri); marker.write(artifact.sha256);
    },
    async removePartial() { const { partial } = await files(artifact.file); if (partial.exists) partial.delete(); },
    async removeAll() { const set = await files(artifact.file); for (const file of Object.values(set)) if (file.exists) file.delete(); },
  };
  return { artifact, storage, download: new OfflineDownload(storage, nativeFetch as unknown as typeof fetch, artifact.bytes, 4 * 1024 * 1024, artifact.url) };
});
let starting = false, cancelled = false;
export async function startJuliaDownload() {
  if (starting) return;
  starting = true; cancelled = false;
  try { for (const { download } of juliaDownloads) { if (cancelled) break; await download.start(); if (download.state.phase !== "ready") break; } }
  finally { starting = false; }
}
export async function pauseJuliaDownload() { cancelled = true; await Promise.all(juliaDownloads.map(({ download }) => download.pause())); }
export async function refreshJuliaDownload() { await Promise.all(juliaDownloads.map(({ download }) => download.refresh())); }
export async function verifiedJuliaFiles(): Promise<{ model: string; tokenizer: unknown; tokenizerConfig: unknown }> {
  for (const item of juliaDownloads) if (item.download.state.phase === "downloading" || item.download.state.phase === "verifying" || !await item.storage.ready()) throw new Error("Download Julia in Settings → Local judgement first.");
  return { model: (await files("model.onnx")).file.uri.replace(/^file:\/\//u, ""),
    tokenizer: JSON.parse(await (await files("tokenizer.json")).file.text()), tokenizerConfig: JSON.parse(await (await files("tokenizer_config.json")).file.text()) };
}
export async function removeJuliaModel() {
  await pauseJuliaDownload();
  const { withOfflineJudgement } = await import("../offline-model");
  await withOfflineJudgement(async () => {
    await (await import("./julia-runtime")).unloadMobileJulia();
    for (const { download } of juliaDownloads) await download.remove(true);
  });
}
AppState.addEventListener("change", state => { if (state !== "active") void pauseJuliaDownload(); });
