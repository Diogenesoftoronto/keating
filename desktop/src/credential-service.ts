import type { CredentialVault } from "./credential-vault.js";

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
}

/**
 * Main-owned credential boundary. New writes never enter the replicated P2P
 * store. A legacy plaintext value is removed only after the OS-backed vault
 * has durably accepted it, so failed encryption never destroys credentials.
 */
export class DesktopCredentialService {
	readonly #vault: CredentialVaultLike;
	readonly #legacy: LegacyProviderKeyBackend;

	constructor(vault: CredentialVault | CredentialVaultLike, legacy: LegacyProviderKeyBackend) {
		this.#vault = vault;
		this.#legacy = legacy;
	}

	async get(id: string): Promise<string | null> {
		const secured = await this.#vault.get(id);
		if (secured !== null) return secured;
		const legacy = await this.#legacy.get(PROVIDER_KEYS_STORE, id);
		if (legacy === null || legacy === undefined) return null;
		if (typeof legacy !== "string") {
			throw new Error("Legacy credential has an invalid value.");
		}
		await this.#vault.set(id, legacy);
		await this.#legacy.delete(PROVIDER_KEYS_STORE, id);
		return legacy;
	}

	async set(id: string, value: string): Promise<void> {
		await this.#vault.set(id, value);
		await this.#legacy.delete(PROVIDER_KEYS_STORE, id);
	}

	async delete(id: string): Promise<void> {
		await this.#vault.delete(id);
		await this.#legacy.delete(PROVIDER_KEYS_STORE, id);
	}

	async keys(): Promise<string[]> {
		const legacyKeys = await this.#legacy.keys(PROVIDER_KEYS_STORE);
		for (const key of legacyKeys) await this.get(key);
		return this.#vault.keys();
	}

	async has(id: string): Promise<boolean> {
		if (await this.#vault.has(id)) return true;
		return (await this.get(id)) !== null;
	}

	async clear(): Promise<void> {
		await this.#vault.clear();
		await this.#legacy.clear(PROVIDER_KEYS_STORE);
	}
}
