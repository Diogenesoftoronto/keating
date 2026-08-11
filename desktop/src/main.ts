import { app, BrowserWindow, safeStorage, shell } from "electron";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
	P2PStore,
	createP2PStorageBackend,
	type StorageBackendLike,
} from "@keating/p2p-core";
import { registerP2PIpc, type P2PBackendBridge } from "./ipc.js";
import { registerCredentialIpc } from "./credential-ipc.js";
import { DesktopCredentialService } from "./credential-service.js";
import { CredentialVault } from "./credential-vault.js";
import {
	startOAuthCallbackReceiver,
	type OAuthCallbackReceiver,
} from "./oauth-callback.js";
import {
	startPackagedNitro,
	type NitroRuntime,
} from "./nitro-runtime.js";
import { DesktopLifecycle } from "./lifecycle.js";
import { installDesktopPermissionPolicy } from "./permissions.js";
import { resolveDesktopRuntimePaths } from "./runtime-paths.js";
import {
	isSafeDevelopmentOrigin,
	isSafeExternalUrl,
	isTrustedAppNavigation,
	enforceOwnerOnlySecretFile,
	trustedOrigin,
} from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OAUTH_CALLBACK_IPC_CHANNEL = "keating:oauth-callback";
let shuttingDown = false;
let windowOpening: Promise<void> | null = null;
let activeWindow: BrowserWindow | null = null;
let oauthCallbackReceiver: OAuthCallbackReceiver | null = null;
let pendingOAuthCallbackUrl: string | null = null;
const lifecycle = new DesktopLifecycle<P2PStore, NitroRuntime>();

async function startDesktopOAuthCallbackReceiver(): Promise<void> {
	if (oauthCallbackReceiver) return;
	const result = await startOAuthCallbackReceiver({
		onCallback({ url }) {
			const callbackUrl = url.toString();
			if (!activeWindow || activeWindow.isDestroyed() || activeWindow.webContents.isDestroyed()) {
				pendingOAuthCallbackUrl = callbackUrl;
				return;
			}
			activeWindow.webContents.send(OAUTH_CALLBACK_IPC_CHANNEL, callbackUrl);
		},
	});
	if (result.available) {
		oauthCallbackReceiver = result.receiver;
		return;
	}
	console.warn(result.message);
}

/**
 * Load or create the per-user 32-byte secret that derives the swarm topic and
 * this device's writable core namespace.
 *
 * Resolution order:
 *  1. KEATING_USER_SECRET hex env var (lets you pair against a known seeder).
 *  2. A file at `${userData}/keating-user-secret.bin`. Created on first run
 *     with 32 bytes from sodium `crypto_randombytes_buf`.
 */
function loadUserSecret(): Uint8Array {
	const hex = process.env["KEATING_USER_SECRET"];
	if (hex && hex.trim().length > 0) {
		const trimmed = hex.trim();
		if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
			throw new Error("KEATING_USER_SECRET must be hex-encoded");
		}
		const buf = Buffer.from(trimmed, "hex");
		if (buf.length !== 32) {
			throw new Error(
				`KEATING_USER_SECRET must be 32 bytes (got ${buf.length})`,
			);
		}
		return new Uint8Array(buf);
	}

	const userData = app.getPath("userData");
	const secretPath = join(userData, "keating-user-secret.bin");
	if (existsSync(secretPath)) {
		enforceOwnerOnlySecretFile(secretPath, process.platform, chmodSync);
		const raw = readFileSync(secretPath);
		if (raw.length !== 32) {
			throw new Error(
				`keating-user-secret.bin must be 32 bytes (got ${raw.length})`,
			);
		}
		return new Uint8Array(raw);
	}

	// First run: ensure userData exists, then generate and persist.
	try {
		mkdirSync(userData, { recursive: true });
	} catch {
		// ignore — likely already exists
	}
	const out = randomBytes(32);
	writeFileSync(secretPath, out, { mode: 0o600 });
	enforceOwnerOnlySecretFile(secretPath, process.platform, chmodSync);
	return out;
}

function installNavigationPolicy(window: BrowserWindow, appOrigin: string): void {
	const denyOrExternalize = (event: { preventDefault(): void }, url: string) => {
		if (isTrustedAppNavigation(url, appOrigin)) return;
		event.preventDefault();
		if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => {});
	};
	window.webContents.on("will-navigate", denyOrExternalize);
	window.webContents.on("will-redirect", denyOrExternalize);
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => {});
		return { action: "deny" };
	});
}

interface RendererLocation {
	origin: string;
	url: string;
}

