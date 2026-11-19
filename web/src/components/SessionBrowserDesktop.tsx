import { css } from "../../styled-system/css";
import { ChatStorageLine } from "./chat/storage-line";
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
import { KeatingGlyph } from "../design-system/glyphs";
import { SessionCard, type SessionCardProps } from "./SessionCard";
import { flattenSessionTree, type SessionTreeNode } from "./session-tree";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import type { SessionSection } from "./session-placement";
import { SessionLibraryEmpty, SessionSearch, SessionSubjectChips, useSubjectLibrary } from "./SessionLibraryTools";
import "./session-panel.css";

const expandedChevron = css({ "&&&": { transform: "rotate(0)" } });

const TREE_COLLAPSED_STORAGE_KEY = "keating:session-tree-collapsed";
const SIDEBAR_MIN_W = 224;
const SIDEBAR_MAX_W = 640;
const SIDEBAR_DEFAULT_W = 264;
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
  onTogglePin: (id: string) => void;
  onMoveSection: (id: string) => void;
  rowId: string;
  depth: number;
  branchCount: number;
  expanded: boolean;
  filtering: boolean;
  focused: boolean;
  onToggle: (id: string) => void;
}

const SECTION_LABELS: Record<SessionSection, string> = {
  pinned: "Pinned",
  recent: "Recent",
  earlier: "Earlier",
};

interface SessionGroup {
  key: SessionSection | "results";
  rows: SessionTreeNode[];
}

