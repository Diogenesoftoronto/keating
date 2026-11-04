import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Lock, Send, X } from "lucide-react";
import { css } from "../../../styled-system/css";
import {
  ROOM_MESSAGE_MAX_CHARS,
  type RoomMessage,
  type RoomOperation,
  type RoomOperationInput,
  type RoomViewerSnapshot,
} from "../../rooms/contracts";
import { buildRoomOperation, randomOperationId } from "../../rooms/client";
import { excerpt } from "./RoomTranscript";
import { roomStyles as s } from "./room-ui";

const TYPING_SIGNAL_MS = 2_500;

export type ComposerMode = "room" | "guidance";

/** Why this viewer cannot post, or null when they can. */
export function composerBlockedReason(snapshot: RoomViewerSnapshot): string | null {
  const { room, viewer, permissions } = snapshot;
  if (room.status === "ended") return "This room has ended. The transcript stays readable.";
  if (viewer.role === "observer") return "You are observing. Observers read the conversation without posting.";
  if (viewer.muted) return "A teacher muted you in this room. You can still read along.";
  if (!permissions.canPost) return "You cannot post in this room right now.";
  return null;
}

/**
 * Builds the operation for a composer submit. Kept pure so the attribution
 * rules (room message vs private guidance, reply targets) are testable.
 */
export function composerOperation(
  mode: ComposerMode,
  body: string,
  replyTo: RoomMessage | null,
  messageId = randomOperationId("msg"),
): RoomOperationInput {
  const text = body.trim();
  if (mode === "guidance") return { type: "whisper.post", messageId, body: text };
  return { type: "message.post", messageId, body: text, ...(replyTo ? { replyToId: replyTo.id } : {}) };
}

