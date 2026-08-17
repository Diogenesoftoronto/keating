import type { KeatingPortableDataBundle } from "../portable-data";
import {
	LEARNER_SYNC_SCHEMA_VERSION,
	MAX_LEARNER_SYNC_CHUNK_BYTES,
	MAX_LEARNER_SYNC_SNAPSHOT_BYTES,
	type EncryptedSyncPayloadKind,
	type LearnerSyncChunk,
	type LearnerSyncManifest,
	type LearnerSyncSnapshot,
	type LearnerSyncTransport,
} from "./contracts";

export class LearnerSyncError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LearnerSyncError";
	}
}

/**
 * Creates the learner recovery snapshot shared between devices. Sandbox files,
 * Git objects, and NodePod state use the separate source-revision flow.
 */
export function buildLearnerSyncProjection(bundle: KeatingPortableDataBundle): KeatingPortableDataBundle {
	return {
		schemaVersion: bundle.schemaVersion,
		kind: bundle.kind,
		generatedAt: bundle.generatedAt,
		sessions: bundle.sessions,
		storage: bundle.storage,
	};
}

function utf8(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
	return new TextDecoder().decode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
	return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function encodeBase64(value: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < value.length; index += 1) {
		binary += String.fromCharCode(value[index]!);
	}
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		throw new LearnerSyncError("Learner sync contains invalid base64 data.");
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function cryptoApi(): Crypto {
	if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
		throw new LearnerSyncError("Web Crypto is required for encrypted learner sync.");
	}
	return globalThis.crypto;
}

async function sha256(value: Uint8Array): Promise<string> {
	const hash = await cryptoApi().subtle.digest("SHA-256", toArrayBuffer(value));
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
	const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const result = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function chunkAdditionalData(input: {
	schemaVersion: number;
	kind: string;
	payloadKind: string;
	keyId: string;
	namespace: string;
	snapshotId: string;
	index: number;
	count: number;
	generatedAt: string;
}): Uint8Array {
	return utf8([
		"keating-encrypted-sync-chunk-aad-v1",
		String(input.schemaVersion),
		input.kind,
		input.payloadKind,
		input.keyId,
		input.namespace,
		input.snapshotId,
		String(input.index),
		String(input.count),
		input.generatedAt,
	].join("\u0000"));
}

function assertManifest(manifest: LearnerSyncManifest): void {
	if (
		manifest.schemaVersion !== LEARNER_SYNC_SCHEMA_VERSION
		|| manifest.kind !== "keating-encrypted-sync-manifest"
		|| (manifest.payloadKind !== "keating-learner-sync" && manifest.payloadKind !== "keating-source-revision")
		|| !manifest.keyId
		|| !manifest.namespace
		|| !manifest.snapshotId
		|| !Number.isInteger(manifest.chunkCount)
		|| manifest.chunkCount < 1
		|| manifest.plaintextBytes < 0
		|| manifest.plaintextBytes > MAX_LEARNER_SYNC_SNAPSHOT_BYTES
	) {
		throw new LearnerSyncError("Learner sync manifest is invalid.");
	}
}

export async function createEncryptedSyncSnapshot(input: {
	payload: unknown;
	payloadKind: EncryptedSyncPayloadKind;
	namespace: string;
	snapshotId: string;
	key: CryptoKey;
	keyId?: string;
	generatedAt?: string;
}): Promise<LearnerSyncSnapshot> {
	if (!input.namespace || !input.snapshotId) {
		throw new LearnerSyncError("Learner sync requires a namespace and snapshot ID.");
	}
	const plaintext = utf8(JSON.stringify(input.payload));
	if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_LEARNER_SYNC_SNAPSHOT_BYTES) {
		throw new LearnerSyncError(`Learner sync snapshots must be between 1 byte and ${MAX_LEARNER_SYNC_SNAPSHOT_BYTES} bytes.`);
	}
	const generatedAt = input.generatedAt ?? new Date().toISOString();
	const count = Math.ceil(plaintext.byteLength / MAX_LEARNER_SYNC_CHUNK_BYTES);
	const crypto = cryptoApi();
	const chunks = await Promise.all(Array.from({ length: count }, async (_, index): Promise<LearnerSyncChunk> => {
		const source = plaintext.subarray(index * MAX_LEARNER_SYNC_CHUNK_BYTES, (index + 1) * MAX_LEARNER_SYNC_CHUNK_BYTES);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const metadata = {
			schemaVersion: LEARNER_SYNC_SCHEMA_VERSION,
			kind: "keating-encrypted-sync-chunk",
			payloadKind: input.payloadKind,
			keyId: input.keyId ?? "default",
			namespace: input.namespace,
			snapshotId: input.snapshotId,
			index,
			count,
			generatedAt,
		} as const;
		const aad = chunkAdditionalData(metadata);
		const ciphertext = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
			input.key,
			toArrayBuffer(source),
		);
		return {
			...metadata,
			iv: encodeBase64(iv),
			ciphertext: encodeBase64(new Uint8Array(ciphertext)),
			plaintextSha256: await sha256(source),
		};
	}));
	return {
		manifest: {
			schemaVersion: LEARNER_SYNC_SCHEMA_VERSION,
			kind: "keating-encrypted-sync-manifest",
			payloadKind: input.payloadKind,
			keyId: input.keyId ?? "default",
			namespace: input.namespace,
			snapshotId: input.snapshotId,
			generatedAt,
			chunkCount: count,
			plaintextBytes: plaintext.byteLength,
			plaintextSha256: await sha256(plaintext),
		},
		chunks,
	};
}

