import {
	assertCredentialId, assertCredentialValue, CredentialEncryptionUnavailableError,
	CredentialVaultError, MAX_CREDENTIAL_ENTRIES, MAX_CREDENTIAL_VAULT_BYTES,
	type CredentialStorageStatus, type CredentialVault,
} from "./credential-vault.js";

export const PROVIDER_KEYS_STORE = "provider-keys";

export interface LegacyProviderKeyBackend {
	get(storeName: string, key: string): Promise<unknown>;
	delete(storeName: string, key: string): Promise<void>;
	keys(storeName: string, prefix?: string): Promise<string[]>;
	clear(storeName: string): Promise<void>;
}

export interface CredentialVaultLike {
	get(id: string): Promise<string | null>;
	set(id: string, value: string): Promise<void>;
	delete(id: string): Promise<boolean>;
	keys(): Promise<string[]>;
	has(id: string): Promise<boolean>;
	clear(): Promise<void>;
	status?(): Promise<CredentialStorageStatus>;
}

/**
 * Main-owned credential boundary. New writes never enter the replicated P2P
 * store. A legacy plaintext value is removed only after the OS-backed vault
 * has durably accepted it. When the OS keyring is unavailable, new credentials
 * stay in this bounded main-process map until app exit or secure recovery.
 */
export class DesktopCredentialService {
	readonly #vault: CredentialVaultLike;
	readonly #legacy: LegacyProviderKeyBackend;
	readonly #session = new Map<string, string>();
	#serial: Promise<void> = Promise.resolve();

	constructor(vault: CredentialVault | CredentialVaultLike, legacy: LegacyProviderKeyBackend) {
		this.#vault = vault;
		this.#legacy = legacy;
	}

	async get(id: string): Promise<string | null> {
		return this.#run(async () => {
			assertCredentialId(id);
			await this.#promote();
			return this.#get(id);
		});
	}

	async #get(id: string): Promise<string | null> {
		if (this.#session.has(id)) return this.#session.get(id)!;
		try {
			const secured = await this.#vault.get(id);
			if (secured !== null) return secured;
		} catch (error) {
			if (!(error instanceof CredentialEncryptionUnavailableError)) throw error;
		}
		const legacy = await this.#legacy.get(PROVIDER_KEYS_STORE, id);
		if (legacy === null || legacy === undefined) return null;
		if (typeof legacy !== "string") {
			throw new Error("Legacy credential has an invalid value.");
		}
		await this.#store(id, assertCredentialValue(legacy));
		return legacy;
	}

	async set(id: string, value: string): Promise<void> {
		await this.#run(async () => {
			assertCredentialId(id); assertCredentialValue(value);
			await this.#promote();
			await this.#store(id, value);
		});
	}

	async delete(id: string): Promise<void> {
		await this.#run(async () => {
			assertCredentialId(id);
			// Do not promote a credential that the user is trying to remove.
			await this.#vault.delete(id);
			await this.#legacy.delete(PROVIDER_KEYS_STORE, id);
			this.#session.delete(id);
		});
	}

	async keys(): Promise<string[]> {
		return this.#run(async () => {
			await this.#promote();
			const names = new Set([...await this.#vault.keys(), ...await this.#legacy.keys(PROVIDER_KEYS_STORE), ...this.#session.keys()]);
			const readable: string[] = [];
			for (const key of names) {
				assertCredentialId(key);
				if (await this.#get(key) !== null) readable.push(key);
			}
			return readable.sort();
		});
	}

	async has(id: string): Promise<boolean> {
		return (await this.get(id)) !== null;
	}

	async clear(): Promise<void> {
		await this.#run(async () => {
			await this.#vault.clear();
			await this.#legacy.clear(PROVIDER_KEYS_STORE);
			this.#session.clear();
		});
	}

	async status(): Promise<CredentialStorageStatus> {
		return this.#run(() => this.#promote());
	}

	async #promote(): Promise<CredentialStorageStatus> {
		const status = this.#vault.status ? await this.#vault.status() : { persistence: "encrypted" as const };
		if (status.persistence === "session") return status;
		for (const [id, value] of this.#session) {
			if (!await this.#store(id, value)) return { persistence: "session" };
		}
		return { persistence: "encrypted" };
	}

	async #store(id: string, value: string): Promise<boolean> {
		try { await this.#vault.set(id, value); }
		catch (error) {
			if (!(error instanceof CredentialEncryptionUnavailableError)) throw error;
			const ids = new Set([...await this.#vault.keys(), ...this.#session.keys(), id]);
			if (ids.size > MAX_CREDENTIAL_ENTRIES) throw new CredentialVaultError("Credential vault has too many entries.");
			const entries = new Map(this.#session);
			entries.set(id, value);
			if (Buffer.byteLength(JSON.stringify([...entries]), "utf8") > MAX_CREDENTIAL_VAULT_BYTES) throw new CredentialVaultError("Session credential storage is too large.");
			this.#session.set(id, value);
			return false;
		}
		await this.#legacy.delete(PROVIDER_KEYS_STORE, id);
		this.#session.delete(id);
		return true;
	}

	#run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#serial.then(operation, operation);
		this.#serial = result.then(() => undefined, () => undefined);
		return result;
	}
}
