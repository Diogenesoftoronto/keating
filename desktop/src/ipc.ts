import { ipcMain, type BrowserWindow } from "electron";
import {
	P2P_IPC_CHANNEL,
	P2P_EVENT_CHANNEL,
	type P2PRpcRequest,
	type P2PRpcResponse,
	type P2PEvent,
	type StorageBackendLike,
	type Mutation,
	type PeerStats,
} from "@keating/p2p-core";

/**
 * The bridge object handed to `registerP2PIpc`. This is the StorageBackend-like
 * adapter the renderer talks to via IPC, plus the two P2P-only ops (`batch`,
 * `stats`) that aren't part of the web's `StorageBackend` interface but ARE
 * part of the `rpc.ts` contract.
 */
export interface P2PBackendBridge extends StorageBackendLike {
	batch(mutations: Mutation[]): Promise<void>;
	stats(): PeerStats;
}

function fail(id: string, message: string): P2PRpcResponse {
	return { id, ok: false, error: { message } };
}

function ok<T>(id: string, result: T): P2PRpcResponse<T> {
	return { id, ok: true, result };
}

function requireString(
	params: Record<string, unknown> | undefined,
	key: string,
): string {
	const v = params?.[key];
	if (typeof v !== "string") {
		throw new Error(`param "${key}" must be a string`);
	}
	return v;
}

function requireOptionalString(
	params: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	if (params === undefined || !(key in params)) return undefined;
	const v = params[key];
	if (v === undefined || v === null) return undefined;
	if (typeof v !== "string") {
		throw new Error(`param "${key}" must be a string when provided`);
	}
	return v;
}

function requireStoreKeys(
	params: Record<string, unknown> | undefined,
): { storeName: string; key: string } {
	const storeName = requireString(params, "storeName");
	const key = requireString(params, "key");
	return { storeName, key };
}

/**
 * Wire the renderer's RPC requests to a StorageBackend (backed by P2PStore in
 * the main process). One `ipcMain.handle` dispatches every method in the
 * rpc.ts contract; payloads are validated by shape before dispatch.
 */
export function registerP2PIpc(
	window: BrowserWindow,
	backend: P2PBackendBridge,
): () => void {
	const handle = async (
		_e: unknown,
		req: P2PRpcRequest,
	): Promise<P2PRpcResponse> => {
		if (!req || typeof req.id !== "string" || typeof req.method !== "string") {
			return fail("", "invalid RPC request shape");
		}
		const { id, method, params } = req;

		try {
			switch (method) {
				case "get": {
					const { storeName, key } = requireStoreKeys(params);
					return ok(id, await backend.get(storeName, key));
				}
				case "set": {
					const { storeName, key } = requireStoreKeys(params);
					const value = params?.["value"];
					await backend.set(storeName, key, value);
					return ok(id, undefined);
				}
				case "delete": {
					const { storeName, key } = requireStoreKeys(params);
					await backend.delete(storeName, key);
					return ok(id, undefined);
				}
				case "keys": {
					const storeName = requireString(params, "storeName");
					const prefix = requireOptionalString(params, "prefix");
					return ok(id, await backend.keys(storeName, prefix));
				}
				case "getAllFromIndex": {
					const storeName = requireString(params, "storeName");
					const indexName = requireString(params, "indexName");
					const directionRaw = params?.["direction"];
					const direction =
						directionRaw === "desc" || directionRaw === "asc"
							? directionRaw
							: "asc";
					return ok(
						id,
						await backend.getAllFromIndex(storeName, indexName, direction),
					);
				}
				case "clear": {
					const storeName = requireString(params, "storeName");
					await backend.clear(storeName);
					return ok(id, undefined);
				}
				case "has": {
					const { storeName, key } = requireStoreKeys(params);
					return ok(id, await backend.has(storeName, key));
				}
				case "batch": {
					const raw = params?.["mutations"];
					if (!Array.isArray(raw)) {
						throw new Error('param "mutations" must be an array');
					}
					const mutations: Mutation[] = raw.map((m, i) => {
						if (!m || typeof m !== "object") {
							throw new Error(`mutation[${i}] must be an object`);
						}
						const obj = m as Record<string, unknown>;
						if (obj["type"] === "put") {
							return {
								type: "put",
								store: requireString({ store: obj["store"] }, "store"),
								key: requireString({ key: obj["key"] }, "key"),
								value: obj["value"],
							};
						}
						if (obj["type"] === "del") {
							return {
								type: "del",
								store: requireString({ store: obj["store"] }, "store"),
								key: requireString({ key: obj["key"] }, "key"),
							};
						}
						throw new Error(`mutation[${i}].type must be "put" or "del"`);
					});
					await backend.batch(mutations);
					return ok(id, undefined);
				}
				case "stats": {
					return ok(id, backend.stats());
				}
				case "quota": {
					return ok(id, await backend.getQuotaInfo());
				}
				case "requestPersistence": {
					return ok(id, await backend.requestPersistence());
				}
				default:
					return fail(id, `unknown method: ${String(method)}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(id, message);
		}
	};

	ipcMain.handle(P2P_IPC_CHANNEL, handle);

	// Push peer stats when the underlying store changes. We poll every 2s while
	// the window is alive and forward the latest snapshot.
	let stopped = false;
	const send = () => {
		if (stopped || window.isDestroyed()) return;
		try {
			const stats = backend.stats();
			const evt: P2PEvent = { type: "peerstats", payload: stats };
			window.webContents.send(P2P_EVENT_CHANNEL, evt);
		} catch {
			// ignore — store may be closing
		}
	};

	const interval = setInterval(send, 2000);
	send();

	const cleanup = () => {
		stopped = true;
		clearInterval(interval);
		ipcMain.removeHandler(P2P_IPC_CHANNEL);
	};
	window.once("closed", cleanup);
	return cleanup;
}