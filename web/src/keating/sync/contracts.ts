/**
 * Transport-neutral contracts for the encrypted learner sync layer.
 *
 * A GUN adapter may persist these values as individual graph nodes, but the
 * contracts intentionally do not import GUN. That keeps browser, React Native,
 * and desktop transports on the same wire format.
 */

export const LEARNER_SYNC_SCHEMA_VERSION = 1 as const;
export const MAX_LEARNER_SYNC_CHUNK_BYTES = 32 * 1024;
export const MAX_LEARNER_SYNC_SNAPSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_REVISION_BYTES = 512 * 1024;

export type EncryptedSyncPayloadKind = "keating-learner-sync" | "keating-source-revision";

export interface LearnerSyncChunk {
	schemaVersion: typeof LEARNER_SYNC_SCHEMA_VERSION;
	kind: "keating-encrypted-sync-chunk";
	payloadKind: EncryptedSyncPayloadKind;
	keyId: string;
	namespace: string;
	snapshotId: string;
	index: number;
	count: number;
	generatedAt: string;
	iv: string;
	ciphertext: string;
	plaintextSha256: string;
}

export interface LearnerSyncManifest {
	schemaVersion: typeof LEARNER_SYNC_SCHEMA_VERSION;
	kind: "keating-encrypted-sync-manifest";
	payloadKind: EncryptedSyncPayloadKind;
	keyId: string;
	namespace: string;
	snapshotId: string;
	generatedAt: string;
	chunkCount: number;
	plaintextBytes: number;
	plaintextSha256: string;
}

export interface LearnerSyncSnapshot {
	manifest: LearnerSyncManifest;
	chunks: LearnerSyncChunk[];
}

export interface LearnerSyncLatestPointer {
	schemaVersion: typeof LEARNER_SYNC_SCHEMA_VERSION;
	kind: "keating-encrypted-sync-latest";
	namespace: string;
	payloadKind: EncryptedSyncPayloadKind;
	snapshotId: string;
	keyId: string;
	generatedAt: string;
}

/**
 * A source change is a unified diff, never a complete filesystem snapshot.
 * Receivers must compare parentTreeSha256 to their checked-out tree before
 * presenting the revision for explicit application.
 */
export interface SourceFileDiff {
	path: string;
	operation: "add" | "modify" | "delete";
	beforeSha256: string;
	afterSha256: string;
	patch: string;
}

export interface SourceRevision {
	schemaVersion: typeof LEARNER_SYNC_SCHEMA_VERSION;
	kind: "keating-source-revision";
	id: string;
	parentId?: string;
	parentTreeSha256: string;
	resultingTreeSha256: string;
	createdAt: string;
	files: SourceFileDiff[];
}

/**
 * Implement this around GUN, a React Native persistence adapter, or the
 * existing desktop Hyperbee bridge. Transports receive ciphertext only.
 */
export interface LearnerSyncTransport {
	putManifest(manifest: LearnerSyncManifest): Promise<void>;
	putChunk(chunk: LearnerSyncChunk): Promise<void>;
	getManifest(namespace: string, snapshotId: string): Promise<LearnerSyncManifest | null>;
	getChunk(namespace: string, snapshotId: string, index: number): Promise<LearnerSyncChunk | null>;
	putLatest(pointer: LearnerSyncLatestPointer): Promise<void>;
	getLatest(namespace: string, payloadKind: EncryptedSyncPayloadKind): Promise<LearnerSyncLatestPointer | null>;
	subscribeLatest(
		namespace: string,
		payloadKind: EncryptedSyncPayloadKind,
		listener: (pointer: LearnerSyncLatestPointer) => void,
	): () => void;
}

/**
 * Metadata returned by Notorganic after it has confirmed a checkpoint with
 * Tinker. It deliberately contains no model bytes, provider credential, or
 * signed download URL, so it is safe to reference from learner state.
 */
export interface AdapterManifestReference {
	id: string;
	projectId: string;
	baseModel: string;
	kind: "sampler" | "training_state";
	status: "active" | "milestone" | "ephemeral" | "archived";
	checkpointRef: string;
	sha256: string;
	sizeBytes: number;
	parentId?: string;
	trainingRunRef?: string;
	expiresAt?: string;
	createdAt: string;
	updatedAt: string;
}
