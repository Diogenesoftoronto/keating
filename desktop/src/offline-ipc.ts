import { ipcMain, type BrowserWindow } from "electron";
import { nativeSenderAuthorized } from "./native-policy.js";
import type { OfflineRuntime } from "./offline-runtime.js";

const CHANNEL = "keating:offline:rpc";
let activeCleanup: (() => Promise<void>) | undefined;
export async function registerOfflineIpc(window: BrowserWindow, runtime: OfflineRuntime, appOrigin: string): Promise<() => Promise<void>> {
  await activeCleanup?.();
  let stopped = false;
  ipcMain.handle(CHANNEL, async (event, method: unknown, request: unknown) => {
    if (stopped || !nativeSenderAuthorized(event, window, appOrigin)) throw new Error("Offline IPC sender is not authorized.");
    switch (method) {
      case "status": return runtime.status();
      case "download": return runtime.download();
      case "cancelDownload": return runtime.cancelDownload();
      case "remove": return runtime.remove();
      case "generate": return runtime.generate(request);
      case "cancelGeneration": return runtime.cancelGeneration();
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
