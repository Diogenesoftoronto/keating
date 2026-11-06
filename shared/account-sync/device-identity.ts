import { webSyncCrypto, type SyncCrypto } from "./crypto.js";

export interface AccountSyncKey {
	keyId: string;
	key: unknown;
	indexingKey?: unknown;
	createdAt: string;
}

export interface AccountSyncKeyStore {
	getActive(): Promise<AccountSyncKey | null>;
	get(keyId: string): Promise<AccountSyncKey | null>;
	save(value: AccountSyncKey, options?: { active?: boolean }): Promise<void>;
	revoke(keyId: string): Promise<void>;
}

export async function deriveAccountSyncNamespace(did: string, crypto: SyncCrypto = webSyncCrypto): Promise<string> {
	const normalized = did.trim().toLowerCase();
	if (!/^did:[a-z0-9]+:[a-z0-9._:%-]+$/u.test(normalized) || normalized.length > 512) {
		throw new Error("A valid ATProto DID is required for account sync.");
	}
	const digest = await crypto.sha256(new TextEncoder().encode(`keating-sync-v1:${normalized}`));
	return `account-${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
