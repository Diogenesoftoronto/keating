import type { KeatingPortableDataBundle } from "../portable-data";
import type { EncryptedSyncPayloadKind, LearnerSyncLatestPointer, LearnerSyncTransport, SourceRevision } from "./contracts";
import type { AccountSyncKeyStore } from "./device-identity";
import { deriveAccountSyncNamespace } from "./device-identity";
import {
	createLearnerSyncSnapshot,
	LearnerSyncError,
	loadLearnerSyncSnapshot,
	publishLearnerSyncSnapshot,
	restoreLearnerSyncSnapshot,
} from "./learner-sync";
import { createSourceRevisionSyncSnapshot, restoreSourceRevisionSyncSnapshot } from "./source-revision";

export interface KeatingSyncCoordinatorOptions {
	did: string;
	transport: LearnerSyncTransport;
	keys: AccountSyncKeyStore;
}

export class KeatingSyncCoordinator {
	private constructor(
		readonly namespace: string,
		private readonly transport: LearnerSyncTransport,
		private readonly keys: AccountSyncKeyStore,
	) {}

	static async create(options: KeatingSyncCoordinatorOptions): Promise<KeatingSyncCoordinator> {
		return new KeatingSyncCoordinator(await deriveAccountSyncNamespace(options.did), options.transport, options.keys);
	}

	private snapshotId(prefix: string): string {
		return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
	}

	private assertPointer(pointer: LearnerSyncLatestPointer, payloadKind: EncryptedSyncPayloadKind): void {
		if (pointer.namespace !== this.namespace || pointer.payloadKind !== payloadKind || !pointer.snapshotId || !pointer.keyId) {
			throw new LearnerSyncError("The latest GUN sync pointer does not match this account.");
		}
	}

	private pointerForSnapshot(snapshot: { manifest: {
		schemaVersion: LearnerSyncLatestPointer["schemaVersion"];
		namespace: string;
		payloadKind: EncryptedSyncPayloadKind;
		snapshotId: string;
		keyId: string;
		generatedAt: string;
	} }): LearnerSyncLatestPointer {
		return {
			schemaVersion: snapshot.manifest.schemaVersion,
			kind: "keating-encrypted-sync-latest",
			namespace: snapshot.manifest.namespace,
			payloadKind: snapshot.manifest.payloadKind,
			snapshotId: snapshot.manifest.snapshotId,
			keyId: snapshot.manifest.keyId,
			generatedAt: snapshot.manifest.generatedAt,
		};
	}

	private async loadLatest(payloadKind: EncryptedSyncPayloadKind) {
		const pointer = await this.transport.getLatest(this.namespace, payloadKind);
		if (!pointer) return null;
		this.assertPointer(pointer, payloadKind);
		const snapshot = await loadLearnerSyncSnapshot(this.transport, this.namespace, pointer.snapshotId);
		if (!snapshot) throw new LearnerSyncError("The latest GUN sync snapshot is unavailable.");
		if (snapshot.manifest.keyId !== pointer.keyId || snapshot.manifest.payloadKind !== payloadKind) {
			throw new LearnerSyncError("The latest GUN sync pointer does not match its encrypted manifest.");
		}
		const key = await this.keys.get(pointer.keyId);
		if (!key) throw new LearnerSyncError(`This device does not have sync key ${pointer.keyId}.`);
		return { snapshot, key };
	}

	async publishLearnerBundle(bundle: KeatingPortableDataBundle): Promise<LearnerSyncLatestPointer> {
		const active = await this.keys.getActive();
		if (!active) throw new LearnerSyncError("This device has no active account sync key.");
		const snapshot = await createLearnerSyncSnapshot({
			bundle,
			namespace: this.namespace,
			snapshotId: this.snapshotId("learner"),
			key: active.key,
			keyId: active.keyId,
		});
		await publishLearnerSyncSnapshot(snapshot, this.transport);
		return this.pointerForSnapshot(snapshot);
	}

	async restoreLatestLearnerBundle(): Promise<KeatingPortableDataBundle | null> {
		const loaded = await this.loadLatest("keating-learner-sync");
		return loaded ? restoreLearnerSyncSnapshot(loaded.snapshot, loaded.key.key) : null;
	}

	async publishSourceRevision(revision: SourceRevision): Promise<LearnerSyncLatestPointer> {
		const active = await this.keys.getActive();
		if (!active) throw new LearnerSyncError("This device has no active account sync key.");
		const snapshot = await createSourceRevisionSyncSnapshot({
			revision,
			namespace: this.namespace,
			snapshotId: revision.id,
			key: active.key,
			keyId: active.keyId,
		});
		await publishLearnerSyncSnapshot(snapshot, this.transport);
		return this.pointerForSnapshot(snapshot);
	}

	async restoreLatestSourceRevision(): Promise<SourceRevision | null> {
		const loaded = await this.loadLatest("keating-source-revision");
		return loaded ? restoreSourceRevisionSyncSnapshot(loaded.snapshot, loaded.key.key) : null;
	}

	subscribeLatest(payloadKind: EncryptedSyncPayloadKind, listener: (pointer: LearnerSyncLatestPointer) => void): () => void {
		return this.transport.subscribeLatest(this.namespace, payloadKind, (pointer) => {
			try {
				this.assertPointer(pointer, payloadKind);
				listener(pointer);
			} catch {
				// Ignore cross-account or malformed peer pointers.
			}
		});
	}
}
