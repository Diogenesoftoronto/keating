import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CornerDownRight, EyeOff, Lock, Reply } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import type { RoomMessage, RoomViewerSnapshot } from "../../rooms/contracts";
import { ROLE_LABELS, formatRoomTime, roomStyles as s } from "./room-ui";
import { canContinueRoomMessage } from "./RoomPrivateFork";
import { RoomSourceReturn } from "./RoomSourceReturn";

const messageClass = css({
  position: "relative",
  display: "grid",
  gap: "0.25rem",
  border: "1px solid transparent",
  px: "0.75rem",
  py: "0.55rem",
  "&:hover .room-message-actions, &:focus-within .room-message-actions": { opacity: 1 },
  _target: { bg: "color-mix(in srgb, var(--peer-blue, #3468b3) 10%, transparent)" },
});

const kindClass: Record<RoomMessage["kind"], string> = {
  chat: css({}),
  keating: css({ borderColor: "color-mix(in srgb, var(--course-green, #1e9b50) 40%, transparent)", bg: "color-mix(in srgb, var(--course-green, #1e9b50) 7%, transparent)" }),
  whisper: css({ borderColor: "color-mix(in srgb, var(--ink) 45%, transparent)", borderStyle: "dashed", bg: "color-mix(in srgb, var(--ink) 5%, transparent)" }),
  system: css({}),
};

export function messageDomId(messageId: string): string {
  return `room-message-${messageId}`;
}

