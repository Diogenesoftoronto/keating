import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type TouchEvent as ReactTouchEvent,
} from "react";
import {
	Check,
	ChevronDown,
	ChevronRight,
	CopyPlus,
	GitBranch,
	History,
	Loader2,
	MoreHorizontal,
	PanelLeftOpen,
	PanelLeftClose,
	Plus,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import type { UseSessionsResult } from "../hooks/use-sessions";
import { formatRelativeSessionDate } from "../lib/session-date";
import {
	buildSessionTree,
	flattenSessionTree,
	type SessionTreeNode,
} from "./session-tree";
import type { SessionBrowserProps } from "./SessionBrowser";

export interface SessionBrowserDesktopProps extends SessionBrowserProps {
	store: UseSessionsResult;
}

const TREE_COLLAPSED_STORAGE_KEY = "keating:session-tree-collapsed";
const SIDEBAR_MIN_W = 288;
const SIDEBAR_MAX_W = 640;
const SIDEBAR_DEFAULT_W = 360;
const SIDEBAR_W_KEY = "keating_session_sidebar_width";

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

function writeCollapsedTreeNodes(value: ReadonlySet<string>) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(TREE_COLLAPSED_STORAGE_KEY, JSON.stringify([...value]));
	} catch {
		// Ignore storage failures.
	}
}

function loadSidebarWidth(): number {
	if (typeof localStorage === "undefined") return SIDEBAR_DEFAULT_W;
	try {
		const raw = localStorage.getItem(SIDEBAR_W_KEY);
		if (!raw) return SIDEBAR_DEFAULT_W;
		const parsed = Number.parseInt(raw, 10);
		if (Number.isNaN(parsed)) return SIDEBAR_DEFAULT_W;
		return Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, parsed));
	} catch {
		return SIDEBAR_DEFAULT_W;
	}
}

function saveSidebarWidth(value: number) {
	try {
		localStorage.setItem(SIDEBAR_W_KEY, String(value));
	} catch {
		// Ignore storage failures.
	}
}

interface DesktopRowProps {
	item: SessionTreeNode;
	rowId: string;
	isFocused: boolean;
	activeSessionId?: string;
	forkingSessionId?: string | null;
	forkedSessionId?: string | null;
	forkedSourceSessionId: string | null;
	isSearching: boolean;
	collapsedNodes: ReadonlySet<string>;
	onToggleNode: (sessionId: string) => void;
	onLoad: (sessionId: string) => void | Promise<void>;
	onFork: (sessionId: string) => void | Promise<void>;
	onRenameStart: (sessionId: string, title: string) => void;
	onDeleteStart: (sessionId: string) => void;
	onSuggestTitle?: (sessionId: string) => Promise<string>;
	onSuggest: (item: SessionTreeNode) => Promise<void>;
	editingSessionId: string | null;
	pendingDeleteSessionId: string | null;
	busySessionId: string | null;
	renameDraft: string;
	setRenameDraft: (value: string) => void;
	onSaveRename: (item: SessionTreeNode) => Promise<void>;
	onCancelRename: () => void;
	onConfirmDelete: (item: SessionTreeNode) => Promise<void>;
	onCancelDelete: () => void;
}

