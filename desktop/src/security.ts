/** Pure policies shared by Electron lifecycle and IPC boundaries. */

export const MAX_RPC_ID_LENGTH = 128;
export const MAX_RPC_NAME_LENGTH = 64;
export const MAX_STORE_NAME_LENGTH = 128;
export const MAX_KEY_LENGTH = 512;
export const MAX_INDEX_NAME_LENGTH = 128;
export const MAX_MUTATION_COUNT = 100;
export const MAX_SERIALIZED_PAYLOAD_BYTES = 64 * 1024;
export const MAX_SERIALIZED_DEPTH = 12;
export const MAX_SERIALIZED_NODES = 1_000;

const RPC_METHODS = new Set([
	"get",
	"set",
	"delete",
	"keys",
	"getAllFromIndex",
	"clear",
	"has",
	"batch",
	"stats",
	"quota",
	"requestPersistence",
]);

export class IpcValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IpcValidationError";
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function assertBoundedName(value: unknown, label: string, limit: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > limit) {
		throw new IpcValidationError(`${label} is invalid.`);
	}
	return value;
}

export function assertKnownRpcMethod(value: unknown): string {
	const method = assertBoundedName(value, "RPC method", MAX_RPC_NAME_LENGTH);
	if (!RPC_METHODS.has(method)) throw new IpcValidationError("RPC method is not supported.");
	return method;
}

export function assertPlainParams(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	if (!isPlainRecord(value)) throw new IpcValidationError("RPC params are invalid.");
	return value;
}

export function assertAllowedParams(
	params: Record<string, unknown> | undefined,
	allowed: readonly string[],
): void {
	if (!params) return;
	if (!isPlainRecord(params)) throw new IpcValidationError("RPC params are invalid.");
	for (const key of Reflect.ownKeys(params)) {
		if (typeof key !== "string" || !allowed.includes(key)) {
			throw new IpcValidationError("RPC params contain an unsupported field.");
		}
	}
}

/** Require JSON-compatible, bounded values before they reach native storage. */
export function assertBoundedSerializablePayload(value: unknown): void {
	let nodes = 0;
	let bytes = 0;
	const ancestors = new Set<object>();
	const visit = (current: unknown, depth: number): void => {
		if (depth > MAX_SERIALIZED_DEPTH) throw new IpcValidationError("RPC payload is too deeply nested.");
		nodes += 1;
		if (nodes > MAX_SERIALIZED_NODES) throw new IpcValidationError("RPC payload has too many values.");
		if (current === null || typeof current === "boolean") return;
		if (typeof current === "number") {
			if (!Number.isFinite(current)) throw new IpcValidationError("RPC payload contains an invalid number.");
			return;
		}
		if (typeof current === "string") {
			bytes += byteLength(current);
			if (bytes > MAX_SERIALIZED_PAYLOAD_BYTES) throw new IpcValidationError("RPC payload is too large.");
			return;
		}
		if (Array.isArray(current)) {
			if (ancestors.has(current)) throw new IpcValidationError("RPC payload may not be cyclic.");
			ancestors.add(current);
			for (const item of current) visit(item, depth + 1);
			ancestors.delete(current);
			return;
		}
		if (!isPlainRecord(current)) throw new IpcValidationError("RPC payload must be JSON-compatible.");
		if (ancestors.has(current)) throw new IpcValidationError("RPC payload may not be cyclic.");
		ancestors.add(current);
		for (const [key, item] of Object.entries(current)) {
			bytes += byteLength(key);
			if (bytes > MAX_SERIALIZED_PAYLOAD_BYTES) throw new IpcValidationError("RPC payload is too large.");
			visit(item, depth + 1);
		}
		ancestors.delete(current);
	};
	visit(value, 0);
	// The traversal enforces structure and gives an early size cutoff; this final
	// check is authoritative because JSON escaping and delimiters add bytes.
	const serialized = JSON.stringify(value);
	if (typeof serialized !== "string" || byteLength(serialized) > MAX_SERIALIZED_PAYLOAD_BYTES) {
		throw new IpcValidationError("RPC payload is too large.");
	}
}

export function trustedOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
	} catch {
		return null;
	}
}

export function isTrustedAppNavigation(value: string, appOrigin: string): boolean {
	const origin = trustedOrigin(value);
	return origin !== null && origin === appOrigin;
}

export function isSafeExternalUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol === "https:") {
			return url.hostname.length > 0 && url.username.length === 0 && url.password.length === 0;
		}
		return url.protocol === "mailto:" && url.pathname.length > 0 && !/[\r\n]/.test(value);
	} catch {
		return false;
	}
}

export function isSafeDevelopmentOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:"
			&& (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
	} catch {
		return false;
	}
}

/** Never return native error text: it can include filesystem paths or provider credentials. */
export function sanitizeIpcError(error: unknown): string {
	if (error instanceof IpcValidationError) return error.message;
	return "P2P request could not be completed.";
}

/** Correct an existing secret file as well as newly-created files where POSIX modes exist. */
export function enforceOwnerOnlySecretFile(
	path: string,
	platform: NodeJS.Platform,
	chmod: (path: string, mode: number) => void,
): void {
	if (platform !== "win32") chmod(path, 0o600);
}

/** Replay protection is bounded per renderer so malformed pages cannot retain unbounded state. */
export function createRequestIdTracker(limit = 1_024): { claim(id: string): boolean } {
	const ids = new Set<string>();
	const order: string[] = [];
	return {
		claim(id) {
			if (ids.has(id)) return false;
			ids.add(id);
			order.push(id);
			if (order.length > limit) {
				const oldest = order.shift();
				if (oldest) ids.delete(oldest);
			}
			return true;
		},
	};
}
