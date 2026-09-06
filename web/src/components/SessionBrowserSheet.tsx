import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "reicon-react/icons/ChevronDown";
import { BranchUp as GitBranch } from "reicon-react/icons/BranchUp";
import { Layers2 as Layers3 } from "reicon-react/icons/Layers2";
import { Plus } from "reicon-react/icons/Plus";
import { Magnifier as Search } from "reicon-react/icons/Magnifier";
import { Xmark as X } from "reicon-react/icons/Xmark";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import { SessionCard } from "./SessionCard";
import { Select } from "./Select";
import { flattenSessionTree, type SessionTreeNode } from "./session-tree";
import { type CategoryKey } from "./session-card-visuals";
import {
  filterSessionLibrary,
  sessionCategories,
  SESSION_ACTIVITY_LABELS,
  type SessionActivityFilter,
} from "./session-library";
import "./session-library.css";

function SessionFamily({
  root,
  matches,
  filtering,
  ...props
}: SessionBrowserSurfaceProps & {
  root: SessionTreeNode;
  matches: ReadonlySet<string>;
  filtering: boolean;
}) {
  const branches = flattenSessionTree(root.children);
  const [expanded, setExpanded] = useState(
    branches.length <= 3 ||
      branches.some((node) => node.session.id === props.activeSessionId),
  );
  const branchId = useId();
  const showBranches = expanded || filtering;
  const titles = new Map(
    props.store.items.map((session) => [session.id, session.title]),
  );
  const renderEntry = (node: SessionTreeNode) => (
    <SessionCard
      session={node.session}
      hero={props.store.heroes.get(node.session.id)}
      active={node.session.id === props.activeSessionId}
      forking={node.session.id === props.forkingSessionId}
      justForked={node.session.id === props.forkedSessionId}
      parentTitle={
        node.session.parentSessionId
          ? titles.get(node.session.parentSessionId)
          : undefined
      }
      contextOnly={filtering && !matches.has(node.session.id)}
      onLoad={props.onLoad}
      onFork={props.onFork}
      onSuggestTitle={props.onSuggestTitle}
      onRename={props.store.rename}
      onDelete={props.store.remove}
    />
  );
  return (
    <li className="session-family">
      {renderEntry(root)}
      {branches.length ? (
        <>
          <button
            type="button"
            className="session-family__toggle"
            aria-controls={branchId}
            aria-expanded={showBranches}
            disabled={filtering}
            onClick={() => setExpanded(!expanded)}
          >
            <GitBranch size={15} />
            <span>
              {branches.length} {branches.length === 1 ? "fork" : "forks"}
            </span>
            <ChevronDown size={15} data-expanded={showBranches || undefined} />
          </button>
          {showBranches ? (
            <ul
              id={branchId}
              className="session-family__branches"
              aria-label={`Forks of ${root.session.title}`}
            >
              {branches.map((node) => (
                <li
                  key={node.session.id}
                  className="session-family__branch"
                  data-deep={node.depth > 1 || undefined}
                >
                  {renderEntry(node)}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** The mobile library keeps sessions and their forks together at every filter. */
export function SessionBrowserSheet(props: SessionBrowserSurfaceProps) {
  const { store, onMobileClose, onNewSession } = props;
  const [category, setCategory] = useState<CategoryKey | "all">("all");
  const [activity, setActivity] = useState<SessionActivityFilter>("all");
  const [forkedSource, setForkedSource] = useState<string | null>(null);
  const forkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const categories = useMemo(
    () => sessionCategories(store.items),
    [store.items],
  );
  const result = useMemo(
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
  const filtering =
    Boolean(store.query.trim()) || category !== "all" || activity !== "all";
  const activityOptions = (
    Object.keys(SESSION_ACTIVITY_LABELS) as SessionActivityFilter[]
  ).filter(
    (value) =>
      value === "all" ||
      value === "forks" ||
      value === activity ||
      [...store.heroes.values()].some((hero) =>
        (hero.types ?? [hero.type]).includes(value),
      ),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    dialog?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(forkTimer.current);
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const resetFilters = () => {
    setCategory("all");
    setActivity("all");
    store.setQuery("");
  };
  const handleLoad = async (id: string) => {
    await props.onLoad(id);
    onMobileClose?.();
  };
  const handleFork = async (id: string) => {
    await props.onFork(id);
    setForkedSource(id);
    clearTimeout(forkTimer.current);
    forkTimer.current = setTimeout(() => setForkedSource(null), 1800);
  };

  return (
    <dialog
      ref={dialogRef}
      className="session-library"
      aria-labelledby={headingId}
      aria-modal="true"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onMobileClose?.();
      }}
    >
      <header className="session-library__header">
        <div className="session-library__heading">
          <h2 id={headingId}>Sessions</h2>
        </div>
        {onMobileClose ? (
          <button
            type="button"
            className="session-library__icon-button"
            aria-label="Close sessions"
            onClick={onMobileClose}
          >
            <X size={22} />
          </button>
        ) : null}
      </header>
      <div className="session-library__tools">
        <div className="session-library__search-row">
          <label className="session-library__search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search sessions"
              value={store.query}
              placeholder="Search sessions"
              onChange={(event) => store.setQuery(event.target.value)}
            />
          </label>
          {onNewSession ? (
            <button
              type="button"
              className="session-library__new session-library__primary"
              aria-label="New session"
              title="New session"
              onClick={() => {
                onNewSession();
                onMobileClose?.();
              }}
            >
              <Plus size={18} />
            </button>
          ) : null}
        </div>
        <div
          className="session-library__categories"
          role="group"
          aria-label="Filter sessions by category"
        >
          <button
            type="button"
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            All<span>{store.items.length}</span>
          </button>
          {categories.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={category === item.key}
              onClick={() =>
                setCategory(category === item.key ? "all" : item.key)
              }
            >
              <span
                className="session-entry__category-dot"
                style={{ background: item.accent }}
                aria-hidden="true"
              />
              {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
        <div className="session-library__browse-row">
          <p role="status" aria-live="polite">
            {store.loading
              ? "Loading sessions"
              : filtering
                ? `${result.matches.size} ${result.matches.size === 1 ? "match" : "matches"}`
                : `${store.items.length} ${store.items.length === 1 ? "session" : "sessions"}`}
            <span>{filtering ? "" : " · recent first"}</span>
          </p>
          <label className="session-library__activity">
            <Layers3 size={14} aria-hidden="true" />
            <Select
              aria-label="Filter sessions by activity"
              value={activity}
              onValueChange={(value) =>
                setActivity(value as SessionActivityFilter)
              }
            >
              {activityOptions.map((value) => (
                <option key={value} value={value}>
                  {SESSION_ACTIVITY_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>
      <div className="session-library__scroll">
        {store.error ? (
          <div className="session-library__error" role="alert">
            <p>{store.error}</p>
            <button type="button" onClick={() => void store.reload()}>
              Try again
            </button>
          </div>
        ) : null}
        {store.loading ? (
          <div className="session-library__skeletons" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="session-library__skeleton">
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : result.roots.length ? (
          <ul className="session-library__families" aria-label="Saved sessions">
            {result.roots.map((root) => (
              <SessionFamily
                key={root.session.id}
                {...props}
                root={root}
                matches={result.matches}
                filtering={filtering}
                onLoad={handleLoad}
                onFork={handleFork}
                forkedSessionId={props.forkedSessionId ?? forkedSource}
              />
            ))}
          </ul>
        ) : !store.error ? (
          <div className="session-library__empty">
            <Search size={28} aria-hidden="true" />
            <h3>
              {filtering
                ? "No sessions found"
                : "Your next question starts here"}
            </h3>
            <p>
              {filtering
                ? "Try another subject or search term."
                : "Start a session to explore something new."}
            </p>
            {filtering ? (
              <button type="button" onClick={resetFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
