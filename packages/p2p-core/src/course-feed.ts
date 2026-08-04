import b4a from "b4a";
import type Hyperbee from "hyperbee";
import type { CorestoreLike, PeerStats } from "./types.js";
import { joinSwarm, type SwarmFactory, type SwarmHandle } from "./swarm.js";

interface CourseCore {
	key: Uint8Array;
	discoveryKey: Uint8Array;
	length: number;
	ready(): Promise<void>;
}

export interface CourseFeedConfig {
	storageDir: string;
	courseId?: string;
	publicKey?: string;
	joinSwarm?: SwarmFactory;
}

/**
 * Server-authoritative Pear feed for the share-safe projection of one course.
 * The gateway is the only writer. Installed Pear clients open the public key as
 * readers, so no signing key ever leaves the server and no multiwriter forks
 * are possible.
 */
export class CourseFeed {
	private coreStore: CorestoreLike | null = null;
	private core: CourseCore | null = null;
	private bee: Hyperbee | null = null;
	private swarm: SwarmHandle | null = null;
	private writable = false;

	private constructor() {}

	static async openWriter(config: CourseFeedConfig): Promise<CourseFeed> {
		if (!config.courseId) throw new Error("CourseFeed.openWriter requires courseId.");
		return CourseFeed.open(config, { name: `keating-course-${config.courseId}` }, true);
	}

	static async openReader(config: CourseFeedConfig): Promise<CourseFeed> {
		if (!config.publicKey || !/^[0-9a-f]{64}$/i.test(config.publicKey)) {
			throw new Error("CourseFeed.openReader requires a 32-byte hex public key.");
		}
		return CourseFeed.open(config, { key: b4a.from(config.publicKey, "hex") }, false);
	}

	private static async open(
		config: CourseFeedConfig,
		coreOptions: { name: string } | { key: Uint8Array },
		writable: boolean,
	): Promise<CourseFeed> {
		const { default: Corestore } = await import("corestore");
		const store = new Corestore(config.storageDir) as unknown as CorestoreLike;
		await store.ready();
		const core = store.get(coreOptions) as unknown as CourseCore;
		await core.ready();
		const { default: HyperbeeConstructor } = await import("hyperbee");
		const bee = new HyperbeeConstructor(core as never, {
			keyEncoding: "utf-8",
			valueEncoding: "json",
		});
		await bee.ready();

		const feed = new CourseFeed();
		feed.coreStore = store;
		feed.core = core;
		feed.bee = bee;
		feed.writable = writable;
		feed.swarm = await (config.joinSwarm ?? joinSwarm)(core.discoveryKey, (socket) => {
			store.replicate(socket);
		});
		await feed.swarm.ready();
		return feed;
	}

	get publicKey(): string {
		if (!this.core) throw new Error("CourseFeed is not open.");
		return b4a.toString(this.core.key, "hex");
	}

	stats(): PeerStats {
		if (!this.core) throw new Error("CourseFeed is not open.");
		const peers = this.swarm?.peerCount ?? 0;
		return {
			topicHex: b4a.toString(this.core.discoveryKey, "hex"),
			peers,
			writableLength: this.core.length,
			connected: peers > 0,
		};
	}

	async setSnapshot(value: unknown): Promise<void> {
		if (!this.writable) throw new Error("CourseFeed reader cannot write.");
		if (!this.bee) throw new Error("CourseFeed is not open.");
		await this.bee.put("course", value);
	}

	async getSnapshot<T = unknown>(): Promise<T | null> {
		if (!this.bee) throw new Error("CourseFeed is not open.");
		await (this.bee.core as unknown as { update(): Promise<void> }).update();
		const entry = await this.bee.get("course");
		return entry?.value as T | null ?? null;
	}

	async close(): Promise<void> {
		await this.swarm?.destroy();
		this.swarm = null;
		await this.bee?.close();
		this.bee = null;
		await this.coreStore?.close();
		this.coreStore = null;
		this.core = null;
	}
}
