import { importAccountSyncKeyBytes, type AccountSyncKey } from "./device-identity";
import { LearnerSyncError } from "./learner-sync";

interface AccountSyncKeyEnvelope {
	version: 1;
	key_id: string;
	server_public_jwk: JsonWebKey;
	salt: string;
	iv: string;
	ciphertext: string;
}

function cryptoApi(): Crypto {
	if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
		throw new LearnerSyncError("Web Crypto is required to unlock account sync.");
	}
	return globalThis.crypto;
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
	return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function decodeBase64Url(value: unknown, name: string, maximumBytes: number): Uint8Array {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > maximumBytes * 2) {
		throw new LearnerSyncError(`The account sync ${name} is invalid.`);
	}
	const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new LearnerSyncError(`The account sync ${name} is invalid.`);
	}
	if (binary.length === 0 || binary.length > maximumBytes) {
		throw new LearnerSyncError(`The account sync ${name} is invalid.`);
	}
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseEnvelope(value: unknown): AccountSyncKeyEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new LearnerSyncError("The account sync key service returned an invalid envelope.");
	}
	const candidate = value as Partial<AccountSyncKeyEnvelope>;
	const jwk = candidate.server_public_jwk;
	if (
		candidate.version !== 1
		|| typeof candidate.key_id !== "string"
		|| !/^[a-f0-9]{32}$/u.test(candidate.key_id)
		|| !jwk
		|| jwk.kty !== "EC"
		|| jwk.crv !== "P-256"
		|| typeof jwk.x !== "string"
		|| typeof jwk.y !== "string"
		|| jwk.d !== undefined
	) throw new LearnerSyncError("The account sync key service returned an invalid envelope.");
	return candidate as AccountSyncKeyEnvelope;
}

export async function unlockAccountSyncKeyWithLogin(input: {
	did: string;
	fetch?: typeof globalThis.fetch;
}): Promise<AccountSyncKey> {
	const crypto = cryptoApi();
	const clientKeys = await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		["deriveBits"],
	);
	const response = await (input.fetch ?? globalThis.fetch)("/api/notorganic/sync/account-key", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ client_public_jwk: await crypto.subtle.exportKey("jwk", clientKeys.publicKey) }),
		cache: "no-store",
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new LearnerSyncError(response.status === 401 || response.status === 403
			? "Sign in with ATProto to unlock account sync."
			: "Account sync could not be unlocked.");
	}
	let value: unknown;
	try {
		value = await response.json();
	} catch {
		throw new LearnerSyncError("The account sync key service returned an invalid envelope.");
	}
	const envelope = parseEnvelope(value);
	let serverPublic: CryptoKey;
	try {
		serverPublic = await crypto.subtle.importKey(
			"jwk",
			envelope.server_public_jwk,
			{ name: "ECDH", namedCurve: "P-256" },
			false,
			[],
		);
	} catch {
		throw new LearnerSyncError("The account sync key service returned an invalid wrapping key.");
	}
	const sharedBits = await crypto.subtle.deriveBits(
		{ name: "ECDH", public: serverPublic },
		clientKeys.privateKey,
		256,
	);
	const sharedKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
	const info = new TextEncoder().encode(`notorganic-account-sync-wrap-v1:${input.did}:keating:${envelope.key_id}`);
	const salt = decodeBase64Url(envelope.salt, "salt", 32);
	const iv = decodeBase64Url(envelope.iv, "IV", 12);
	const ciphertext = decodeBase64Url(envelope.ciphertext, "ciphertext", 64);
	if (salt.byteLength !== 32 || iv.byteLength !== 12 || ciphertext.byteLength !== 48) {
		throw new LearnerSyncError("The account sync key envelope has invalid lengths.");
	}
	const wrappingKey = await crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: arrayBuffer(salt), info: arrayBuffer(info) },
		sharedKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["decrypt"],
	);
	let raw: Uint8Array;
	try {
		raw = new Uint8Array(await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: arrayBuffer(iv), additionalData: arrayBuffer(info) },
			wrappingKey,
			arrayBuffer(ciphertext),
		));
	} catch {
		throw new LearnerSyncError("The account sync key envelope could not be authenticated.");
	}
	try {
		const imported = await importAccountSyncKeyBytes(raw);
		if (imported.keyId !== envelope.key_id) {
			throw new LearnerSyncError("The account sync key ID does not match its envelope.");
		}
		return imported;
	} finally {
		raw.fill(0);
	}
}
