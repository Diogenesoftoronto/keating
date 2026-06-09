import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { History, Loader2, Plus, Search, X } from "lucide-react";
import { keatingStorage, sessions, updateSessionTitle } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { buildSessionTree, type SessionTreeNode } from "./session-tree";
import { SessionCard } from "./SessionCard";
import { ForkMapCard } from "./ForkMapCard";
import {
	type ArtifactHero,
	buildArtifactHeroMap,
	MASONRY_GAP_PX,
	MASONRY_ROW_PX,
	pxToSpan,
} from "./session-card-visuals";

export interface SessionCardGridProps {
	activeSessionId?: string;
	forkingSessionId?: string | null;
	forkedSessionId?: string | null;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onOpenSessions: () => void;
	onNewSession?: () => void;
	onClose?: () => void;
}

function notifySessionsChanged() {
	window.dispatchEvent(new Event("keating:sessions-changed"));
}

/**
 * Re-measures its child's natural height and spans the right number of 8px grid
 * rows so a CSS-grid masonry packs without gaps. Fork-map cards span both columns.
 */
function MasonryItem({ children, fullWidth }: { children: ReactNode; fullWidth?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	const [span, setSpan] = useState(20);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setSpan(pxToSpan(el.getBoundingClientRect().height));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<div className="min-w-0" style={{ gridRow: `span ${span}`, gridColumn: fullWidth ? "1 / -1" : undefined }}>
			<div ref={ref} className="min-w-0">{children}</div>
		</div>
	);
}

export function SessionCardGrid({
	activeSessionId,
	forkingSessionId,
	forkedSessionId,
	onLoad,
	onFork,
	onOpenSessions,
	onNewSession,
	onClose,
}: SessionCardGridProps) {
	const [items, setItems] = useState<SessionMetadata[]>([]);
	const [heroes, setHeroes] = useState<Map<string, ArtifactHero>>(new Map());
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [forkedSource, setForkedSource] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const reload = async () => {
			try {
				const [metadata, heroMap] = await Promise.all([
					sessions.getAllMetadata() as Promise<SessionMetadata[]>,
					buildArtifactHeroMap(keatingStorage).catch(() => new Map<string, ArtifactHero>()),
				]);
				if (cancelled) return;
				setItems(metadata);
				setHeroes(heroMap);
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void reload();
		const onChanged = () => void reload();
		window.addEventListener("keating:sessions-changed", onChanged);
		return () => {
			cancelled = true;
			window.removeEventListener("keating:sessions-changed", onChanged);
		};
	}, []);

	const normalizedQuery = query.trim().toLowerCase();

	const flatCards = useMemo(() => {
		if (!normalizedQuery) return null;
		return items
			.filter((session) =>
				[session.title, session.preview, new Date(session.lastModified).toLocaleString()]
					.some((value) => value.toLowerCase().includes(normalizedQuery)),
			)
			.sort((left, right) => right.lastModified.localeCompare(left.lastModified))
			.slice(0, 60);
	}, [items, normalizedQuery]);

	const roots: SessionTreeNode[] = useMemo(
		() => (normalizedQuery ? [] : buildSessionTree(items)),
		[items, normalizedQuery],
	);

	const handleRename = async (id: string, title: string) => {
		await updateSessionTitle(id, title);
	};
	const handleDelete = async (id: string) => {
		await sessions.deleteSession(id);
		notifySessionsChanged();
	};
	const handleFork = async (id: string) => {
		await onFork(id);
		setForkedSource(id);
		window.setTimeout(() => setForkedSource((current) => (current === id ? null : current)), 1800);
	};

	const isEmpty = !loading && (normalizedQuery ? flatCards?.length === 0 : roots.length === 0);

	return (
		<>
			<div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
			{/* Intentionally not role="dialog": a global mobile rule
			    (`[role=dialog] button { width: 100% }`) would stretch every card
			    and chrome button. The overlay is labelled for assistive tech instead. */}
			<aside
				className="session-card-grid fixed inset-0 z-50 flex flex-col bg-background"
				aria-label="Sessions"
			>
				<header className="flex items-center gap-2 border-b border-border px-4 py-3">
					<History size={16} className="shrink-0 text-foreground" />
					<h2 className="flex-1 text-base font-semibold">Sessions</h2>
					<button
						type="button"
						className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs hover:bg-accent"
						onClick={onOpenSessions}
					>
						Manage
					</button>
					{onClose ? (
						<button
							type="button"
							className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							aria-label="Close sessions"
							onClick={onClose}
						>
							<X size={16} />
						</button>
					) : null}
				</header>

				<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
					{onNewSession ? (
						<button
							type="button"
							className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							onClick={() => {
								onNewSession();
								onClose?.();
							}}
						>
							<Plus size={16} />
							New
						</button>
					) : null}
					<label className="flex min-h-9 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
						<Search size={15} className="shrink-0 text-muted-foreground" />
						<input
							className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
							value={query}
							placeholder="Search sessions"
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-3">
					{loading ? (
						<div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading…
						</div>
					) : isEmpty ? (
						<div className="py-12 text-center text-sm text-muted-foreground">
							{items.length === 0 ? "No sessions yet" : "No sessions match your search"}
						</div>
					) : (
						<div
							className="grid grid-cols-2 items-start"
							style={{ gridAutoRows: `${MASONRY_ROW_PX}px`, gap: `${MASONRY_GAP_PX}px` }}
						>
							{flatCards
								? flatCards.map((session) => (
										<MasonryItem key={session.id}>
											<SessionCard
												session={session}
												hero={heroes.get(session.id)}
												active={session.id === activeSessionId}
												forking={session.id === forkingSessionId}
												justForked={session.id === forkedSource || session.id === forkedSessionId}
												onLoad={onLoad}
												onFork={handleFork}
												onRename={handleRename}
												onDelete={handleDelete}
											/>
										</MasonryItem>
									))
								: roots.map((root) =>
										root.children.length > 0 ? (
											<MasonryItem key={root.session.id} fullWidth>
												<ForkMapCard
													root={root}
													activeSessionId={activeSessionId}
													forkingSessionId={forkingSessionId}
													onLoad={onLoad}
													onFork={handleFork}
													onRename={handleRename}
													onDelete={handleDelete}
												/>
											</MasonryItem>
										) : (
											<MasonryItem key={root.session.id}>
												<SessionCard
													session={root.session}
													hero={heroes.get(root.session.id)}
													active={root.session.id === activeSessionId}
													forking={root.session.id === forkingSessionId}
													justForked={root.session.id === forkedSource || root.session.id === forkedSessionId}
													onLoad={onLoad}
													onFork={handleFork}
													onRename={handleRename}
													onDelete={handleDelete}
												/>
											</MasonryItem>
										),
									)}
						</div>
					)}
				</div>
			</aside>
		</>
	);
}
