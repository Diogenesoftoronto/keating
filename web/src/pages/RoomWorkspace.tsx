import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, BookOpen } from "lucide-react";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { RoomComposer } from "../components/rooms/RoomComposer";
import { RoomInvitesPanel } from "../components/rooms/RoomInvitesPanel";
import { RoomDraftReview, RoomKeatingPanel } from "../components/rooms/RoomKeatingPanel";
import { RoomPeoplePanel } from "../components/rooms/RoomPeoplePanel";
import { RoomSettingsPanel, RoomTranscriptExport } from "../components/rooms/RoomSettingsPanel";
import { RoomTranscript } from "../components/rooms/RoomTranscript";
import { RoomPrivateFork, RoomPrivateForkOffers } from "../components/rooms/RoomPrivateFork";
import { ROLE_LABELS, roomStyles as s } from "../components/rooms/room-ui";
import type { RoomMessage, RoomOperationInput, RoomViewerSnapshot } from "../rooms/contracts";
import { typingAccountIds, TYPING_VISIBLE_MS } from "../rooms/room-state";
import { useRoomFacilitator } from "../rooms/useRoomFacilitator";
import { useRoomSession, type RoomConnectionStatus } from "../rooms/useRoomSession";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

export type RoomSideTab = "keating" | "people" | "invite" | "settings";

export function roomSideTabs(snapshot: RoomViewerSnapshot): Array<{ id: RoomSideTab; label: string }> {
  const tabs: Array<{ id: RoomSideTab; label: string }> = [
    { id: "keating", label: "Keating" },
    { id: "people", label: "People" },
  ];
  if (snapshot.permissions.canInvite || snapshot.permissions.canOversee) tabs.push({ id: "invite", label: "Invite" });
  if (snapshot.permissions.canOversee) tabs.push({ id: "settings", label: "Settings" });
  return tabs;
}

const CONNECTION_LABEL: Record<RoomConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
};

