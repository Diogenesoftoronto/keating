import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { P2PStore } from "../src/store.js";
import { deriveTopic } from "../src/swarm.js";
import type { SwarmFactory, SwarmHandle } from "../src/swarm.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

async function tempP2PDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function noopSwarmHandle(): SwarmHandle {
	return {
		peerCount: 0,
		async ready() {},
		async destroy() {},
		onPeerChange() {
			return () => {};
		},
	};
}

const joinNoopSwarm: SwarmFactory = () => noopSwarmHandle();

async function canLoadNativeStorage(): Promise<boolean> {
	try {
		await import("hyperbee");
		await import("corestore");
		return true;
	} catch {
		return false;
	}
}

const nativeStorageTest = (await canLoadNativeStorage()) ? test : test.skip;

function writerKeyHex(store: P2PStore): string {
	const bee = (store as unknown as {
		bee: { core: { key: Uint8Array } };
	}).bee;
	return Buffer.from(bee.core.key).toString("hex");
}

describe("deriveTopic", () => {
	test("is deterministic for the same secret", () => {
		const secret = new Uint8Array(32).fill(7);
		expect(Buffer.from(deriveTopic(secret)).toString("hex")).toBe(
			Buffer.from(deriveTopic(secret)).toString("hex"),
		);
	});
});

describe("P2PStore", () => {
	nativeStorageTest("does not derive every device writer from the shared user secret", async () => {
		const userSecret = new Uint8Array(32).fill(11);
		const left = await P2PStore.open({
			storageDir: await tempP2PDir("keating-p2p-left-"),
			userSecret,
			label: "left",
			joinSwarm: joinNoopSwarm,
		});
		const right = await P2PStore.open({
			storageDir: await tempP2PDir("keating-p2p-right-"),
			userSecret,
			label: "right",
			joinSwarm: joinNoopSwarm,
		});

		try {
			expect(left.stats().topicHex).toBe(right.stats().topicHex);
			expect(writerKeyHex(left)).not.toBe(writerKeyHex(right));
		} finally {
			await Promise.all([left.close(), right.close()]);
		}
	}, 15_000);

	nativeStorageTest("keeps one device's writer durable across restarts", async () => {
		const userSecret = new Uint8Array(32).fill(12);
		const storageDir = await tempP2PDir("keating-p2p-durable-");
		const first = await P2PStore.open({
			storageDir,
			userSecret,
			label: "first-open",
			joinSwarm: joinNoopSwarm,
		});
		const firstKey = writerKeyHex(first);
		await first.close();

		const second = await P2PStore.open({
			storageDir,
			userSecret,
			label: "second-open",
			joinSwarm: joinNoopSwarm,
		});
		try {
			expect(writerKeyHex(second)).toBe(firstKey);
		} finally {
			await second.close();
		}
	}, 15_000);
});