export function excerpt(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function authorLabel(message: RoomMessage): string {
  if (message.kind === "keating") return "Keating";
  if (message.authorRole === "keating" || message.authorRole === "system") return message.authorName;
  return ROLE_LABELS[message.authorRole];
}

export function RoomMessageItem({
  message,
  snapshot,
  replyTarget,
  onReply,
  onHide,
  onContinuePrivately,
}: {
  message: RoomMessage;
  snapshot: RoomViewerSnapshot;
  replyTarget?: RoomMessage;
  onReply?: (message: RoomMessage) => void;
  onHide?: (message: RoomMessage, hidden: boolean) => void;
  onContinuePrivately?: (message: RoomMessage) => void;
}) {
  const { permissions, viewer } = snapshot;
  if (message.kind === "system") {
    return (
      <li id={messageDomId(message.id)} className={css({ px: "0.75rem", py: "0.35rem", textAlign: "center", fontSize: "0.72rem", color: "var(--ink-soft)" })}>
        {message.body} · <time dateTime={message.createdAt}>{formatRoomTime(message.createdAt)}</time>
      </li>
    );
  }
  const hiddenForViewer = Boolean(message.hidden) && !permissions.canOversee;
  const own = message.authorAccountId === viewer.accountId;
  const canReply = permissions.canPost && message.kind !== "whisper" && !message.hidden && Boolean(onReply);
  const canHide = permissions.canOversee && message.kind !== "whisper" && Boolean(onHide);
  const canFork = Boolean(onContinuePrivately) && canContinueRoomMessage(snapshot, message);
  return (
    <li id={messageDomId(message.id)} tabIndex={-1} className={cx(messageClass, kindClass[message.kind])} aria-label={`${message.authorName}, ${formatRoomTime(message.createdAt)}`}>
      <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.45rem" })}>
        <strong className={css({ fontSize: "0.84rem" })}>{message.authorName}{own ? " (you)" : ""}</strong>
        <span className={s.chip}>{authorLabel(message)}</span>
        {message.kind === "whisper" ? (
          <span className={s.chip}><Lock size={10} aria-hidden="true" /> Private guidance · teachers only</span>
        ) : null}
        {message.hidden ? <span className={s.chip}><EyeOff size={10} aria-hidden="true" /> Hidden</span> : null}
        <time dateTime={message.createdAt} className={css({ fontSize: "0.68rem", color: "var(--ink-soft)" })}>{formatRoomTime(message.createdAt)}</time>
        {message.keating ? (
          <span className={css({ fontSize: "0.68rem", color: "var(--ink-soft)" })}>
            {message.keating.model}
            {message.keating.reviewedBy
              ? (message.keating.edited ? " · edited and approved by a teacher" : " · approved by a teacher")
              : message.keating.facilitatorName ? ` · run in ${message.keating.facilitatorName}'s browser, not reviewed` : ""}
          </span>
        ) : null}
      </div>
      {replyTarget ? (
        <a href={`#${messageDomId(replyTarget.id)}`} className={css({ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "var(--ink-soft)", textDecoration: "none", _hover: { textDecoration: "underline" } })}>
          <CornerDownRight size={12} aria-hidden="true" />
          Replying to {replyTarget.authorName}: {replyTarget.hidden && !permissions.canOversee ? "hidden message" : excerpt(replyTarget.body, 60)}
        </a>
      ) : null}
      {message.addressedTo?.length ? (
        <span className={css({ fontSize: "0.72rem", color: "var(--ink-soft)" })}>To {message.addressedTo.join(", ")}</span>
      ) : null}
      {hiddenForViewer ? (
        <p className={css({ fontSize: "0.82rem", fontStyle: "italic", color: "var(--ink-soft)" })}>A teacher hid this message.</p>
      ) : (
        <p className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9rem", lineHeight: 1.55, opacity: message.hidden ? 0.6 : 1 })}>{message.body}</p>
      )}
      {canReply || canHide || canFork ? (
        <div className={cx("room-message-actions", css({ display: "flex", flexWrap: "wrap", gap: "0.25rem", opacity: { base: 1, md: 0 }, transition: "opacity 150ms ease-out" }))}>
          {canReply ? (
            <button type="button" className={s.quiet} onClick={() => onReply?.(message)} aria-label={`Reply to ${message.authorName}`}>
              <Reply size={12} aria-hidden="true" /> Reply
            </button>
          ) : null}
          {canFork ? <button type="button" className={s.button} onClick={() => onContinuePrivately?.(message)} aria-label={`Continue privately from ${message.authorName}'s message`}>
            <Lock size={12} aria-hidden="true" /> Continue privately
          </button> : null}
          {canHide ? (
            <button type="button" className={s.quiet} onClick={() => onHide?.(message, !message.hidden)}>
              <EyeOff size={12} aria-hidden="true" /> {message.hidden ? "Show to room" : "Hide from room"}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The shared transcript. Sticks to the bottom while the reader is there,
 * keeps their place when earlier pages load or when they scroll up.
 */
export function RoomTranscript({
  snapshot,
  preview,
  typingNames,
  onLoadEarlier,
  onReply,
  onHide,
  onContinuePrivately,
}: {
  snapshot: RoomViewerSnapshot;
  preview: string | null;
  typingNames: string[];
  onLoadEarlier: () => Promise<void>;
  onReply: (message: RoomMessage) => void;
  onHide: (message: RoomMessage, hidden: boolean) => void;
  onContinuePrivately?: (message: RoomMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const messages = snapshot.room.messages;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const lastSeq = messages.at(-1)?.seq ?? 0;

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (restoreRef.current) {
      node.scrollTop = node.scrollHeight - restoreRef.current.height + restoreRef.current.top;
      restoreRef.current = null;
      return;
    }
    if (pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [lastSeq, messages.length, preview, typingNames.length]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [snapshot.room.id]);

  const loadEarlier = async () => {
    const node = scrollRef.current;
    if (node) restoreRef.current = { height: node.scrollHeight, top: node.scrollTop };
    setLoadingEarlier(true);
    try {
      await onLoadEarlier();
    } finally {
      setLoadingEarlier(false);
    }
  };

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
      className={css({ minH: "18rem", overflowY: "auto", overscrollBehavior: "contain", flex: 1, py: "0.5rem" })}
    >
      <RoomSourceReturn snapshot={snapshot} onLoadEarlier={onLoadEarlier} onReveal={() => { pinnedRef.current = false; }} />
      {snapshot.hasEarlierMessages ? (
        <div className={css({ display: "grid", placeItems: "center", py: "0.5rem" })}>
          <button type="button" className={s.button} onClick={() => void loadEarlier()} disabled={loadingEarlier}>
            {loadingEarlier ? "Loading…" : "Load earlier messages"}
          </button>
        </div>
      ) : null}
      {messages.length === 0 ? (
        <p className={css({ px: "1rem", py: "3rem", textAlign: "center", color: "var(--ink-soft)", fontSize: "0.85rem" })}>
          No messages yet. Say hello, or share what you want to work through.
        </p>
      ) : null}
      <ol aria-label="Room conversation" className={css({ display: "grid", gap: "0.15rem" })}>
        {messages.map((message) => {
          const replyTarget = message.replyToId ? byId.get(message.replyToId) : undefined;
          return (
            <RoomMessageItem
              key={message.id}
              message={message}
              snapshot={snapshot}
              {...(replyTarget ? { replyTarget } : {})}
              onReply={onReply}
              onHide={onHide}
              {...(onContinuePrivately ? { onContinuePrivately } : {})}
            />
          );
        })}
      </ol>
      {preview ? (
        <div aria-live="off" className={cx(messageClass, kindClass.keating, css({ mt: "0.15rem" }))}>
          <div className={css({ display: "flex", gap: "0.45rem", alignItems: "baseline" })}>
            <strong className={css({ fontSize: "0.84rem" })}>Keating</strong>
            <span className={s.chip}>Writing…</span>
          </div>
          <p className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9rem", lineHeight: 1.55, color: "var(--ink-soft)" })}>{preview}</p>
        </div>
      ) : null}
      <p aria-live="polite" className={css({ minH: "1.2rem", px: "0.75rem", fontSize: "0.72rem", color: "var(--ink-soft)" })}>
        {typingNames.length === 1
          ? `${typingNames[0]} is typing…`
          : typingNames.length > 1
            ? `${typingNames.slice(0, 2).join(" and ")}${typingNames.length > 2 ? ` and ${typingNames.length - 2} more` : ""} are typing…`
            : ""}
      </p>
    </div>
  );
}
