import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Check,
	ChevronDown,
	ChevronRight,
	CopyPlus,
	GitBranch,
	History,
	Loader2,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Search,
} from "lucide-react";
import { sessions } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { buildSessionTree, flattenSessionTree } from "./session-tree";

const TREE_COLLAPSED_STORAGE_KEY = "keating:session-tree-collapsed";
const MD_BREAKPOINT = 768;

interface SessionSidebarProps {
	activeSessionId?: string;
	forkingSessionId?: string | null;
	forkedSessionId?: string | null;
	collapsed?: boolean;
	onCollapsedChange?: (next: boolean) => void;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onOpenSessions: () => void;
	mobileOpen?: boolean;
	onMobileClose?: () => void;
	onNewSession?: () => void;
}

function formatDate(isoString: string) {
	const date = new Date(isoString);
	const now = new Date();
	const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days}d ago`;
	return date.toLocaleDateString();
}

function readCollapsedTreeNodes(): Set<string> {
	if (typeof localStorage === "undefined") return new Set();
	try {
		const raw = localStorage.getItem(TREE_COLLAPSED_STORAGE_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((value): value is string => typeof value === "string"));
	} catch {
		return new Set();
	}
}

function writeCollapsedTreeNodes(set: ReadonlySet<string>) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(TREE_COLLAPSED_STORAGE_KEY, JSON.stringify([...set]));
	} catch {
		// localStorage may be full or blocked; ignore.
	}
}

export function SessionSidebar({
	activeSessionId,
	forkingSessionId,
	forkedSessionId,
	collapsed = false,
	onCollapsedChange,
	onLoad,
	onFork,
	onOpenSessions,
	mobileOpen = false,
	onMobileClose,
	onNewSession,
}: SessionSidebarProps) {
	const [items, setItems] = useState<SessionMetadata[]>([]);
	const [loading, setLoading] = useState(false);
	const [query, setQuery] = useState("");
	const [forkedSourceSessionId, setForkedSourceSessionId] = useState<string | null>(null);
	const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => readCollapsedTreeNodes());
	const [isDesktop, setIsDesktop] = useState(() =>
		typeof window !== "undefined"
			? window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`).matches
			: true,
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mq = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`);
		const sync = () => setIsDesktop(mq.matches);
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);

	const isSearching = query.trim().length > 0;

	const visibleItems = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const filtered = items.filter((session) => {
			if (!normalizedQuery) return true;
			return [session.title, session.preview, formatDate(session.lastModified)]
				.some((value) => value.toLowerCase().includes(normalizedQuery));
		});
		if (normalizedQuery) {
			return filtered
				.map((session) => ({ session, children: [], depth: 0 }))
				.sort((left, right) => right.session.lastModified.localeCompare(left.session.lastModified))
				.slice(0, 40);
		}
		return flattenSessionTree(buildSessionTree(filtered), collapsedNodes).slice(0, 80);
	}, [items, query, collapsedNodes]);

	const reload = async () => {
		setLoading(true);
		try {
			setItems((await sessions.getAllMetadata()) as SessionMetadata[]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void reload();
		const onChanged = () => void reload();
		window.addEventListener("keating:sessions-changed", onChanged);
		return () => window.removeEventListener("keating:sessions-changed", onChanged);
	}, []);

	const toggleNode = useCallback((sessionId: string) => {
		setCollapsedNodes((current) => {
			const next = new Set(current);
			if (next.has(sessionId)) {
				next.delete(sessionId);
			} else {
				next.add(sessionId);
			}
			writeCollapsedTreeNodes(next);
			return next;
		});
	}, []);

	const forkSession = async (sessionId: string) => {
		await onFork(sessionId);
		setForkedSourceSessionId(sessionId);
		window.setTimeout(() => {
			setForkedSourceSessionId((current) => current === sessionId ? null : current);
		}, 1800);
	};

	/* ── Mobile drawer ── */
	if (!isDesktop) {
		if (!mobileOpen) return null;
		return (
			<>
				<div
					className="fixed inset-0 z-40 bg-black/45"
					onClick={onMobileClose}
					aria-hidden="true"
				/>
				<aside className="session-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(22rem,85vw)] flex-col border-r-2 border-border bg-background">
					<header className="border-b border-border px-4 py-4">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="flex items-center gap-2 text-sm font-semibold">
									<History size={15} />
									Sessions
								</div>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									Search, fork, rename, or load a previous conversation
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<button
									type="button"
									className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border px-2 text-xs hover:bg-accent"
									onClick={onOpenSessions}
								>
									Manage
								</button>
								{onMobileClose ? (
									<button
										type="button"
										className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
										title="Close sessions panel"
										aria-label="Close sessions panel"
										onClick={onMobileClose}
									>
										<PanelLeftClose size={14} />
									</button>
								) : null}
							</div>
						</div>
						<label className="mt-3 flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs">
							<Search size={14} className="shrink-0 text-muted-foreground" />
							<input
								className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted-foreground"
								value={query}
								placeholder="Search sessions"
								onChange={(event) => setQuery(event.target.value)}
							/>
						</label>
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto p-3">
						{loading && items.length === 0 ? (
							<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
								<Loader2 size={14} className="animate-spin" />
								Loading
							</div>
						) : visibleItems.length === 0 ? (
							<div className="px-2 py-8 text-center text-xs text-muted-foreground">
								No sessions yet
							</div>
						) : (
							<ul className="space-y-2" role="tree" aria-label="Session tree">
								{visibleItems.map(({ session, depth, children }) => {
									const active = session.id === activeSessionId;
									const forking = session.id === forkingSessionId;
									const justForkedSource = session.id === forkedSourceSessionId;
									const justForked = session.id === forkedSessionId;
									const hasChildren = children.length > 0;
									const expanded = hasChildren && !collapsedNodes.has(session.id);
									const showToggle = hasChildren && !isSearching;
									return (
										<li
											key={session.id}
											role="treeitem"
											aria-level={depth + 1}
											aria-expanded={hasChildren ? expanded : undefined}
											className={justForked ? "session-fork-arrive" : undefined}
											style={{ marginLeft: `${Math.min(depth, 5) * 0.9}rem` }}
										>
											<div
												className={`group flex min-w-0 items-start gap-1 rounded-lg border p-3 transition-colors ${
													active
														? "border-primary bg-primary/10 text-primary"
														: "border-border text-foreground hover:bg-muted/40"
												}`}
											>
												{showToggle ? (
													<button
														type="button"
														className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
														title={expanded ? "Collapse forks" : "Expand forks"}
														aria-label={expanded ? `Collapse ${children.length} fork${children.length === 1 ? "" : "s"}` : `Expand ${children.length} fork${children.length === 1 ? "" : "s"}`}
														onClick={() => toggleNode(session.id)}
													>
														{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
													</button>
												) : (
													<span aria-hidden="true" className="mt-0.5 inline-block h-5 w-5 shrink-0" />
												)}
												<button
													type="button"
													className="min-w-0 flex-1 text-left"
													onClick={() => void onLoad(session.id)}
												>
													<div className="flex min-w-0 items-center gap-2">
														{session.parentSessionId ? (
															<GitBranch size={13} className="shrink-0 text-primary" />
														) : null}
														<span className="truncate text-sm font-medium">{session.title}</span>
														{hasChildren ? (
															<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
																{children.length}
															</span>
														) : null}
														{justForkedSource ? (
															<span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
																Forked
															</span>
														) : null}
													</div>
													<p className="mt-2 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
														{session.preview || "No preview saved"}
														</p>
													<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
														<span>{session.parentSessionId ? "Fork | " : ""}{formatDate(session.lastModified)}</span>
														<span aria-hidden="true">|</span>
														<span>{session.messageCount} messages</span>
													</div>
												</button>
												<button
													type="button"
													className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 group-hover:opacity-100 ${
														justForkedSource ? "text-primary opacity-100" : "opacity-0"
													}`}
														title={justForkedSource ? "Session forked" : "Fork session"}
														aria-label={justForkedSource ? "Session forked" : "Fork session"}
														disabled={forking}
														onClick={() => void forkSession(session.id)}
													>
														{forking ? (
															<Loader2 size={12} className="animate-spin" />
														) : justForkedSource ? (
															<Check size={12} />
														) : (
															<CopyPlus size={12} />
														)}
													</button>
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</aside>
			</>
		);
	}

	/* ── Desktop collapsed strip ── */
	if (collapsed) {
		return (
			<aside className="session-sidebar flex w-14 shrink-0 flex-col items-center gap-3 border-r-2 border-border bg-background py-3">
				<button
					type="button"
					className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground"
					title="Expand sessions panel"
					aria-label="Expand sessions panel"
					onClick={() => onCollapsedChange?.(false)}
				>
					<PanelLeftOpen size={16} />
				</button>
				<div className="my-1 h-px w-8 bg-border" />
				{onNewSession ? (
					<button
						type="button"
						className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground"
						title="New session"
						aria-label="New session"
						onClick={onNewSession}
					>
						<Plus size={16} />
					</button>
				) : null}
			</aside>
		);
	}

	/* ── Desktop expanded sidebar ── */
	return (
		<aside className="session-sidebar flex w-80 shrink-0 flex-col border-r-2 border-border bg-background xl:w-96">
			<header className="border-b border-border px-4 py-4">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-sm font-semibold">
							<History size={15} />
							Sessions
						</div>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							Search, fork, rename, or load a previous conversation
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border px-2 text-xs hover:bg-accent"
							onClick={onOpenSessions}
						>
							Manage
						</button>
						{onCollapsedChange ? (
							<button
								type="button"
								className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								title="Collapse sessions panel"
								aria-label="Collapse sessions panel"
								onClick={() => onCollapsedChange(true)}
							>
								<PanelLeftClose size={14} />
							</button>
						) : null}
					</div>
				</div>
				<label className="mt-3 flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs">
					<Search size={14} className="shrink-0 text-muted-foreground" />
					<input
						className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted-foreground"
						value={query}
						placeholder="Search sessions"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{loading && items.length === 0 ? (
					<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
						<Loader2 size={14} className="animate-spin" />
						Loading
					</div>
				) : visibleItems.length === 0 ? (
					<div className="px-2 py-8 text-center text-xs text-muted-foreground">
						No sessions yet
					</div>
				) : (
					<ul
						className="space-y-2"
						role="tree"
						aria-label="Session tree"
					>
						{visibleItems.map(({ session, depth, children }) => {
							const active = session.id === activeSessionId;
							const forking = session.id === forkingSessionId;
							const justForkedSource = session.id === forkedSourceSessionId;
							const justForked = session.id === forkedSessionId;
							const hasChildren = children.length > 0;
							const expanded = hasChildren && !collapsedNodes.has(session.id);
							const showToggle = hasChildren && !isSearching;
							return (
								<li
									key={session.id}
									role="treeitem"
									aria-level={depth + 1}
									aria-expanded={hasChildren ? expanded : undefined}
									className={justForked ? "session-fork-arrive" : undefined}
									style={{ marginLeft: `${Math.min(depth, 5) * 0.9}rem` }}
								>
									<div
										className={`group flex min-w-0 items-start gap-1 rounded-lg border p-3 transition-colors ${
											active
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-foreground hover:bg-muted/40"
										}`}
									>
										{showToggle ? (
											<button
												type="button"
												className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
												title={expanded ? "Collapse forks" : "Expand forks"}
												aria-label={expanded ? `Collapse ${children.length} fork${children.length === 1 ? "" : "s"}` : `Expand ${children.length} fork${children.length === 1 ? "" : "s"}`}
												onClick={() => toggleNode(session.id)}
											>
												{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
											</button>
										) : (
											<span aria-hidden="true" className="mt-0.5 inline-block h-5 w-5 shrink-0" />
										)}
										<button
											type="button"
											className="min-w-0 flex-1 text-left"
											onClick={() => void onLoad(session.id)}
										>
											<div className="flex min-w-0 items-center gap-2">
												{session.parentSessionId ? (
													<GitBranch size={13} className="shrink-0 text-primary" />
												) : null}
												<span className="truncate text-sm font-medium">{session.title}</span>
												{hasChildren ? (
													<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
														{children.length}
													</span>
												) : null}
												{justForkedSource ? (
													<span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
														Forked
													</span>
												) : null}
											</div>
											<p className="mt-2 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
												{session.preview || "No preview saved"}
											</p>
											<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
												<span>{session.parentSessionId ? "Fork | " : ""}{formatDate(session.lastModified)}</span>
												<span aria-hidden="true">|</span>
												<span>{session.messageCount} messages</span>
											</div>
										</button>
										<button
											type="button"
											className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 md:group-hover:opacity-100 ${
												justForkedSource ? "text-primary md:opacity-100" : "md:opacity-0"
											}`}
											title={justForkedSource ? "Session forked" : "Fork session"}
											aria-label={justForkedSource ? "Session forked" : "Fork session"}
											disabled={forking}
											onClick={() => void forkSession(session.id)}
										>
											{forking ? (
												<Loader2 size={12} className="animate-spin" />
											) : justForkedSource ? (
												<Check size={12} />
											) : (
												<CopyPlus size={12} />
											)}
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</aside>
	);
}
