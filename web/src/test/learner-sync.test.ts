import { describe, expect, it } from "bun:test";
import fc from "fast-check";

import type { KeatingPortableDataBundle } from "../keating/portable-data";
import {
	createLearnerSyncSnapshot,
	createEncryptedSyncSnapshot,
	loadLearnerSyncSnapshot,
	publishLearnerSyncSnapshot,
	restoreLearnerSyncSnapshot,
	restoreEncryptedSyncPayload,
} from "../keating/sync/learner-sync";
import {
	createSourceRevisionSyncSnapshot,
	restoreSourceRevisionSyncSnapshot,
} from "../keating/sync/source-revision";
import type {
	EncryptedSyncPayloadKind,
	LearnerSyncChunk,
	LearnerSyncLatestPointer,
	LearnerSyncManifest,
	LearnerSyncTransport,
	SourceRevision,
} from "../keating/sync/contracts";

const bundle = {
	schemaVersion: 1,
	kind: "keating-portable-data",
	generatedAt: "2026-08-15T00:00:00.000Z",
	sessions: [{ data: { id: "session-1", messages: [{ content: "private learner note" }] }, metadata: { id: "session-1" } }],
	storage: { learnerState: { schemaVersion: 3, topicsExplored: ["calculus"] } },
	sandbox: { files: [{ path: "secret-source.ts", content: "do-not-sync-automatically" }] },
} as unknown as KeatingPortableDataBundle;

async function key(): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(32).fill(7), "AES-GCM", false, ["encrypt", "decrypt"]);
}

class MemoryTransport implements LearnerSyncTransport {
	private manifest = new Map<string, LearnerSyncManifest>();
	private chunks = new Map<string, LearnerSyncChunk>();
	private latest = new Map<string, LearnerSyncLatestPointer>();

	async putManifest(value: LearnerSyncManifest): Promise<void> {
		this.manifest.set(`${value.namespace}:${value.snapshotId}`, value);
	}

	async putChunk(value: LearnerSyncChunk): Promise<void> {
		this.chunks.set(`${value.namespace}:${value.snapshotId}:${value.index}`, value);
	}

	async getManifest(namespace: string, snapshotId: string): Promise<LearnerSyncManifest | null> {
		return this.manifest.get(`${namespace}:${snapshotId}`) ?? null;
	}

	async getChunk(namespace: string, snapshotId: string, index: number): Promise<LearnerSyncChunk | null> {
		return this.chunks.get(`${namespace}:${snapshotId}:${index}`) ?? null;
	}

	async putLatest(value: LearnerSyncLatestPointer): Promise<void> {
		this.latest.set(`${value.namespace}:${value.payloadKind}`, value);
	}

	async getLatest(namespace: string, payloadKind: EncryptedSyncPayloadKind): Promise<LearnerSyncLatestPointer | null> {
		return this.latest.get(`${namespace}:${payloadKind}`) ?? null;
	}

	subscribeLatest(): () => void {
		return () => undefined;
	}
}

