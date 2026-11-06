/**
 * Shared vocabulary for the study-room surfaces: class names that extend the
 * course design language, plain-language labels, and the permission rules the
 * UI mirrors from the server so people only see controls that will work.
 */
import { css } from "../../../styled-system/css";
import {
  courseButtonClass,
  courseInputClass,
  courseLabelClass,
} from "../courses/course-ui";
import {
  facilitatorIsFresh,
  roleCanOversee,
  type RoomInviteRole,
  type RoomInviteSummary,
  type RoomMember,
  type RoomRole,
  type RoomSettings,
  type RoomViewerSnapshot,
} from "../../rooms/contracts";

/**
 * One self-contained class: stacking the course button and primary classes
 * leaves the background to stylesheet order, which can drop the green.
 * #14743c with white text is about 6:1, safe for small labels.
 */
const roomPrimaryClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  border: "1px solid #0f5a2e",
  bg: "#14743c",
  px: "0.7rem",
  py: "0.48rem",
  fontSize: "0.74rem",
  fontWeight: 750,
  color: "#ffffff",
  whiteSpace: "nowrap",
  cursor: "pointer",
  _hover: { bg: "#0f5a2e" },
  _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" },
  _disabled: { opacity: 0.55, cursor: "not-allowed", _hover: { bg: "#14743c" } },
});

const roomQuietClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  border: "1px solid transparent",
  bg: "transparent",
  px: "0.4rem",
  py: "0.25rem",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "var(--ink)",
  cursor: "pointer",
  _hover: { borderColor: "var(--ink)" },
  _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" },
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
});

const roomQuietDangerClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  border: "1px solid transparent",
  bg: "transparent",
  px: "0.4rem",
  py: "0.25rem",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "var(--destructive)",
  cursor: "pointer",
  _hover: { borderColor: "var(--destructive)" },
  _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" },
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
});

const roomDangerClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  border: "1px solid var(--destructive)",
  bg: "var(--paper)",
  px: "0.7rem",
  py: "0.48rem",
  fontSize: "0.74rem",
  fontWeight: 750,
  color: "var(--destructive)",
  whiteSpace: "nowrap",
  cursor: "pointer",
  _hover: { bg: "color-mix(in srgb, var(--destructive) 10%, var(--paper))" },
  _focusVisible: { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "2px" },
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
});

export const roomStyles = {
  label: courseLabelClass,
  input: courseInputClass,
  button: courseButtonClass,
  primary: roomPrimaryClass,
  quiet: roomQuietClass,
  danger: roomDangerClass,
  quietDanger: roomQuietDangerClass,
  section: css({
    borderTop: "1px solid var(--ink)",
    pt: "0.9rem",
    mt: "1rem",
    _first: { borderTop: 0, pt: 0, mt: 0 },
  }),
  heading: css({
    fontFamily: "Georgia, serif",
    fontSize: "1.05rem",
    fontWeight: 700,
    lineHeight: 1.25,
  }),
  help: css({
    mt: "0.3rem",
    fontSize: "0.74rem",
    lineHeight: 1.5,
    color: "var(--ink-soft)",
  }),
  field: css({ display: "grid", gap: "0.3rem" }),
  fieldLabel: css({ fontSize: "0.76rem", fontWeight: 750 }),
  error: css({
    border: "1px solid color-mix(in srgb, var(--destructive) 55%, transparent)",
    bg: "color-mix(in srgb, var(--destructive) 8%, var(--card))",
    px: "0.75rem",
    py: "0.55rem",
    fontSize: "0.78rem",
    color: "var(--destructive)",
  }),
  notice: css({
    border: "1px solid color-mix(in srgb, var(--course-green, #1e9b50) 55%, transparent)",
    bg: "color-mix(in srgb, var(--course-green, #1e9b50) 10%, var(--card))",
    px: "0.75rem",
    py: "0.55rem",
    fontSize: "0.78rem",
    lineHeight: 1.5,
  }),
  chip: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    border: "1px solid color-mix(in srgb, var(--ink) 35%, transparent)",
    px: "0.4rem",
    py: "0.12rem",
    fontFamily: "var(--mono-display)",
    fontSize: "0.6rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--ink-soft)",
    whiteSpace: "nowrap",
  }),
  /** Segmented radio group that reads as one control. */
  segment: css({
    display: "grid",
    gridAutoFlow: { base: "row", sm: "column" },
    gridAutoColumns: "minmax(0, 1fr)",
    border: "1px solid var(--ink)",
  }),
  segmentOption: css({
    position: "relative",
    display: "grid",
    gap: "0.15rem",
    borderBottom: { base: "1px solid var(--ink)", sm: 0 },
    borderRight: { sm: "1px solid var(--ink)" },
    px: "0.65rem",
    py: "0.55rem",
    cursor: "pointer",
    fontSize: "0.76rem",
    _last: { borderBottom: 0, borderRight: 0 },
    _hover: { bg: "var(--course-wash, #ddebdd)" },
    "&:has(input:checked)": { bg: "var(--ink)", color: "var(--paper)" },
    "&:has(input:focus-visible)": { outline: "2px solid var(--peer-blue, #3468b3)", outlineOffset: "-3px" },
    "&:has(input:disabled)": { opacity: 0.55, cursor: "not-allowed" },
    "& input": { position: "absolute", opacity: 0, pointerEvents: "none" },
  }),
  segmentHint: css({ fontSize: "0.68rem", opacity: 0.8, lineHeight: 1.35 }),
};

