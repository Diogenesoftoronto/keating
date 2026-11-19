import { css } from "../../styled-system/css";
import { useEffect, useId, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import type { SessionBrowserSurfaceProps } from "./SessionBrowser";
import { SessionCard } from "./SessionCard";
import { flattenSessionTree, type SessionTreeNode } from "./session-tree";
import type { SessionSection } from "./session-placement";
import { SessionLibraryEmpty, SessionSearch, SessionSubjectChips, useSubjectLibrary } from "./SessionLibraryTools";
import "./session-library.css";

const expandedChevron = css({ "&&&": { transform: "rotate(0)" } });

const SECTION_LABELS: Record<SessionSection, string> = {
  pinned: "Pinned",
  recent: "Recent",
  earlier: "Earlier",
};

function SessionFamily({
  root,
  matches,
  filtering,
  section,
  onTogglePin,
  onMoveSection,
  onDelete,
  ...props
}: SessionBrowserSurfaceProps & {
  root: SessionTreeNode;
  matches: ReadonlySet<string>;
  filtering: boolean;
  section?: SessionSection;
  onTogglePin: (id: string) => void;
  onMoveSection: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
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
      onDelete={onDelete}
      {...(node === root
        ? {
            pinned: section === "pinned",
            inEarlier: section === "earlier",
            onTogglePin,
            onMoveSection,
          }
        : {})}
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
            <KeatingGlyph name="fork" size={15} />
            <span>
              {branches.length} {branches.length === 1 ? "fork" : "forks"}
            </span>
            <KeatingGlyph name="chev" size={15} className={showBranches ? expandedChevron : undefined} />
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
  const [forkedSource, setForkedSource] = useState<string | null>(null);
  const forkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const library = useSubjectLibrary(store, props.activeSessionId);
  const { searching: filtering, filtered: result, sections, earlierPage, earlierOpen } = library;

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

  const { resetFilters } = library;
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

  const renderFamily = (root: SessionTreeNode, section?: SessionSection) => (
    <SessionFamily
      key={root.session.id}
      {...props}
      root={root}
      matches={result.matches}
      filtering={filtering}
      section={section ?? library.sectionOf.get(root.session.id)}
      onLoad={handleLoad}
      onFork={handleFork}
      onTogglePin={library.togglePin}
      onMoveSection={library.moveSection}
      onDelete={library.remove}
      forkedSessionId={props.forkedSessionId ?? forkedSource}
    />
  );

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
      title="Close sessions"
            onClick={onMobileClose}
          >
            <KeatingGlyph name="x" size={22} />
          </button>
        ) : null}
      </header>
      <div className="session-library__tools">
        <div className="session-library__search-row">
          <SessionSearch store={store} />
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
              <KeatingGlyph name="plus" size={18} />
            </button>
          ) : null}
        </div>
        <SessionSubjectChips library={library} total={store.items.length} />
        <div className="session-library__browse-row">
          <p role="status" aria-live="polite">
            {store.loading
              ? "Loading sessions"
              : filtering
                ? `${result.matches.size} ${result.matches.size === 1 ? "match" : "matches"}`
                : `${store.items.length} ${store.items.length === 1 ? "session" : "sessions"}`}
          </p>
          {filtering ? (
            <button type="button" onClick={resetFilters}>
              Clear filters
            </button>
          ) : null}
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
        ) : filtering && result.roots.length ? (
          <ul className="session-library__families" aria-label="Matching sessions">
            {result.roots.map((root) => renderFamily(root))}
          </ul>
        ) : !filtering && store.roots.length ? (
          <div className="session-library__sections">
            {(["pinned", "recent"] as const).map((key) =>
              sections[key].length ? (
                <section
                  key={key}
                  className="session-library__section"
                  aria-labelledby={`${headingId}-${key}`}
                >
                  <h3
                    id={`${headingId}-${key}`}
                    className="session-library__section-label"
                    hidden={key === "recent" && !sections.pinned.length && !sections.earlier.length}
                  >
                    {SECTION_LABELS[key]}
                  </h3>
                  <ul className="session-library__families">
                    {sections[key].map((root) => renderFamily(root, key))}
                  </ul>
                </section>
              ) : null,
            )}
            {sections.earlier.length ? (
              <section
                className="session-library__section"
                aria-labelledby={`${headingId}-earlier`}
              >
                <h3 className="session-library__section-label">
                  <button
                    id={`${headingId}-earlier`}
                    type="button"
                    className="session-library__earlier"
                    aria-expanded={earlierOpen}
                    aria-controls={`${headingId}-earlier-rows`}
                    onClick={() => library.setEarlierOpen(!earlierOpen)}
                  >
                    <KeatingGlyph name="chev" size={15} className={earlierOpen ? expandedChevron : undefined} />
                    <span>{SECTION_LABELS.earlier}</span>
                    <span className="session-library__count">{sections.earlier.length}</span>
                  </button>
                </h3>
                <ul id={`${headingId}-earlier-rows`} className="session-library__families">
                  {earlierPage.roots.map((root) => renderFamily(root, "earlier"))}
                </ul>
                {earlierPage.nextCount > 0 ? (
                  <button
                    type="button"
                    className="session-library__more"
                    onClick={library.showMoreEarlier}
                  >
                    Show {earlierPage.nextCount} more
                  </button>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : !store.error ? (
          <SessionLibraryEmpty filtering={filtering} resetFilters={resetFilters} />
        ) : null}
      </div>
    </dialog>
  );
}