export function RoomComposer({
  snapshot,
  replyTo,
  onClearReply,
  onSubmit,
  onTyping,
}: {
  snapshot: RoomViewerSnapshot;
  replyTo: RoomMessage | null;
  onClearReply: () => void;
  /** Receives a full operation; retries of the same text reuse its id. */
  onSubmit: (operation: RoomOperation) => Promise<unknown>;
  onTyping: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<ComposerMode>("room");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /**
   * The operation for the text currently in the box. A retry after a lost
   * response resends the same id, so the server applies it at most once.
   * Editing the text or switching audience starts a new operation.
   */
  const pendingRef = useRef<RoomOperation | null>(null);
  /**
   * Sends that failed without a clear answer. The server may still have
   * applied them; when the message shows up in the transcript, it was sent.
   */
  const unconfirmedRef = useRef<Array<{ messageId: string; body: string }>>([]);
  const lastTypingRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const blocked = composerBlockedReason(snapshot);
  const canGuide = snapshot.permissions.canOversee && snapshot.room.status === "open";
  const onRequest = snapshot.room.settings.participation === "on-request";

  // Lost oversight mid-draft: never turn private guidance into a public post.
  useEffect(() => {
    if (canGuide || mode !== "guidance") return;
    setMode("room");
    pendingRef.current = null;
    setError("");
    if (body.trim()) {
      setNotice(snapshot.room.status === "ended"
        ? "The room ended, so the unsent private guidance was discarded."
        : "Your teacher access changed, so the unsent private guidance was discarded.");
    }
    setBody("");
  }, [body, canGuide, mode, snapshot.room.status]);

  // A send whose response was lost but which the server applied.
  const messages = snapshot.room.messages;
  useEffect(() => {
    if (unconfirmedRef.current.length === 0) return;
    const landed = new Set(messages.map((message) => message.id));
    const delivered = unconfirmedRef.current.filter((entry) => landed.has(entry.messageId));
    if (delivered.length === 0) return;
    unconfirmedRef.current = unconfirmedRef.current.filter((entry) => !landed.has(entry.messageId));
    setError("");
    if (pendingRef.current && "messageId" in pendingRef.current && landed.has(pendingRef.current.messageId)) pendingRef.current = null;
    if (delivered.some((entry) => entry.body.trim() === body.trim())) {
      setBody("");
      onClearReply();
      setNotice("Sent.");
    } else {
      setNotice("Your earlier message was delivered. The text below has not been sent yet.");
    }
  }, [body, messages, onClearReply]);

  useEffect(() => {
    pendingRef.current = null;
    if (replyTo) {
      setMode("room");
      inputRef.current?.focus();
    }
  }, [replyTo]);

  if (blocked) {
    return (
      <div className={css({ borderTop: "2px solid var(--ink)", px: "1rem", py: "0.9rem", display: "grid", gap: "0.45rem" })}>
        {notice ? <p role="status" className={s.notice}>{notice}</p> : null}
        <p role="status" className={css({ fontSize: "0.82rem", color: "var(--ink-soft)" })}>{blocked}</p>
      </div>
    );
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setError("");
    setNotice("");
    const operation = pendingRef.current
      ?? buildRoomOperation(snapshot.room.id, composerOperation(mode, body, mode === "room" ? replyTo : null));
    pendingRef.current = operation;
    try {
      await onSubmit(operation);
      pendingRef.current = null;
      setBody("");
      onClearReply();
    } catch (cause) {
      if ((operation.type === "message.post" || operation.type === "whisper.post") && !unconfirmedRef.current.some((entry) => entry.messageId === operation.messageId)) {
        unconfirmedRef.current.push({ messageId: operation.messageId, body: operation.body });
      }
      // Keep the unsent text in place so nothing is lost.
      setError(cause instanceof Error ? cause.message : "Your message was not sent.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && replyTo) {
      onClearReply();
    }
  };

  const guidance = mode === "guidance";
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={css({ borderTop: "2px solid var(--ink)", bg: guidance ? "color-mix(in srgb, var(--ink) 6%, var(--card))" : "var(--card)", px: "0.75rem", py: "0.65rem", display: "grid", gap: "0.45rem" })}
    >
      {canGuide ? (
        <div role="radiogroup" aria-label="Who sees this message" className={css({ display: "flex", flexWrap: "wrap", gap: "0.3rem" })}>
          {(["room", "guidance"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              className={s.button}
              style={mode === option ? { background: "var(--ink)", color: "var(--paper)" } : undefined}
              onClick={() => {
                if (option !== mode) pendingRef.current = null;
                setMode(option);
              }}
            >
              {option === "guidance" ? <><Lock size={12} aria-hidden="true" /> Private guidance for Keating</> : "Message the room"}
            </button>
          ))}
        </div>
      ) : null}
      {guidance ? (
        <p className={s.help}>Only teachers and the host see this guidance. Turn on teacher review to check Keating’s replies before they are shared.</p>
      ) : replyTo ? (
        <div className={css({ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.74rem", color: "var(--ink-soft)" })}>
          <span className={css({ minW: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
            Replying to <strong>{replyTo.authorName}</strong>: {excerpt(replyTo.body, 80)}
          </span>
          <button type="button" className={s.quiet} onClick={onClearReply} aria-label="Cancel reply"><X size={13} aria-hidden="true" /></button>
        </div>
      ) : null}
      <div className={css({ display: "flex", alignItems: "flex-end", gap: "0.5rem" })}>
        <label htmlFor={`${id}-body`} className={css({ srOnly: true })}>
          {guidance ? "Private guidance for Keating" : `Message as ${snapshot.viewer.displayName}`}
        </label>
        <textarea
          id={`${id}-body`}
          ref={inputRef}
          value={body}
          rows={2}
          maxLength={ROOM_MESSAGE_MAX_CHARS}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder={guidance
            ? "e.g. Ask Priya to explain her step before giving hints."
            : onRequest
              ? `Message as ${snapshot.viewer.displayName} · mention @Keating to ask it in`
              : `Message as ${snapshot.viewer.displayName}`}
          className={`${s.input} ${css({ resize: "vertical", minH: "2.75rem", maxH: "12rem" })}`}
          onChange={(event) => {
            setBody(event.target.value);
            pendingRef.current = null;
            if (error) setError("");
            if (notice) setNotice("");
            const now = Date.now();
            if (!guidance && event.target.value && now - lastTypingRef.current > TYPING_SIGNAL_MS) {
              lastTypingRef.current = now;
              onTyping();
            }
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={s.primary} disabled={sending || !body.trim()} aria-label={guidance ? "Send private guidance" : "Send message"}>
          <Send size={15} aria-hidden="true" />
          <span className={css({ display: { base: "none", sm: "inline" } })}>{sending ? "Sending…" : "Send"}</span>
        </button>
      </div>
      {notice ? <p role="status" className={s.notice}>{notice}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className={s.error}>{error} Your text is still here; try again.</p> : null}
    </form>
  );
}
