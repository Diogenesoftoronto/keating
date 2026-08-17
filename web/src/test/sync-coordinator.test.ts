import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";

import type { KeatingPortableDataBundle } from "../keating/portable-data";
import type {
	AccountSyncKey,
	AccountSyncKeyStore,
} from "../keating/sync/device-identity";
import {
	deriveAccountSyncNamespace,
	generateAccountSyncKey,
	importAccountSyncRecoveryCode,
	IndexedDbAccountSyncKeyStore,
} from "../keating/sync/device-identity";
import type {
	EncryptedSyncPayloadKind,
	LearnerSyncChunk,
	LearnerSyncLatestPointer,
	LearnerSyncManifest,
	LearnerSyncTransport,
} from "../keating/sync/contracts";
import { KeatingSyncCoordinator } from "../keating/sync/sync-coordinator";

class MemoryKeyStore implements AccountSyncKeyStore {
	private activeId: string | null = null;
	private readonly values = new Map<string, AccountSyncKey>();

	async getActive(): Promise<AccountSyncKey | null> {
		return this.activeId ? this.values.get(this.activeId) ?? null : null;
	}

	async get(keyId: string): Promise<AccountSyncKey | null> {
		return this.values.get(keyId) ?? null;
	}

	async save(value: AccountSyncKey, options: { active?: boolean } = {}): Promise<void> {
		this.values.set(value.keyId, value);
		if (options.active !== false) this.activeId = value.keyId;
	}

	async revoke(keyId: string): Promise<void> {
		this.values.delete(keyId);
		if (this.activeId === keyId) this.activeId = null;
	}
}

class MemoryTransport implements LearnerSyncTransport {
	private readonly manifests = new Map<string, LearnerSyncManifest>();
	private readonly chunks = new Map<string, LearnerSyncChunk>();
	private readonly latest = new Map<string, LearnerSyncLatestPointer>();
	private readonly listeners = new Map<string, Set<(pointer: LearnerSyncLatestPointer) => void>>();

	private snapshotKey(namespace: string, snapshotId: string): string {
		return `${namespace}:${snapshotId}`;
	}

	private latestKey(namespace: string, payloadKind: EncryptedSyncPayloadKind): string {
		return `${namespace}:${payloadKind}`;
	}

	async putManifest(value: LearnerSyncManifest): Promise<void> {
		this.manifests.set(this.snapshotKey(value.namespace, value.snapshotId), value);
	}

	async putChunk(value: LearnerSyncChunk): Promise<void> {
		this.chunks.set(`${this.snapshotKey(value.namespace, value.snapshotId)}:${value.index}`, value);
	}

	async getManifest(namespace: string, snapshotId: string): Promise<LearnerSyncManifest | null> {
		return this.manifests.get(this.snapshotKey(namespace, snapshotId)) ?? null;
	}

	async getChunk(namespace: string, snapshotId: string, index: number): Promise<LearnerSyncChunk | null> {
		return this.chunks.get(`${this.snapshotKey(namespace, snapshotId)}:${index}`) ?? null;
	}

	async putLatest(value: LearnerSyncLatestPointer): Promise<void> {
		const key = this.latestKey(value.namespace, value.payloadKind);
		this.latest.set(key, value);
		for (const listener of this.listeners.get(key) ?? []) listener(value);
	}

	async getLatest(namespace: string, payloadKind: EncryptedSyncPayloadKind): Promise<LearnerSyncLatestPointer | null> {
		return this.latest.get(this.latestKey(namespace, payloadKind)) ?? null;
	}

	subscribeLatest(namespace: string, payloadKind: EncryptedSyncPayloadKind, listener: (pointer: LearnerSyncLatestPointer) => void): () => void {
		const key = this.latestKey(namespace, payloadKind);
		const values = this.listeners.get(key) ?? new Set();
		values.add(listener);
		this.listeners.set(key, values);
		return () => values.delete(listener);
	}
}

const bundle = {
	schemaVersion: 1,
	kind: "keating-portable-data",
	generatedAt: "2026-08-15T00:00:00.000Z",
	sessions: [],
	storage: { learnerState: { schemaVersion: 3, topicsExplored: ["calculus"] } },
} as unknown as KeatingPortableDataBundle;

describe("Keating GUN sync coordination", () => {
	it("persists non-extractable account keys in browser storage and supports revocation", async () => {
		Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
		const store = new IndexedDbAccountSyncKeyStore();
		const generated = await generateAccountSyncKey();
		await store.save(generated, { active: true });
		expect((await store.getActive())?.keyId).toBe(generated.keyId);
		expect((await store.get(generated.keyId))?.key.extractable).toBe(false);
		await store.revoke(generated.keyId);
		expect(await store.get(generated.keyId)).toBeNull();
	});

	it("derives an opaque namespace and imports the same recovery key on another device", async () => {
		const namespace = await deriveAccountSyncNamespace("did:plc:ExampleAccount");
		expect(namespace).toStartWith("account-");
		expect(namespace).not.toContain("exampleaccount");
		const generated = await generateAccountSyncKey();
		const imported = await importAccountSyncRecoveryCode(generated.recoveryCode);
		expect(imported.keyId).toBe(generated.keyId);
		expect(imported.key.extractable).toBe(false);
	});

	it("publishes on one device and restores on another device with the same DID and key", async () => {
		const transport = new MemoryTransport();
		const firstKeys = new MemoryKeyStore();
		const secondKeys = new MemoryKeyStore();
		const generated = await generateAccountSyncKey();
		await firstKeys.save(generated);
		await secondKeys.save(await importAccountSyncRecoveryCode(generated.recoveryCode));
		const first = await KeatingSyncCoordinator.create({ did: "did:plc:example", transport, keys: firstKeys });
		const second = await KeatingSyncCoordinator.create({ did: "did:plc:example", transport, keys: secondKeys });

		const pointer = await first.publishLearnerBundle(bundle);
		expect(pointer.keyId).toBe(generated.keyId);
		expect(await second.restoreLatestLearnerBundle()).toEqual(bundle);
	});

	it("does not expose another DID's latest data", async () => {
		const transport = new MemoryTransport();
		const keys = new MemoryKeyStore();
		await keys.save(await generateAccountSyncKey());
		const owner = await KeatingSyncCoordinator.create({ did: "did:plc:owner", transport, keys });
		const stranger = await KeatingSyncCoordinator.create({ did: "did:plc:stranger", transport, keys });
		await owner.publishLearnerBundle(bundle);
		expect(await stranger.restoreLatestLearnerBundle()).toBeNull();
	});
});
