// Ambient module declarations for libraries without @types packages.
// These are intentionally narrow — only the surface area we use.

declare module "hyperswarm" {
	import type { Duplex } from "node:stream";
	import type { EventEmitter } from "node:events";
	interface PeerDiscoverySession {
		flushed(): Promise<void>;
		destroy(): Promise<void>;
	}
	class Hyperswarm extends EventEmitter {
		connections: Set<Duplex>;
		destroyed: boolean;
		constructor(opts?: { keyPair?: unknown });
		join(topic: Uint8Array, opts?: { server?: boolean; client?: boolean; limit?: number }): PeerDiscoverySession;
		leave(topic: Uint8Array): Promise<void>;
		destroy(opts?: { force?: boolean }): Promise<void>;
		listen(): Promise<void>;
		flush(): Promise<boolean>;
		on(event: "connection", listener: (conn: Duplex, peerInfo?: unknown) => void): this;
		on(event: "update", listener: () => void): this;
		off(event: string, listener: (...args: unknown[]) => void): this;
		once(event: string, listener: (...args: unknown[]) => void): this;
	}
	export default Hyperswarm;
}

declare module "hyperbee" {
	class Hyperbee {
		readonly core: {
			length: number;
			writable: boolean;
			readonly: boolean;
		};
		readonly keyEncoding: string | unknown;
		readonly valueEncoding: string | unknown;
		readonly opened: boolean;
		readonly closing: boolean;
		readonly readonly: boolean;
		constructor(
			core: unknown,
			opts?: { keyEncoding?: string; valueEncoding?: string },
		);
		ready(): Promise<void>;
		put(key: string, value: unknown): Promise<unknown>;
		del(key: string): Promise<unknown>;
		get(key: string): Promise<{ key: string; value: unknown } | null>;
		batch(): Batch;
		createReadStream(opts?: { gte?: string; lt?: string; gt?: string; lte?: string }): NodeJS.ReadableStream & AsyncIterable<{ key: string; value: unknown }>;
		close(): Promise<void>;
	}
	class Batch {
		put(key: string, value: unknown): Promise<unknown>;
		del(key: string): Promise<unknown>;
		flush(): Promise<void>;
	}
	export default Hyperbee;
}

declare module "corestore" {
	class Corestore {
		readonly directory: string | null;
		constructor(directory?: string | null);
		namespace(name: string, opts?: unknown): {
			get(opts: { name?: string; key?: Uint8Array }): {
				ready(): Promise<void>;
				length: number;
			};
		};
		replicate(socket: unknown): unknown;
		ready(): Promise<void>;
		close(): Promise<void>;
	}
	export default Corestore;
}

declare module "b4a" {
	export function from(input: string | Uint8Array | ArrayLike<number>, encoding?: string): Uint8Array;
	export function toString(input: Uint8Array | ArrayLike<number>, encoding?: string): string;
	export function equals(a: Uint8Array | ArrayLike<number>, b: Uint8Array | ArrayLike<number>): boolean;
	export function alloc(size: number): Uint8Array;
	export function compare(a: Uint8Array | ArrayLike<number>, b: Uint8Array | ArrayLike<number>): number;
	const _default: {
		from: typeof from;
		toString: typeof toString;
		equals: typeof equals;
		alloc: typeof alloc;
		compare: typeof compare;
	};
	export default _default;
}
