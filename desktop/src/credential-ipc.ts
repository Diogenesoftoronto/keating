import { ipcMain, type BrowserWindow } from "electron";
import { DesktopCredentialService } from "./credential-service.js";
import { CredentialVaultError } from "./credential-vault.js";
import {
	assertAllowedParams,
	assertBoundedName,
	assertBoundedSerializablePayload,
	assertPlainParams,
	createRequestIdTracker,
	IpcValidationError,
	isTrustedAppNavigation,
	MAX_KEY_LENGTH,
	MAX_RPC_ID_LENGTH,
	MAX_RPC_NAME_LENGTH,
} from "./security.js";

export const CREDENTIAL_IPC_CHANNEL = "keating:credentials:rpc";

const CREDENTIAL_METHODS = new Set(["get", "set", "delete", "keys", "has", "clear"]);

interface CredentialRequest {
	id: string;
	method: string;
	params?: Record<string, unknown>;
}

interface CredentialResponse<T = unknown> {
	id: string;
	ok: boolean;
	result?: T;
	error?: { message: string };
}

let activeCleanup: (() => void) | null = null;

function parseRequest(value: unknown): CredentialRequest {
	assertBoundedSerializablePayload(value);
	const request = assertPlainParams(value);
	if (!request) throw new IpcValidationError("Credential request is invalid.");
	assertAllowedParams(request, ["id", "method", "params"]);
	const id = assertBoundedName(request["id"], "Credential request id", MAX_RPC_ID_LENGTH);
	const method = assertBoundedName(request["method"], "Credential method", MAX_RPC_NAME_LENGTH);
	if (!CREDENTIAL_METHODS.has(method)) throw new IpcValidationError("Credential method is not supported.");
	return { id, method, params: assertPlainParams(request["params"]) };
}

function credentialId(params: Record<string, unknown> | undefined): string {
	assertAllowedParams(params, ["id"]);
	return assertBoundedName(params?.["id"], "Credential id", MAX_KEY_LENGTH);
}

function safeCredentialError(error: unknown): string {
	if (error instanceof IpcValidationError || error instanceof CredentialVaultError) return error.message;
	if (error instanceof Error && error.message === "Legacy credential has an invalid value.") return error.message;
	return "Secure credential storage could not complete the request.";
}

function senderIsAuthorized(
	event: { sender: { id: number; getURL(): string }; senderFrame?: { url: string } | null },
	window: BrowserWindow,
	appOrigin: string,
): boolean {
	return event.sender.id === window.webContents.id
		&& isTrustedAppNavigation(event.senderFrame?.url ?? event.sender.getURL(), appOrigin);
}

export function registerCredentialIpc(
	window: BrowserWindow,
	service: DesktopCredentialService,
	appOrigin: string,
): () => void {
	activeCleanup?.();
	const requestIds = createRequestIdTracker();
	let stopped = false;
	const handle = async (
		event: { sender: { id: number; getURL(): string }; senderFrame?: { url: string } | null },
		raw: unknown,
	): Promise<CredentialResponse> => {
		if (stopped || !senderIsAuthorized(event, window, appOrigin)) {
			return { id: "", ok: false, error: { message: "Credential IPC sender is not authorized." } };
		}
		let request: CredentialRequest | undefined;
		try {
			request = parseRequest(raw);
			if (!requestIds.claim(request.id)) {
				return { id: request.id, ok: false, error: { message: "Credential request id has already been used." } };
			}
			const params = request.params;
			switch (request.method) {
				case "get":
					return { id: request.id, ok: true, result: await service.get(credentialId(params)) };
				case "set": {
					assertAllowedParams(params, ["id", "value"]);
					const id = assertBoundedName(params?.["id"], "Credential id", MAX_KEY_LENGTH);
					const value = params?.["value"];
					if (typeof value !== "string") throw new IpcValidationError("Credential value is invalid.");
					await service.set(id, value);
					return { id: request.id, ok: true };
				}
				case "delete":
					await service.delete(credentialId(params));
					return { id: request.id, ok: true };
				case "keys":
					assertAllowedParams(params, []);
					return { id: request.id, ok: true, result: await service.keys() };
				case "has":
					return { id: request.id, ok: true, result: await service.has(credentialId(params)) };
				case "clear":
					assertAllowedParams(params, []);
					await service.clear();
					return { id: request.id, ok: true };
			}
			throw new IpcValidationError("Credential method is not supported.");
		} catch (error) {
			return { id: request?.id ?? "", ok: false, error: { message: safeCredentialError(error) } };
		}
	};

	ipcMain.handle(CREDENTIAL_IPC_CHANNEL, handle);
	const cleanup = () => {
		if (stopped) return;
		stopped = true;
		window.removeListener("closed", cleanup);
		if (!window.webContents.isDestroyed()) window.webContents.removeListener("destroyed", cleanup);
		if (activeCleanup === cleanup) {
			activeCleanup = null;
			ipcMain.removeHandler(CREDENTIAL_IPC_CHANNEL);
		}
	};
	activeCleanup = cleanup;
	window.once("closed", cleanup);
	window.webContents.once("destroyed", cleanup);
	return cleanup;
}
