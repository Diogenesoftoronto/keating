import { type ReactNode, useEffect, useRef, useState } from "react";
import { History, Loader2, Plus, Search, X } from "lucide-react";
import type { UseSessionsResult } from "../hooks/use-sessions";
import { ForkMapCard } from "./ForkMapCard";
import type { SessionBrowserProps } from "./SessionBrowser";
import { SessionCard } from "./SessionCard";
import {
	MASONRY_GAP_PX,
	MASONRY_ROW_PX,
	pxToSpan,
} from "./session-card-visuals";

export interface SessionBrowserSheetProps extends SessionBrowserProps {
	store: UseSessionsResult;
}

function MasonryItem({
	children,
	fullWidth,
}: {
	children: ReactNode;
	fullWidth?: boolean;
}) {
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
		<div
			className="min-w-0"
			style={{ gridRow: `span ${span}`, gridColumn: fullWidth ? "1 / -1" : undefined }}
		>
			<div ref={ref} className="min-w-0">
				{children}
			</div>
		</div>
	);
}

/**
 * Mobile (< SESSION_BROWSER_BREAKPOINT) variant: full-screen card
 * sheet. Ported from SessionCardGrid.tsx (fixed inset-0 sheet, masonry
 * of SessionCard + ForkMapCard, search, New Session) — with data/search
 * from `store` instead of local state, no "Manage" button, rename and
 * delete routed through the store, and an AI-suggest action on cards.
 * Deliberately NOT role="dialog": the global mobile CSS stretches
 * dialog buttons full-width (see app.css).
 */
export function SessionBrowserSheet({
	activeSessionId,
	forkingSessionId,
	forkedSessionId,
	onLoad,
	onFork,
	onNewSession,
	onMobileClose,
	onSuggestTitle,
	store,
}: SessionBrowserSheetProps) {
	const [forkedSource, setForkedSource] = useState<string | null>(null);

	const handleFork = async (id: string) => {
		await onFork(id);
		setForkedSource(id);
		window.setTimeout(() => {
			setForkedSource((current) => (current === id ? null : current));
		}, 1800);
	};

	const cards = store.flatResults;
	const isEmpty = !store.loading && (cards ? cards.length === 0 : store.roots.length === 0);

	return (
		<>
			<div className="fixed inset-0 z-40 bg-black/40" onClick={onMobileClose} aria-hidden="true" />
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
					{onMobileClose ? (
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							aria-label="Close sessions"
							onClick={onMobileClose}
						>
							<X size={16} />
						</button>
					) : null}
				</header>

				<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
					{onNewSession ? (
						<button
							type="button"
							className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							onClick={() => {
								onNewSession();
								onMobileClose?.();
							}}
						>
							<Plus size={16} />
							New
						</button>
					) : null}
					<label className="flex min-h-10 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
						<Search size={15} className="shrink-0 text-muted-foreground" />
						<input
							className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
							value={store.query}
							placeholder="Search sessions"
							onChange={(event) => store.setQuery(event.target.value)}
						/>
					</label>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
					{store.error ? (
						<div
							className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="status"
						>
							{store.error}
						</div>
					) : null}
					{store.loading ? (
						<div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading…
						</div>
					) : isEmpty ? (
						<div className="py-12 text-center text-sm text-muted-foreground">
							{store.items.length === 0 ? "No sessions yet" : "No sessions match your search"}
						</div>
					) : (
						<div
							className="grid grid-cols-2 items-start"
							style={{ gridAutoRows: `${MASONRY_ROW_PX}px`, gap: `${MASONRY_GAP_PX}px` }}
						>
							{cards
								? cards.map((session) => (
										<MasonryItem key={session.id}>
											<SessionCard
												session={session}
												hero={store.heroes.get(session.id)}
												active={session.id === activeSessionId}
												forking={session.id === forkingSessionId}
												justForked={
													session.id === forkedSource || session.id === forkedSessionId
												}
												onLoad={onLoad}
												onFork={handleFork}
												onSuggestTitle={onSuggestTitle}
												onRename={(id, title) => store.rename(id, title)}
												onDelete={store.remove}
											/>
										</MasonryItem>
									))
								: store.roots.map((root) =>
										root.children.length > 0 ? (
										<MasonryItem key={root.session.id} fullWidth>
											<ForkMapCard
												root={root}
												activeSessionId={activeSessionId}
												forkingSessionId={forkingSessionId}
												onLoad={onLoad}
												onFork={handleFork}
												onSuggestTitle={onSuggestTitle}
												onRename={(id, title) => store.rename(id, title)}
												onDelete={store.remove}
											/>
											</MasonryItem>
										) : (
											<MasonryItem key={root.session.id}>
												<SessionCard
													session={root.session}
													hero={store.heroes.get(root.session.id)}
													active={root.session.id === activeSessionId}
													forking={root.session.id === forkingSessionId}
													justForked={
														root.session.id === forkedSource ||
														root.session.id === forkedSessionId
													}
													onLoad={onLoad}
													onFork={handleFork}
													onSuggestTitle={onSuggestTitle}
													onRename={(id, title) => store.rename(id, title)}
													onDelete={store.remove}
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