async function rendererLocation(): Promise<RendererLocation> {
	const devServer = process.env["KEATING_DEV_SERVER"];
	if (devServer) {
		if (!isSafeDevelopmentOrigin(devServer)) {
			throw new Error("KEATING_DEV_SERVER must be a loopback http origin.");
		}
		const origin = trustedOrigin(devServer);
		if (!origin) throw new Error("KEATING_DEV_SERVER has no valid origin.");
		// Preserve the developer-selected entrypoint; production always enters /chat.
		return { origin, url: devServer };
	}
	const origin = (await ensurePackagedNitro()).origin;
	return { origin, url: new URL("/chat", origin).toString() };
}

async function getP2PStore(): Promise<P2PStore> {
	return lifecycle.openStore(async () => {
		const userSecret = loadUserSecret();
		return P2PStore.open({
			storageDir: join(app.getPath("userData"), "p2p"),
			userSecret,
			label: `desktop:${process.platform}`,
		});
	});
}

async function createWindow(): Promise<void> {
	let window: BrowserWindow | null = null;
	try {
		const renderer = await rendererLocation();
		const store = await getP2PStore();
		window = new BrowserWindow({
			width: 1200,
			height: 800,
			webPreferences: {
				preload: join(__dirname, "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		activeWindow = window;
		window.once("closed", () => {
			if (activeWindow === window) activeWindow = null;
		});

		const backend: StorageBackendLike = createP2PStorageBackend(store);
		const bridge: P2PBackendBridge = {
			...backend,
			batch: (mutations) => store.batch(mutations),
			stats: () => store.stats(),
		};
		const rendererCleanups: Array<() => void | Promise<void>> = [
			registerP2PIpc(window, bridge, { appOrigin: renderer.origin }),
		];
		const credentials = new CredentialVault({
			path: join(app.getPath("userData"), "credentials.v1.json"),
			codec: {
				isEncryptionAvailable() {
					if (!safeStorage.isEncryptionAvailable()) return false;
					if (process.platform !== "linux") return true;
					const backend = safeStorage.getSelectedStorageBackend();
					return backend !== "basic_text" && backend !== "unknown";
				},
				encryptString: (plaintext) => safeStorage.encryptString(plaintext),
				decryptString: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext)),
			},
		});
		rendererCleanups.push(registerCredentialIpc(
			window,
			new DesktopCredentialService(credentials, bridge),
			renderer.origin,
		));
		// Replacing the lifecycle binding first clears handlers from a prior macOS
		// window before the new window installs handlers on the shared session.
		lifecycle.setRendererCleanup(async () => {
			const cleanups = rendererCleanups.splice(0).map(async (cleanup) => { await cleanup(); });
			await Promise.allSettled(cleanups);
		});
		rendererCleanups.push(installDesktopPermissionPolicy(window, renderer.origin));
		installNavigationPolicy(window, renderer.origin);
		await window.loadURL(renderer.url);
		if (pendingOAuthCallbackUrl && !window.webContents.isDestroyed()) {
			const callbackUrl = pendingOAuthCallbackUrl;
			pendingOAuthCallbackUrl = null;
			window.webContents.send(OAUTH_CALLBACK_IPC_CHANNEL, callbackUrl);
		}
	} catch (error) {
		if (window && !window.isDestroyed()) window.destroy();
		await shutdownDesktop();
		throw error;
	}
}

function openWindow(): Promise<void> {
	if (windowOpening) return windowOpening;
	windowOpening = createWindow().finally(() => {
		windowOpening = null;
	});
	return windowOpening;
}

async function ensurePackagedNitro(): Promise<NitroRuntime> {
	return lifecycle.openNitro(async () => {
		const paths = resolveDesktopRuntimePaths({
			isPackaged: app.isPackaged,
			moduleDir: __dirname,
			resourcesPath: process.resourcesPath,
			userData: app.getPath("userData"),
		});
		return startPackagedNitro(paths);
	});
}

async function shutdownDesktop(): Promise<void> {
	const receiver = oauthCallbackReceiver;
	oauthCallbackReceiver = null;
	await Promise.allSettled([
		...(receiver ? [receiver.stop()] : []),
		lifecycle.shutdown(),
	]);
}

app.whenReady()
	.then(async () => {
		await startDesktopOAuthCallbackReceiver();
		await openWindow();
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				void openWindow().catch((error) => {
					console.error("Keating desktop failed to reactivate:", error);
					app.quit();
				});
			}
		});
	})
	.catch((error) => {
		console.error("Keating desktop failed to start:", error);
		void shutdownDesktop().finally(() => app.quit());
	});

app.on("before-quit", (event) => {
	if (shuttingDown) return;
	shuttingDown = true;
	event.preventDefault();
	void shutdownDesktop().finally(() => app.quit());
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
