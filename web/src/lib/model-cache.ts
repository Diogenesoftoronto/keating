/**
 * Reads and clears the Cache API buckets transformers.js writes model weights
 * into. Names mirror the library defaults; we never override `env.cacheKey`,
 * and reading them here keeps the 100MB library out of the bundle for what is
 * really just a cache scan.
 */
export const TRANSFORMERS_CACHE_NAMES = [
	"transformers-cache",
	"experimental_transformers-hash-cache",
] as const;

export interface CachedModelInfo {
	/** Total of the entries' content-length headers. */
	bytes: number;
	files: number;
}

export const EMPTY_CACHED_MODEL: CachedModelInfo = { bytes: 0, files: 0 };

/** The slice of CacheStorage we use, so tests can pass a fake. */
export interface CacheStorageLike {
	has(cacheName: string): Promise<boolean>;
	open(cacheName: string): Promise<CacheLike>;
}

export interface CacheLike {
	keys(): Promise<readonly { url: string }[]>;
	match(request: { url: string }): Promise<{ headers: { get(name: string): string | null } } | undefined>;
	delete(request: { url: string }): Promise<boolean>;
}

function defaultStorage(): CacheStorageLike | null {
	// Absent in insecure contexts and in private-mode Firefox.
	return typeof caches === "undefined" ? null : (caches as unknown as CacheStorageLike);
}

/** True when a cached file URL belongs to this repo. */
export function isModelCacheEntry(url: string, modelId: string): boolean {
	return url.includes(`/${modelId}/`) || url.includes(`/${encodeURI(modelId)}/`);
}

async function eachModelEntry(
	modelId: string,
	storage: CacheStorageLike,
	visit: (cache: CacheLike, request: { url: string }) => Promise<number>,
): Promise<CachedModelInfo> {
	let bytes = 0;
	let files = 0;
	for (const name of TRANSFORMERS_CACHE_NAMES) {
		if (!(await storage.has(name))) continue;
		const cache = await storage.open(name);
		for (const request of await cache.keys()) {
			if (!isModelCacheEntry(request.url, modelId)) continue;
			bytes += await visit(cache, request);
			files += 1;
		}
	}
	return { bytes, files };
}

async function entrySize(cache: CacheLike, request: { url: string }): Promise<number> {
	const response = await cache.match(request);
	// Headers only — never read a multi-gigabyte body to measure it.
	const length = Number(response?.headers.get("content-length") ?? 0);
	return Number.isFinite(length) ? length : 0;
}

/** How much of this model is already on disk. Zero when nothing is cached. */
export async function readCachedModelInfo(
	modelId: string,
	storage: CacheStorageLike | null = defaultStorage(),
): Promise<CachedModelInfo> {
	if (!storage) return EMPTY_CACHED_MODEL;
	try {
		return await eachModelEntry(modelId, storage, entrySize);
	} catch {
		return EMPTY_CACHED_MODEL;
	}
}

/**
 * Sizes for many models in one pass. A selector row per model would otherwise
 * walk every cache key once per row.
 */
export async function readCachedModelSizes(
	modelIds: readonly string[],
	storage: CacheStorageLike | null = defaultStorage(),
): Promise<Record<string, CachedModelInfo>> {
	const sizes: Record<string, CachedModelInfo> = {};
	for (const modelId of modelIds) sizes[modelId] = { ...EMPTY_CACHED_MODEL };
	if (!storage) return sizes;
	try {
		for (const name of TRANSFORMERS_CACHE_NAMES) {
			if (!(await storage.has(name))) continue;
			const cache = await storage.open(name);
			for (const request of await cache.keys()) {
				const modelId = modelIds.find((id) => isModelCacheEntry(request.url, id));
				if (!modelId) continue;
				const entry = sizes[modelId];
				entry.bytes += await entrySize(cache, request);
				entry.files += 1;
			}
		}
	} catch {
		// A cache we cannot read reports as nothing cached.
	}
	return sizes;
}

/** Drop every cached file for this model. Returns what was freed. */
export async function deleteCachedModel(
	modelId: string,
	storage: CacheStorageLike | null = defaultStorage(),
): Promise<CachedModelInfo> {
	if (!storage) return EMPTY_CACHED_MODEL;
	try {
		return await eachModelEntry(modelId, storage, async (cache, request) => {
			const size = await entrySize(cache, request);
			await cache.delete(request);
			return size;
		});
	} catch {
		return EMPTY_CACHED_MODEL;
	}
}
