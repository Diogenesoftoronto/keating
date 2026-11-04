import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Search, X } from "lucide-react";
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

  return (
    <main className={css({ mx: "auto", maxW: "60rem", px: "1rem", py: { base: "2rem", md: "3rem" } })}>
      <header
        className={css({
          display: "flex",
          flexDir: { base: "column", sm: "row" },
          alignItems: { sm: "end" },
          justifyContent: "space-between",
          gap: "1rem",
          borderBottom: "2px solid var(--ink)",
          pb: "1.25rem",
        })}
      >
        <div>
          <p className={css({ fontFamily: "var(--mono-display)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}>
            Study rooms
          </p>
          <h1 className={css({ mt: "0.35rem", fontFamily: "Georgia, serif", fontSize: { base: "2.1rem", md: "2.8rem" }, lineHeight: 1.05 })}>
            Learn together with Keating
          </h1>
          <p className={css({ mt: "0.6rem", maxW: "58ch", color: "var(--ink-soft)", lineHeight: 1.6 })}>
            A room is one shared conversation for a group and Keating. Teachers can guide Keating privately,
            review its replies, and pause it at any time.
          </p>
        </div>
        <button
          type="button"
          className={s.primary}
          aria-expanded={creating}
          aria-controls="room-create-panel"
          onClick={() => setCreating((open) => !open)}
        >
          {creating ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          {creating ? "Close" : "New room"}
        </button>
      </header>

      {creating ? (
        <section
          id="room-create-panel"
          aria-labelledby="room-create-heading"
          className={css({ mt: "1.25rem", border: "2px solid var(--ink)", bg: "var(--card)", p: { base: "1rem", md: "1.5rem" }, boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 22%, transparent)" })}
        >
          <h2 id="room-create-heading" className={s.heading}>New study room</h2>
          <p className={s.help}>You will host it as {account.displayName}. Invite people once it is open.</p>
          <div className={css({ mt: "1rem" })}>
            <RoomCreateForm
              onCancel={() => setCreating(false)}
              onCreate={async (input) => {
                const snapshot = await createRoom({ ...input, displayName: account.displayName });
                await navigate({ to: "/rooms/$roomId", params: { roomId: snapshot.room.id } });
              }}
            />
          </div>
        </section>
      ) : null}

      <div className={css({ mt: "1.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
        <div role="group" aria-label="Filter rooms" className={css({ display: "flex", flexWrap: "wrap", gap: "0.35rem" })}>
          {ROOM_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={s.button}
              style={filter === option.value ? { background: "var(--ink)", color: "var(--paper)" } : undefined}
            >
              {option.label} <span aria-hidden="true">{counts[option.value]}</span>
            </button>
          ))}
        </div>
        <label className={css({ position: "relative", w: { base: "100%", sm: "16rem" } })}>
          <span className={css({ srOnly: true })}>Search rooms</span>
          <Search size={15} aria-hidden="true" className={css({ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" })} />
          <input
            type="search"
            className={s.input}
            style={{ paddingLeft: "2rem" }}
            value={query}
            placeholder="Search title, topic, course"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <div role="alert" className={css({ mt: "1rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" })}>
          <p className={s.error}>{error}</p>
          <button type="button" className={s.button} onClick={() => void load()}>Try again</button>
        </div>
      ) : null}

      <section aria-label="Your rooms" aria-busy={loading} className={css({ mt: "1rem" })}>
        {loading ? (
          <p role="status" className={css({ py: "3rem", textAlign: "center", color: "var(--ink-soft)" })}>Loading your rooms…</p>
        ) : visible.length ? (
          <div className={css({ borderTop: "1px solid var(--ink)" })}>
            {visible.map((room) => <RoomRow key={room.id} room={room} />)}
          </div>
        ) : rooms.length && !error ? (
          <p className={css({ py: "2rem", color: "var(--ink-soft)" })}>
            No rooms match this filter.{" "}
            <button type="button" className={css({ textDecoration: "underline" })} onClick={() => { setFilter("all"); setQuery(""); }}>
              Show all rooms
            </button>
          </p>
        ) : !error ? (
          <div className={css({ mt: "0.5rem", border: "1px dashed color-mix(in srgb, var(--ink) 45%, transparent)", p: { base: "1.25rem", md: "2rem" } })}>
            <h2 className={s.heading}>No rooms yet</h2>
            <p className={css({ mt: "0.4rem", maxW: "60ch", color: "var(--ink-soft)", lineHeight: 1.6 })}>
              Start one for a study group or a class, then share an invite link or QR code. Course teachers can also open a
              room from any lesson, and course members find it in the lesson’s side rail.
            </p>
            {!creating ? (
              <button type="button" className={`${s.primary} ${css({ mt: "1rem" })}`} onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" /> Start a room
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
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
      <Nav />
      {access.status === "ready" ? <RoomLibrary account={access.account} /> : <CoursesAccessGate state={access} onRetry={retry} />}
    </div>
  );
}
