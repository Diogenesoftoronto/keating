import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppBar, Button, Chip, EmptyState, Loading, IconButton, SearchField, Sheet } from "../design-system/kit";
import { KeatingBot } from "../components/KeatingBot";
import { useMediaQuery } from "../hooks/use-media-query";
import "../components/rooms/rooms.css";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { RoomCreateForm } from "../components/rooms/RoomCreateForm";
import { filterRooms, ROOM_FILTERS, RoomRow, type RoomFilter } from "../components/rooms/RoomList";
import { errorMessage, roomStyles as s } from "../components/rooms/room-ui";
import { createRoom, listRooms } from "../rooms/client";
import type { RoomListItem } from "../rooms/contracts";
import { type CoursesAccount, useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

function RoomLibrary({ account }: { account: CoursesAccount }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("open");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const createTrigger = useRef<HTMLButtonElement>(null);
  const closeCreate = () => {
    setCreating(false);
    createTrigger.current?.focus();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRooms(await listRooms());
    } catch (cause) {
      setError(errorMessage(cause, "Your rooms could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => filterRooms(rooms, filter, query), [filter, query, rooms]);
  const counts = useMemo(
    () => Object.fromEntries(ROOM_FILTERS.map((option) => [option.value, filterRooms(rooms, option.value, "").length])) as Record<RoomFilter, number>,
    [rooms],
  );

  const wide = useMediaQuery("(min-width: 64em)");
  return (
    <main className="rm-library">
      <AppBar back={{ label: "Chat", to: "/chat" }} start={<KeatingBot state="blank-idle" size={28} label="" />} title={<h1>Study rooms</h1>} subtitle="One shared conversation for a group and Keating" menu={false}>
        <Button variant="primary" ref={createTrigger} glyph="plus" aria-expanded={creating} onClick={() => setCreating(true)}>New room</Button>
      </AppBar>
      <div className="rm-library-body">
        <div className="rm-directory">
          <div className="rm-filterbar">
            <div role="group" aria-label="Filter rooms" className="rm-badges">
              {ROOM_FILTERS.map(option => <Chip as="button" key={option.value} selected={filter === option.value} count={counts[option.value]} onClick={() => setFilter(option.value)}>{option.label}</Chip>)}
            </div>
            <SearchField data-glyph-host label="Search rooms" placeholder="Search title, topic, course" value={query} onChange={setQuery} />
          </div>
          {error ? (
            <div role="alert" className={css({ mt: "1rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" })}>
              <p className={s.error}>{error}</p>
              <button type="button" className="k-button k-ghost k-sm" onClick={() => void load()}>Try again</button>
            </div>
          ) : null}

          <section aria-label="Your rooms" aria-busy={loading} className="rm-list">
            {loading ? (
              <Loading label="Loading your rooms…" />
            ) : visible.length ? (
              <div>
                {visible.map((room, index) => <RoomRow key={room.id} room={room} index={index} />)}
                <div className="rm-guide k-halftone"><KeatingBot state="waving" label="" size={36} /><div><strong>Start one for a study group or a class.</strong><p>Share an invite link or QR code. Course teachers can also open a room from any lesson.</p></div></div>
              </div>
            ) : rooms.length && !error ? (
              <EmptyState glyph="search" heading="No rooms match this filter." actions={
                <Button variant="ghost" onClick={() => { setFilter("all"); setQuery(""); }}>Show all rooms</Button>
              } />
            ) : !error ? (
              <EmptyState glyph="people" heading={<span role="heading" aria-level={2}>No rooms yet</span>}
                actions={!creating && <Button variant="primary" onClick={() => setCreating(true)}>Start a room</Button>}>
                Start one for a study group or a class, then share an invite link or QR code. Course teachers can also open a
                room from any lesson, and course members find it in the lesson’s side rail.
              </EmptyState>
            ) : null}
          </section>
        </div>
        {creating && <RoomCreateForm
          context={<p className={s.help}>You will host it as {account.displayName}. Invite people once it is open. Teachers can guide Keating privately, review its replies, and pause it at any time.</p>}
          onCancel={closeCreate}
          onCreate={async input => {
            const snapshot = await createRoom({ ...input, displayName: account.displayName });
            await navigate({ to: "/rooms/$roomId", params: { roomId: snapshot.room.id } });
          }}
          renderPanel={(form, busy) => wide
            ? <aside className="rm-create"><header className="k-halftone"><h2>New study room</h2><IconButton glyph="x" label="Close new study room" disabled={busy} onClick={closeCreate} /></header>{form}</aside>
            : <Sheet open title="New study room" side="right" onClose={() => { if (!busy) closeCreate(); }}>{form}</Sheet>}
        />}
      </div>
    </main>
  );
}

export function Rooms() {
  useSeo({
    title: "Study rooms — Keating",
    description: "Shared study sessions where a group learns with Keating and teachers keep oversight.",
  });
  const [access, retry] = useCoursesAccess();
  return (
    <div className={css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" })}>
      {access.status !== "ready" && <Nav />}
      {access.status === "ready" ? <RoomLibrary account={access.account} /> : <CoursesAccessGate state={access} onRetry={retry} />}
    </div>
  );
}
