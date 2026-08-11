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
import {
	assertAllowedParams,
	assertBoundedName,
	assertBoundedSerializablePayload,
	assertKnownRpcMethod,
	assertPlainParams,
	createRequestIdTracker,
	IpcValidationError,
	isTrustedAppNavigation,
	MAX_INDEX_NAME_LENGTH,
	MAX_KEY_LENGTH,
	MAX_MUTATION_COUNT,
	MAX_RPC_ID_LENGTH,
	MAX_STORE_NAME_LENGTH,
	sanitizeIpcError,
} from "./security.js";
import { PROVIDER_KEYS_STORE } from "./credential-service.js";

export interface P2PBackendBridge extends StorageBackendLike {
	batch(mutations: Mutation[]): Promise<void>;
	stats(): PeerStats;
}

export interface P2PIpcOptions {
	/** Exact local Nitro or explicitly configured dev origin allowed to use the preload bridge. */
	appOrigin: string;
}

interface ParsedRequest {
	id: string;
	method: P2PRpcRequest["method"];
	params: Record<string, unknown> | undefined;
}

let activeCleanup: (() => void) | null = null;

function fail(id: string, message: string): P2PRpcResponse {
	return { id, ok: false, error: { message } };
}

function ok<T>(id: string, result: T): P2PRpcResponse<T> {
	return { id, ok: true, result };
}

function parseRequest(value: unknown): ParsedRequest {
	const request = assertPlainParams(value);
	if (!request) throw new IpcValidationError("RPC request is invalid.");
	assertAllowedParams(request, ["id", "method", "params"]);
	const id = assertBoundedName(request["id"], "RPC id", MAX_RPC_ID_LENGTH);
	const method = assertKnownRpcMethod(request["method"]) as P2PRpcRequest["method"];
	const params = assertPlainParams(request["params"]);
	assertBoundedSerializablePayload({ id, method, params: params ?? null });
	return { id, method, params };
}

function requireString(
	params: Record<string, unknown> | undefined,
	key: string,
	limit = MAX_KEY_LENGTH,
): string {
	return assertBoundedName(params?.[key], `RPC ${key}`, limit);
}

function requireReplicatedStoreName(
	params: Record<string, unknown> | undefined,
): string {
	const storeName = requireString(params, "storeName", MAX_STORE_NAME_LENGTH);
	if (storeName === PROVIDER_KEYS_STORE) {
		throw new IpcValidationError("Provider credentials require secure credential storage.");
	}
	return storeName;
}

function requireOptionalString(
	params: Record<string, unknown> | undefined,
	key: string,
	limit = MAX_KEY_LENGTH,
): string | undefined {
	if (params === undefined || !(key in params) || params[key] === undefined || params[key] === null) return undefined;
	return assertBoundedName(params[key], `RPC ${key}`, limit);
}

function requireStoreKeys(params: Record<string, unknown> | undefined): { storeName: string; key: string } {
	assertAllowedParams(params, ["storeName", "key"]);
	return {
		storeName: requireReplicatedStoreName(params),
		key: requireString(params, "key"),
	};
}

function requireValue(params: Record<string, unknown> | undefined): unknown {
	if (!params || !("value" in params)) throw new IpcValidationError("RPC value is required.");
	assertBoundedSerializablePayload(params["value"]);
	return params["value"];
}

function parseMutations(params: Record<string, unknown> | undefined): Mutation[] {
	assertAllowedParams(params, ["mutations"]);
	const raw = params?.["mutations"];
	if (!Array.isArray(raw) || raw.length > MAX_MUTATION_COUNT) {
		throw new IpcValidationError("RPC mutations are invalid.");
	}
	return raw.map((mutation, index) => {
		if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) {
			throw new IpcValidationError(`RPC mutation ${index} is invalid.`);
		}
		const candidate = mutation as Record<string, unknown>;
		if (candidate["type"] === "put") {
			assertAllowedParams(candidate, ["type", "store", "key", "value"]);
			if (!("value" in candidate)) throw new IpcValidationError(`RPC mutation ${index} needs a value.`);
			assertBoundedSerializablePayload(candidate["value"]);
			return {
				type: "put" as const,
				store: (() => {
					const store = assertBoundedName(candidate["store"], "RPC store", MAX_STORE_NAME_LENGTH);
					if (store === PROVIDER_KEYS_STORE) throw new IpcValidationError("Provider credentials require secure credential storage.");
					return store;
				})(),
				key: assertBoundedName(candidate["key"], "RPC key", MAX_KEY_LENGTH),
				value: candidate["value"],
			};
		}
		if (candidate["type"] === "del") {
			assertAllowedParams(candidate, ["type", "store", "key"]);
			return {
				type: "del" as const,
				store: (() => {
					const store = assertBoundedName(candidate["store"], "RPC store", MAX_STORE_NAME_LENGTH);
					if (store === PROVIDER_KEYS_STORE) throw new IpcValidationError("Provider credentials require secure credential storage.");
					return store;
				})(),
				key: assertBoundedName(candidate["key"], "RPC key", MAX_KEY_LENGTH),
			};
		}
		throw new IpcValidationError(`RPC mutation ${index} has an invalid type.`);
	});
}

