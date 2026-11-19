import { Link } from "@tanstack/react-router";
import { KeatingBot } from "../KeatingBot";
import { useChartTooltip } from "../../design-system/charts";
import { motion } from "motion/react";
import { AvatarStack, Chip, StatusDot } from "../../design-system/kit";
import { SOFT, useMotionAllowed } from "../../design-system/motion";
import { formatCourseRelative } from "../courses/course-ui";
import type { RoomListItem } from "../../rooms/contracts";
import { ROLE_LABELS } from "./room-ui";

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

export function RoomRow({ room, index = 0 }: { room: RoomListItem; index?: number }) {
  const state = room.keating ?? (room.facilitatorName ? "running" : "off");
  const stateLabel = { running: "Keating is running", off: "Keating is not running", paused: "Keating is paused", ended: "Room ended" }[state];
  const names = room.present?.map(member => member.displayName) ?? [];
  const count = room.presentCount;
  const tip = useChartTooltip();
  const presence = names.length ? `${count ?? names.length} here: ${names.join(", ")}` : "";
  const { "aria-label": presenceLabel, ...presenceEvents } = tip.bind(presence);
  const activity = room.lastMessageAt ?? room.updatedAt;
  const animate = useMotionAllowed();
  return (
    <motion.div initial={animate ? { y: 8 } : false} animate={{ y: 0 }} transition={{ ...SOFT, delay: Math.min(index, 7) * 0.06 }}>
      <Link to="/rooms/$roomId" params={{ roomId: room.id }} className="rm-room-row" data-lead={index === 0} {...(presence ? presenceEvents : {})}>
        <span className="rm-row-title"><strong>{room.title}</strong>
          {room.topic && <small>{room.topic}</small>}
          {room.courseTitle && <small>{room.courseTitle}{room.lessonTitle && ` · ${room.lessonTitle}`}</small>}
        </span>
        <span className="rm-faces">
          {names.length > 0 && <span className="rm-presence" role="img" aria-label={presenceLabel}>
            <AvatarStack names={names.slice(0, 3)} aria-hidden="true" />
            {(count ?? names.length) > 3 && <span className="rm-extra" aria-hidden="true">+{(count ?? names.length) - 3}</span>}
          </span>}
        </span>
        <span className="rm-activity">
          {count !== undefined && <>{count ? `${count} here` : "Nobody here"} · </>}{room.memberCount} {room.memberCount === 1 ? "member" : "members"}
          <small>Active <time dateTime={activity}>{formatCourseRelative(activity)}</time></small>
        </span>
        <span className="rm-run-cell">{state === "running" ? <KeatingBot state="blank-idle" size={22} label="" /> : <StatusDot tone={state === "paused" ? "warn" : "idle"} />}
          <span>{stateLabel}
            {state === "running" && room.viewerIsFacilitator && <small>from your browser</small>}
            {state === "running" && room.facilitatorName && !room.viewerIsFacilitator && <small>from {room.facilitatorName}’s browser</small>}
            {state === "off" && <small>someone needs to start it</small>}
          </span>
        </span>
        <span className="rm-badges"><Chip>{ROLE_LABELS[room.role]}</Chip>{room.status === "ended" && <Chip>Ended</Chip>}</span>
      </Link>
      {tip.tooltip}
    </motion.div>
  );
}
