/** Native keys stay opaque; browser adapters use non-extractable CryptoKeys. */
export interface SyncCrypto {
	randomBytes(length: number): Uint8Array;
	randomUUID(): string;
	sha256(bytes: Uint8Array): Promise<Uint8Array>;
	encrypt(key: unknown, iv: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
	decrypt(key: unknown, iv: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
	hmac(key: unknown, bytes: Uint8Array): Promise<Uint8Array>;
	gzip?(bytes: Uint8Array): Promise<Uint8Array>;
	gunzip?(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array>;
}

function buffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export const webSyncCrypto: SyncCrypto = {
	randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
	randomUUID: () => crypto.randomUUID(),
	sha256: async bytes => new Uint8Array(await crypto.subtle.digest("SHA-256", buffer(bytes))),
	encrypt: async (key, iv, aad, bytes) => new Uint8Array(await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: buffer(iv), additionalData: buffer(aad) }, key as CryptoKey, buffer(bytes))),
	decrypt: async (key, iv, aad, bytes) => new Uint8Array(await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: buffer(iv), additionalData: buffer(aad) }, key as CryptoKey, buffer(bytes))),
	hmac: async (key, bytes) => new Uint8Array(await crypto.subtle.sign("HMAC", key as CryptoKey, buffer(bytes))),
};
