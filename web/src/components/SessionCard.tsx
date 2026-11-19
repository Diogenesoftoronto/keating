import { memo, useEffect, useId, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import type { SessionMetadata } from "../types/session";
import { shortSubject } from "./SessionLibraryTools";
import { type ArtifactHero, categorize } from "./session-card-visuals";
import { formatRelativeSessionDate } from "../lib/session-date";
import { Spinner } from "./Spinner";
import "./session-library.css";

const ARTIFACT_LABELS = {
  map: "Concept map",
  animation: "Animation",
  plan: "Lesson plan",
};

export interface SessionCardProps {
  session: SessionMetadata;
  hero?: ArtifactHero;
  childCount?: number;
  active?: boolean;
  forking?: boolean;
  justForked?: boolean;
  /** Name the source even when deep forks use the same visual indentation. */
  parentTitle?: string;
  /** A non-matching ancestor retained to explain a filtered result. */
  contextOnly?: boolean;
  onLoad: (sessionId: string) => void | Promise<void>;
  onFork: (sessionId: string) => void | Promise<void>;
  onSuggestTitle?: (sessionId: string) => Promise<string>;
  onRename: (
    sessionId: string,
    title: string,
    aiGeneratedTitle?: boolean,
  ) => void | Promise<void>;
  onDelete: (sessionId: string) => void | Promise<void>;
  /** Shown in the Pinned section; adds a pin mark. */
  pinned?: boolean;
  /** Lives in the collapsed Earlier group; flips the move action's wording. */
  inEarlier?: boolean;
  /** Pin or unpin. Omit to hide placement actions (e.g. forks, which follow their root). */
  onTogglePin?: (sessionId: string) => void;
  /** Move to Earlier, or back to Recent when `inEarlier`. */
  onMoveSection?: (sessionId: string) => void;
  /** Also offer pin/move as hover- and focus-revealed buttons on the row (desktop). */
  quickActions?: boolean;
}

export const SessionCard = memo(function SessionCard({
  session,
  hero,
  childCount = 0,
  active = false,
  forking = false,
  justForked = false,
  parentTitle,
  contextOnly = false,
  onLoad,
  onFork,
  onSuggestTitle,
  onRename,
  onDelete,
  pinned = false,
  inEarlier = false,
  onTogglePin,
  onMoveSection,
  quickActions = false,
}: SessionCardProps) {
  const category = categorize(session.title);
  const [panel, setPanel] = useState<"actions" | "rename" | "delete" | null>(
    null,
  );
  const [draft, setDraft] = useState(session.title);
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const actionsRef = useRef<HTMLButtonElement>(null);
  const previousPanel = useRef(panel);
  useEffect(() => {
    if (previousPanel.current && !panel && !busy) actionsRef.current?.focus();
    if (!busy) previousPanel.current = panel;
  }, [panel, busy]);

  const closePanel = () => {
    setPanel(null);
    setError(null);
  };
  const run = async (action: () => void | Promise<void>, close = true) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      if (close) closePanel();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't save this change. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveRename = () => {
    const title = draft.trim();
    if (!title) return;
    void run(() =>
      title === session.title.trim()
        ? undefined
        : onRename(session.id, title, title === suggestedTitle),
    );
  };
  const title = session.title || "Untitled session";
  const pinLabel = pinned ? "Unpin" : "Pin";
  const moveLabel = inEarlier ? "Move back to Recent" : "Move to Earlier";
  const moveGlyph = inEarlier ? "rise" : "down";

  return (
    <article
      className="session-entry"
      data-active={active || undefined}
      data-arriving={justForked || undefined}
      data-context={contextOnly || undefined}
      data-pinned={pinned || undefined}
    >
      <div className="session-entry__row">
        <button
          type="button"
          className="session-entry__open"
          aria-label={`Open session ${session.title}`}
          aria-current={active ? "true" : undefined}
          disabled={busy}
          onClick={() => void run(() => onLoad(session.id), false)}
        >
          <span className="session-entry__title">{title}</span>
          <span className="session-entry__meta">
            <span className="session-entry__eyeline">
              <span className="session-entry__category" title={category.label}>
                <span
                  className="session-entry__category-dot"
                  style={{ background: category.accent }}
                  aria-hidden="true"
                />
                {shortSubject(category)}
              </span>
              {active ? (
                <span className="session-entry__current">Current</span>
              ) : contextOnly ? (
                <span className="session-entry__context">Origin</span>
              ) : null}
              {pinned ? (
                <span className="session-entry__pinned" title="Pinned">
                  <KeatingGlyph name="bookmark" size={12} />
                  <span className="session-entry__sr">Pinned</span>
                </span>
              ) : null}
              <span className="session-entry__time">
                {formatRelativeSessionDate(session.lastModified, {
                  today: "time",
                })}
              </span>
            </span>

            <span>
              {session.messageCount}{" "}
              {session.messageCount === 1 ? "message" : "messages"}
            </span>
            {childCount > 0 ? (
              <span>
                {childCount} {childCount === 1 ? "fork" : "forks"}
              </span>
            ) : null}
            {hero ? (
              <span className="session-entry__artifact">
                {ARTIFACT_LABELS[hero.type]}
              </span>
            ) : null}
            {parentTitle || session.parentSessionId ? (
              <span className="session-entry__parent">
                <KeatingGlyph name="fork" size={12} />
                <span>
                  {parentTitle ? `From ${parentTitle}` : "Forked session"}
                </span>
              </span>
            ) : null}
          </span>
        </button>
        {quickActions && (onTogglePin || onMoveSection) ? (
          <div className="session-entry__quick">
            {onTogglePin ? (
              <button
                type="button"
                className="session-library__icon-button k-bloom"
                aria-label={`${pinLabel} ${title}`}
                title={pinLabel}
                disabled={busy}
                onClick={() => onTogglePin(session.id)}
              >
                <KeatingGlyph name="bookmark" size={16} />
              </button>
            ) : null}
            {onMoveSection ? (
              <button
                type="button"
                className="session-library__icon-button k-bloom"
                aria-label={`${moveLabel}: ${title}`}
                title={moveLabel}
                disabled={busy}
                onClick={() => onMoveSection(session.id)}
              >
                <KeatingGlyph name={moveGlyph} size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="session-entry__side">
          <button
            ref={actionsRef}
            type="button"
            className="session-library__icon-button k-bloom"
            aria-label={`Actions for ${session.title}`}
            title="More actions"
            aria-expanded={panel !== null}
            aria-controls={panelId}
            disabled={busy}
            onClick={() => {
              setError(null);
              setPanel(panel ? null : "actions");
            }}
          >
            <Spinner size={16} loading={busy}>
              {panel ? <KeatingGlyph name="x" size={16} /> : <KeatingGlyph name="more" size={16} />}
            </Spinner>
          </button>
        </div>
      </div>
      {justForked ? (
        <p className="session-entry__notice" role="status">
          <KeatingGlyph name="check" size={14} />
          Fork created
        </p>
      ) : null}
      {panel ? (
        <div
          id={panelId}
          className="session-entry__panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closePanel();
            }
          }}
        >
          {panel === "actions" ? (
            <div className="session-entry__actions">
              <button
                type="button"
                title="Fork session"
                aria-label="Fork session"
                disabled={busy || forking}
                onClick={() => void run(() => onFork(session.id))}
              >
                <Spinner size={16} loading={forking}>
                  <KeatingGlyph name="fork" size={16} />
                </Spinner>
              </button>
              <button
                type="button"
                title="Rename"
                aria-label="Rename"
                disabled={busy}
                onClick={() => {
                  setDraft(session.title);
                  setSuggestedTitle(null);
                  setPanel("rename");
                }}
              >
                <KeatingGlyph name="edit" size={16} />
              </button>
              {onSuggestTitle ? (
                <button
                  type="button"
                  title="Suggest title"
                  aria-label="Suggest title"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const suggestion = await onSuggestTitle(session.id);
                      setDraft(suggestion);
                      setSuggestedTitle(suggestion.trim());
                      setPanel("rename");
                    }, false)
                  }
                >
                  <KeatingGlyph name="spark" size={16} />
                </button>
              ) : null}
              {onTogglePin ? (
                <button
                  type="button"
                  title={pinLabel}
                  aria-label={pinLabel}
                  disabled={busy}
                  onClick={() => {
                    closePanel();
                    onTogglePin(session.id);
                  }}
                >
                  <KeatingGlyph name="bookmark" size={16} />
                </button>
              ) : null}
              {onMoveSection ? (
                <button
                  type="button"
                  title={moveLabel}
                  aria-label={moveLabel}
                  disabled={busy}
                  onClick={() => {
                    closePanel();
                    onMoveSection(session.id);
                  }}
                >
                  <KeatingGlyph name={moveGlyph} size={16} />
                </button>
              ) : null}
              <button
                type="button"
                className="session-entry__destructive"
                title="Delete"
                aria-label="Delete"
                disabled={busy}
                onClick={() => setPanel("delete")}
              >
                <KeatingGlyph name="trash" size={16} />
              </button>
            </div>
          ) : null}
          {panel === "rename" ? (
            <form
              className="session-entry__rename"
              onSubmit={(event) => {
                event.preventDefault();
                saveRename();
              }}
            >
              <label htmlFor={`${panelId}-title`}>Session title</label>
              <input
                id={`${panelId}-title`}
                value={draft}
                autoFocus
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="session-entry__form-actions">
                <button type="button" disabled={busy} onClick={closePanel}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="session-library__primary"
                  disabled={busy || !draft.trim()}
                >
                  <KeatingGlyph name="check" size={16} />
                  Save title
                </button>
              </div>
            </form>
          ) : null}
          {panel === "delete" ? (
            <div className="session-entry__delete">
              <p>Delete “{session.title}”?</p>
              <div className="session-entry__form-actions">
                <button type="button" disabled={busy} onClick={closePanel}>
                  Keep session
                </button>
                <button
                  type="button"
                  className="session-entry__delete-confirm"
                  disabled={busy}
                  onClick={() => void run(() => onDelete(session.id))}
                >
                  <KeatingGlyph name="trash" size={16} />
                  Delete session
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="session-entry__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
});
