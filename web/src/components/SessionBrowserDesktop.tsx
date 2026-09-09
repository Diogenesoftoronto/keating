import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { PenLine } from "reicon-react/icons/PenLine";
import { SidebarLeft } from "reicon-react/icons/SidebarLeft";
import { ChevronDown } from "reicon-react/icons/ChevronDown";
import { BranchUp } from "reicon-react/icons/BranchUp";
import { Magnifier } from "reicon-react/icons/Magnifier";
import { Xmark } from "reicon-react/icons/Xmark";
import { KeatingIcon } from "./KeatingIcon";
import { SessionCard, type SessionCardProps } from "./SessionCard";
import { Select } from "./Select";
import { flattenSessionTree } from "./session-tree";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import type { CategoryKey } from "./session-card-visuals";
import {
  filterSessionLibrary,
  sessionCategories,
  SESSION_ACTIVITY_LABELS,
  type SessionActivityFilter,
} from "./session-library";
import "./session-panel.css";

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
    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

function writeCollapsedTreeNodes(value: ReadonlySet<string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      TREE_COLLAPSED_STORAGE_KEY,
      JSON.stringify([...value]),
    );
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

interface SessionTreeRowProps extends SessionCardProps {
  rowId: string;
  depth: number;
  branchCount: number;
  expanded: boolean;
  filtering: boolean;
  focused: boolean;
  onToggle: (id: string) => void;
}

// Updating the current session should only revisit the old and new rows.
// Offscreen content-visibility saves layout work, but does not skip React work.
const SessionTreeRow = memo(function SessionTreeRow({
  rowId, depth, branchCount, expanded, filtering, focused, onToggle, ...cardProps
}: SessionTreeRowProps) {
  const { session, active } = cardProps;
  return <li
    id={rowId}
    role="treeitem"
    aria-label={session.title}
    aria-level={depth + 1}
    aria-expanded={branchCount ? expanded : undefined}
    aria-selected={active}
    data-cursor={focused || undefined}
    data-branch={depth > 0 || undefined}
    className="session-panel__row"
    style={{ marginLeft: Math.min(depth, 3) * 12 }}
  >
    <SessionCard {...cardProps} />
    {branchCount ? <button
      type="button"
      className="session-panel__forks"
      aria-label={`${expanded ? "Collapse" : "Expand"} forks of ${session.title}`}
      aria-expanded={expanded}
      disabled={filtering}
      onClick={() => onToggle(session.id)}
    >
      <KeatingIcon icon={BranchUp} size={14} />
      <span>{branchCount} {branchCount === 1 ? "fork" : "forks"}</span>
      <ChevronDown size={14} data-expanded={expanded || undefined} aria-hidden />
    </button> : null}
  </li>;
});

