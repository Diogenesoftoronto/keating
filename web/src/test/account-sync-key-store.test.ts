import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deriveAccountSyncNamespace, generateAccountSyncKey, importAccountSyncRecoveryCode, IndexedDbAccountSyncKeyStore } from "../keating/sync/device-identity";

describe("account-scoped sync key storage", () => {
	it("derives a stable, separate non-extractable content indexing key on every device", async () => {
		const first = await generateAccountSyncKey();
		const second = await importAccountSyncRecoveryCode(first.recoveryCode);
		expect(first.indexingKey?.extractable).toBe(false);
		expect(first.indexingKey?.algorithm.name).toBe("HMAC");
		expect(first.key.algorithm.name).toBe("AES-GCM");
		await expect(crypto.subtle.exportKey("raw", first.indexingKey!)).rejects.toThrow();
		const bytes = new TextEncoder().encode("same canonical message");
		expect(await crypto.subtle.sign("HMAC", first.indexingKey!, bytes)).toEqual(await crypto.subtle.sign("HMAC", second.indexingKey!, bytes));
	});

	it("isolates account keys and never adopts a legacy global active key", async () => {
		Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
		const legacy = new IndexedDbAccountSyncKeyStore();
		const alice = new IndexedDbAccountSyncKeyStore(await deriveAccountSyncNamespace("did:plc:alice"));
		const bob = new IndexedDbAccountSyncKeyStore(await deriveAccountSyncNamespace("did:plc:bob"));
		const legacyKey = await generateAccountSyncKey();
		const aliceKey = await generateAccountSyncKey();
		const bobKey = await generateAccountSyncKey();
		await legacy.save(legacyKey);
		expect(await alice.getActive()).toBeNull();
		expect(await bob.getActive()).toBeNull();
		await alice.save(aliceKey);
		await bob.save(bobKey);
		expect((await alice.getActive())?.keyId).toBe(aliceKey.keyId);
		expect((await alice.getActive())?.indexingKey?.extractable).toBe(false);
		expect((await bob.getActive())?.keyId).toBe(bobKey.keyId);
		expect(await bob.get(aliceKey.keyId)).toBeNull();
		expect(await alice.get(legacyKey.keyId)).toBeNull();
		await bob.revoke(aliceKey.keyId);
		expect((await alice.get(aliceKey.keyId))?.keyId).toBe(aliceKey.keyId);
	});

});
