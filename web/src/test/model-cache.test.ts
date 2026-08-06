import { describe, expect, it } from "bun:test";
import {
	deleteCachedModel,
	isModelCacheEntry,
	readCachedModelInfo,
	readCachedModelSizes,
	type CacheStorageLike,
} from "../lib/model-cache";

/** Minimal stand-in for the Cache API, keyed by URL like the real thing. */
function fakeCaches(buckets: Record<string, Record<string, number>>): CacheStorageLike {
	const store = new Map(
		Object.entries(buckets).map(([name, entries]) => [name, new Map(Object.entries(entries))]),
	);
	return {
		has: async (name) => store.has(name),
		open: async (name) => {
			const entries = store.get(name)!;
			return {
				keys: async () => [...entries.keys()].map((url) => ({ url })),
				match: async ({ url }) => {
					const size = entries.get(url);
					return size === undefined
						? undefined
						: { headers: { get: (header: string) => (header === "content-length" ? String(size) : null) } };
				},
				delete: async ({ url }) => entries.delete(url),
			};
		},
	};
}

const MODEL = "onnx-community/gemma-4-E4B-it-ONNX";
const OTHER = "onnx-community/LFM2-1.2B-ONNX";

function hfUrl(modelId: string, file: string): string {
	return `https://huggingface.co/${modelId}/resolve/main/${file}`;
}

describe("isModelCacheEntry", () => {
	it("matches only files belonging to the repo", () => {
		expect(isModelCacheEntry(hfUrl(MODEL, "onnx/model.onnx"), MODEL)).toBe(true);
		expect(isModelCacheEntry(hfUrl(OTHER, "onnx/model.onnx"), MODEL)).toBe(false);
	});
});

describe("readCachedModelInfo", () => {
	it("sums content-length across every cache bucket", async () => {
		const storage = fakeCaches({
			"transformers-cache": {
				[hfUrl(MODEL, "onnx/model.onnx")]: 4_000_000_000,
				[hfUrl(MODEL, "config.json")]: 1_000,
				[hfUrl(OTHER, "onnx/model.onnx")]: 900_000,
			},
			"experimental_transformers-hash-cache": { [hfUrl(MODEL, "hash")]: 64 },
		});

		expect(await readCachedModelInfo(MODEL, storage)).toEqual({ bytes: 4_000_001_064, files: 3 });
	});

	it("reports nothing when the Cache API is unavailable", async () => {
		expect(await readCachedModelInfo(MODEL, null)).toEqual({ bytes: 0, files: 0 });
	});
});

describe("readCachedModelSizes", () => {
	it("buckets one pass over the cache by model", async () => {
		const storage = fakeCaches({
			"transformers-cache": {
				[hfUrl(MODEL, "onnx/model.onnx")]: 200,
				[hfUrl(OTHER, "onnx/model.onnx")]: 50,
			},
		});

		expect(await readCachedModelSizes([MODEL, OTHER, "unused/model"], storage)).toEqual({
			[MODEL]: { bytes: 200, files: 1 },
			[OTHER]: { bytes: 50, files: 1 },
			"unused/model": { bytes: 0, files: 0 },
		});
	});
});

describe("deleteCachedModel", () => {
	it("removes that model's files and leaves the rest alone", async () => {
		const storage = fakeCaches({
			"transformers-cache": {
				[hfUrl(MODEL, "onnx/model.onnx")]: 300,
				[hfUrl(MODEL, "config.json")]: 20,
				[hfUrl(OTHER, "onnx/model.onnx")]: 50,
			},
		});

		expect(await deleteCachedModel(MODEL, storage)).toEqual({ bytes: 320, files: 2 });
		expect(await readCachedModelInfo(MODEL, storage)).toEqual({ bytes: 0, files: 0 });
		expect(await readCachedModelInfo(OTHER, storage)).toEqual({ bytes: 50, files: 1 });
	});
});
