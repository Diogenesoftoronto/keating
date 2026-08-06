import { useEffect, useState } from "react";
import { EMPTY_CACHED_MODEL, readCachedModelSizes, type CachedModelInfo } from "../lib/model-cache";
import { BROWSER_MODELS } from "../stores/local-model";

/** Fired on `window` after a download is removed or completed. */
export const MODEL_CACHE_CHANGED_EVENT = "keating:model-cache-changed";

/** One scan shared by every row; dropped whenever the cache changes. */
let pending: Promise<Record<string, CachedModelInfo>> | null = null;

function sharedSizes(): Promise<Record<string, CachedModelInfo>> {
	pending ??= readCachedModelSizes(BROWSER_MODELS.map((model) => model.id));
	return pending;
}

/** Invalidate the shared scan and tell every mounted row to re-read it. */
export function refreshCachedModelSizes(): void {
	pending = null;
	window.dispatchEvent(new CustomEvent(MODEL_CACHE_CHANGED_EVENT));
}

/** Bytes and file count already on disk for a browser model. */
export function useCachedModelSize(modelId: string | null, enabled = true): CachedModelInfo {
	const [info, setInfo] = useState<CachedModelInfo>(EMPTY_CACHED_MODEL);

	useEffect(() => {
		if (!enabled || !modelId) {
			setInfo(EMPTY_CACHED_MODEL);
			return;
		}
		let active = true;
		const read = () => {
			sharedSizes().then((sizes) => {
				if (active) setInfo(sizes[modelId] ?? EMPTY_CACHED_MODEL);
			});
		};
		read();
		window.addEventListener(MODEL_CACHE_CHANGED_EVENT, read);
		return () => {
			active = false;
			window.removeEventListener(MODEL_CACHE_CHANGED_EVENT, read);
		};
	}, [modelId, enabled]);

	return info;
}
