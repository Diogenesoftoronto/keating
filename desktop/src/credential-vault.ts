import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The only vault format this module will read or write. */
export const CREDENTIAL_VAULT_VERSION = 1;
export const MAX_CREDENTIAL_ID_LENGTH = 128;
export const MAX_CREDENTIAL_VALUE_BYTES = 128 * 1024;
export const MAX_CREDENTIAL_ENTRIES = 512;
export const MAX_CREDENTIAL_VAULT_BYTES = 1024 * 1024;

/**
 * Deliberately mirrors Electron safeStorage without importing Electron. The
 * main process can adapt `safeStorage` directly; tests can inject a local
 * deterministic codec. A false availability result is always fail-closed.
 */
export interface CredentialEncryptionCodec {
	isEncryptionAvailable(): boolean;
	encryptString(plaintext: string): Uint8Array;
	decryptString(ciphertext: Uint8Array): string;
}

export interface CredentialVaultOptions {
	path: string;
	codec: CredentialEncryptionCodec;
}

interface VaultDocument {
	version: typeof CREDENTIAL_VAULT_VERSION;
	entries: Record<string, string>;
}

/** Errors deliberately omit native filesystem and crypto detail. */
export class CredentialVaultError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CredentialVaultError";
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/** Provider and OAuth names are deliberately path- and prototype-safe. */
export function assertCredentialId(value: unknown): string {
	if (
		typeof value !== "string"
		|| value.length === 0
		|| value.length > MAX_CREDENTIAL_ID_LENGTH
		|| !/^[a-z0-9][a-z0-9._:-]*$/.test(value)
	) {
		throw new CredentialVaultError("Credential id is invalid.");
	}
	return value;
}

function assertCredentialValue(value: unknown): string {
	if (typeof value !== "string" || byteLength(value) > MAX_CREDENTIAL_VALUE_BYTES) {
		throw new CredentialVaultError("Credential value is invalid.");
	}
	return value;
}

function isCanonicalBase64(value: string): boolean {
	if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
	try {
		return Buffer.from(value, "base64").toString("base64") === value;
	} catch {
		return false;
	}
}

function emptyDocument(): VaultDocument {
	return { version: CREDENTIAL_VAULT_VERSION, entries: Object.create(null) as Record<string, string> };
}

