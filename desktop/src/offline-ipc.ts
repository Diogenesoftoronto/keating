import { ipcMain, type BrowserWindow } from "electron";
import { nativeSenderAuthorized } from "./native-policy.js";
import type { OfflineModels } from "./offline-models.js";

const CHANNEL = "keating:offline:rpc";
let activeCleanup: (() => Promise<void>) | undefined;
export async function registerOfflineIpc(window: BrowserWindow, runtime: OfflineModels, appOrigin: string): Promise<() => Promise<void>> {
  await activeCleanup?.();
  let stopped = false;
  ipcMain.handle(CHANNEL, async (event, method: unknown, request: unknown) => {
    if (stopped || !nativeSenderAuthorized(event, window, appOrigin)) throw new Error("Offline IPC sender is not authorized.");
    switch (method) {
      case "status": return runtime.status(typeof request === "string" ? request : undefined);
      case "download": return runtime.download(typeof request === "string" ? request : undefined);
      case "cancelDownload": return runtime.cancelDownload(typeof request === "string" ? request : undefined);
      case "remove": return runtime.remove(typeof request === "string" ? request : undefined);
      case "generate": return runtime.generate(request);
      case "cancelGeneration": return runtime.cancelGeneration();
      case "scoreLabels": return runtime.scoreLabels(request);
      case "cancelScoring": return runtime.cancelScoring(typeof request === "string" ? request : "");
      case "unloadJudgement": return runtime.unloadJudgement();
      default: throw new Error("Unknown offline tutor operation.");
    }
  });
  const onClosed = () => { void cleanup(); };
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    window.removeListener("closed", onClosed);
    if (!window.webContents.isDestroyed()) window.webContents.removeListener("destroyed", onClosed);
    if (activeCleanup === cleanup) { activeCleanup = undefined; ipcMain.removeHandler(CHANNEL); }
    await runtime.stop();
  };
  activeCleanup = cleanup;
  window.once("closed", onClosed);
  window.webContents.once("destroyed", onClosed);
  return cleanup;
}