export const ROLE_LABELS: Record<RoomRole, string> = {
  host: "Host",
  teacher: "Teacher",
  learner: "Learner",
  observer: "Observer",
};

export const INVITE_ROLE_HINTS: Record<RoomInviteRole, string> = {
  teacher:
    "Reads everything, including private guidance and held replies, and can run, pause, or review Keating.",
  learner: "Joins the shared conversation with Keating and the group.",
  observer: "Reads the shared conversation without posting.",
};

export const INVITE_EXPIRY_OPTIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 720, label: "30 days" },
] as const;

export function articleRole(role: RoomRole | RoomInviteRole): string {
  return role === "observer" ? "an observer" : `a ${role}`;
}

export function memberName(member: Pick<RoomMember, "accountId" | "displayName">, viewerId: string): string {
  return member.accountId === viewerId ? `${member.displayName} (you)` : member.displayName;
}

export interface MemberActions {
  canMute: boolean;
  canRemove: boolean;
  roleOptions: RoomInviteRole[];
}

/** Mirrors the server's member.mute / member.remove / member.role rules. */
export function memberActions(snapshot: RoomViewerSnapshot, target: RoomMember): MemberActions {
  const { viewer, permissions } = snapshot;
  const self = target.accountId === viewer.accountId;
  const none: MemberActions = { canMute: false, canRemove: false, roleOptions: [] };
  if (self || target.role === "host" || !permissions.canOversee) return none;
  return {
    canMute: !roleCanOversee(target.role),
    canRemove: target.role !== "teacher" || viewer.role === "host",
    roleOptions: permissions.canManageRoles ? (["teacher", "learner", "observer"] as const).filter((role) => role !== target.role) : [],
  };
}

export type InviteState = "active" | "expired" | "revoked" | "used";

export function inviteState(invite: RoomInviteSummary, now = Date.now()): InviteState {
  if (invite.revokedAt) return "revoked";
  if (Date.parse(invite.expiresAt) <= now) return "expired";
  if (invite.uses >= invite.maxUses) return "used";
  return "active";
}

export function formatRoomTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return date.toLocaleString(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatUntil(iso: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `${minutes} min left`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h left`;
  return `${Math.round(minutes / 1_440)} days left`;
}

/** One plain sentence about how Keating behaves in this room, for every role. */
export function describeKeatingBehavior(settings: Pick<RoomSettings, "keating" | "participation" | "replyReview">): string {
  if (settings.keating === "paused") return "A teacher has paused Keating. It will not reply until they resume it.";
  const when = settings.participation === "on-request"
    ? "Keating replies only when someone mentions @Keating or a teacher asks it to step in."
    : "Keating reads the conversation and joins in when it can help.";
  return settings.replyReview === "teacher-approves"
    ? `${when} A teacher approves each reply before the room sees it.`
    : when;
}

export type KeatingRunState =
  | { kind: "ended" }
  | { kind: "paused" }
  | { kind: "off" }
  | { kind: "running"; facilitatorName: string; modelLabel: string; self: boolean; thinking: boolean };

export function keatingRunState(snapshot: RoomViewerSnapshot, now = Date.now()): KeatingRunState {
  const { room, viewer } = snapshot;
  if (room.status === "ended") return { kind: "ended" };
  if (room.settings.keating === "paused") return { kind: "paused" };
  if (!facilitatorIsFresh(room.facilitator, now)) return { kind: "off" };
  return {
    kind: "running",
    facilitatorName: room.facilitator.displayName,
    modelLabel: room.facilitator.modelLabel,
    self: room.facilitator.accountId === viewer.accountId,
    thinking: room.turn.status === "thinking",
  };
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
