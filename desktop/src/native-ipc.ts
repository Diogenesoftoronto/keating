import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { nativeSenderAuthorized } from "./native-policy.js";
import { MAX_NATIVE_BODY, type NativeRuntime } from "./native-runtime.js";

const CHANNEL = "keating:native:rpc";
let activeCleanup: (() => Promise<void>) | null = null;
export async function registerNativeIpc(
	window: BrowserWindow,
	runtime: NativeRuntime,
	appOrigin: string,
): Promise<() => Promise<void>> {
	await activeCleanup?.();
	let stopped = false;
	let inFlight = 0;
	ipcMain.handle(
		CHANNEL,
		async (event: IpcMainInvokeEvent, request: unknown) => {
			if (stopped || !nativeSenderAuthorized(event, window, appOrigin))
				throw new Error("Native IPC sender is not authorized.");
			if (inFlight >= 16) throw new Error("Native runtime is busy.");
			inFlight++;
			try {
				if (!request || typeof request !== "object" || Array.isArray(request))
					throw new Error("Native request is invalid.");
				if (Buffer.byteLength(JSON.stringify(request)) > MAX_NATIVE_BODY)
					throw new Error("Native request is too large.");
				const input = request as { operation?: unknown; payload?: unknown };
				if (input.operation === "runtime.info")
					return { projectRoot: runtime.projectRoot };
				if (typeof input.operation !== "string" || input.operation.length > 64)
					throw new Error("Native operation is invalid.");
				return await runtime.execute(input.operation, input.payload);
			} finally {
				inFlight--;
			}
		},
	);
	const onClosed = () => {
		void cleanup();
	};
	const cleanup = async () => {
		if (stopped) return;
		stopped = true;
		window.removeListener("closed", onClosed);
		if (!window.webContents.isDestroyed())
			window.webContents.removeListener("destroyed", onClosed);
		if (activeCleanup === cleanup) {
			activeCleanup = null;
			ipcMain.removeHandler(CHANNEL);
		}
		await runtime.stop();
	};
	activeCleanup = cleanup;
	window.once("closed", onClosed);
	window.webContents.once("destroyed", onClosed);
	return cleanup;
}
