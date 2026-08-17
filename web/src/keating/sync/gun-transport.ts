import type {
	EncryptedSyncPayloadKind,
	LearnerSyncChunk,
	LearnerSyncLatestPointer,
	LearnerSyncManifest,
	LearnerSyncTransport,
} from "./contracts";
import { LearnerSyncError } from "./learner-sync";

interface GunAck {
	err?: string;
}

export interface GunSyncNode {
	get(key: string): GunSyncNode;
	put(value: string, callback?: (ack: GunAck) => void): GunSyncNode;
	on(callback: (value: unknown) => void): GunSyncNode;
	once(callback: (value: unknown) => void, options?: { wait?: number }): GunSyncNode;
	off(): GunSyncNode;
}

export interface GunLearnerSyncTransportOptions {
	gun: GunSyncNode;
	ackTimeoutMs?: number;
	readTimeoutMs?: number;
	readWaitMs?: number;
}

const ROOT_KEY = "keating-encrypted-sync-v1";

function validSegment(value: string): boolean {
	return Boolean(value) && value.length <= 512 && !value.includes("\0");
}

function parseRecord<T>(value: unknown, description: string): T | null {
	if (value == null) return null;
	if (typeof value !== "string") {
		throw new LearnerSyncError(`GUN ${description} record is not encoded text.`);
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new LearnerSyncError(`GUN ${description} record is invalid JSON.`);
	}
}

export class GunLearnerSyncTransport implements LearnerSyncTransport {
	private readonly root: GunSyncNode;
	private readonly ackTimeoutMs: number;
	private readonly readTimeoutMs: number;
	private readonly readWaitMs: number;

	constructor(options: GunLearnerSyncTransportOptions) {
		this.root = options.gun.get(ROOT_KEY);
		this.ackTimeoutMs = options.ackTimeoutMs ?? 10_000;
		this.readTimeoutMs = options.readTimeoutMs ?? 12_000;
		this.readWaitMs = options.readWaitMs ?? 600;
	}

	private namespace(namespace: string): GunSyncNode {
		if (!validSegment(namespace)) throw new LearnerSyncError("GUN sync namespace is invalid.");
		return this.root.get("accounts").get(namespace);
	}

	private snapshot(namespace: string, snapshotId: string): GunSyncNode {
		if (!validSegment(snapshotId)) throw new LearnerSyncError("GUN sync snapshot ID is invalid.");
		return this.namespace(namespace).get("snapshots").get(snapshotId);
	}

	private async put(node: GunSyncNode, value: unknown, description: string): Promise<void> {
		const encoded = JSON.stringify(value);
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new LearnerSyncError(`GUN ${description} write timed out.`)), this.ackTimeoutMs);
			node.put(encoded, (ack) => {
				clearTimeout(timeout);
				if (ack?.err) reject(new LearnerSyncError(`GUN ${description} write failed: ${ack.err}`));
				else resolve();
			});
		});
	}

	private async once<T>(node: GunSyncNode, description: string): Promise<T | null> {
		return new Promise<T | null>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new LearnerSyncError(`GUN ${description} read timed out.`)), this.readTimeoutMs);
			node.once((value) => {
				clearTimeout(timeout);
				try {
					resolve(parseRecord<T>(value, description));
				} catch (error) {
					reject(error);
				}
			}, { wait: this.readWaitMs });
		});
	}

	async putManifest(manifest: LearnerSyncManifest): Promise<void> {
		await this.put(this.snapshot(manifest.namespace, manifest.snapshotId).get("manifest"), manifest, "manifest");
	}

	async putChunk(chunk: LearnerSyncChunk): Promise<void> {
		await this.put(this.snapshot(chunk.namespace, chunk.snapshotId).get("chunks").get(String(chunk.index)), chunk, "chunk");
	}

	async getManifest(namespace: string, snapshotId: string): Promise<LearnerSyncManifest | null> {
		return this.once(this.snapshot(namespace, snapshotId).get("manifest"), "manifest");
	}

	async getChunk(namespace: string, snapshotId: string, index: number): Promise<LearnerSyncChunk | null> {
		if (!Number.isInteger(index) || index < 0) throw new LearnerSyncError("GUN sync chunk index is invalid.");
		return this.once(this.snapshot(namespace, snapshotId).get("chunks").get(String(index)), "chunk");
	}

	async putLatest(pointer: LearnerSyncLatestPointer): Promise<void> {
		await this.put(this.namespace(pointer.namespace).get("latest").get(pointer.payloadKind), pointer, "latest pointer");
	}

	async getLatest(namespace: string, payloadKind: EncryptedSyncPayloadKind): Promise<LearnerSyncLatestPointer | null> {
		return this.once(this.namespace(namespace).get("latest").get(payloadKind), "latest pointer");
	}

	subscribeLatest(
		namespace: string,
		payloadKind: EncryptedSyncPayloadKind,
		listener: (pointer: LearnerSyncLatestPointer) => void,
	): () => void {
		const node = this.namespace(namespace).get("latest").get(payloadKind);
		let active = true;
		let lastSnapshotId: string | null = null;
		node.on((value) => {
			if (!active) return;
			try {
				const pointer = parseRecord<LearnerSyncLatestPointer>(value, "latest pointer");
				if (!pointer || pointer.snapshotId === lastSnapshotId) return;
				lastSnapshotId = pointer.snapshotId;
				listener(pointer);
			} catch {
				// Ignore malformed peer data; authenticated decryption and manifest
				// validation remain the authority when the snapshot is loaded.
			}
		});
		return () => {
			active = false;
			node.off();
		};
	}
}

export function parseGunPeerUrls(value: string | undefined): string[] {
	if (!value?.trim()) return [];
	const peers = value.split(",").map((peer) => peer.trim()).filter(Boolean).map((peer) => {
		let url: URL;
		try {
			url = new URL(peer);
		} catch {
			throw new LearnerSyncError(`Invalid GUN relay URL: ${peer}`);
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			throw new LearnerSyncError(`GUN relay must use HTTP or HTTPS: ${peer}`);
		}
		if (url.pathname === "/") url.pathname = "/gun";
		url.hash = "";
		return url.toString().replace(/\/$/u, "");
	});
	return [...new Set(peers)];
}

export async function createBrowserGunLearnerSyncTransport(options: {
	peers: string[];
	databaseName?: string;
	ackTimeoutMs?: number;
	readTimeoutMs?: number;
}): Promise<GunLearnerSyncTransport> {
	if (typeof window === "undefined") {
		throw new LearnerSyncError("The browser GUN transport requires a browser environment.");
	}
	if (options.peers.length === 0) {
		throw new LearnerSyncError("At least one durable GUN relay is required for cross-device sync.");
	}
	if (typeof indexedDB !== "undefined") await import("gun/lib/rindexed.js");
	const { default: Gun } = await import("gun");
	const gun = Gun({
		peers: options.peers,
		file: options.databaseName ?? "keating-encrypted-sync",
		localStorage: false,
	} as never);
	return new GunLearnerSyncTransport({
		gun: gun as unknown as GunSyncNode,
		ackTimeoutMs: options.ackTimeoutMs,
		readTimeoutMs: options.readTimeoutMs,
	});
}
