import { describe, expect, it } from "bun:test";
import { unlockAccountSyncKeyWithLogin } from "../keating/sync/account-key-broker";

function encode(value: BufferSource): string {
	const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function buffer(value: Uint8Array): ArrayBuffer {
	return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

async function brokerResponse(request: Request, raw = new Uint8Array(32).fill(9)): Promise<Response> {
	const body = await request.json() as { client_public_jwk: JsonWebKey };
	const clientPublic = await crypto.subtle.importKey("jwk", body.client_public_jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
	const server = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: clientPublic }, server.privateKey, 256);
	const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
	const digest = await crypto.subtle.digest("SHA-256", raw);
	const keyId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
	const salt = crypto.getRandomValues(new Uint8Array(32));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const info = new TextEncoder().encode(`notorganic-account-sync-wrap-v1:did:plc:alice:keating:${keyId}`);
	const wrappingKey = await crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: buffer(salt), info: buffer(info) },
		base,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt"],
	);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: buffer(iv), additionalData: buffer(info) },
		wrappingKey,
		buffer(raw),
	);
	return Response.json({
		version: 1,
		key_id: keyId,
		server_public_jwk: await crypto.subtle.exportKey("jwk", server.publicKey),
		salt: encode(salt),
		iv: encode(iv),
		ciphertext: encode(ciphertext),
	});
}

describe("ATProto login account sync unlock", () => {
	it("unwraps the brokered key into a non-extractable browser key", async () => {
		let requestBody = "";
		const key = await unlockAccountSyncKeyWithLogin({
			did: "did:plc:alice",
			fetch: (async (input, init) => {
				requestBody = String(init?.body);
				return brokerResponse(new Request(`https://keating.test${input}`, init));
			}) as typeof fetch,
		});
		expect(key.key.extractable).toBe(false);
		expect(new Set(key.key.usages)).toEqual(new Set(["encrypt", "decrypt"]));
		expect(requestBody).not.toContain("did:plc:alice");
		expect(requestBody).not.toContain("recovery");
	});

	it("rejects an envelope bound to a different DID", async () => {
		await expect(unlockAccountSyncKeyWithLogin({
			did: "did:plc:bob",
			fetch: (async (input, init) => brokerResponse(new Request(`https://keating.test${input}`, init))) as typeof fetch,
		})).rejects.toThrow("could not be authenticated");
	});
});