/** Resizable library; filtering keeps a matching fork's ancestors visible. */
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
}: SessionBrowserSurfaceProps) {
  const [collapsedNodes, setCollapsedNodes] = useState(readCollapsedTreeNodes);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [category, setCategory] = useState<CategoryKey | "all">("all");
  const [activity, setActivity] = useState<SessionActivityFilter>("all");
  const [focusedId, setFocusedId] = useState(activeSessionId);
  const [error, setError] = useState("");
  const [treeFocused, setTreeFocused] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const treeId = useId();
  // The parent owns live callbacks and may recreate them on every agent update.
  // Stable delegates let unchanged rows keep their render without stale actions.
  const actionsRef = useRef({ onLoad, onFork, onSuggestTitle, rename: store.rename, remove: store.remove });
  actionsRef.current = { onLoad, onFork, onSuggestTitle, rename: store.rename, remove: store.remove };
  const loadRow = useCallback((id: string) => actionsRef.current.onLoad(id), []);
  const forkRow = useCallback((id: string) => actionsRef.current.onFork(id), []);
  const renameRow = useCallback((id: string, title: string, aiGeneratedTitle?: boolean) => actionsRef.current.rename(id, title, aiGeneratedTitle), []);
  const removeRow = useCallback((id: string) => actionsRef.current.remove(id), []);
  const suggestRowTitle = useCallback((id: string) => {
    const suggest = actionsRef.current.onSuggestTitle;
    if (!suggest) return Promise.reject(new Error("Title suggestions are unavailable."));
    return suggest(id);
  }, []);
  const categories = useMemo(
    () => sessionCategories(store.items),
    [store.items],
  );
  const filtering = Boolean(
    store.query.trim() || category !== "all" || activity !== "all",
  );
  const filtered = useMemo(
    () =>
      filterSessionLibrary({
        roots: store.roots,
        heroes: store.heroes,
        queryResults: store.flatResults,
        category,
        activity,
      }),
    [store.roots, store.heroes, store.flatResults, category, activity],
  );
  const visible = useMemo(
    () =>
      flattenSessionTree(
        filtered.roots,
        filtering ? undefined : collapsedNodes,
      ),
    [filtered.roots, filtering, collapsedNodes],
  );
  const titles = useMemo(
    () => new Map(store.items.map((session) => [session.id, session.title])),
    [store.items],
  );
  const focusedIndex = Math.max(
    0,
    visible.findIndex((item) => item.session.id === focusedId),
  );
  const rowId = (id: string) => `${treeId}-${id}`;

  const toggleNode = useCallback((id: string) => {
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsedTreeNodes(next);
      return next;
    });
  }, []);
  useEffect(() => {
    setFocusedId(activeSessionId);
  }, [activeSessionId]);
  useEffect(() => () => dragCleanup.current?.(), []);
  // Opening a fork must also expose it in a previously collapsed family.
  useEffect(() => {
    if (!activeSessionId && !forkedSessionId) return;
    setCollapsedNodes((current) => {
      if (current.size === 0) return current;
      const next = new Set(current);
      const parents = new Map(
        store.items.map((item) => [item.id, item.parentSessionId]),
      );
      for (const id of [activeSessionId, forkedSessionId]) {
        const visited = new Set<string>();
        let parent = id ? parents.get(id) : undefined;
        while (parent && !visited.has(parent)) {
          visited.add(parent);
          next.delete(parent);
          parent = parents.get(parent);
        }
      }
      if (next.size === current.size) return current;
      writeCollapsedTreeNodes(next);
      return next;
    });
  }, [activeSessionId, forkedSessionId, store.items]);

  const focusRow = (index: number) => {
    const item = visible[Math.max(0, Math.min(visible.length - 1, index))];
    if (!item) return;
    setFocusedId(item.session.id);
    document
      .getElementById(rowId(item.session.id))
      ?.scrollIntoView({ block: "nearest" });
  };
  const loadFocused = async (id: string) => {
    setError("");
    try {
      await onLoad(id);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't open this session.",
      );
    }
  };
  const handleTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // Native controls inside each row retain their own keyboard behavior.
    if (event.target !== event.currentTarget || !visible.length) return;
    const item = visible[focusedIndex];
    const expanded =
      item.children.length > 0 &&
      (filtering || !collapsedNodes.has(item.session.id));
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(focusedIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(focusedIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(visible.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (item.children.length) {
          if (!expanded) toggleNode(item.session.id);
          else focusRow(focusedIndex + 1);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (expanded && !filtering) toggleNode(item.session.id);
        else {
          const parent = visible.findIndex(
            (candidate) =>
              candidate.session.id === item.session.parentSessionId,
          );
          if (parent >= 0) focusRow(parent);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        void loadFocused(item.session.id);
        break;
    }
  };
  const updateWidth = (width: number) => {
    const next = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, width));
    setSidebarWidth(next);
    saveSidebarWidth(next);
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanup.current?.();
    const startX = event.clientX,
      startWidth = sidebarWidth;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (next: globalThis.PointerEvent) =>
      updateWidth(startWidth + next.clientX - startX);
    const finish = () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      dragCleanup.current = null;
    };
    dragCleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };
  const resetFilters = () => {
    store.setQuery("");
    setCategory("all");
    setActivity("all");
  };
  const newButton = onNewSession ? (
    <button
      type="button"
      className="session-panel__icon session-panel__new"
      aria-label="New session"
      title="New session"
      onClick={() => {
        resetFilters();
        onNewSession();
      }}
    >
      <KeatingIcon icon={PenLine} size={20} />
    </button>
  ) : null;

  if (collapsed)
    return (
      <aside
        className="session-panel session-panel--collapsed"
        aria-label="Sessions"
      >
        <button
          type="button"
          className="session-panel__icon"
          aria-label="Expand session panel"
          title="Expand session panel"
          onClick={() => onCollapsedChange?.(false)}
        >
          <KeatingIcon icon={SidebarLeft} size={21} />
        </button>
        {newButton}
      </aside>
    );

  return (
    <aside
      className="session-panel"
      aria-label="Sessions"
      style={{ width: sidebarWidth }}
    >
      <header className="session-panel__header">
        <h2>
          {newButton}
          <span>{store.items.length}</span>
        </h2>
        <div>
          {onCollapsedChange ? (
            <button
              type="button"
              className="session-panel__icon"
              aria-label="Collapse session panel"
              title="Collapse session panel"
              onClick={() => onCollapsedChange(true)}
            >
              <KeatingIcon icon={SidebarLeft} size={20} active />
            </button>
          ) : null}
        </div>
      </header>
      <div className="session-panel__tools">
        <label className="session-panel__search">
          <KeatingIcon icon={Magnifier} size={18} />
          <input
            type="search"
            aria-label="Search sessions"
            placeholder="Find a session"
            value={store.query}
            onChange={(event) => store.setQuery(event.target.value)}
          />
          {store.query ? (
            <button
              type="button"
              className="session-panel__icon"
              aria-label="Clear search"
              onClick={() => store.setQuery("")}
            >
              <KeatingIcon icon={Xmark} size={16} />
            </button>
          ) : null}
        </label>
        <div className="session-panel__filters">
          <label>
            <span>Category</span>
            <Select
              aria-label="Session category"
              value={category}
              onValueChange={(value) =>
                setCategory(value as CategoryKey | "all")
              }
            >
              <option value="all">All subjects</option>
              {categories.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label} · {item.count}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span>Activity</span>
            <Select
              aria-label="Session activity"
              value={activity}
              onValueChange={(value) =>
                setActivity(value as SessionActivityFilter)
              }
            >
              {Object.entries(SESSION_ACTIVITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>
      {store.error || error ? (
        <div className="session-panel__error" role="alert">
          <p>{error || store.error}</p>
          {store.error ? (
            <button type="button" onClick={() => void store.reload()}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="session-panel__scroll">
        {store.loading ? (
          <div
            className="session-library__skeletons"
            aria-label="Loading sessions"
            role="status"
          >
            {[0, 1, 2].map((item) => (
              <div key={item} className="session-library__skeleton">
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : visible.length ? (
          <>
            {filtering ? (
              <p className="session-panel__results" role="status">
                {filtered.matches.size}{" "}
                {filtered.matches.size === 1 ? "match" : "matches"}
                <button type="button" onClick={resetFilters}>
                  Clear filters
                </button>
              </p>
            ) : null}
            <ul
              id={treeId}
              className="session-panel__tree"
              role="tree"
              aria-label="Session library"
              tabIndex={0}
              aria-activedescendant={
                visible[focusedIndex]
                  ? rowId(visible[focusedIndex].session.id)
                  : undefined
              }
              onKeyDown={handleTreeKeyDown}
              onFocus={(event) =>
                setTreeFocused(event.target === event.currentTarget)
              }
              onBlur={() => setTreeFocused(false)}
            >
              {visible.map(({ session, depth, children }, index) => <SessionTreeRow
                key={session.id}
                rowId={rowId(session.id)}
                session={session}
                depth={depth}
                branchCount={children.length}
                expanded={filtering || !collapsedNodes.has(session.id)}
                filtering={filtering}
                focused={treeFocused && index === focusedIndex}
                hero={store.heroes.get(session.id)}
                active={session.id === activeSessionId}
                forking={session.id === forkingSessionId}
                justForked={session.id === forkedSessionId}
                parentTitle={session.parentSessionId ? titles.get(session.parentSessionId) : undefined}
                contextOnly={filtering && !filtered.matches.has(session.id)}
                onLoad={loadRow}
                onFork={forkRow}
                onSuggestTitle={onSuggestTitle ? suggestRowTitle : undefined}
                onRename={renameRow}
                onDelete={removeRow}
                onToggle={toggleNode}
              />)}
            </ul>
          </>
        ) : (
          <div className="session-panel__empty">
            <KeatingIcon icon={filtering ? Magnifier : BranchUp} size={30} />
            <h3>
              {filtering ? "No sessions found" : "A place to pick up again"}
            </h3>
            <p>
              {filtering
                ? "Try another subject or search."
                : "Your conversations and their forks will live here."}
            </p>
            {filtering ? (
              <button type="button" onClick={resetFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        )}
      </div>
      <div
        className="session-panel__resize"
        role="separator"
        tabIndex={0}
        aria-label="Resize session panel"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_W}
        aria-valuemax={SIDEBAR_MAX_W}
        aria-valuenow={sidebarWidth}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          updateWidth(
            event.key === "Home"
              ? SIDEBAR_MIN_W
              : event.key === "End"
                ? SIDEBAR_MAX_W
                : sidebarWidth + (event.key === "ArrowRight" ? 24 : -24),
          );
        }}
      />
    </aside>
  );
}
