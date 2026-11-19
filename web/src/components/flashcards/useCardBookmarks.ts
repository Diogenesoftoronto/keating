import { useCallback, useState } from "react";
const BOOKMARK_KEY = "keating:card-bookmarks";


function loadBookmarkIds(): Set<string> {
	try {
		const raw = localStorage.getItem(BOOKMARK_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((s): s is string => typeof s === "string"));
	} catch {
		return new Set();
	}
}

function saveBookmarkIds(ids: Set<string>) {
	try {
		localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...ids]));
	} catch {
		/* ignore */
	}
}

export function useCardBookmarks() {
	const [bookmarkIds,setBookmarkIds] = useState(loadBookmarkIds);
	const toggleBookmark = useCallback((cardId: string) => {
		setBookmarkIds((previous) => {
			const next = new Set(previous);
			if (next.has(cardId)) next.delete(cardId);
			else next.add(cardId);
			saveBookmarkIds(next);
			return next;
		});
	}, []);

	return [bookmarkIds,toggleBookmark] as const;
}