describe("learner sync", () => {
	it("encrypts a bounded learner-only snapshot and restores it through a transport", async () => {
		const syncKey = await key();
		const snapshot = await createLearnerSyncSnapshot({
			bundle,
			namespace: "account:did:plc:example",
			snapshotId: "snapshot-1",
			key: syncKey,
			generatedAt: "2026-08-15T01:00:00.000Z",
		});

		expect(JSON.stringify(snapshot)).not.toContain("private learner note");
		expect(JSON.stringify(snapshot)).not.toContain("do-not-sync-automatically");
		expect(snapshot.chunks.every((chunk) => chunk.ciphertext.length > 0)).toBe(true);

		const transport = new MemoryTransport();
		await publishLearnerSyncSnapshot(snapshot, transport);
		const restored = await loadLearnerSyncSnapshot(transport, "account:did:plc:example", "snapshot-1");
		expect(restored).not.toBeNull();
		expect(await restoreLearnerSyncSnapshot(restored!, syncKey)).toEqual({
			...bundle,
			sandbox: undefined,
		});
	});

	it("rejects tampered encrypted chunks", async () => {
		const syncKey = await key();
		const snapshot = await createLearnerSyncSnapshot({
			bundle,
			namespace: "account:did:plc:example",
			snapshotId: "snapshot-2",
			key: syncKey,
		});
		const altered = {
			...snapshot,
			chunks: snapshot.chunks.map((chunk, index) => index === 0 ? {
				...chunk,
				ciphertext: `${chunk.ciphertext[0] === "A" ? "B" : "A"}${chunk.ciphertext.slice(1)}`,
			} : chunk),
		};
		await expect(restoreLearnerSyncSnapshot(altered, syncKey)).rejects.toThrow("Learner sync");
	});

	it("authenticates chunk metadata as well as ciphertext", async () => {
		const syncKey = await key();
		const snapshot = await createLearnerSyncSnapshot({
			bundle,
			namespace: "account:did:plc:example",
			snapshotId: "snapshot-metadata",
			key: syncKey,
		});
		const original = snapshot.chunks[0]!;
		const mutations: LearnerSyncChunk[] = [
			{ ...original, generatedAt: "2020-01-01T00:00:00.000Z" },
			{ ...original, keyId: "attacker" },
			{ ...original, namespace: "account:did:plc:other" },
			{ ...original, snapshotId: "snapshot-replayed" },
			{ ...original, iv: btoa(String.fromCharCode(...new Uint8Array(8))) },
		];
		for (const chunk of mutations) {
			await expect(restoreLearnerSyncSnapshot({ ...snapshot, chunks: [chunk] }, syncKey)).rejects.toThrow("Learner sync");
		}
	});

	it("round-trips generated JSON across varied text and collection shapes", async () => {
		const syncKey = await key();
		await fc.assert(fc.asyncProperty(
			fc.dictionary(fc.string({ maxLength: 32 }), fc.array(fc.string({ maxLength: 2_048 }), { maxLength: 12 })),
			async (payload) => {
				const snapshot = await createEncryptedSyncSnapshot({
					payload,
					payloadKind: "keating-learner-sync",
					namespace: "account:property",
					snapshotId: crypto.randomUUID(),
					key: syncKey,
					keyId: "property-key",
				});
				expect(await restoreEncryptedSyncPayload(snapshot, syncKey, "keating-learner-sync")).toEqual(payload);
			},
		), { numRuns: 50 });
	});

	it("never advances latest when a chunk or manifest write fails", async () => {
		const syncKey = await key();
		const first = await createLearnerSyncSnapshot({ bundle, namespace: "account:atomic", snapshotId: "first", key: syncKey });
		const second = await createLearnerSyncSnapshot({ bundle, namespace: "account:atomic", snapshotId: "second", key: syncKey });
		const durable = new MemoryTransport();
		await publishLearnerSyncSnapshot(first, durable);
		for (const failure of ["chunk", "manifest"] as const) {
			const faulting: LearnerSyncTransport = {
				putChunk: async (value) => {
					if (failure === "chunk") throw new Error("injected chunk failure");
					await durable.putChunk(value);
				},
				putManifest: async (value) => {
					if (failure === "manifest") throw new Error("injected manifest failure");
					await durable.putManifest(value);
				},
				putLatest: (value) => durable.putLatest(value),
				getChunk: (namespace, snapshotId, index) => durable.getChunk(namespace, snapshotId, index),
				getManifest: (namespace, snapshotId) => durable.getManifest(namespace, snapshotId),
				getLatest: (namespace, payloadKind) => durable.getLatest(namespace, payloadKind),
				subscribeLatest: () => () => undefined,
			};
			await expect(publishLearnerSyncSnapshot(second, faulting)).rejects.toThrow("injected");
			expect((await durable.getLatest("account:atomic", "keating-learner-sync"))?.snapshotId).toBe("first");
		}
	});

	it("encrypts a parent-checked source diff without applying it", async () => {
		const revision: SourceRevision = {
			schemaVersion: 1,
			kind: "keating-source-revision",
			id: "revision-1",
			parentTreeSha256: "a".repeat(64),
			resultingTreeSha256: "b".repeat(64),
			createdAt: "2026-08-15T01:00:00.000Z",
			files: [{
				path: "notebooks/lesson.ts",
				operation: "modify",
				beforeSha256: "c".repeat(64),
				afterSha256: "d".repeat(64),
				patch: "@@ -1 +1 @@\\n-old lesson\\n+new lesson",
			}],
		};
		const syncKey = await key();
		const snapshot = await createSourceRevisionSyncSnapshot({
			revision,
			namespace: "account:did:plc:example",
			key: syncKey,
		});

		expect(snapshot.manifest.payloadKind).toBe("keating-source-revision");
		expect(JSON.stringify(snapshot)).not.toContain("new lesson");
		expect(await restoreSourceRevisionSyncSnapshot(snapshot, syncKey)).toEqual(revision);
	});

	it("rejects source diffs outside the checked-out workspace", async () => {
		const syncKey = await key();
		await expect(createSourceRevisionSyncSnapshot({
			revision: {
				schemaVersion: 1,
				kind: "keating-source-revision",
				id: "revision-unsafe",
				parentTreeSha256: "a".repeat(64),
				resultingTreeSha256: "b".repeat(64),
				createdAt: "2026-08-15T01:00:00.000Z",
				files: [{ path: "../outside.ts", operation: "modify", beforeSha256: "c".repeat(64), afterSha256: "d".repeat(64), patch: "+unsafe" }],
			},
			namespace: "account:did:plc:example",
			key: syncKey,
		})).rejects.toThrow("invalid file diff");
	});
});