function StatusScreen({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <main className={css({ mx: "auto", maxW: "36rem", px: "1rem", py: "4rem" })}>
      <section className={css({ border: "2px solid var(--ink)", bg: "var(--card)", p: "1.5rem" })}>
        <h1 className={css({ fontFamily: "Georgia, serif", fontSize: "1.6rem" })}>{title}</h1>
        <p className={css({ mt: "0.6rem", color: "var(--ink-soft)", lineHeight: 1.6 })}>{body}</p>
        <div className={css({ mt: "1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
          {action}
          <Link to="/rooms" className={s.button}>Open your rooms</Link>
        </div>
      </section>
    </main>
  );
}

function SideTabs({ tabs, active, onSelect }: { tabs: Array<{ id: RoomSideTab; label: string }>; active: RoomSideTab; onSelect: (tab: RoomSideTab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : -1;
    if (target < 0) return;
    event.preventDefault();
    const next = tabs[target]!;
    onSelect(next.id);
    document.getElementById(`room-tab-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Room panels" onKeyDown={onKeyDown} className={css({ display: "flex", borderBottom: "2px solid var(--ink)", overflowX: "auto" })}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`room-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls="room-side-panel"
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          className={css({
            flex: 1,
            borderBottom: "3px solid transparent",
            px: "0.6rem",
            py: "0.6rem",
            fontFamily: "var(--mono-display)",
            fontSize: "0.66rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--ink-soft)",
            whiteSpace: "nowrap",
            _hover: { color: "var(--ink)" },
            _selected: { color: "var(--ink)", borderBottomColor: "var(--course-green, #1e9b50)" },
            _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "-2px" },
          })}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function useTick(active: boolean, ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return now;
}

function Workspace({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const session = useRoomSession(roomId, true);
  const facilitator = useRoomFacilitator(roomId, session);
  const { state, status, error, loadError, setError, mutate, send, loadEarlier, refresh } = session;
  const snapshot = state.snapshot;
  const [tab, setTab] = useState<RoomSideTab>("keating");
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const [privateSource, setPrivateSource] = useState<RoomMessage | null>(null);
  const openPrivateChat = (sessionId: string, question: string) => navigate({ to: "/chat", search: { session: sessionId, ...(question ? { ask: question } : {}) } });

  const hasTyping = Object.keys(state.typing).length > 0;
  const now = useTick(hasTyping, Math.round(TYPING_VISIBLE_MS / 4));

  // The mutate hook already surfaces errors in the room banner and rethrows;
  // callers that show their own inline error still need the rejection.
  const run = useCallback((operation: RoomOperationInput) => mutate(operation), [mutate]);
  const quiet = useCallback(async (operation: RoomOperationInput) => {
    try {
      await mutate(operation);
    } catch {
      // Already shown in the banner.
    }
  }, [mutate]);

  useSeo({
    title: snapshot ? `${snapshot.room.title} — Keating study room` : "Study room — Keating",
    description: "A shared study session with Keating.",
  });

  const tabs = useMemo(() => (snapshot ? roomSideTabs(snapshot) : []), [snapshot]);
  useEffect(() => {
    if (tabs.length && !tabs.some((candidate) => candidate.id === tab)) setTab("keating");
  }, [tab, tabs]);

  // A reply target that was hidden or disappeared is no longer valid.
  useEffect(() => {
    if (!replyTo || !snapshot) return;
    const current = snapshot.room.messages.find((message) => message.id === replyTo.id);
    if (!current || current.hidden) setReplyTo(null);
  }, [replyTo, snapshot]);

  if (state.removed) {
    return <StatusScreen title="You are no longer in this room" body="You left the room, a teacher removed you, or the room was deleted. Your own chats and courses are unaffected." />;
  }
  if (loadError) {
    const missing = loadError.status === 404 || loadError.status === 403;
    return (
      <StatusScreen
        title={missing ? "Room not available" : "The room could not be opened"}
        body={missing ? "This room does not exist, or you are not a member. Ask the host for an invitation link." : loadError.message}
        {...(!missing ? { action: <button type="button" className={s.primary} onClick={() => void refresh()}>Try again</button> } : {})}
      />
    );
  }
  if (!snapshot) {
    return <p role="status" className={css({ py: "5rem", textAlign: "center", color: "var(--ink-soft)" })}>Opening the room…</p>;
  }

  const { room, viewer, permissions } = snapshot;
  const nameOf = new Map(room.members.map((member) => [member.accountId, member.displayName]));
  const typingNames = typingAccountIds(state, now, viewer.accountId).map((accountId) => nameOf.get(accountId)).filter((name): name is string => Boolean(name));
  const preview = facilitator.localPreview?.text ?? state.preview?.text ?? null;
  const pendingDrafts = permissions.canOversee ? room.drafts : [];

  return (
    <main className={css({ mx: "auto", w: "100%", maxW: "90rem", px: { base: 0, md: "1rem" }, py: { base: 0, md: "1rem" } })}>
      <header className={css({ display: "grid", gap: "0.35rem", borderBottom: "2px solid var(--ink)", px: "1rem", py: "0.85rem", md: { border: "2px solid var(--ink)", borderBottom: 0, bg: "var(--card)" } })}>
        <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem" })}>
          <Link to="/rooms" className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: "var(--ink-soft)", _hover: { color: "var(--ink)" } })}>
            <ArrowLeft size={13} aria-hidden="true" /> Rooms
          </Link>
          {room.context.courseId ? (
            <Link to="/courses/$courseId" params={{ courseId: room.context.courseId }} className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: "var(--ink-soft)", _hover: { color: "var(--ink)" } })}>
              <BookOpen size={13} aria-hidden="true" /> {room.context.courseTitle ?? "Course"}{room.context.lessonTitle ? ` · ${room.context.lessonTitle}` : ""}
            </Link>
          ) : null}
          <span className={s.chip}>You: {ROLE_LABELS[viewer.role]}</span>
          {room.status === "ended" ? <span className={s.chip}>Ended</span> : null}
          <span role="status" className={css({ ml: "auto", display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "var(--ink-soft)" })}>
            <span aria-hidden="true" className={css({ h: "0.5rem", w: "0.5rem", borderRadius: "50%" })} style={{ background: status === "connected" ? "var(--phosphor, #4be388)" : "#c9a227" }} />
            {CONNECTION_LABEL[status]}
          </span>
        </div>
        <h1 className={css({ fontFamily: "Georgia, serif", fontSize: { base: "1.45rem", md: "1.8rem" }, lineHeight: 1.15, overflowWrap: "anywhere" })}>{room.title}</h1>
        {room.topic || room.goal ? (
          <p className={css({ maxW: "75ch", fontSize: "0.82rem", lineHeight: 1.5, color: "var(--ink-soft)" })}>
            {room.topic}
            {room.topic && room.goal ? " · " : ""}
            {room.goal ? <><strong className={css({ color: "var(--ink)" })}>Goal:</strong> {room.goal}</> : null}
          </p>
        ) : null}
      </header>

      {error ? (
        <div role="alert" className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", px: "1rem", py: "0.5rem", md: { borderInline: "2px solid var(--ink)" } })}>
          <p className={`${s.error} ${css({ flex: 1 })}`}>{error}</p>
          <button type="button" className={s.quiet} onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}
      {room.status === "ended" ? (
        <p className={`${s.notice} ${css({ mx: { base: "1rem", md: 0 }, my: "0.5rem" })}`}>
          This room has ended. The transcript stays readable{permissions.canOversee ? "; reopen it from Settings to continue" : ""}.
        </p>
      ) : null}

      <div className={css({ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", lg: { gridTemplateColumns: "minmax(0, 1fr) 22rem" }, md: { border: "2px solid var(--ink)" }, bg: "var(--card)" })}>
        <div className={css({ gridColumn: "1 / -1", minW: 0 })}>
          {privateSource ? <div className={css({ p: "0.75rem", maxH: "65vh", overflowY: "auto", flexShrink: 0 })}>
            <RoomPrivateFork key={`${room.id}:${viewer.accountId}:${privateSource.id}`} snapshot={snapshot} source={privateSource} mutate={run}
              onCancel={() => { setPrivateSource(null); document.getElementById(`room-message-${privateSource.id}`)?.focus(); }} onOpenChat={openPrivateChat} />
          </div> : <RoomPrivateForkOffers key={`${room.id}:${viewer.accountId}`} snapshot={snapshot} mutate={run} onOpenChat={openPrivateChat} />}
        </div>
        <section aria-label="Conversation" className={css({ display: "flex", flexDir: "column", minW: 0, h: { base: "70vh", lg: "calc(100vh - 13rem)" }, minH: "26rem" })}>
          <RoomDraftReview drafts={pendingDrafts} members={room.members} messages={room.messages} roomOpen={room.status === "open"} mutate={run} />
          <RoomTranscript
            snapshot={snapshot}
            preview={preview}
            typingNames={typingNames}
            onLoadEarlier={loadEarlier}
            onReply={setReplyTo}
            onContinuePrivately={setPrivateSource}
            onHide={(message, hidden) => void quiet({ type: "message.hide", messageId: message.id, hidden })}
          />
          <RoomComposer
            snapshot={snapshot}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            onSubmit={(operation) => run(operation)}
            onTyping={() => send({ type: "typing" })}
          />
        </section>
        <aside aria-label="Room tools" className={css({ minW: 0, borderTop: "2px solid var(--ink)", bg: "var(--paper-deep, #e9e2d2)", lg: { borderTop: 0, borderLeft: "2px solid var(--ink)", h: "calc(100vh - 13rem)", minH: "26rem", overflowY: "auto" } })}>
          <SideTabs tabs={tabs} active={tab} onSelect={setTab} />
          <div id="room-side-panel" role="tabpanel" aria-labelledby={`room-tab-${tab}`} className={css({ p: "1rem" })}>
            {tab === "keating" ? (
              <>
                <RoomKeatingPanel snapshot={snapshot} facilitator={facilitator} mutate={run} />
                <div className={s.section}><RoomTranscriptExport roomId={room.id} /></div>
              </>
            ) : tab === "people" ? (
              <RoomPeoplePanel snapshot={snapshot} presentAccountIds={state.presentAccountIds} mutate={run} onLeft={() => void navigate({ to: "/rooms" })} />
            ) : tab === "invite" ? (
              <RoomInvitesPanel snapshot={snapshot} />
            ) : (
              <RoomSettingsPanel snapshot={snapshot} mutate={run} onDeleted={() => void navigate({ to: "/rooms", replace: true })} />
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

export function RoomWorkspace() {
  const { roomId } = useParams({ strict: false }) as { roomId: string };
  const [access, retry] = useCoursesAccess();
  return (
    <div className={css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" })}>
      <Nav />
      {access.status === "ready" ? <Workspace key={roomId} roomId={roomId} /> : <CoursesAccessGate state={access} onRetry={retry} />}
    </div>
  );
}
