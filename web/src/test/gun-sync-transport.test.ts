import { describe, expect, it } from "bun:test";

import type { LearnerSyncChunk, LearnerSyncLatestPointer, LearnerSyncManifest } from "../keating/sync/contracts";
import { GunLearnerSyncTransport, parseGunPeerUrls, type GunSyncNode } from "../keating/sync/gun-transport";

class MemoryGunNode implements GunSyncNode {
	constructor(
		private readonly values = new Map<string, string>(),
		private readonly listeners = new Map<string, Set<(value: unknown) => void>>(),
		private readonly path: string[] = [],
	) {}

	private key(): string {
		return this.path.join("/");
	}

	get(key: string): GunSyncNode {
		return new MemoryGunNode(this.values, this.listeners, [...this.path, key]);
	}

	put(value: string, callback?: (ack: { err?: string }) => void): GunSyncNode {
		this.values.set(this.key(), value);
		for (const listener of this.listeners.get(this.key()) ?? []) listener(value);
		queueMicrotask(() => callback?.({}));
		return this;
	}

	on(callback: (value: unknown) => void): GunSyncNode {
		const callbacks = this.listeners.get(this.key()) ?? new Set();
		callbacks.add(callback);
		this.listeners.set(this.key(), callbacks);
		if (this.values.has(this.key())) queueMicrotask(() => callback(this.values.get(this.key())));
		return this;
	}

	once(callback: (value: unknown) => void): GunSyncNode {
		queueMicrotask(() => callback(this.values.get(this.key())));
		return this;
	}

	off(): GunSyncNode {
		this.listeners.delete(this.key());
		return this;
	}
}

const manifest: LearnerSyncManifest = {
	schemaVersion: 1,
	kind: "keating-encrypted-sync-manifest",
	payloadKind: "keating-learner-sync",
	keyId: "key-1",
	namespace: "account-hash",
	snapshotId: "snapshot-1",
	generatedAt: "2026-08-15T00:00:00.000Z",
	chunkCount: 1,
	plaintextBytes: 5,
	plaintextSha256: "a".repeat(64),
};

const chunk: LearnerSyncChunk = {
	schemaVersion: 1,
	kind: "keating-encrypted-sync-chunk",
	payloadKind: "keating-learner-sync",
	keyId: "key-1",
	namespace: manifest.namespace,
	snapshotId: manifest.snapshotId,
	index: 0,
	count: 1,
	generatedAt: manifest.generatedAt,
	iv: "iv",
	ciphertext: "ciphertext",
	plaintextSha256: "b".repeat(64),
};

const latest: LearnerSyncLatestPointer = {
	schemaVersion: 1,
	kind: "keating-encrypted-sync-latest",
	namespace: manifest.namespace,
	payloadKind: manifest.payloadKind,
	snapshotId: manifest.snapshotId,
	keyId: manifest.keyId,
	generatedAt: manifest.generatedAt,
};

describe("GUN learner sync transport", () => {
	it("round-trips encrypted manifests, chunks, and latest pointers", async () => {
		const transport = new GunLearnerSyncTransport({ gun: new MemoryGunNode() });
		await transport.putChunk(chunk);
		await transport.putManifest(manifest);
		await transport.putLatest(latest);

		expect(await transport.getChunk(manifest.namespace, manifest.snapshotId, 0)).toEqual(chunk);
		expect(await transport.getManifest(manifest.namespace, manifest.snapshotId)).toEqual(manifest);
		expect(await transport.getLatest(manifest.namespace, manifest.payloadKind)).toEqual(latest);
	});

	it("subscribes to each new latest revision once and can unsubscribe", async () => {
		const gun = new MemoryGunNode();
		const transport = new GunLearnerSyncTransport({ gun });
		const received: string[] = [];
		const unsubscribe = transport.subscribeLatest(manifest.namespace, manifest.payloadKind, (pointer) => received.push(pointer.snapshotId));
		await transport.putLatest(latest);
		await transport.putLatest(latest);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(received).toEqual(["snapshot-1"]);
		unsubscribe();
		await transport.putLatest({ ...latest, snapshotId: "snapshot-2" });
		expect(received).toEqual(["snapshot-1"]);
	});

	it("rejects invalid graph coordinates", async () => {
		const transport = new GunLearnerSyncTransport({ gun: new MemoryGunNode() });
		await expect(transport.getChunk("", "snapshot-1", 0)).rejects.toThrow("namespace");
		await expect(transport.getChunk("account-hash", "snapshot-1", -1)).rejects.toThrow("index");
	});

	it("normalizes and validates configured relay URLs", () => {
		expect(parseGunPeerUrls("https://sync.example, https://sync.example/gun, http://localhost:8765")).toEqual([
			"https://sync.example/gun",
			"http://localhost:8765/gun",
		]);
		expect(() => parseGunPeerUrls("file:///tmp/gun")).toThrow("HTTP or HTTPS");
	});
});
