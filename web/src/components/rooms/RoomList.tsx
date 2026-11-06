import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Users } from "lucide-react";
import { css } from "../../../styled-system/css";
import { formatCourseRelative } from "../courses/course-ui";
import type { RoomListItem } from "../../rooms/contracts";
import { ROLE_LABELS, roomStyles as s } from "./room-ui";

export type RoomFilter = "open" | "hosting" | "course" | "ended" | "all";

export const ROOM_FILTERS: ReadonlyArray<{ value: RoomFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "hosting", label: "Hosting" },
  { value: "course", label: "Course rooms" },
  { value: "ended", label: "Ended" },
  { value: "all", label: "All" },
];

export function filterRooms(rooms: readonly RoomListItem[], filter: RoomFilter, query: string): RoomListItem[] {
  const needle = query.trim().toLowerCase();
  return rooms
    .filter((room) => {
      if (filter === "open" && room.status !== "open") return false;
      if (filter === "ended" && room.status !== "ended") return false;
      if (filter === "hosting" && room.role !== "host") return false;
      if (filter === "course" && !room.courseId) return false;
      if (!needle) return true;
      return [room.title, room.topic, room.courseTitle, room.lessonTitle]
        .some((field) => field?.toLowerCase().includes(needle));
    })
    .sort((left, right) =>
      Date.parse(right.lastMessageAt ?? right.updatedAt) - Date.parse(left.lastMessageAt ?? left.updatedAt));
}

const rowClass = css({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: "0.75rem",
  borderBottom: "1px solid color-mix(in srgb, var(--ink) 25%, transparent)",
  px: "0.25rem",
  py: "0.85rem",
  color: "inherit",
  textDecoration: "none",
  _hover: { bg: "color-mix(in srgb, var(--course-wash, #ddebdd) 60%, transparent)" },
  _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" },
});

export function RoomRow({ room }: { room: RoomListItem }) {
  const activity = room.lastMessageAt ?? room.updatedAt;
  return (
    <Link to="/rooms/$roomId" params={{ roomId: room.id }} className={rowClass}>
      <span className={css({ minW: 0 })}>
        <span className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" })}>
          <strong className={css({ fontSize: "0.98rem", overflowWrap: "anywhere" })}>{room.title}</strong>
          <span className={s.chip}>{ROLE_LABELS[room.role]}</span>
          {room.status === "ended" ? <span className={s.chip}>Ended</span> : null}
        </span>
        {room.topic ? (
          <span className={css({ mt: "0.2rem", display: "block", fontSize: "0.8rem", color: "var(--ink-soft)", lineClamp: 2 })}>
            {room.topic}
          </span>
        ) : null}
        <span className={css({ mt: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.8rem", fontSize: "0.72rem", color: "var(--ink-soft)" })}>
          <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem" })}>
            <Users size={13} aria-hidden="true" /> {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
          </span>
          {room.courseTitle ? (
            <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem" })}>
              <BookOpen size={13} aria-hidden="true" /> {room.courseTitle}{room.lessonTitle ? ` · ${room.lessonTitle}` : ""}
            </span>
          ) : null}
          <span>{room.facilitatorName ? `Keating running from ${room.facilitatorName}’s browser` : "Keating not running"}</span>
          <span>Active <time dateTime={activity}>{formatCourseRelative(activity)}</time></span>
        </span>
      </span>
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}
