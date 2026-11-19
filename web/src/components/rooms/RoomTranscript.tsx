import { Avatar, Button, EmptyState, Loading, IconButton, Menu, Prose } from "../../design-system/kit";
import { motion } from "motion/react";
import { SOFT, SPRING, useMotionAllowed } from "../../design-system/motion";
import { RoomDraftCard } from "./RoomKeatingPanel";
import { KeatingGlyph } from "../../design-system/glyphs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { css, cx } from "../../../styled-system/css";
import type { RoomDraft, RoomOperationInput, RoomMessage, RoomViewerSnapshot } from "../../rooms/contracts";
import { ROLE_LABELS, formatRoomTime } from "./room-ui";
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
  const animate = useMotionAllowed();
  const { permissions, viewer } = snapshot;
  if (message.kind === "system") {
    return (
      <motion.li initial={animate ? { y: 7 } : false} animate={{ y: 0 }} transition={SOFT} id={messageDomId(message.id)} className={css({ px: "0.75rem", py: "0.35rem", textAlign: "center", fontSize: "0.72rem", color: "var(--ink-soft)" })}>
        {message.body} · <time dateTime={message.createdAt}>{formatRoomTime(message.createdAt)}</time>
      </motion.li>
    );
  }
  const hiddenForViewer = Boolean(message.hidden) && !permissions.canOversee;
  const own = message.authorAccountId === viewer.accountId;
  const canReply = permissions.canPost && message.kind !== "whisper" && !message.hidden && Boolean(onReply);
  const canHide = permissions.canOversee && message.kind !== "whisper" && Boolean(onHide);
  const canFork = Boolean(onContinuePrivately) && canContinueRoomMessage(snapshot, message);
  return (
    <motion.li initial={animate ? { y: 7 } : false} animate={{ y: 0 }} transition={SOFT} id={messageDomId(message.id)} layoutId={animate && message.keating?.reviewedBy ? `rm-turn-${message.keating.turnId}` : undefined} tabIndex={-1} data-kind={message.kind} className={cx("rm-message", messageClass, kindClass[message.kind])} aria-label={`${message.authorName}, ${formatRoomTime(message.createdAt)}`}>
      <div className="rm-message-head" data-glyph-host>
        {message.kind === "whisper" ? <><KeatingGlyph name="lock" size={12} /><span>Private guidance · teachers only</span></> : <Avatar size="sm" name={message.authorName} />}
        <strong>{message.authorName}{own ? " (you)" : ""}</strong>
        {message.kind !== "whisper" && <span>{authorLabel(message)}</span>}
        {message.hidden && <span><KeatingGlyph name="eyeoff" size={10} /> Hidden</span>}
        <time dateTime={message.createdAt}>{formatRoomTime(message.createdAt)}</time>
        {message.keating ? (
          <span className={css({ fontSize: "0.68rem", color: "var(--ink-soft)" })}>
            {message.keating.model}
            {message.keating.reviewedBy
              ? (message.keating.edited ? " · edited and approved by a teacher" : " · approved by a teacher")
              : message.keating.facilitatorName ? ` · run in ${message.keating.facilitatorName}'s browser, not reviewed` : ""}
          </span>
        ) : null}
        {(canReply || canHide || canFork) && <div className="room-message-actions">
          {canReply && <Button variant="ghost" size="sm" glyph="reply" onClick={() => onReply?.(message)} aria-label={`Reply to ${message.authorName}`}>Reply</Button>}
          {(canHide || canFork) && <Menu label="Message actions" trigger={<IconButton glyph="more" size="sm" label={`More actions for ${message.authorName}’s message`} />}
            items={[
              ...(canFork ? [{ id: "private", label: "Continue privately", glyph: "lock" as const, onSelect: () => onContinuePrivately?.(message) }] : []),
              ...(canHide ? [{ id: "hide", label: message.hidden ? "Show to room" : "Hide from room", glyph: message.hidden ? "eye" as const : "eyeoff" as const, onSelect: () => onHide?.(message, !message.hidden) }] : []),
            ]} />}
        </div>}
      </div>
      {replyTarget ? (
        <a href={`#${messageDomId(replyTarget.id)}`} className={css({ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", color: "var(--ink-soft)", textDecoration: "none", _hover: { textDecoration: "underline" } })}>
          <KeatingGlyph name="corner" size={12} />
          Replying to {replyTarget.authorName}: {replyTarget.hidden && !permissions.canOversee ? "hidden message" : excerpt(replyTarget.body, 60)}
        </a>
      ) : null}
      {message.addressedTo?.length ? (
        <span className={css({ fontSize: "0.72rem", color: "var(--ink-soft)" })}>To {message.addressedTo.join(", ")}</span>
      ) : null}
      {hiddenForViewer ? (
        <p className={css({ fontSize: "0.82rem", fontStyle: "italic", color: "var(--ink-soft)" })}>A teacher hid this message.</p>
      ) : message.kind === "keating" ? <Prose className="rm-message-body" style={{ opacity: message.hidden ? 0.6 : 1 }}>{message.body}</Prose> : (
        <p className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9rem", lineHeight: 1.55, opacity: message.hidden ? 0.6 : 1 })}>{message.body}</p>
      )}
    </motion.li>
  );
}

/** Insert drafts by creation time while preserving the authoritative message sequence. */
export function roomTimeline(messages: RoomMessage[], drafts: RoomDraft[]): (RoomMessage | RoomDraft)[] {
  const pending = [...drafts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const rows: (RoomMessage | RoomDraft)[] = [];
  let next = 0;
  for (const message of messages) {
    while (next < pending.length && Date.parse(pending[next]!.createdAt) < Date.parse(message.createdAt)) {
      rows.push(pending[next++]!);
    }
    rows.push(message);
  }
  return rows.concat(pending.slice(next));
}

/**
 * The shared transcript. Sticks to the bottom while the reader is there,
 * keeps their place when earlier pages load or when they scroll up.
 */
export function RoomTranscript({
  snapshot,
  preview,
  typingNames,
  mutate,
  onLoadEarlier,
  onReply,
  onHide,
  onContinuePrivately,
}: {
  snapshot: RoomViewerSnapshot;
  preview: string | null;
  typingNames: string[];
  mutate: (operation: RoomOperationInput) => Promise<unknown>;
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
  const animate = useMotionAllowed();
  const pending = snapshot.permissions.canOversee ? snapshot.room.drafts.filter(draft => draft.status === "pending") : [];
  const timeline = roomTimeline(messages, pending);
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
  }, [lastSeq, messages.length, pending.length, preview, typingNames.length]);

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
    <>
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
      className="rm-transcript"
    >
      <RoomSourceReturn snapshot={snapshot} onLoadEarlier={onLoadEarlier} onReveal={() => { pinnedRef.current = false; }} />
      {snapshot.hasEarlierMessages ? (
        <div className={css({ display: "grid", placeItems: "center", py: "0.5rem" })}>
          <button type="button" className="k-button k-ghost k-sm" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
            {loadingEarlier ? <Loading size="inline" label="Loading…" /> : "Load earlier messages"}
          </button>
        </div>
      ) : null}
      {timeline.length === 0 ? (
        <EmptyState glyph="people" heading="No messages yet.">Say hello, or share what you want to work through.</EmptyState>
      ) : null}
      <ol aria-label="Room conversation" className={css({ display: "grid", gap: "0.15rem" })}>
        {timeline.map((message) => {
          if (!("seq" in message)) return <motion.li key={`draft-${message.id}`}
            initial={animate ? { scale: 0.97 } : false} animate={{ scale: 1 }} transition={SPRING}
            layoutId={animate ? `rm-turn-${message.turnId}` : undefined}>
            <ul><RoomDraftCard draft={message} members={snapshot.room.members} messages={messages} roomOpen={snapshot.room.status === "open"} mutate={mutate} /></ul>
          </motion.li>;
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
            <Loading size="inline" label="Writing…" aria-live="off" />
          </div>
          <p className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9rem", lineHeight: 1.55, color: "var(--ink-soft)" })}>{preview}</p>
        </div>
      ) : null}
    </div>
      <p aria-live="polite" className={css({ minH: "1.2rem", px: "0.75rem", fontSize: "0.72rem", color: "var(--ink-soft)" })}>
        {typingNames.length === 1
          ? `${typingNames[0]} is typing…`
          : typingNames.length > 1
            ? `${typingNames.slice(0, 2).join(" and ")}${typingNames.length > 2 ? ` and ${typingNames.length - 2} more` : ""} are typing…`
            : ""}
      </p>
    </>
  );
}
