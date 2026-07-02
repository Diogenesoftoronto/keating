import b4a from "b4a";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import type { Topic } from "./types.js";

/**
 * Deterministically derive a 32-byte swarm topic from a per-user secret.
 *
 * Must be a one-way hash so the on-the-wire topic never reveals the secret, and
 * stable so every device of the same user derives the identical topic.
 */
export function deriveTopic(userSecret: Uint8Array): Topic {
	if (!(userSecret instanceof Uint8Array)) {
		throw new TypeError("deriveTopic: userSecret must be a Uint8Array");
	}
	const hash = createHash("sha256");
	hash.update(b4a.from("keating:p2p:topic:v1"));
	hash.update(userSecret);
	return new Uint8Array(hash.digest());
}

export interface SwarmHandle {
	/** Number of currently connected peers. */
	readonly peerCount: number;
	/** Resolves once flushed/announced on the DHT. */
	ready(): Promise<void>;
	/** Tear down all connections and leave the topic. */
	destroy(): Promise<void>;
	/** Subscribe to peer-count changes. Returns an unsubscribe fn. */
	onPeerChange(listener: (count: number) => void): () => void;
}

/**
 * A factory that joins `topic` and pipes each peer connection into `replicate`.
 *
 * This is the seam that makes the writer transport-agnostic:
 *  - Node/desktop/seeder use {@link joinSwarm} (real `hyperswarm`: DHT + UDP
 *    hole-punching).
 *  - The browser injects a relay-based factory (`hyperswarm-web` /
 *    `@hyperswarm/dht-relay` over WebSocket) because raw UDP/DHT is unavailable
 *    there.
 */
export type SwarmFactory = (
	topic: Topic,
	replicate: (socket: Duplex) => void,
) => SwarmHandle | Promise<SwarmHandle>;

/** Minimal structural surface of a Hyperswarm instance the join wiring needs. */
interface HyperswarmLike {
	connections: { size: number };
	destroyed: boolean;
	join(
		topic: Uint8Array,
		opts?: { server?: boolean; client?: boolean },
	): { flushed(): Promise<void> };
	destroy(): Promise<void>;
	on(event: "connection", listener: (conn: Duplex) => void): unknown;
	on(event: "update", listener: () => void): unknown;
}

/**
 * Wire an already-constructed Hyperswarm-like instance to `replicate` and join
 * `topic`. Shared by the Node default and any injected transport that produces
 * a Hyperswarm-compatible object.
 */
export function wireSwarm(
	swarm: HyperswarmLike,
	topic: Topic,
	replicate: (socket: Duplex) => void,
): SwarmHandle {
	const listeners = new Set<(count: number) => void>();

	const notify = () => {
		const count = swarm.connections.size;
		for (const l of listeners) {
			try {
				l(count);
			} catch {
				// swallow listener errors
			}
		}
	};

	swarm.on("connection", (conn: Duplex) => {
		replicate(conn);
		notify();
		const onDone = () => notify();
		conn.once("close", onDone);
		conn.once("error", onDone);
	});
	swarm.on("update", notify);

	const discovery = swarm.join(topic, { server: true, client: true });

	const handle: SwarmHandle = {
		get peerCount(): number {
			return swarm.connections.size;
		},
		async ready(): Promise<void> {
			await discovery.flushed();
		},
		async destroy(): Promise<void> {
			if (swarm.destroyed) return;
			await swarm.destroy();
		},
		onPeerChange(listener: (count: number) => void): () => void {
			listeners.add(listener);
			try {
				listener(swarm.connections.size);
			} catch {
				// swallow listener errors
			}
			return () => {
				listeners.delete(listener);
			};
		},
	};

	return handle;
}

/**
 * Default Node/desktop/seeder transport: join `topic` on a real `hyperswarm`
 * instance and pipe every peer connection into `replicate` (a
 * `Corestore.replicate(socket)` call from store.ts).
 *
 * `hyperswarm` is imported dynamically so browser bundles that inject their own
 * {@link SwarmFactory} never pull the Node-only dependency into the graph.
 */
export async function joinSwarm(
	topic: Topic,
	replicate: (socket: Duplex) => void,
): Promise<SwarmHandle> {
	const { default: Hyperswarm } = await import("hyperswarm");
	const swarm = new Hyperswarm() as unknown as HyperswarmLike;
	return wireSwarm(swarm, topic, replicate);
}
