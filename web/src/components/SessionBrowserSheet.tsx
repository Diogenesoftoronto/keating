import { type ReactNode, useEffect, useRef, useState } from "react";
import { History, Plus, Search, X } from "lucide-react";
import { Spinner } from "./Spinner";
import { ForkMapCard } from "./ForkMapCard";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import { SessionCard } from "./SessionCard";
import {
	MASONRY_GAP_PX,
	MASONRY_ROW_PX,
	pxToSpan,
} from "./session-card-visuals";
import { css, cx } from "../../styled-system/css";

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
			className={css({ minWidth: 0 })}
			style={{ gridRow: `span ${span}`, gridColumn: fullWidth ? "1 / -1" : undefined }}
		>
			<div ref={ref} className={css({ minWidth: 0 })}>
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
 * Deliberately NOT role="dialog": the global mobile Panda rules stretch
 * dialog buttons full-width.
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
}: SessionBrowserSurfaceProps) {
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
			<div className={css({ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0, 0, 0, 0.4)" })} onClick={onMobileClose} aria-hidden="true" />
			{/* Intentionally not role="dialog": a global mobile rule
			    (`[role=dialog] button { width: 100% }`) would stretch every card
			    and chrome button. The overlay is labelled for assistive tech instead. */}
			<aside
				className={cx("session-card-grid", css({ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--background)" }))}
				aria-label="Sessions"
			>
				<header className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottom: "1px solid var(--border)", padding: "0.75rem 1rem" })}>
					<History size={16} className={css({ flexShrink: 0, color: "var(--foreground)" })} />
					<h2 className={css({ flex: 1, fontSize: "1rem", fontWeight: 600 })}>Sessions</h2>
					{onMobileClose ? (
						<button
							type="button"
							className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", border: "1px solid var(--border)", color: "var(--muted-foreground)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
							aria-label="Close sessions"
							onClick={onMobileClose}
						>
							<X size={16} />
						</button>
					) : null}
				</header>

				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottom: "1px solid var(--border)", padding: "0.625rem 1rem" })}>
					{onNewSession ? (
						<button
							type="button"
							className={css({ display: "inline-flex", height: "2.5rem", flexShrink: 0, alignItems: "center", gap: "0.375rem", borderRadius: "0.375rem", background: "var(--primary)", paddingInline: "0.75rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--primary-foreground)", _hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" } })}
							onClick={() => {
								onNewSession();
								onMobileClose?.();
							}}
						>
							<Plus size={16} />
							New
						</button>
					) : null}
					<label className={css({ display: "flex", minHeight: "2.5rem", flex: 1, alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", paddingInline: "0.75rem", fontSize: "0.875rem" })}>
						<Search size={15} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
						<input
							className={css({ minWidth: 0, flex: 1, background: "transparent", outline: "none", _placeholder: { color: "var(--muted-foreground)" } })}
							value={store.query}
							placeholder="Search sessions"
							onChange={(event) => store.setQuery(event.target.value)}
						/>
					</label>
				</div>

				<div className={css({ minHeight: 0, flex: 1, overflowY: "auto", padding: "0.75rem", paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" })}>
					{store.error ? (
						<div
							className={css({ marginBottom: "0.75rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", background: "color-mix(in srgb, var(--destructive) 5%, transparent)", padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "var(--destructive)" })}
							role="status"
						>
							{store.error}
						</div>
					) : null}
					{store.loading ? (
						<div className={css({ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", paddingBlock: "3rem", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
							<Spinner size={16} />
							Loading…
						</div>
					) : isEmpty ? (
						<div className={css({ paddingBlock: "3rem", textAlign: "center", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
							{store.items.length === 0 ? "No sessions yet" : "No sessions match your search"}
						</div>
					) : (
						<div
							className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", alignItems: "start" })}
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
