import { memo, useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight } from "reicon-react/icons/ArrowUpRight";
import { Check } from "reicon-react/icons/Check";
import { BranchUp as GitBranch } from "reicon-react/icons/BranchUp";
import { More as MoreHorizontal } from "reicon-react/icons/More";
import { PenLine as Pencil } from "reicon-react/icons/PenLine";
import { Feather as Sparkles } from "reicon-react/icons/Feather";
import { Trash2 } from "reicon-react/icons/Trash2";
import { Xmark as X } from "reicon-react/icons/Xmark";
import type { SessionMetadata } from "../types/session";
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

  return (
    <article
      className="session-entry"
      data-active={active || undefined}
      data-arriving={justForked || undefined}
      data-context={contextOnly || undefined}
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
          <span className="session-entry__eyeline">
            <span className="session-entry__category">
              <span
                className="session-entry__category-dot"
                style={{ background: category.accent }}
                aria-hidden="true"
              />
              {category.label}
            </span>
            {active ? (
              <span className="session-entry__current">Current</span>
            ) : contextOnly ? (
              <span className="session-entry__context">Origin</span>
            ) : null}
          </span>
          <span className="session-entry__title">
            {session.title || "Untitled session"}
          </span>
          {parentTitle || session.parentSessionId ? (
            <span className="session-entry__parent">
              <GitBranch size={12} aria-hidden="true" />
              <span>
                {parentTitle ? `From ${parentTitle}` : "Forked session"}
              </span>
            </span>
          ) : null}
          {session.preview ? (
            <span className="session-entry__description">
              {session.preview}
            </span>
          ) : (
            <span className="session-entry__description">
              {session.messageCount === 0
                ? "Ready for your first question."
                : "Open to pick up the conversation."}
            </span>
          )}
          <span className="session-entry__meta">
            <span>
              {formatRelativeSessionDate(session.lastModified, {
                today: "time",
              })}
            </span>
            <span>
              {session.messageCount}{" "}
              {session.messageCount === 1 ? "message" : "messages"}
            </span>
            {hero ? (
              <span className="session-entry__artifact">
                {ARTIFACT_LABELS[hero.type]}
              </span>
            ) : null}
            {childCount > 0 ? (
              <span>
                <GitBranch size={12} aria-hidden="true" />
                {childCount} {childCount === 1 ? "fork" : "forks"}
              </span>
            ) : null}
          </span>
        </button>
        <div className="session-entry__side">
          <button
            ref={actionsRef}
            type="button"
            className="session-library__icon-button"
            aria-label={`Actions for ${session.title}`}
            aria-expanded={panel !== null}
            aria-controls={panelId}
            disabled={busy}
            onClick={() => {
              setError(null);
              setPanel(panel ? null : "actions");
            }}
          >
            <Spinner size={18} loading={busy}>
              {panel ? <X size={18} /> : <MoreHorizontal size={20} />}
            </Spinner>
          </button>
          <ArrowUpRight
            size={17}
            className="session-entry__open-mark"
            aria-hidden="true"
          />
        </div>
      </div>
      {justForked ? (
        <p className="session-entry__notice" role="status">
          <Check size={14} />
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
                disabled={busy || forking}
                onClick={() => void run(() => onFork(session.id))}
              >
                <Spinner size={16} loading={forking}>
                  <GitBranch size={16} />
                </Spinner>
                Fork session
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(session.title);
                  setSuggestedTitle(null);
                  setPanel("rename");
                }}
              >
                <Pencil size={16} />
                Rename
              </button>
              {onSuggestTitle ? (
                <button
                  type="button"
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
                  <Sparkles size={16} />
                  Suggest title
                </button>
              ) : null}
              <button
                type="button"
                className="session-entry__destructive"
                disabled={busy}
                onClick={() => setPanel("delete")}
              >
                <Trash2 size={16} />
                Delete
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
                  <Check size={16} />
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
                  <Trash2 size={16} />
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