// Updating the current session should only revisit the old and new rows.
// Offscreen content-visibility saves layout work, but does not skip React work.
const SessionTreeRow = memo(function SessionTreeRow({
  rowId, depth, branchCount, expanded, filtering, focused, onToggle, onTogglePin, onMoveSection, ...cardProps
}: SessionTreeRowProps) {
  const { session, active } = cardProps;
  const placementActions = depth === 0 ? { onTogglePin, onMoveSection } : {};
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
    <SessionCard {...cardProps} {...placementActions} pinned={depth === 0 && cardProps.pinned} quickActions />
    {branchCount ? <button
      type="button"
      className="session-panel__forks"
      aria-label={`${expanded ? "Collapse" : "Expand"} forks of ${session.title}`}
      aria-expanded={expanded}
      disabled={filtering}
      onClick={() => onToggle(session.id)}
    >
      <KeatingGlyph name="fork" size={14} />
      <span>{branchCount} {branchCount === 1 ? "fork" : "forks"}</span>
      <KeatingGlyph name="chev" size={14} className={expanded ? expandedChevron : undefined} />
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
  const searchInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const focusOnSlash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]")) return;
      if (!panel.current?.getClientRects().length || document.querySelector("dialog[open], [aria-modal=true]:not(dialog):not([hidden])")) return;
      event.preventDefault();
      if (collapsed) { focusSearch.current = true; onCollapsedChange?.(false); }
      else searchInput.current?.focus();
    };
    document.addEventListener("keydown", focusOnSlash);
    return () => document.removeEventListener("keydown", focusOnSlash);
  }, [collapsed, onCollapsedChange]);
  const focusSearch = useRef(false);
  const [focusedId, setFocusedId] = useState(activeSessionId);
  const [error, setError] = useState("");
  const [treeFocused, setTreeFocused] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const treeId = useId();
  const library = useSubjectLibrary(store, activeSessionId);
  const { searching: filtering, filtered, sections, earlierPage, earlierOpen, sectionOf } = library;
  // The parent owns live callbacks and may recreate them on every agent update.
  // Stable delegates let unchanged rows keep their render without stale actions.
  const actionsRef = useRef({ onLoad, onFork, onSuggestTitle, rename: store.rename });
  actionsRef.current = { onLoad, onFork, onSuggestTitle, rename: store.rename };
  const loadRow = useCallback((id: string) => actionsRef.current.onLoad(id), []);
  const forkRow = useCallback((id: string) => actionsRef.current.onFork(id), []);
  const renameRow = useCallback((id: string, title: string, aiGeneratedTitle?: boolean) => actionsRef.current.rename(id, title, aiGeneratedTitle), []);
  const suggestRowTitle = useCallback((id: string) => {
    const suggest = actionsRef.current.onSuggestTitle;
    if (!suggest) return Promise.reject(new Error("Title suggestions are unavailable."));
    return suggest(id);
  }, []);
  // Section headers are not rows: arrow keys walk one flat list across sections.
  const groups = useMemo<SessionGroup[]>(() => {
    if (filtering) return [{ key: "results", rows: flattenSessionTree(filtered.roots) }];
    return [
      { key: "pinned" as const, rows: flattenSessionTree(sections.pinned, collapsedNodes) },
      { key: "recent" as const, rows: flattenSessionTree(sections.recent, collapsedNodes) },
      { key: "earlier" as const, rows: flattenSessionTree(earlierPage.roots, collapsedNodes) },
    ];
  }, [filtering, filtered.roots, sections, earlierPage.roots, collapsedNodes]);
  const visible = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
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
  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
  const { resetFilters } = library;
  const newButton = onNewSession ? (
    <button
      type="button"
      className="session-panel__icon session-panel__new k-lift"
      data-glyph-surface="inverse"
      aria-label="New session"
      title="New session"
      onClick={() => {
        resetFilters();
        onNewSession();
      }}
    >
      <KeatingGlyph name="plus" size={13} /><span aria-hidden="true">New</span>
    </button>
  ) : null;

  if (collapsed)
    return (
      <aside ref={panel}
        className="session-panel session-panel--collapsed"
        aria-label="Sessions"
      >
        <button
          type="button"
          className="session-panel__icon k-bloom"
          aria-label="Expand session panel"
          title="Expand session panel"
          onClick={() => onCollapsedChange?.(false)}
        >
          <KeatingGlyph name="panel" size={15} />
        </button>
        {newButton}
        <button type="button" className="session-panel__icon k-bloom" aria-label="Search sessions" title="Search sessions"
          onClick={() => { focusSearch.current = true; onCollapsedChange?.(false); }}>
          <KeatingGlyph name="search" size={15} />
        </button>
      </aside>
    );

  return (
    <aside ref={panel}
      className="session-panel"
      aria-label="Sessions"
      style={{ width: sidebarWidth === SIDEBAR_DEFAULT_W ? "12.7rem" : sidebarWidth }}
    >
      <header className="session-panel__header">
        <h2>
          {newButton}
          <span>{store.items.length} {store.items.length === 1 ? "session" : "sessions"}</span>
        </h2>
        <div>
          {onCollapsedChange ? (
            <button
              type="button"
              className="session-panel__icon k-bloom"
              aria-label="Collapse session panel"
              title="Collapse session panel"
              onClick={() => onCollapsedChange(true)}
            >
              <KeatingGlyph name="panel" size={15} active />
            </button>
          ) : null}
        </div>
      </header>
      <div className="session-panel__tools">
        <SessionSearch store={store} desktop inputRef={node => {
          searchInput.current = node;
          if (node && focusSearch.current) { focusSearch.current = false; node.focus(); }
        }} />
        <SessionSubjectChips library={library} total={store.items.length} />
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
        ) : (filtering ? visible.length : store.roots.length) ? (
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
            <div
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
              {groups.map((group) => {
                const rows = group.rows.map(({ session, depth, children }) => {
                  const rootSection = depth === 0 ? sectionOf.get(session.id) : undefined;
                  return <SessionTreeRow
                    key={session.id}
                    rowId={rowId(session.id)}
                    session={session}
                    depth={depth}
                    branchCount={children.length}
                    expanded={filtering || !collapsedNodes.has(session.id)}
                    filtering={filtering}
                    focused={treeFocused && visible[focusedIndex]?.session.id === session.id}
                    hero={store.heroes.get(session.id)}
                    active={session.id === activeSessionId}
                    forking={session.id === forkingSessionId}
                    justForked={session.id === forkedSessionId}
                    parentTitle={session.parentSessionId ? titles.get(session.parentSessionId) : undefined}
                    contextOnly={filtering && !filtered.matches.has(session.id)}
                    pinned={rootSection === "pinned"}
                    inEarlier={rootSection === "earlier"}
                    onLoad={loadRow}
                    onFork={forkRow}
                    onSuggestTitle={onSuggestTitle ? suggestRowTitle : undefined}
                    onRename={renameRow}
                    onDelete={library.remove}
                    onTogglePin={library.togglePin}
                    onMoveSection={library.moveSection}
                    onToggle={toggleNode}
                  />;
                });
                if (group.key === "results") return <ul key="results" role="none" className="session-panel__rows">{rows}</ul>;
                if (group.key === "earlier") {
                  if (!sections.earlier.length) return null;
                  const headingId = `${treeId}-earlier`;
                  return <div key="earlier" role="group" aria-labelledby={headingId} className="session-panel__section" data-section="earlier">
                    <h3 className="session-panel__section-label">
                      <button
                        id={headingId}
                        type="button"
                        className="session-panel__earlier"
                        aria-expanded={earlierOpen}
                        aria-controls={`${headingId}-rows`}
                        onClick={() => library.setEarlierOpen(!earlierOpen)}
                      >
                        <KeatingGlyph name="chev" size={14} className={earlierOpen ? expandedChevron : undefined} />
                        <span>{SECTION_LABELS.earlier}</span>
                        <span className="session-panel__count">{sections.earlier.length}</span>
                      </button>
                    </h3>
                    <ul id={`${headingId}-rows`} role="none" className="session-panel__rows">{rows}</ul>
                    {earlierPage.nextCount > 0 ? <button
                      type="button"
                      className="session-panel__more"
                      onClick={library.showMoreEarlier}
                    >
                      Show {earlierPage.nextCount} more
                    </button> : null}
                  </div>;
                }
                if (!rows.length) return null;
                const headingId = `${treeId}-${group.key}`;
                const labelled = group.key === "pinned" || sections.pinned.length > 0 || sections.earlier.length > 0;
                return <div key={group.key} role="group" aria-labelledby={labelled ? headingId : undefined} aria-label={labelled ? undefined : SECTION_LABELS[group.key]} className="session-panel__section" data-section={group.key}>
                  {labelled ? <h3 id={headingId} className="session-panel__section-label">{SECTION_LABELS[group.key]}</h3> : null}
                  <ul role="none" className="session-panel__rows">{rows}</ul>
                </div>;
              })}
            </div>
          </>
        ) : (
          <SessionLibraryEmpty desktop filtering={filtering} resetFilters={resetFilters} />
        )}
      </div>
      <ChatStorageLine.Consumer>{line => line}</ChatStorageLine.Consumer>
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
