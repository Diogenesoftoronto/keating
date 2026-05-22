import { useEffect, useMemo, useState } from "react";
import { CopyPlus, GitBranch, History, Loader2, Search } from "lucide-react";
import { sessions } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { buildSessionTree, flattenSessionTree } from "./session-tree";

interface SessionSidebarProps {
	activeSessionId?: string;
	forkingSessionId?: string | null;
	forkedSessionId?: string | null;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onOpenSessions: () => void;
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

export function SessionSidebar({
	activeSessionId,
	forkingSessionId,
	forkedSessionId,
	onLoad,
	onFork,
	onOpenSessions,
}: SessionSidebarProps) {
	const [items, setItems] = useState<SessionMetadata[]>([]);
	const [loading, setLoading] = useState(false);
	const [query, setQuery] = useState("");

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
		return flattenSessionTree(buildSessionTree(filtered)).slice(0, 40);
	}, [items, query]);

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

	return (
		<aside className="hidden w-80 shrink-0 border-r-2 border-border bg-background md:flex md:flex-col xl:w-96">
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
					<button
						type="button"
						className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border px-2 text-xs hover:bg-accent"
						onClick={onOpenSessions}
					>
						Manage
					</button>
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
					<ul className="space-y-2" aria-label="Session tree">
						{visibleItems.map(({ session, depth, children }) => {
							const active = session.id === activeSessionId;
							const forking = session.id === forkingSessionId;
							const justForked = session.id === forkedSessionId;
							return (
								<li
									key={session.id}
									className={justForked ? "session-fork-arrive" : undefined}
									style={{ marginLeft: `${Math.min(depth, 5) * 0.9}rem` }}
								>
									<div
										className={`group flex min-w-0 items-start gap-2 rounded-lg border p-3 transition-colors ${
											active
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-foreground hover:bg-muted/40"
										}`}
									>
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
												{children.length > 0 ? (
													<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
														{children.length}
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
											className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100"
											title="Fork session"
											aria-label="Fork session"
											disabled={forking}
											onClick={() => void onFork(session.id)}
										>
											{forking ? (
												<Loader2 size={12} className="animate-spin" />
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