function DesktopRow({
	item,
	rowId,
	isFocused,
	activeSessionId,
	forkingSessionId,
	forkedSessionId,
	forkedSourceSessionId,
	isSearching,
	collapsedNodes,
	onToggleNode,
	onLoad,
	onFork,
	onRenameStart,
	onDeleteStart,
	onSuggestTitle,
	onSuggest,
	editingSessionId,
	pendingDeleteSessionId,
	busySessionId,
	renameDraft,
	setRenameDraft,
	onSaveRename,
	onCancelRename,
	onConfirmDelete,
	onCancelDelete,
}: DesktopRowProps) {
	const { session, depth, children } = item;
	const active = session.id === activeSessionId;
	const forking = session.id === forkingSessionId;
	const justForkedSource = session.id === forkedSourceSessionId;
	const justForked = session.id === forkedSessionId;
	const isBusy = session.id === busySessionId;
	const isRenaming = session.id === editingSessionId;
	const isDeleting = session.id === pendingDeleteSessionId;
	const hasChildren = children.length > 0;
	const expanded = hasChildren && !collapsedNodes.has(session.id);
	const showToggle = hasChildren && !isSearching;
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	return (
		<li
			id={rowId}
			role="treeitem"
			aria-level={depth + 1}
			aria-expanded={hasChildren ? expanded : undefined}
			aria-selected={isFocused}
			className={`${justForked ? "session-fork-arrive" : ""} ${isFocused ? "ring-1 ring-primary/40 rounded-lg" : ""}`.trim()}
			style={{ marginLeft: `${Math.min(depth, 5) * 0.9}rem` }}
		>
			<div
				className={`group rounded-lg border p-3 transition-colors ${
					active
						? "border-primary bg-primary/10 text-primary"
						: "border-border text-foreground hover:bg-muted/40"
				}`}
			>
				<div className="flex min-w-0 items-start gap-1">
					{showToggle ? (
						<button
							type="button"
							className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							title={expanded ? "Collapse forks" : "Expand forks"}
							aria-label={
								expanded
									? `Collapse ${children.length} fork${children.length === 1 ? "" : "s"}`
									: `Expand ${children.length} fork${children.length === 1 ? "" : "s"}`
							}
							onClick={() => onToggleNode(session.id)}
						>
							{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
						</button>
					) : (
						<span aria-hidden="true" className="mt-0.5 inline-block h-10 w-10 shrink-0" />
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
							<span>
								{session.parentSessionId ? "Fork | " : ""}
								{formatRelativeSessionDate(session.lastModified)}
							</span>
							<span aria-hidden="true">|</span>
							<span>{session.messageCount} messages</span>
						</div>
					</button>
					<button
						type="button"
						className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 md:group-hover:opacity-100 ${
							justForkedSource ? "text-primary md:opacity-100" : "md:opacity-0"
						}`}
						title={justForkedSource ? "Session forked" : "Fork session"}
						aria-label={justForkedSource ? "Session forked" : "Fork session"}
						disabled={forking}
						onClick={() => void onFork(session.id)}
					>
						{forking ? (
							<Loader2 size={14} className="animate-spin" />
						) : justForkedSource ? (
							<Check size={14} />
						) : (
							<CopyPlus size={14} />
						)}
					</button>
					<div ref={menuRef} className="relative shrink-0">
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
							aria-label="Session actions"
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							disabled={isBusy}
							onClick={() => setMenuOpen((open) => !open)}
						>
							{isBusy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={16} />}
						</button>
						{menuOpen ? (
							<div
								role="menu"
								className="absolute right-0 top-11 z-20 w-40 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-lg"
							>
								<button
									type="button"
									role="menuitem"
									className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent"
									onClick={() => {
										setMenuOpen(false);
										onCancelDelete();
										onRenameStart(session.id, session.title);
									}}
								>
									Rename
								</button>
								{onSuggestTitle ? (
									<button
										type="button"
										role="menuitem"
										className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent disabled:opacity-50"
										disabled={isBusy}
										onClick={() => {
											setMenuOpen(false);
											void onSuggest(item);
										}}
									>
										<Sparkles size={13} />
										Suggest title
									</button>
								) : null}
								<button
									type="button"
									role="menuitem"
									className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs text-destructive hover:bg-destructive/10"
									onClick={() => {
										setMenuOpen(false);
										onCancelRename();
										onDeleteStart(session.id);
									}}
								>
									<Trash2 size={13} />
									Delete
								</button>
							</div>
						) : null}
					</div>
				</div>

				{isRenaming ? (
					<div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background/50 p-3">
						<input
							className="min-h-10 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
							value={renameDraft}
							disabled={isBusy}
							autoFocus
							onChange={(event) => setRenameDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void onSaveRename(item);
								if (event.key === "Escape") onCancelRename();
							}}
						/>
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
							onClick={onCancelRename}
						>
							<X size={16} />
						</button>
						<button
							type="button"
							className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
							disabled={isBusy}
							onClick={() => void onSaveRename(item)}
						>
							<Check size={16} />
						</button>
					</div>
				) : null}

				{isDeleting ? (
					<div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
						<p className="text-sm text-foreground">Delete this session?</p>
						<div className="flex gap-2">
							<button
								type="button"
								className="rounded-md px-3 py-2 text-sm hover:bg-accent"
								disabled={isBusy}
								onClick={onCancelDelete}
							>
								Cancel
							</button>
							<button
								type="button"
								className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
								disabled={isBusy}
								onClick={() => void onConfirmDelete(item)}
							>
								Delete
							</button>
						</div>
					</div>
				) : null}
			</div>
		</li>
	);
}

/**
 * Desktop (≥ SESSION_BROWSER_BREAKPOINT) variant: the resizable left
 * panel. Ported from SessionSidebar.tsx (collapsed 56px strip, drag
 * resize 288–640px persisted at `keating_session_sidebar_width`,
 * role="tree" flattened fork tree with collapse state persisted at
 * `keating:session-tree-collapsed`, search, New Session, fork buttons
 * and fork-arrival animation) — with data/search from `store` instead
 * of local state, no "Manage" button, and per-row rename / delete /
 * AI-suggest actions ported from SessionManagerDialog.
 */
export function SessionBrowserDesktop({
	activeSessionId,
	forkingSessionId,
	forkedSessionId,
	collapsed = false,
	onCollapsedChange,
	onLoad,
	onFork,
	onNewSession,
	onSuggestTitle,
	store,
}: SessionBrowserDesktopProps) {
	const [forkedSourceSessionId, setForkedSourceSessionId] = useState<string | null>(null);
	const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => readCollapsedTreeNodes());
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
	const [busySessionId, setBusySessionId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [aiSuggestionForSessionId, setAiSuggestionForSessionId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState("");
	const dragState = useRef({ active: false, startX: 0, startWidth: 0 });
	const dragCleanupRef = useRef<(() => void) | null>(null);

	const isSearching = store.query.trim().length > 0;
	const visibleItems = useMemo(() => {
		if (store.flatResults) {
			return store.flatResults.map((session) => ({ session, children: [], depth: 0 }));
		}
		return flattenSessionTree(buildSessionTree(store.items), collapsedNodes).slice(0, 80);
	}, [collapsedNodes, store.flatResults, store.items]);

	const toggleNode = useCallback((sessionId: string) => {
		setCollapsedNodes((current) => {
			const next = new Set(current);
			if (next.has(sessionId)) next.delete(sessionId);
			else next.add(sessionId);
			writeCollapsedTreeNodes(next);
			return next;
		});
	}, []);

	// Roving focus within the tree (aria-activedescendant pattern). The <ul>
	// is the single tab stop; each row exposes its id and we change which id
	// the container points at as the user navigates.
	const TREE_ID = "session-tree";
	const rowId = (index: number) => `${TREE_ID}-row-${index}`;
	// Default the keyboard cursor to the active session if it appears in the
	// visible list; otherwise fall back to the first row. This keeps focus
	// and the chat panel pointing at the same row.
	const [focusedIndex, setFocusedIndex] = useState(() => {
		if (!activeSessionId) return 0;
		const idx = visibleItems.findIndex((item) => item.session.id === activeSessionId);
		return idx >= 0 ? idx : 0;
	});

	useEffect(() => {
		// Keep focusedIndex inside the new bounds when the visible list shrinks.
		if (visibleItems.length === 0) {
			setFocusedIndex(0);
			return;
		}
		setFocusedIndex((current) => Math.min(current, visibleItems.length - 1));
	}, [visibleItems.length]);

	const focusRow = useCallback((index: number) => {
		if (visibleItems.length === 0) return;
		const clamped = Math.max(0, Math.min(visibleItems.length - 1, index));
		setFocusedIndex(clamped);
		const el = document.getElementById(rowId(clamped));
		el?.scrollIntoView({ block: "nearest" });
	}, [visibleItems.length]);

	const handleTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLUListElement>) => {
		if (visibleItems.length === 0) return;
		const current = focusedIndex;
		const currentItem = visibleItems[current];
		if (!currentItem) return;
		const hasChildren = currentItem.children.length > 0;
		const expanded = hasChildren && !collapsedNodes.has(currentItem.session.id);
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				focusRow(current + 1);
				return;
			case "ArrowUp":
				event.preventDefault();
				focusRow(current - 1);
				return;
			case "Home":
				event.preventDefault();
				focusRow(0);
				return;
			case "End":
				event.preventDefault();
				focusRow(visibleItems.length - 1);
				return;
			case "ArrowRight":
				event.preventDefault();
				if (hasChildren && !expanded) toggleNode(currentItem.session.id);
				return;
			case "ArrowLeft":
				event.preventDefault();
				if (hasChildren && expanded) {
					toggleNode(currentItem.session.id);
					return;
				}
				for (let i = current - 1; i >= 0; i -= 1) {
					if (visibleItems[i].depth < currentItem.depth) {
						focusRow(i);
						return;
					}
				}
				return;
			case "Enter":
				event.preventDefault();
				void onLoad(currentItem.session.id);
				return;
			default:
				return;
		}
	}, [collapsedNodes, focusRow, focusedIndex, onLoad, toggleNode, visibleItems]);

	const handleFork = useCallback(
		async (sessionId: string) => {
			await onFork(sessionId);
			setForkedSourceSessionId(sessionId);
			window.setTimeout(() => {
				setForkedSourceSessionId((current) => (current === sessionId ? null : current));
			}, 1800);
		},
		[onFork],
	);

	const handleSaveRename = useCallback(
		async (item: SessionTreeNode) => {
			const nextTitle = renameDraft.trim();
			if (!nextTitle) {
				setErrorMessage("Session title cannot be empty");
				return;
			}
			if (nextTitle === item.session.title.trim()) {
				setEditingSessionId(null);
				setAiSuggestionForSessionId(null);
				return;
			}
			setBusySessionId(item.session.id);
			setErrorMessage("");
			try {
				await store.rename(
					item.session.id,
					nextTitle,
					aiSuggestionForSessionId === item.session.id || item.session.aiGeneratedTitle,
				);
				setEditingSessionId(null);
				setAiSuggestionForSessionId(null);
			} catch (error) {
				setErrorMessage(
					error instanceof Error ? error.message : "Failed to rename session",
				);
			} finally {
				setBusySessionId(null);
			}
		},
		[aiSuggestionForSessionId, renameDraft, store],
	);

	const handleConfirmDelete = useCallback(
		async (item: SessionTreeNode) => {
			setBusySessionId(item.session.id);
			setErrorMessage("");
			try {
				await store.remove(item.session.id);
				setPendingDeleteSessionId(null);
			} catch (error) {
				setErrorMessage(
					error instanceof Error ? error.message : "Failed to delete session",
				);
			} finally {
				setBusySessionId(null);
			}
		},
		[store],
	);

	const handleSuggest = useCallback(
		async (item: SessionTreeNode) => {
			if (!onSuggestTitle) return;
			setBusySessionId(item.session.id);
			setErrorMessage("");
			try {
				const title = await onSuggestTitle(item.session.id);
				setPendingDeleteSessionId(null);
				setAiSuggestionForSessionId(item.session.id);
				setEditingSessionId(item.session.id);
				setRenameDraft(title);
			} catch (error) {
				setErrorMessage(
					error instanceof Error ? error.message : "Failed to suggest a title",
				);
			} finally {
				setBusySessionId(null);
			}
		},
		[onSuggestTitle],
	);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent | ReactTouchEvent) => {
			event.preventDefault();
			const clientX =
				"touches" in event ? event.touches[0].clientX : event.clientX;
			dragState.current = { active: true, startX: clientX, startWidth: sidebarWidth };

			const onMove = (moveEvent: MouseEvent | TouchEvent) => {
				if (!dragState.current.active) return;
				const moveX =
					"touches" in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
				const delta = moveX - dragState.current.startX;
				const next = Math.min(
					SIDEBAR_MAX_W,
					Math.max(SIDEBAR_MIN_W, dragState.current.startWidth + delta),
				);
				setSidebarWidth(next);
			};

			const onUp = () => {
				if (!dragState.current.active) return;
				dragState.current.active = false;
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				window.removeEventListener("touchmove", onMove);
				window.removeEventListener("touchend", onUp);
				setSidebarWidth((width) => {
					saveSidebarWidth(width);
					return width;
				});
			};

			dragCleanupRef.current = () => {
				dragState.current.active = false;
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				window.removeEventListener("touchmove", onMove);
				window.removeEventListener("touchend", onUp);
			};

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
			window.addEventListener("touchmove", onMove, { passive: false });
			window.addEventListener("touchend", onUp);
		},
		[sidebarWidth],
	);

	useEffect(() => {
		return () => {
			dragCleanupRef.current?.();
			dragCleanupRef.current = null;
		};
	}, []);

	if (collapsed) {
		return (
			<aside className="session-sidebar flex w-14 shrink-0 flex-col items-center gap-3 border-r-2 border-border bg-background py-3">
				<button
					type="button"
					className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground"
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
						className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground"
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

	return (
		<aside
			className="session-sidebar relative flex shrink-0 flex-col border-r-2 border-border bg-background"
			style={{ width: `${sidebarWidth}px` }}
		>
			<div
				className="group absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize items-center justify-center"
				onMouseDown={handleResizeStart}
				onTouchStart={handleResizeStart}
			>
				<div className="h-8 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
			</div>

			<header className="border-b border-border px-4 py-4">
				<div className="flex items-start gap-3">
					<div className="flex shrink-0 items-center gap-1">
						{onCollapsedChange ? (
							<button
								type="button"
								className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								title="Collapse sessions panel"
								aria-label="Collapse sessions panel"
								onClick={() => onCollapsedChange(true)}
							>
								<PanelLeftClose size={14} />
							</button>
						) : null}
					</div>
					<div className="min-w-0 flex-1 text-right">
						<div className="flex items-center justify-end gap-2 text-sm font-semibold">
							Sessions
							<History size={15} />
						</div>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							Search, fork, rename, or load a previous conversation
						</p>
					</div>
				</div>
				{onNewSession ? (
					<button
						type="button"
						className="sb-new mt-3 inline-flex h-10 w-full items-center justify-center gap-2 text-sm font-semibold"
						onClick={onNewSession}
					>
						<Plus size={16} />
						New_Session
					</button>
				) : null}
				<label className="mt-3 flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs">
					<Search size={14} className="shrink-0 text-muted-foreground" />
					<input
						className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted-foreground"
						value={store.query}
						placeholder="Search sessions"
						onChange={(event) => store.setQuery(event.target.value)}
					/>
				</label>
				{(errorMessage || store.error) ? (
					<div
						className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
						role="status"
					>
						{errorMessage || store.error}
					</div>
				) : null}
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{store.loading && store.items.length === 0 ? (
					<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
						<Loader2 size={14} className="animate-spin" />
						Loading
					</div>
				) : visibleItems.length === 0 ? (
					<div className="px-2 py-8 text-center text-xs text-muted-foreground">
						{store.items.length === 0 ? "No sessions yet" : "No sessions match your search"}
					</div>
				) : (
					<ul
						id={TREE_ID}
						className="space-y-2 outline-none"
						role="tree"
						aria-label="Session tree"
						aria-activedescendant={visibleItems[focusedIndex] ? rowId(focusedIndex) : undefined}
						tabIndex={0}
						onKeyDown={handleTreeKeyDown}
					>
						{visibleItems.map((item, index) => (
							<DesktopRow
								key={item.session.id}
								item={item}
								rowId={rowId(index)}
								isFocused={index === focusedIndex}
								activeSessionId={activeSessionId}
								forkingSessionId={forkingSessionId}
								forkedSessionId={forkedSessionId}
								forkedSourceSessionId={forkedSourceSessionId}
								isSearching={isSearching}
								collapsedNodes={collapsedNodes}
								onToggleNode={toggleNode}
								onLoad={onLoad}
								onFork={handleFork}
								onRenameStart={(sessionId, title) => {
									setPendingDeleteSessionId(null);
									setAiSuggestionForSessionId(null);
									setEditingSessionId(sessionId);
									setRenameDraft(title);
								}}
								onDeleteStart={(sessionId) => {
									setEditingSessionId(null);
									setAiSuggestionForSessionId(null);
									setPendingDeleteSessionId(sessionId);
								}}
								onSuggestTitle={onSuggestTitle}
								onSuggest={handleSuggest}
								editingSessionId={editingSessionId}
								pendingDeleteSessionId={pendingDeleteSessionId}
								busySessionId={busySessionId}
								renameDraft={renameDraft}
								setRenameDraft={setRenameDraft}
								onSaveRename={handleSaveRename}
								onCancelRename={() => {
									setEditingSessionId(null);
									setAiSuggestionForSessionId(null);
								}}
								onConfirmDelete={handleConfirmDelete}
								onCancelDelete={() => setPendingDeleteSessionId(null)}
							/>
						))}
					</ul>
				)}
			</div>
			<footer className="sb-foot">
				<div>
					<span className="sb-dot" aria-hidden="true" />
					<b>{store.items.length}</b> SAVED SESSIONS
				</div>
			</footer>
		</aside>
	);
}
