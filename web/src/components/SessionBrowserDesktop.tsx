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
import { css, cx } from "../../styled-system/css";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { Spinner } from "./Spinner";

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

	return (
		<li
			id={rowId}
			role="treeitem"
			aria-level={depth + 1}
			aria-expanded={hasChildren ? expanded : undefined}
			aria-selected={isFocused}
			className={cx(
				justForked ? "session-fork-arrive" : "",
				isFocused ? css({ borderRadius: "0.5rem", boxShadow: "0 0 0 1px color-mix(in srgb, var(--primary) 40%, transparent)" }) : "",
			)}
			style={{ marginLeft: `${Math.min(depth, 5) * 0.9}rem` }}
		>
			<div
				className={css({
					borderRadius: "0.5rem",
					border: "1px solid",
					borderColor: active ? "var(--primary)" : "var(--border)",
					background: active ? "color-mix(in srgb, var(--primary) 10%, transparent)" : undefined,
					padding: "0.75rem",
					color: active ? "var(--primary)" : "var(--foreground)",
					transition: "color 150ms, background-color 150ms, border-color 150ms",
					_hover: active ? undefined : { background: "color-mix(in srgb, var(--muted) 40%, transparent)" },
					"&:hover [data-row-fork-action]": { opacity: 1 },
				})}
			>
				<div className={css({ display: "flex", minWidth: 0, alignItems: "flex-start", gap: "0.25rem" })}>
					{showToggle ? (
						<button
							type="button"
							className={css({ marginTop: "0.125rem", display: "inline-flex", height: "2.5rem", width: "2.5rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.25rem", color: "var(--muted-foreground)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
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
						<span aria-hidden="true" className={css({ marginTop: "0.125rem", display: "inline-block", height: "2.5rem", width: "2.5rem", flexShrink: 0 })} />
					)}
					<button
						type="button"
						className={css({ minWidth: 0, flex: 1, textAlign: "left" })}
						onClick={() => void onLoad(session.id)}
					>
						<div className={css({ display: "flex", minWidth: 0, alignItems: "center", gap: "0.5rem" })}>
							{session.parentSessionId ? (
								<GitBranch size={13} className={css({ flexShrink: 0, color: "var(--primary)" })} />
							) : null}
							<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500 })}>{session.title}</span>
							{hasChildren ? (
								<span className={css({ flexShrink: 0, borderRadius: "0.25rem", background: "var(--muted)", padding: "0.125rem 0.375rem", fontSize: "0.625rem", color: "var(--muted-foreground)" })}>
									{children.length}
								</span>
							) : null}
							{justForkedSource ? (
								<span className={css({ flexShrink: 0, borderRadius: "0.25rem", background: "var(--primary)", padding: "0.125rem 0.375rem", fontSize: "0.625rem", color: "var(--primary-foreground)" })}>
									Forked
								</span>
							) : null}
						</div>
						<p className={css({ marginTop: "0.5rem", lineClamp: 2, fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" })}>
							{session.preview || "No preview saved"}
						</p>
						<div className={css({ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
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
						data-row-fork-action
						className={css({
							display: "inline-flex",
							height: "2.5rem",
							width: "2.5rem",
							flexShrink: 0,
							alignItems: "center",
							justifyContent: "center",
							borderRadius: "0.375rem",
							color: justForkedSource ? "var(--primary)" : "var(--muted-foreground)",
							md: { opacity: justForkedSource ? 1 : 0 },
							_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
							_disabled: { opacity: 0.5 },
						})}
						title={justForkedSource ? "Session forked" : "Fork session"}
						aria-label={justForkedSource ? "Session forked" : "Fork session"}
						disabled={forking}
						onClick={() => void onFork(session.id)}
					>
						{forking ? (
							<Spinner size={14} />
						) : justForkedSource ? (
							<Check size={14} />
						) : (
							<CopyPlus size={14} />
						)}
					</button>
					<OverflowMenu
						width="10rem"
						offset={4}
						items={[
							{
								key: "rename",
								label: "Rename",
								onSelect: () => {
									onCancelDelete();
									onRenameStart(session.id, session.title);
								},
							},
							...(onSuggestTitle
								? [
										{
											key: "suggest",
											label: "Suggest title",
											icon: <Sparkles size={13} />,
											disabled: isBusy,
											onSelect: () => void onSuggest(item),
										} satisfies OverflowMenuItem,
									]
								: []),
							{
								key: "delete",
								label: "Delete",
								icon: <Trash2 size={13} />,
								destructive: true,
								onSelect: () => {
									onCancelRename();
									onDeleteStart(session.id);
								},
							},
						]}
					>
						{({ open, toggle }) => (
							<button
								type="button"
								className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", color: "var(--muted-foreground)", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" }, _disabled: { opacity: 0.5 } })}
								aria-label="Session actions"
								aria-haspopup="menu"
								aria-expanded={open}
								disabled={isBusy}
								onClick={toggle}
							>
								<Spinner size={14} loading={isBusy}>
									<MoreHorizontal size={16} />
								</Spinner>
							</button>
						)}
					</OverflowMenu>
				</div>

				{isRenaming ? (
					<div className={css({ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 50%, transparent)", padding: "0.75rem" })}>
						<input
							className={css({ minHeight: "2.5rem", flex: 1, borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.5rem 0.75rem", fontSize: "0.875rem", outline: "none", _focus: { borderColor: "var(--ring)" } })}
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
							className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", _hover: { background: "var(--accent)" } })}
							onClick={onCancelRename}
						>
							<X size={16} />
						</button>
						<button
							type="button"
							className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", background: "var(--primary)", color: "var(--primary-foreground)", _disabled: { opacity: 0.5 } })}
							disabled={isBusy}
							onClick={() => void onSaveRename(item)}
						>
							<Check size={16} />
						</button>
					</div>
				) : null}

				{isDeleting ? (
					<div className={css({ marginTop: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", background: "color-mix(in srgb, var(--destructive) 5%, transparent)", padding: "0.75rem" })}>
						<p className={css({ fontSize: "0.875rem", color: "var(--foreground)" })}>Delete this session?</p>
						<div className={css({ display: "flex", gap: "0.5rem" })}>
							<button
								type="button"
								className={css({ borderRadius: "0.375rem", padding: "0.5rem 0.75rem", fontSize: "0.875rem", _hover: { background: "var(--accent)" } })}
								disabled={isBusy}
								onClick={onCancelDelete}
							>
								Cancel
							</button>
							<button
								type="button"
								className={css({ borderRadius: "0.375rem", background: "var(--destructive)", padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "var(--destructive-foreground)", _disabled: { opacity: 0.5 } })}
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
					aiSuggestionForSessionId === item.session.id,
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
			<aside className={`${css({ width: "3.5rem", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", borderRight: "2px solid var(--border)", background: "var(--background)", paddingBlock: "0.75rem" })} session-sidebar`}>
				<button
					type="button"
					className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", color: "var(--foreground)", transitionProperty: "background-color, color", transitionDuration: "150ms", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
					title="Expand sessions panel"
					aria-label="Expand sessions panel"
					onClick={() => onCollapsedChange?.(false)}
				>
					<PanelLeftOpen size={16} />
				</button>
				<div className={css({ marginBlock: "0.25rem", height: "1px", width: "2rem", background: "var(--border)" })} />
				{onNewSession ? (
					<button
						type="button"
						className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", color: "var(--foreground)", transitionProperty: "background-color, color", transitionDuration: "150ms", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
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
			className={`${css({ position: "relative", display: "flex", flexShrink: 0, flexDirection: "column", borderRight: "2px solid var(--border)", background: "var(--background)" })} session-sidebar`}
			style={{ width: `${sidebarWidth}px` }}
		>
			<div
				className={`${css({ position: "absolute", insetBlock: 0, right: 0, zIndex: 10, display: "flex", width: "0.5rem", cursor: "col-resize", alignItems: "center", justifyContent: "center" })} group`}
				onMouseDown={handleResizeStart}
				onTouchStart={handleResizeStart}
			>
				<div className={css({ height: "2rem", width: "0.125rem", borderRadius: "9999px", background: "var(--border)", opacity: 0, transitionProperty: "opacity", transitionDuration: "150ms", _groupHover: { opacity: 1 }, _groupActive: { opacity: 1 } })} />
			</div>

			<header className={css({ borderBottom: "1px solid var(--border)", paddingInline: "1rem", paddingBlock: "1rem" })}>
				<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" })}>
					<div className={css({ display: "flex", flexShrink: 0, alignItems: "center", gap: "0.25rem" })}>
						{onCollapsedChange ? (
							<button
								type="button"
								className={css({ display: "inline-flex", height: "2.5rem", width: "2.5rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", border: "1px solid var(--border)", color: "var(--muted-foreground)", transitionProperty: "background-color, color", transitionDuration: "150ms", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
								title="Collapse sessions panel"
								aria-label="Collapse sessions panel"
								onClick={() => onCollapsedChange(true)}
							>
								<PanelLeftClose size={14} />
							</button>
						) : null}
					</div>
					<div className={css({ minWidth: 0, flex: 1, textAlign: "right" })}>
						<div className={css({ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600 })}>
							Sessions
							<History size={15} />
						</div>
						<p className={css({ marginTop: "0.25rem", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" })}>
							Search, fork, rename, or load a previous conversation
						</p>
					</div>
				</div>
				{onNewSession ? (
					<button
						type="button"
						className={`${css({ marginTop: "0.75rem", display: "inline-flex", height: "2.5rem", width: "100%", alignItems: "center", justifyContent: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600 })} sb-new`}
						onClick={onNewSession}
					>
						<Plus size={16} />
						New_Session
					</button>
				) : null}
				<label className={css({ marginTop: "0.75rem", display: "flex", minHeight: "2.5rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", paddingInline: "0.75rem", fontSize: "0.75rem" })}>
					<Search size={14} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
					<input
						className={css({ minWidth: 0, flex: 1, background: "transparent", paddingBlock: "0.5rem", outline: "none", _placeholder: { color: "var(--muted-foreground)" } })}
						value={store.query}
						placeholder="Search sessions"
						onChange={(event) => store.setQuery(event.target.value)}
					/>
				</label>
				{(errorMessage || store.error) ? (
					<div
						className={css({ marginTop: "0.75rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", background: "color-mix(in srgb, var(--destructive) 5%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.75rem", color: "var(--destructive)" })}
						role="status"
					>
						{errorMessage || store.error}
					</div>
				) : null}
			</header>
			<div className={css({ minHeight: 0, flex: 1, overflowY: "auto", padding: "0.75rem" })}>
				{store.loading && store.items.length === 0 ? (
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", paddingBlock: "2rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						<Spinner size={14} />
						Loading
					</div>
				) : visibleItems.length === 0 ? (
					<div className={css({ paddingInline: "0.5rem", paddingBlock: "2rem", textAlign: "center", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						{store.items.length === 0 ? "No sessions yet" : "No sessions match your search"}
					</div>
				) : (
					<ul
						id={TREE_ID}
						className={css({ display: "flex", flexDirection: "column", gap: "0.5rem", outline: "none" })}
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
