import { LearnerSyncError } from "./learner-sync";

export interface AccountSyncKey {
	keyId: string;
	key: CryptoKey;
	createdAt: string;
}

export interface GeneratedAccountSyncKey extends AccountSyncKey {
	/** Show once or wrap with the account recovery service; never send to GUN. */
	recoveryCode: string;
}

export interface AccountSyncKeyStore {
	getActive(): Promise<AccountSyncKey | null>;
	get(keyId: string): Promise<AccountSyncKey | null>;
	save(value: AccountSyncKey, options?: { active?: boolean }): Promise<void>;
	revoke(keyId: string): Promise<void>;
}

const DB_NAME = "keating-sync-keys";
const STORE_NAME = "keys";

interface StoredAccountSyncKey extends AccountSyncKey {
	active: boolean;
}

function cryptoApi(): Crypto {
	if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
		throw new LearnerSyncError("Web Crypto is required for account sync keys.");
	}
	return globalThis.crypto;
}

function bytesToRecoveryCode(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function recoveryCodeToBytes(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
		throw new LearnerSyncError("The sync recovery code is invalid.");
	}
	const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (bytes.byteLength !== 32) throw new LearnerSyncError("The sync recovery code is invalid.");
	return bytes;
}

async function digestHex(value: Uint8Array): Promise<string> {
	const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
	const digest = await cryptoApi().subtle.digest("SHA-256", buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importRawKey(bytes: Uint8Array): Promise<AccountSyncKey> {
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	return {
		keyId: (await digestHex(bytes)).slice(0, 32),
		key: await cryptoApi().subtle.importKey("raw", buffer, "AES-GCM", false, ["encrypt", "decrypt"]),
		createdAt: new Date().toISOString(),
	};
}

export async function importAccountSyncKeyBytes(bytes: Uint8Array): Promise<AccountSyncKey> {
	if (bytes.byteLength !== 32) throw new LearnerSyncError("The account sync key is invalid.");
	return importRawKey(bytes);
}

export async function deriveAccountSyncNamespace(did: string): Promise<string> {
	const normalized = did.trim().toLowerCase();
	if (!/^did:[a-z0-9]+:[a-z0-9._:%-]+$/u.test(normalized) || normalized.length > 512) {
		throw new LearnerSyncError("A valid ATProto DID is required for account sync.");
	}
	return `account-${await digestHex(new TextEncoder().encode(`keating-sync-v1:${normalized}`))}`;
}

export async function generateAccountSyncKey(): Promise<GeneratedAccountSyncKey> {
	const raw = cryptoApi().getRandomValues(new Uint8Array(32));
	const imported = await importRawKey(raw);
	return { ...imported, recoveryCode: bytesToRecoveryCode(raw) };
}

export async function importAccountSyncRecoveryCode(recoveryCode: string): Promise<AccountSyncKey> {
	return importRawKey(recoveryCodeToBytes(recoveryCode.trim()));
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new LearnerSyncError("Sync key storage request failed."));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new LearnerSyncError("Sync key storage transaction failed."));
		transaction.onabort = () => reject(transaction.error ?? new LearnerSyncError("Sync key storage transaction was aborted."));
	});
}

export class IndexedDbAccountSyncKeyStore implements AccountSyncKeyStore {
	private database: Promise<IDBDatabase> | null = null;

	private open(): Promise<IDBDatabase> {
		if (this.database) return this.database;
		this.database = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE_NAME)) {
					request.result.createObjectStore(STORE_NAME, { keyPath: "keyId" });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new LearnerSyncError("Could not open sync key storage."));
		});
		return this.database;
	}

	async getActive(): Promise<AccountSyncKey | null> {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, "readonly");
		const values = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as StoredAccountSyncKey[];
		return values.find((value) => value.active) ?? null;
	}

	async get(keyId: string): Promise<AccountSyncKey | null> {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, "readonly");
		return await requestResult(transaction.objectStore(STORE_NAME).get(keyId)) as StoredAccountSyncKey | undefined ?? null;
	}

	async save(value: AccountSyncKey, options: { active?: boolean } = {}): Promise<void> {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, "readwrite");
		const store = transaction.objectStore(STORE_NAME);
		const makeActive = options.active !== false;
		if (makeActive) {
			const existing = await requestResult(store.getAll()) as StoredAccountSyncKey[];
			for (const candidate of existing) store.put({ ...candidate, active: false });
		}
		store.put({ ...value, active: makeActive });
		await transactionDone(transaction);
	}

	async revoke(keyId: string): Promise<void> {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, "readwrite");
		transaction.objectStore(STORE_NAME).delete(keyId);
		await transactionDone(transaction);
	}
}