function senderIsAuthorized(
	event: { sender: { id: number; getURL(): string }; senderFrame?: { url: string } | null },
	window: BrowserWindow,
	appOrigin: string,
): boolean {
	if (event.sender.id !== window.webContents.id) return false;
	return isTrustedAppNavigation(event.senderFrame?.url ?? event.sender.getURL(), appOrigin);
}

/**
 * Register one renderer-scoped handler. IPC is a process-global Electron API,
 * so a replacement tears down the former window before installing the next.
 */
export function registerP2PIpc(
	window: BrowserWindow,
	backend: P2PBackendBridge,
	options: P2PIpcOptions,
): () => void {
	activeCleanup?.();
	const requestIds = createRequestIdTracker();
	let stopped = false;
	const handle = async (
		event: { sender: { id: number; getURL(): string }; senderFrame?: { url: string } | null },
		req: unknown,
	): Promise<P2PRpcResponse> => {
		if (stopped || !senderIsAuthorized(event, window, options.appOrigin)) {
			return fail("", "IPC sender is not authorized.");
		}

		let request: ParsedRequest | undefined;
		try {
			request = parseRequest(req);
			if (!requestIds.claim(request.id)) return fail(request.id, "RPC id has already been used.");
			const { id, method, params } = request;
			switch (method) {
				case "get": {
					const { storeName, key } = requireStoreKeys(params);
					return ok(id, await backend.get(storeName, key));
				}
				case "set": {
					assertAllowedParams(params, ["storeName", "key", "value"]);
					const storeName = requireReplicatedStoreName(params);
					const key = requireString(params, "key");
					await backend.set(storeName, key, requireValue(params));
					return ok(id, undefined);
				}
				case "delete": {
					const { storeName, key } = requireStoreKeys(params);
					await backend.delete(storeName, key);
					return ok(id, undefined);
				}
				case "keys": {
					assertAllowedParams(params, ["storeName", "prefix"]);
					return ok(id, await backend.keys(
						requireReplicatedStoreName(params),
						requireOptionalString(params, "prefix"),
					));
				}
				case "getAllFromIndex": {
					assertAllowedParams(params, ["storeName", "indexName", "direction"]);
					const direction = params?.["direction"];
					if (direction !== undefined && direction !== "asc" && direction !== "desc") {
						throw new IpcValidationError("RPC direction is invalid.");
					}
					return ok(id, await backend.getAllFromIndex(
						requireReplicatedStoreName(params),
						requireString(params, "indexName", MAX_INDEX_NAME_LENGTH),
						direction ?? "asc",
					));
				}
				case "clear": {
					assertAllowedParams(params, ["storeName"]);
					await backend.clear(requireReplicatedStoreName(params));
					return ok(id, undefined);
				}
				case "has": {
					const { storeName, key } = requireStoreKeys(params);
					return ok(id, await backend.has(storeName, key));
				}
				case "batch": {
					await backend.batch(parseMutations(params));
					return ok(id, undefined);
				}
				case "stats":
					assertAllowedParams(params, []);
					return ok(id, backend.stats());
				case "quota":
					assertAllowedParams(params, []);
					return ok(id, await backend.getQuotaInfo());
				case "requestPersistence":
					assertAllowedParams(params, []);
					return ok(id, await backend.requestPersistence());
			}
		} catch (error) {
			return fail(request?.id ?? "", sanitizeIpcError(error));
		}
	};

	ipcMain.handle(P2P_IPC_CHANNEL, handle);
	const send = () => {
		if (stopped || window.isDestroyed() || window.webContents.isDestroyed()) return;
		try {
			const evt: P2PEvent = { type: "peerstats", payload: backend.stats() };
			window.webContents.send(P2P_EVENT_CHANNEL, evt);
		} catch {
			// The store may be closing; do not expose a native error to the renderer.
		}
	};
	const interval = setInterval(send, 2_000);
	send();

	const cleanup = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(interval);
		window.removeListener("closed", cleanup);
		if (!window.webContents.isDestroyed()) window.webContents.removeListener("destroyed", cleanup);
		if (activeCleanup === cleanup) {
			activeCleanup = null;
			ipcMain.removeHandler(P2P_IPC_CHANNEL);
		}
	};
	activeCleanup = cleanup;
	window.once("closed", cleanup);
	window.webContents.once("destroyed", cleanup);
	return cleanup;
}