export async function restoreEncryptedSyncPayload(
	snapshot: LearnerSyncSnapshot,
	key: CryptoKey,
	expectedPayloadKind: EncryptedSyncPayloadKind,
): Promise<unknown> {
	assertManifest(snapshot.manifest);
	if (snapshot.manifest.payloadKind !== expectedPayloadKind) {
		throw new LearnerSyncError("Learner sync payload kind does not match the requested restore.");
	}
	if (snapshot.chunks.length !== snapshot.manifest.chunkCount) {
		throw new LearnerSyncError("Learner sync is missing encrypted chunks.");
	}
	const crypto = cryptoApi();
	const plaintext = await Promise.all(snapshot.chunks
		.slice()
		.sort((left, right) => left.index - right.index)
		.map(async (chunk, index) => {
			if (
				chunk.schemaVersion !== LEARNER_SYNC_SCHEMA_VERSION
				|| chunk.kind !== "keating-encrypted-sync-chunk"
				|| chunk.payloadKind !== snapshot.manifest.payloadKind
				|| chunk.keyId !== snapshot.manifest.keyId
				|| chunk.namespace !== snapshot.manifest.namespace
				|| chunk.snapshotId !== snapshot.manifest.snapshotId
				|| chunk.index !== index
				|| chunk.count !== snapshot.manifest.chunkCount
				|| chunk.generatedAt !== snapshot.manifest.generatedAt
			) {
				throw new LearnerSyncError("Learner sync chunk metadata does not match its manifest.");
			}
			let decrypted: ArrayBuffer;
			try {
				const iv = decodeBase64(chunk.iv);
				if (iv.byteLength !== 12) throw new LearnerSyncError("Learner sync IV is invalid.");
				const aad = chunkAdditionalData(chunk);
				decrypted = await crypto.subtle.decrypt(
					{ name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
					key,
					toArrayBuffer(decodeBase64(chunk.ciphertext)),
				);
			} catch {
				throw new LearnerSyncError("Learner sync decryption failed.");
			}
			const bytes = new Uint8Array(decrypted);
			if (await sha256(bytes) !== chunk.plaintextSha256) {
				throw new LearnerSyncError("Learner sync chunk integrity check failed.");
			}
			return bytes;
		}));
	const combined = joinChunks(plaintext);
	if (combined.byteLength !== snapshot.manifest.plaintextBytes || await sha256(combined) !== snapshot.manifest.plaintextSha256) {
		throw new LearnerSyncError("Learner sync snapshot integrity check failed.");
	}
	let value: unknown;
	try {
		value = JSON.parse(decodeUtf8(combined));
	} catch {
		throw new LearnerSyncError("Learner sync payload is not valid JSON.");
	}
	return value;
}

export async function createLearnerSyncSnapshot(input: {
	bundle: KeatingPortableDataBundle;
	namespace: string;
	snapshotId: string;
	key: CryptoKey;
	keyId?: string;
	generatedAt?: string;
}): Promise<LearnerSyncSnapshot> {
	return createEncryptedSyncSnapshot({
		...input,
		payloadKind: "keating-learner-sync",
		payload: buildLearnerSyncProjection(input.bundle),
	});
}

export async function restoreLearnerSyncSnapshot(snapshot: LearnerSyncSnapshot, key: CryptoKey): Promise<KeatingPortableDataBundle> {
	const value = await restoreEncryptedSyncPayload(snapshot, key, "keating-learner-sync");
	if (!value || typeof value !== "object" || (value as KeatingPortableDataBundle).kind !== "keating-portable-data") {
		throw new LearnerSyncError("Learner sync payload is not a Keating data bundle.");
	}
	return value as KeatingPortableDataBundle;
}

export async function publishLearnerSyncSnapshot(snapshot: LearnerSyncSnapshot, transport: LearnerSyncTransport): Promise<void> {
	assertManifest(snapshot.manifest);
	if (snapshot.chunks.length !== snapshot.manifest.chunkCount) {
		throw new LearnerSyncError("Learner sync cannot publish an incomplete snapshot.");
	}
	for (const chunk of snapshot.chunks) {
		await transport.putChunk(chunk);
	}
	await transport.putManifest(snapshot.manifest);
	await transport.putLatest({
		schemaVersion: LEARNER_SYNC_SCHEMA_VERSION,
		kind: "keating-encrypted-sync-latest",
		namespace: snapshot.manifest.namespace,
		payloadKind: snapshot.manifest.payloadKind,
		snapshotId: snapshot.manifest.snapshotId,
		keyId: snapshot.manifest.keyId,
		generatedAt: snapshot.manifest.generatedAt,
	});
}

export async function loadLearnerSyncSnapshot(
	transport: LearnerSyncTransport,
	namespace: string,
	snapshotId: string,
): Promise<LearnerSyncSnapshot | null> {
	const manifest = await transport.getManifest(namespace, snapshotId);
	if (!manifest) return null;
	assertManifest(manifest);
	const chunks = await Promise.all(Array.from({ length: manifest.chunkCount }, async (_, index) => {
		const chunk = await transport.getChunk(namespace, snapshotId, index);
		if (!chunk) throw new LearnerSyncError(`Learner sync is missing chunk ${index}.`);
		return chunk;
	}));
	return { manifest, chunks };
}