function validateDocument(value: unknown): VaultDocument {
	if (!isPlainRecord(value)) throw new CredentialVaultError("Credential vault is corrupt.");
	const fields = Object.keys(value);
	if (fields.length !== 2 || !fields.includes("version") || !fields.includes("entries")) {
		throw new CredentialVaultError("Credential vault is corrupt.");
	}
	if (value["version"] !== CREDENTIAL_VAULT_VERSION) {
		throw new CredentialVaultError("Credential vault version is not supported.");
	}
	if (!isPlainRecord(value["entries"])) throw new CredentialVaultError("Credential vault is corrupt.");
	const rawEntries = value["entries"];
	const names = Object.keys(rawEntries);
	if (names.length > MAX_CREDENTIAL_ENTRIES) throw new CredentialVaultError("Credential vault is corrupt.");
	const entries = Object.create(null) as Record<string, string>;
	for (const name of names) {
		assertCredentialId(name);
		const ciphertext = rawEntries[name];
		if (
			typeof ciphertext !== "string"
			|| ciphertext.length > MAX_CREDENTIAL_VALUE_BYTES * 2
			|| !isCanonicalBase64(ciphertext)
		) {
			throw new CredentialVaultError("Credential vault is corrupt.");
		}
		entries[name] = ciphertext;
	}
	return { version: CREDENTIAL_VAULT_VERSION, entries };
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Encrypted, owner-only credential storage for Electron main. It has no
 * Electron dependency and intentionally exposes plaintext only from `get()`.
 */
export class CredentialVault {
	readonly #path: string;
	readonly #codec: CredentialEncryptionCodec;
	#serial: Promise<void> = Promise.resolve();

	constructor(options: CredentialVaultOptions) {
		if (typeof options?.path !== "string" || options.path.length === 0) {
			throw new CredentialVaultError("Credential vault path is invalid.");
		}
		this.#path = options.path;
		this.#codec = options.codec;
	}

	get path(): string {
		return this.#path;
	}

	async get(id: string): Promise<string | null> {
		return this.#run(async () => {
			assertCredentialId(id);
			const document = await this.#readDocument();
			const encoded = document.entries[id];
			if (encoded === undefined) return null;
			try {
				const value = this.#codec.decryptString(new Uint8Array(Buffer.from(encoded, "base64")));
				return assertCredentialValue(value);
			} catch (error) {
				if (error instanceof CredentialVaultError) throw error;
				throw new CredentialVaultError("Credential vault could not be decrypted.");
			}
		});
	}

	async set(id: string, value: string): Promise<void> {
		await this.#run(async () => {
			assertCredentialId(id);
			const plaintext = assertCredentialValue(value);
			const document = await this.#readDocument();
			if (!(id in document.entries) && Object.keys(document.entries).length >= MAX_CREDENTIAL_ENTRIES) {
				throw new CredentialVaultError("Credential vault has too many entries.");
			}
			let ciphertext: Uint8Array;
			try {
				ciphertext = this.#codec.encryptString(plaintext);
			} catch {
				throw new CredentialVaultError("Credential vault could not encrypt the credential.");
			}
			if (!(ciphertext instanceof Uint8Array) || ciphertext.byteLength === 0 || ciphertext.byteLength > MAX_CREDENTIAL_VALUE_BYTES) {
				throw new CredentialVaultError("Credential vault could not encrypt the credential.");
			}
			document.entries[id] = Buffer.from(ciphertext).toString("base64");
			await this.#writeDocument(document);
		});
	}

	async delete(id: string): Promise<boolean> {
		return this.#run(async () => {
			assertCredentialId(id);
			const document = await this.#readDocument();
			if (!(id in document.entries)) return false;
			delete document.entries[id];
			await this.#writeDocument(document);
			return true;
		});
	}

	async keys(): Promise<string[]> {
		return this.#run(async () => Object.keys((await this.#readDocument()).entries).sort());
	}

	async has(id: string): Promise<boolean> {
		return this.#run(async () => {
			assertCredentialId(id);
			return id in (await this.#readDocument()).entries;
		});
	}

	async clear(): Promise<void> {
		await this.#run(async () => {
			const document = await this.#readDocument();
			if (Object.keys(document.entries).length === 0) return;
			await this.#writeDocument(emptyDocument());
		});
	}

	#run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#serial.then(operation, operation);
		this.#serial = result.then(() => undefined, () => undefined);
		return result;
	}

	#assertSecureEncryption(): void {
		try {
			if (this.#codec?.isEncryptionAvailable() !== true) {
				throw new CredentialVaultError("Secure credential encryption is unavailable.");
			}
		} catch (error) {
			if (error instanceof CredentialVaultError) throw error;
			throw new CredentialVaultError("Secure credential encryption is unavailable.");
		}
	}

	async #readDocument(): Promise<VaultDocument> {
		this.#assertSecureEncryption();
		await this.#assertSafeExistingVault();
		let contents: Buffer;
		try {
			contents = await readFile(this.#path);
		} catch (error) {
			if (isMissing(error)) return emptyDocument();
			throw new CredentialVaultError("Credential vault could not be read.");
		}
		if (contents.byteLength > MAX_CREDENTIAL_VAULT_BYTES) throw new CredentialVaultError("Credential vault is corrupt.");
		try {
			return validateDocument(JSON.parse(contents.toString("utf8")));
		} catch (error) {
			if (error instanceof CredentialVaultError) throw error;
			throw new CredentialVaultError("Credential vault is corrupt.");
		}
	}

	async #assertSafeExistingVault(): Promise<void> {
		try {
			const entry = await lstat(this.#path);
			if (!entry.isFile() || entry.isSymbolicLink()) throw new CredentialVaultError("Credential vault is unsafe.");
			if (process.platform !== "win32") {
				if ((entry.mode & 0o077) !== 0) throw new CredentialVaultError("Credential vault permissions are unsafe.");
				const uid = process.getuid?.();
				if (typeof uid === "number" && entry.uid !== uid) throw new CredentialVaultError("Credential vault ownership is unsafe.");
			}
		} catch (error) {
			if (isMissing(error)) return;
			if (error instanceof CredentialVaultError) throw error;
			throw new CredentialVaultError("Credential vault is unsafe.");
		}
	}

	async #writeDocument(document: VaultDocument): Promise<void> {
		this.#assertSecureEncryption();
		const normalized = validateDocument(document);
		const encoded = Buffer.from(JSON.stringify(normalized), "utf8");
		if (encoded.byteLength > MAX_CREDENTIAL_VAULT_BYTES) throw new CredentialVaultError("Credential vault is too large.");
		await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
		// Refuse a vault swapped into place after the load. Never replace a symlink
		// or corrupt/unsupported file just because a caller asked to mutate it.
		await this.#assertSafeExistingVault();
		const temporary = join(dirname(this.#path), `.${basename(this.#path)}.${randomUUID()}.tmp`);
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(temporary, "wx", 0o600);
			await handle.writeFile(encoded);
			await handle.sync();
			await handle.close();
			handle = undefined;
			if (process.platform !== "win32") await chmod(temporary, 0o600);
			await this.#assertSafeExistingVault();
			await rename(temporary, this.#path);
			if (process.platform !== "win32") await chmod(this.#path, 0o600);
			// Best-effort directory sync makes the rename durable where supported.
			try {
				const directory = await open(dirname(this.#path), "r");
				try { await directory.sync(); } finally { await directory.close(); }
			} catch {
				// Some platforms cannot fsync directories; the atomic rename still holds.
			}
		} catch (error) {
			throw error instanceof CredentialVaultError
				? error
				: new CredentialVaultError("Credential vault could not be written.");
		} finally {
			await handle?.close().catch(() => {});
			await unlink(temporary).catch(() => {});
		}
	}
}
