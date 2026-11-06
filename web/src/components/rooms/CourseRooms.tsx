/**
 * Shared study rooms linked to a course, shown in the course workspace rail.
 * Course teachers and owners open rooms (carrying the current lesson);
 * every course member can join as a learner. Teachers join as teachers.
 * Nothing about anyone's private course progress is shared by joining.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, Users, X } from "lucide-react";
import { css } from "../../../styled-system/css";
import { createRoom, joinCourseRoom, listCourseRooms } from "../../rooms/client";
import type { RoomListItem } from "../../rooms/contracts";
import type { CourseLesson, CourseRole } from "../../courses/contracts";
import { RoomCreateForm } from "./RoomCreateForm";
import { RoomJoinDisclosureList } from "./RoomJoinDisclosure";
import { ROLE_LABELS, articleRole, errorMessage, roomStyles as s } from "./room-ui";

export function courseRoomJoinRole(role: CourseRole): "teacher" | "learner" {
  return role === "owner" || role === "teacher" ? "teacher" : "learner";
}

export function canOpenCourseRoom(role: CourseRole): boolean {
  return role === "owner" || role === "teacher";
}

export function CourseRooms({
  courseId,
  courseRole,
  activeLesson,
  displayName,
}: {
  courseId: string;
  courseRole: CourseRole;
  activeLesson: CourseLesson | undefined;
  displayName: string;
}) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState("");
  /** The unjoined room whose disclosure is open for confirmation. */
  const [confirmId, setConfirmId] = useState("");
  const requestRef = useRef(0);
  const canOpen = canOpenCourseRoom(courseRole);

  const load = useCallback(async () => {
    // Ignore a slow response for a course the rail has since moved away from.
    const request = ++requestRef.current;
    setError("");
    try {
      const items = await listCourseRooms(courseId);
      if (request === requestRef.current) setRooms(items);
    } catch (cause) {
      if (request === requestRef.current) setError(errorMessage(cause, "Course rooms could not be loaded."));
    }
  }, [courseId]);

  useEffect(() => {
    setRooms(null);
    setConfirmId("");
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const join = async (room: RoomListItem) => {
    if (room.joined) {
      await navigate({ to: "/rooms/$roomId", params: { roomId: room.id } });
      return;
    }
    if (confirmId !== room.id) {
      setConfirmId(room.id);
      return;
    }
    setJoiningId(room.id);
    setError("");
    try {
      const snapshot = await joinCourseRoom(room.id, courseId, displayName);
      await navigate({ to: "/rooms/$roomId", params: { roomId: snapshot.room.id } });
    } catch (cause) {
      setError(errorMessage(cause, "You could not join this room."));
      setJoiningId("");
    }
  };

  const open = (rooms ?? []).filter((room) => room.status === "open");

  return (
    <section aria-labelledby="course-rooms-heading" className={css({ mt: "1.25rem", borderTop: "1px solid var(--ink)", pt: "1rem" })}>
      <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
        <h2 id="course-rooms-heading" className={s.label}>Study rooms</h2>
        {canOpen ? (
          <button type="button" className={s.quiet} aria-expanded={creating} onClick={() => setCreating((value) => !value)}>
            {creating ? <X size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />} {creating ? "Close" : "Open room"}
          </button>
        ) : null}
      </div>
      <p className={s.help}>
        A shared conversation with Keating and classmates. Your Keating chat above stays private; in a room, everyone
        sees what you post. Your course progress is not shared.
      </p>

      {creating ? (
        <div className={css({ mt: "0.6rem", border: "1px solid var(--ink)", bg: "var(--card)", p: "0.75rem" })}>
          <RoomCreateForm
            submitLabel="Open room"
            initial={{ title: activeLesson ? activeLesson.title : "", topic: activeLesson?.summary.slice(0, 2_000) ?? "" }}
            context={
              <p className={s.help}>
                {activeLesson
                  ? <>Linked to the lesson <strong>{activeLesson.title}</strong>; Keating reads its objectives. Course members can join from here.</>
                  : "Linked to this course. Course members can join from here."}
              </p>
            }
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              const snapshot = await createRoom({ ...input, courseId, ...(activeLesson ? { lessonId: activeLesson.id } : {}), displayName });
              await navigate({ to: "/rooms/$roomId", params: { roomId: snapshot.room.id } });
            }}
          />
        </div>
      ) : null}

      {error ? (
        <div role="alert" className={css({ mt: "0.5rem", display: "grid", gap: "0.35rem" })}>
          <p className={s.error}>{error}</p>
          <button type="button" className={s.quiet} onClick={() => void load()}>Try again</button>
        </div>
      ) : null}

      {rooms === null && !error ? (
        <p className={s.help}>Loading rooms…</p>
      ) : rooms && open.length === 0 ? (
        <p className={s.help}>{canOpen ? "No open rooms. Open one for the current lesson." : "No open rooms yet. Your teacher can open one."}</p>
      ) : (
        <ul className={css({ mt: "0.5rem", display: "grid", gap: "0.4rem" })}>
          {open.map((room) => {
            // Unjoined course listings carry the role the server will grant.
            const joinRole = room.role;
            const confirming = !room.joined && confirmId === room.id;
            return (
            <li key={room.id} className={css({ border: "1px solid color-mix(in srgb, var(--ink) 35%, transparent)", bg: "var(--card)", p: "0.55rem" })}>
              <strong className={css({ display: "block", fontSize: "0.8rem", overflowWrap: "anywhere" })}>{room.title}</strong>
              <span className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem", mt: "0.15rem", fontSize: "0.68rem", color: "var(--ink-soft)" })}>
                <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.2rem" })}><Users size={11} aria-hidden="true" /> {room.memberCount}</span>
                {room.lessonTitle ? <span>{room.lessonTitle}</span> : null}
                <span>{room.facilitatorName ? "Keating running" : "Keating off"}</span>
              </span>
              {confirming ? (
                <div role="group" aria-label={`Before you join ${room.title}`} className={css({ mt: "0.5rem", borderTop: "1px solid color-mix(in srgb, var(--ink) 25%, transparent)", pt: "0.5rem", fontSize: "0.72rem" })}>
                  <p className={css({ mb: "0.45rem", fontWeight: 750 })}>You will join as {articleRole(joinRole)}.</p>
                  <div className={css({ "& ul": { fontSize: "0.72rem", gap: "0.5rem" } })}>
                    <RoomJoinDisclosureList disclosure={room} role={joinRole} />
                  </div>
                </div>
              ) : null}
              <div className={css({ mt: "0.45rem", display: "flex", gap: "0.35rem" })}>
                <button
                  type="button"
                  className={`${room.joined || !confirming ? s.button : s.primary} ${css({ flex: 1 })}`}
                  disabled={joiningId === room.id}
                  onClick={() => void join(room)}
                  aria-expanded={room.joined ? undefined : confirming}
                  aria-label={room.joined ? `Open ${room.title}` : confirming ? `Join ${room.title} as ${joinRole}` : `Review joining ${room.title}`}
                >
                  {joiningId === room.id ? "Joining…" : room.joined ? "Open" : confirming ? `Join as ${ROLE_LABELS[joinRole].toLowerCase()}` : "Join…"}
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
                {confirming ? <button type="button" className={s.button} onClick={() => setConfirmId("")}>Cancel</button> : null}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      <Link to="/rooms" className={css({ mt: "0.5rem", display: "inline-block", fontSize: "0.7rem", textDecoration: "underline", color: "var(--ink-soft)" })}>All your rooms</Link>
    </section>
  );
}
