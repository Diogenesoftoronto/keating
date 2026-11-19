import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AppBar, AvatarStack, Button, Chip, Loading, Sheet, StatusDot, Tabs, TabPanel } from "../design-system/kit";
import { useMediaQuery } from "../hooks/use-media-query";
import "../components/rooms/rooms.css";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { RoomComposer } from "../components/rooms/RoomComposer";
import { RoomInvitesPanel } from "../components/rooms/RoomInvitesPanel";
import { RoomKeatingPanel } from "../components/rooms/RoomKeatingPanel";
import { RoomPeoplePanel } from "../components/rooms/RoomPeoplePanel";
import { RoomLifecycle, RoomSettingsPanel, RoomTranscriptExport } from "../components/rooms/RoomSettingsPanel";
import { RoomTranscript } from "../components/rooms/RoomTranscript";
import { RoomPrivateFork, RoomPrivateForkOffers } from "../components/rooms/RoomPrivateFork";
import { ROLE_LABELS, roomStyles as s } from "../components/rooms/room-ui";
import type { RoomMessage, RoomOperationInput, RoomViewerSnapshot } from "../rooms/contracts";
import { typingAccountIds, TYPING_VISIBLE_MS } from "../rooms/room-state";
import { useRoomFacilitator } from "../rooms/useRoomFacilitator";
import { useRoomSession, type RoomConnectionStatus } from "../rooms/useRoomSession";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

export type RoomSideTab = "people" | "invite" | "settings";

export function roomSideTabs(snapshot: RoomViewerSnapshot): Array<{ id: RoomSideTab; label: string }> {
  const tabs: Array<{ id: RoomSideTab; label: string }> = [
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
      <section className="k-card rm-unavailable">
        <h1 className="rm-heading">{title}</h1>
        <p className={css({ mt: "0.6rem", color: "var(--ink-soft)", lineHeight: 1.6 })}>{body}</p>
        <div className={css({ mt: "1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
          {action}
          <Link to="/rooms" className="k-button k-ghost k-sm">Open your rooms</Link>
        </div>
      </section>
    </main>
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
  const [tab, setTab] = useState<RoomSideTab>("people");
  const wide = useMediaQuery("(min-width: 64em)");
  const [toolsOpen, setToolsOpen] = useState(false);
  const openTools = (next: RoomSideTab) => { setTab(next); setToolsOpen(true); };
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
    if (tabs.length && !tabs.some((candidate) => candidate.id === tab)) setTab("people");
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
    return <Loading size="page" label="Opening the room…" />;
  }

  const { room, viewer, permissions } = snapshot;
  const nameOf = new Map(room.members.map((member) => [member.accountId, member.displayName]));
  const typingNames = typingAccountIds(state, now, viewer.accountId).map((accountId) => nameOf.get(accountId)).filter((name): name is string => Boolean(name));
  const preview = facilitator.localPreview?.text ?? state.preview?.text ?? null;
  const present = room.members.filter(member => state.presentAccountIds.includes(member.accountId));
  const activeTab = tabs.some(item => item.id === tab) ? tab : "people";
  const goal = [room.topic, room.goal && `Goal: ${room.goal}`].filter(Boolean).join(" · ");
  const context = <>
    {room.context.courseId && <Link className="rm-course" to="/courses/$courseId" params={{ courseId: room.context.courseId }}>
      {room.context.courseTitle ?? "Course"}{room.context.lessonTitle && ` · ${room.context.lessonTitle}`}
    </Link>}
    <Chip>You: {ROLE_LABELS[viewer.role]}</Chip>{room.status === "ended" && <Chip>Ended</Chip>}
    <span role="status" className={`rm-connection rm-${status}`}><StatusDot tone={status === "connected" ? "ok" : "warn"} />{CONNECTION_LABEL[status]}</span>
  </>;
  const rail = <>
    {!wide && <div className="rm-sheet-context">{context}</div>}
    <Tabs className="k-halftone" label="Room panels" items={tabs.map(item => item.id === "people" ? { ...item, count: room.members.length } : item)}
      value={activeTab} onChange={id => setTab(id as RoomSideTab)} stretch />
    <TabPanel id={activeTab} active className="rm-panel">
      {activeTab === "people" ? <RoomPeoplePanel snapshot={snapshot} presentAccountIds={state.presentAccountIds} mutate={run} onLeft={() => void navigate({ to: "/rooms" })} />
        : activeTab === "invite" ? <RoomInvitesPanel snapshot={snapshot} />
        : <RoomSettingsPanel snapshot={snapshot} mutate={run} onDeleted={() => void navigate({ to: "/rooms", replace: true })} />}
    </TabPanel>
    <footer className="rm-rail-footer"><RoomTranscriptExport roomId={room.id} />
      {activeTab === "people" && permissions.canOversee && room.status === "open" && <RoomLifecycle snapshot={snapshot} mutate={run} endOnly />}
    </footer>
  </>;
  return (
    <main className="rm-workspace">
      <AppBar back={{ label: "Rooms", to: "/rooms" }} title={<h1>{room.title}</h1>}
        subtitle={wide && goal ? goal : undefined}>
        {wide && context}
        <button type="button" className="rm-presence" aria-label={`People, ${present.length} here`} onClick={() => openTools("people")}>
          <AvatarStack names={present.map(member => member.displayName)} /><span>{wide ? `${present.length} here` : `People · ${present.length}`}</span>
        </button>
        {wide && tabs.some(item => item.id === "invite") && <Button variant="line" glyph="share" size="sm" onClick={() => openTools("invite")}>Invite</Button>}
      </AppBar>
      {!wide && goal && <p className="rm-mobile-goal">{goal}</p>}
      <RoomKeatingPanel snapshot={snapshot} facilitator={facilitator} mutate={run} />
      {error ? (
        <div role="alert" className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", px: "1rem", py: "0.5rem", md: { borderInline: "2px solid var(--ink)" } })}>
          <p className={`${s.error} ${css({ flex: 1 })}`}>{error}</p>
          <button type="button" className={s.quiet} onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}
      <div className="rm-desk">
        <div className={css({ gridColumn: "1 / -1", minW: 0 })}>
          {privateSource ? <div className="rm-source-pane" data-glyph-host>
            <RoomPrivateFork key={`${room.id}:${viewer.accountId}:${privateSource.id}`} snapshot={snapshot} source={privateSource} mutate={run}
              onCancel={() => { setPrivateSource(null); document.getElementById(`room-message-${privateSource.id}`)?.focus(); }} onOpenChat={openPrivateChat} />
          </div> : <RoomPrivateForkOffers key={`${room.id}:${viewer.accountId}`} snapshot={snapshot} mutate={run} onOpenChat={openPrivateChat} />}
        </div>
        <section aria-label="Conversation" className="rm-conversation">
          <RoomTranscript
            snapshot={snapshot}
            mutate={run}
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
        {wide ? <aside aria-label="Room tools" className="rm-rail">{rail}</aside> :
          <Sheet open={toolsOpen} title="Room tools" side="right" onClose={() => setToolsOpen(false)}>{toolsOpen && rail}</Sheet>}

      </div>
    </main>
  );
}

export function RoomWorkspace() {
  const { roomId } = useParams({ strict: false }) as { roomId: string };
  const [access, retry] = useCoursesAccess();
  return (
    <div className={css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" })}>
      {access.status !== "ready" && <Nav />}
      {access.status === "ready" ? <Workspace key={roomId} roomId={roomId} /> : <CoursesAccessGate state={access} onRetry={retry} />}
    </div>
  );
}
