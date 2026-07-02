import { useCallback, useEffect, useMemo, useState } from "react";
import { keatingStorage, sessions, updateSessionTitle } from "./keating-storage";
import type { SessionMetadata } from "../types/session";
import { buildSessionTree, type SessionTreeNode } from "../components/session-tree";
import {
	type ArtifactHero,
	buildArtifactHeroMap,
} from "../components/session-card-visuals";

export interface UseSessionsOptions {
	/** Also load artifact hero visuals (used by the mobile card sheet). */
	withHeroes?: boolean;
	/** Cap on flat search results. Default 50. */
	flatLimit?: number;
}

export interface UseSessionsResult {
	/** All session metadata, recency-sorted (most recent first). */
	items: SessionMetadata[];
	loading: boolean;
	error: string | null;
	query: string;
	setQuery: (q: string) => void;
	/** Non-null while `query` is non-empty: flat, recency-sorted, capped. */
	flatResults: SessionMetadata[] | null;
	/** Fork-tree roots over all items (when not searching). */
	roots: SessionTreeNode[];
	/** Session id → hero visual; empty unless `withHeroes`. */
	heroes: Map<string, ArtifactHero>;
	reload: () => Promise<void>;
	/** Persist a new title (re-derives metadata, notifies listeners). */
	rename: (id: string, title: string, aiGeneratedTitle?: boolean) => Promise<void>;
	/** Delete the session and notify listeners. */
	remove: (id: string) => Promise<void>;
}

export function notifySessionsChanged() {
	window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
}

export function sortSessionsByLastModified(items: SessionMetadata[]): SessionMetadata[] {
	return [...items].sort((left, right) => {
		const byModified = right.lastModified.localeCompare(left.lastModified);
		return byModified !== 0 ? byModified : right.id.localeCompare(left.id);
	});
}

export function filterSessions(items: SessionMetadata[], query: string): SessionMetadata[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return items;
	return items.filter((session) =>
		[session.title, session.preview].some((value) =>
			value.toLowerCase().includes(normalizedQuery),
		),
	);
}

/**
 * Single source of session-list state shared by every session UI
 * (desktop panel and mobile sheet). Owns: metadata load + recency sort,
 * reload on `keating:sessions-changed`, the search filter, fork-tree
 * building, and rename/delete mutations.
 *
 * Talks only to the `sessions`/`keatingStorage` facades so it works
 * unchanged on the IndexedDB and P2P backends.
 */
export function useSessions(opts: UseSessionsOptions = {}): UseSessionsResult {
	const [items, setItems] = useState<SessionMetadata[]>([]);
	const [heroes, setHeroes] = useState<Map<string, ArtifactHero>>(new Map());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [metadata, heroMap] = await Promise.all([
				sessions.getAllMetadata() as Promise<SessionMetadata[]>,
				opts.withHeroes
					? buildArtifactHeroMap(keatingStorage).catch(
							() => new Map<string, ArtifactHero>(),
						)
					: Promise.resolve(new Map<string, ArtifactHero>()),
			]);
			setItems(sortSessionsByLastModified(metadata));
			setHeroes(heroMap);
		} catch (loadError) {
			setError(
				loadError instanceof Error ? loadError.message : "Failed to load sessions",
			);
			setItems([]);
			setHeroes(new Map());
		} finally {
			setLoading(false);
		}
	}, [opts.withHeroes]);

	useEffect(() => {
		let cancelled = false;
		const runReload = async () => {
			setLoading(true);
			setError(null);
			try {
				const [metadata, heroMap] = await Promise.all([
					sessions.getAllMetadata() as Promise<SessionMetadata[]>,
					opts.withHeroes
						? buildArtifactHeroMap(keatingStorage).catch(
								() => new Map<string, ArtifactHero>(),
							)
						: Promise.resolve(new Map<string, ArtifactHero>()),
				]);
				if (cancelled) return;
				setItems(sortSessionsByLastModified(metadata));
				setHeroes(heroMap);
			} catch (loadError) {
				if (cancelled) return;
				setError(
					loadError instanceof Error ? loadError.message : "Failed to load sessions",
				);
				setItems([]);
				setHeroes(new Map());
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void runReload();
		const onChanged = () => void runReload();
		window.addEventListener("keating:sessions-changed", onChanged);
		return () => {
			cancelled = true;
			window.removeEventListener("keating:sessions-changed", onChanged);
		};
	}, [opts.withHeroes]);

	const filtered = useMemo(() => filterSessions(items, query), [items, query]);
	const flatResults = useMemo(() => {
		if (!query.trim()) return null;
		return filtered.slice(0, opts.flatLimit ?? 50);
	}, [filtered, opts.flatLimit, query]);
	const roots = useMemo(() => buildSessionTree(items), [items]);

	const rename = useCallback(
		async (id: string, title: string, aiGeneratedTitle?: boolean) => {
			await updateSessionTitle(id, title, aiGeneratedTitle);
		},
		[],
	);

	const remove = useCallback(async (id: string) => {
		await sessions.deleteSession(id);
		notifySessionsChanged();
	}, []);

	return {
		items,
		loading,
		error,
		query,
		setQuery,
		flatResults,
		roots,
		heroes,
		reload,
		rename,
		remove,
	};
}
