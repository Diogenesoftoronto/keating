import { ipcMain, type BrowserWindow } from "electron";
import { nativeSenderAuthorized } from "./native-policy.js";
import { isDesktopOAuthProvider } from "./oauth-callback.js";
import type { DesktopOAuthLifecycle } from "./oauth-lifecycle.js";

const PREPARE = "keating:oauth:prepare";
const CANCEL = "keating:oauth:cancel";
let activeCleanup: (() => Promise<void>) | null = null;

export async function registerOAuthIpc(window: BrowserWindow, lifecycle: DesktopOAuthLifecycle, appOrigin: string): Promise<() => Promise<void>> {
	await activeCleanup?.();
	let stopped = false;
	ipcMain.handle(PREPARE, (event, state: unknown, provider: unknown = "openai-codex") => {
		if (stopped || !nativeSenderAuthorized(event, window, appOrigin)) throw new Error("OAuth IPC sender is not authorized.");
		if (typeof state !== "string") throw new Error("Invalid OAuth callback state.");
		if (!isDesktopOAuthProvider(provider)) throw new Error("Unsupported desktop OAuth provider.");
		return lifecycle.prepare(state, provider);
	});
	ipcMain.handle(CANCEL, (event) => {
		if (stopped || !nativeSenderAuthorized(event, window, appOrigin)) throw new Error("OAuth IPC sender is not authorized.");
		return lifecycle.cancel();
	});
	const onClosed = () => { void cleanup(); };
	const cleanup = async () => {
		if (stopped) return;
		stopped = true;
		window.removeListener("closed", onClosed);
		if (!window.webContents.isDestroyed()) window.webContents.removeListener("destroyed", onClosed);
		if (activeCleanup === cleanup) {
			activeCleanup = null;
			ipcMain.removeHandler(PREPARE);
			ipcMain.removeHandler(CANCEL);
		}
		await lifecycle.cancel();
	};
	activeCleanup = cleanup;
	window.once("closed", onClosed);
	window.webContents.once("destroyed", onClosed);
	return cleanup;
}
