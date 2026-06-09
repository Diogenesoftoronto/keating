import { useEffect, useMemo, useState } from "react";
import { Check, CopyPlus, GitBranch, Loader2, Pencil, Search, Sparkles, Trash2, X } from "lucide-react";
import { sessions, updateSessionTitle } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import { buildSessionTree, flattenSessionTree } from "./session-tree";

export interface SessionManagerDialogProps {
	open: boolean;
	onClose: () => void;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork?: (sessionId: string) => void | Promise<void>;
	onSuggestTitle?: (sessionId: string) => Promise<string>;
	onDeleted?: (sessionId: string) => void | Promise<void>;
	onRenamed?: (sessionId: string, title: string) => void | Promise<void>;
}

function formatUsage(usage: SessionMetadata["usage"]) {
	const tokens = usage.totalTokens.toLocaleString();
	const cost = usage.cost.total > 0 ? ` | $${usage.cost.total.toFixed(4)}` : "";
	return `${tokens} tokens${cost}`;
}

function formatDate(isoString: string) {
	const date = new Date(isoString);
	const now = new Date();
	const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days} days ago`;
	return date.toLocaleDateString();
}

export function SessionManagerDialog({
	open,
	onClose,
	onLoad,
	onFork,
	onSuggestTitle,
	onDeleted,
	onRenamed,
}: SessionManagerDialogProps) {
	const [items, setItems] = useState<SessionMetadata[]>([]);
	const [loading, setLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const [query, setQuery] = useState("");
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
	const [busySessionId, setBusySessionId] = useState<string | null>(null);
	const [forkedSourceSessionId, setForkedSourceSessionId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [aiSuggestionForSessionId, setAiSuggestionForSessionId] = useState<string | null>(null);
	const [isSidePanel, setIsSidePanel] = useState(false);

	const sortedItems = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const filtered = items
			.filter((session) => {
				if (!normalizedQuery) return true;
				return [
					session.title,
					session.preview,
					new Date(session.lastModified).toLocaleString(),
					String(session.messageCount),
				].some((value) => value.toLowerCase().includes(normalizedQuery));
			});
		if (normalizedQuery) {
			return filtered
				.map((session) => ({ session, children: [], depth: 0 }))
				.sort((left, right) => right.session.lastModified.localeCompare(left.session.lastModified));
		}
		return flattenSessionTree(buildSessionTree(filtered));
	}, [items, query]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		setErrorMessage("");
		sessions.getAllMetadata()
			.then((metadata) => {
				if (!cancelled) setItems(metadata as SessionMetadata[]);
			})
			.catch((error) => {
				console.error("Failed to load sessions:", error);
				if (!cancelled) setErrorMessage(error instanceof Error ? error.message : "Failed to load sessions");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mediaQuery = window.matchMedia("(min-width: 768px)");
		const syncMode = () => setIsSidePanel(mediaQuery.matches);
		syncMode();
		mediaQuery.addEventListener("change", syncMode);
		return () => mediaQuery.removeEventListener("change", syncMode);
	}, []);

	if (!open) return null;

	const reload = async () => {
		setItems((await sessions.getAllMetadata()) as SessionMetadata[]);
	};

	const saveRename = async (session: SessionMetadata) => {
		const nextTitle = renameDraft.trim();
		if (!nextTitle) {
			setErrorMessage("Session title cannot be empty");
			return;
		}
		if (nextTitle === session.title.trim()) {
			setEditingSessionId(null);
			setAiSuggestionForSessionId(null);
			return;
		}
		setBusySessionId(session.id);
		setErrorMessage("");
		try {
			const fromAi = aiSuggestionForSessionId === session.id;
			await updateSessionTitle(session.id, nextTitle, fromAi || session.aiGeneratedTitle);
			await reload();
			setEditingSessionId(null);
			setAiSuggestionForSessionId(null);
			await onRenamed?.(session.id, nextTitle);
		} catch (error) {
			console.error("Failed to rename session:", error);
			setErrorMessage(error instanceof Error ? error.message : "Failed to rename session");
		} finally {
			setBusySessionId(null);
		}
	};

	const confirmDelete = async (session: SessionMetadata) => {
		setBusySessionId(session.id);
		setErrorMessage("");
		try {
			await sessions.deleteSession(session.id);
			await reload();
			setPendingDeleteSessionId(null);
			await onDeleted?.(session.id);
		} catch (error) {
			console.error("Failed to delete session:", error);
			setErrorMessage(error instanceof Error ? error.message : "Failed to delete session");
		} finally {
			setBusySessionId(null);
		}
	};

	const forkSession = async (session: SessionMetadata) => {
		if (!onFork) return;
			setBusySessionId(session.id);
			setErrorMessage("");
		try {
			await onFork(session.id);
			await reload();
			setForkedSourceSessionId(session.id);
			window.setTimeout(() => {
				setForkedSourceSessionId((current) => current === session.id ? null : current);
			}, 1800);
			if (!isSidePanel) onClose();
		} catch (error) {
			console.error("Failed to fork session:", error);
			setErrorMessage(error instanceof Error ? error.message : "Failed to fork session");
		} finally {
			setBusySessionId(null);
		}
	};

	const suggestTitle = async (session: SessionMetadata) => {
		if (!onSuggestTitle) return;
		setBusySessionId(session.id);
		setErrorMessage("");
		try {
			const title = await onSuggestTitle(session.id);
			setPendingDeleteSessionId(null);
			setAiSuggestionForSessionId(session.id);
			setEditingSessionId(session.id);
			setRenameDraft(title);
		} catch (error) {
			console.error("Failed to suggest title:", error);
			setErrorMessage(error instanceof Error ? error.message : "Failed to suggest a title");
		} finally {
			setBusySessionId(null);
		}
	};

	const shellClassName = isSidePanel
		? "fixed inset-y-0 left-0 z-50 flex w-auto max-w-full items-stretch pointer-events-none"
		: "fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-2 sm:p-4";
	const panelClassName = isSidePanel
		? "session-manager-dialog session-manager-side-panel pointer-events-auto flex h-full w-[min(28rem,100vw)] max-w-full flex-col overflow-hidden bg-background text-foreground"
		: "session-manager-dialog flex max-h-[95dvh] sm:max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-background text-foreground";

	return (
		<div className={shellClassName}>
			<div className={panelClassName} role="dialog" aria-modal={isSidePanel ? undefined : true} aria-label="Sessions">
				<header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
					<div>
						<h2 className="text-base font-semibold">Sessions</h2>
						<p className="mt-1 text-sm text-muted-foreground">Search, fork, rename, or load a previous conversation</p>
					</div>
					<button className="dialog-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent" aria-label="Close sessions" onClick={onClose}>
						<X size={16} />
					</button>
				</header>

				{errorMessage ? (
					<div className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status">
						{errorMessage}
					</div>
				) : null}

				<div className="border-b border-border px-5 py-3">
					<label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
						<Search size={15} className="shrink-0 text-muted-foreground" />
						<input
							className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted-foreground"
							value={query}
							placeholder="Search sessions"
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-5">
					{loading ? (
						<div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading...
						</div>
					) : sortedItems.length === 0 ? (
						<div className="py-10 text-center text-sm text-muted-foreground">
							{items.length === 0 ? "No sessions yet" : "No sessions match your search"}
						</div>
					) : (
						<ul className="space-y-2" aria-label="Saved sessions">
							{sortedItems.map(({ session, depth, children }) => {
								const isBusy = busySessionId === session.id;
								const isRenaming = editingSessionId === session.id;
								const isDeleting = pendingDeleteSessionId === session.id;
								const justForked = forkedSourceSessionId === session.id;
								return (
									<li
										key={session.id}
										className="rounded-lg border border-border bg-background p-3"
										style={{ marginLeft: `${Math.min(depth, 6) * 1.25}rem` }}
									>
										<div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
											<button
												className="min-w-0 flex-1 text-left"
												disabled={isBusy}
												onClick={() => {
													void Promise.resolve(onLoad(session.id)).catch(console.error);
													if (!isSidePanel) onClose();
												}}
											>
												<h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
													{session.parentSessionId ? (
														<GitBranch size={13} className="shrink-0 text-primary" />
													) : null}
													<span className="truncate">{session.title}</span>
													{children.length > 0 ? (
														<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
															{children.length}
														</span>
													) : null}
													{justForked ? (
														<span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
															Forked
														</span>
													) : null}
												</h3>
												<p className="mt-1 text-xs text-muted-foreground">
													{session.parentSessionId ? "Fork | " : ""}{formatDate(session.lastModified)} | {session.messageCount} messages | {formatUsage(session.usage)}
												</p>
											</button>
											<div className="flex shrink-0 gap-1 ml-auto">
												<button
													className="dialog-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
													disabled={isBusy || !onFork}
													aria-label={justForked ? "Session forked" : "Fork session"}
													title={justForked ? "Session forked" : "Fork session"}
													onClick={() => void forkSession(session)}
												>
													{isBusy ? <Loader2 size={15} className="animate-spin" /> : justForked ? <Check size={15} /> : <CopyPlus size={15} />}
												</button>
												<button
													className="dialog-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
													disabled={isBusy || !onSuggestTitle}
													aria-label="Suggest title with AI"
													title="Suggest title with AI"
													onClick={() => void suggestTitle(session)}
												>
													{isBusy && busySessionId === session.id ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
												</button>
												<button
													className="dialog-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
													disabled={isBusy || !session.aiGeneratedTitle}
													aria-label={session.aiGeneratedTitle ? "Rename session" : "AI title required before renaming"}
													title={session.aiGeneratedTitle ? "Rename session" : "AI title required before renaming"}
													onClick={() => {
														setPendingDeleteSessionId(null);
														setEditingSessionId(session.id);
														setRenameDraft(session.title);
													}}
												>
													<Pencil size={15} />
												</button>
												<button
													className="dialog-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
													disabled={isBusy}
													aria-label="Delete session"
													onClick={() => {
														setEditingSessionId(null);
														setPendingDeleteSessionId(session.id);
													}}
												>
													<Trash2 size={15} />
												</button>
											</div>
										</div>

										{isRenaming ? (
											<div className="mt-3 flex gap-2 rounded-md border border-border bg-background/50 p-3">
												<input
													className="min-h-10 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
													value={renameDraft}
													disabled={isBusy}
													autoFocus
													onChange={(event) => setRenameDraft(event.target.value)}
													onKeyDown={(event) => {
														if (event.key === "Enter") void saveRename(session);
														if (event.key === "Escape") setEditingSessionId(null);
													}}
												/>
												<button className="dialog-icon-button inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent" onClick={() => setEditingSessionId(null)}>
													<X size={16} />
												</button>
												<button className="dialog-icon-button inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50" disabled={isBusy} onClick={() => void saveRename(session)}>
													<Check size={16} />
												</button>
											</div>
										) : null}

										{isDeleting ? (
											<div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
												<p className="text-sm text-foreground">Delete this session?</p>
												<div className="flex gap-2">
													<button className="dialog-compact-button rounded-md px-3 py-2 text-sm hover:bg-accent" disabled={isBusy} onClick={() => setPendingDeleteSessionId(null)}>
														Cancel
													</button>
													<button className="dialog-compact-button rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50" disabled={isBusy} onClick={() => void confirmDelete(session)}>
														Delete
													</button>
												</div>
											</div>
										) : null}
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
