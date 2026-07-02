import { app, BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
	P2PStore,
	createP2PStorageBackend,
	type StorageBackendLike,
} from "@keating/p2p-core";
import { registerP2PIpc, type P2PBackendBridge } from "./ipc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
	writeFileSync(secretPath, out);
	return out;
}

async function createWindow(): Promise<void> {
	const window = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	// Boot the P2P store in the main process and expose it to the renderer
	// strictly through the typed IPC bridge.
	const userSecret = loadUserSecret();
	const store = await P2PStore.open({
		storageDir: join(app.getPath("userData"), "p2p"),
		userSecret,
		label: `desktop:${process.platform}`,
	});

	const backend: StorageBackendLike = createP2PStorageBackend(store);
	const bridge: P2PBackendBridge = {
		...backend,
		batch: (mutations) => store.batch(mutations),
		stats: () => store.stats(),
	};
	registerP2PIpc(window, bridge);

	app.on("before-quit", () => {
		void store.close();
	});

	const devServer = process.env["KEATING_DEV_SERVER"];
	if (devServer) {
		await window.loadURL(devServer);
	} else {
		// Production: load the static web build.
		await window.loadFile(join(__dirname, "../../web/dist/index.html"));
	}
}

app.whenReady().then(async () => {
	await createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
