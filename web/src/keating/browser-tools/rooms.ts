import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  applyRoomOperation,
  createRoom,
  createRoomInvite,
  getRoom,
  listRooms,
  randomOperationId,
  RoomApiError,
  roomInviteUrl,
} from "../../rooms/client";
import {
  ROOM_MAX_MEMBERS,
  ROOM_MESSAGE_MAX_CHARS,
  type RoomInviteRole,
  type RoomInviteSummary,
  type RoomViewerSnapshot,
} from "../../rooms/contracts";
import { createTool } from "./shared";

/** Mirrors the server's invite body limits in server/api/rooms/[...path].ts. */
const INVITE_MAX_HOURS = 24 * 30;
const INVITE_DEFAULT_HOURS = 72;
const INVITE_DEFAULT_USES = 30;
const ROOM_TITLE_MAX_CHARS = 160;
const ROOM_TEXT_MAX_CHARS = 2_000;
const TOOL_INVITE_ROLES = ["learner", "observer"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function roomLink(id: string, title: string): string {
  return `[${title}](/rooms/${encodeURIComponent(id)})`;
}

function browserOrigin(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const origin = window.location?.origin;
  return origin && /^https?:\/\//.test(origin) ? origin : undefined;
}

function absoluteInviteUrl(token: string): string {
  const origin = browserOrigin();
  return origin ? roomInviteUrl(token, origin) : `/rooms/join/${token}`;
}

/**
 * Translate room API failures into text the tutor can relay to the learner.
 * Thrown as plain Errors so createTool reports them as execution failures
 * without exposing raw response bodies.
 */
export function roomFailureMessage(error: unknown, action: string): string {
  if (!(error instanceof RoomApiError)) {
    return `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const code = error.code ?? "";
  if (error.status === 401 || code.startsWith("notorganic_auth")) {
    return `Could not ${action}: study rooms need a signed-in Keating account. Ask the learner to sign in, then try again.`;
  }
  if (error.status === 429) {
    return `Could not ${action}: room requests are rate limited right now. Try again in a few minutes.`;
  }
  if (code === "room_invite_limit") {
    return `Could not ${action}: this room already has too many open invitations. The learner can revoke an unused one from the room's invite panel, then try again.`;
  }
  if (error.status === 403) {
    return `Could not ${action}: ${error.message || "the learner is not permitted to do this in that room."} Only the room's host or teachers can invite, unless the host allows learner invitations.`;
  }
  if (error.status === 404) {
    return `Could not ${action}: that room was not found, has been deleted, or the learner is no longer a member. Use room_list to choose a room.`;
  }
  if (error.status === 400) {
    return `Could not ${action}: the room service rejected the request (${error.message}).`;
  }
  if (error.status >= 500) {
    return `Could not ${action}: study rooms are not available on this server right now. Try again later.`;
  }
  return `Could not ${action}: the room request failed (${error.status}).`;
}

async function roomCall<T>(action: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new Error(roomFailureMessage(error, action));
  }
}

function integerParam(
  value: unknown,
  name: string,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be a whole number from 1 to ${max}.`);
  }
  return value;
}

function boundedText(value: unknown, name: string, max: number): string {
  const result = text(value);
  if (result.length > max) {
    throw new Error(`${name} must be at most ${max} characters.`);
  }
  return result;
}

function formatExpiry(invite: RoomInviteSummary): string {
  const expires = new Date(invite.expiresAt);
  if (Number.isNaN(expires.getTime())) return invite.expiresAt;
  return expires.toUTCString();
}

async function postOpeningMessage(
  snapshot: RoomViewerSnapshot,
  body: string,
): Promise<string> {
  if (!body) return "";
  if (!snapshot.permissions.canPost) {
    return "Opening message: not posted, because the learner cannot post in this room.";
  }
  try {
    await applyRoomOperation(snapshot.room.id, {
      type: "message.post",
      messageId: randomOperationId("msg"),
      body,
    });
    return "Opening message: posted in the room so the invitee arrives with context.";
  } catch (error) {
    return `Opening message: not posted (${roomFailureMessage(error, "post the opening message")}). The invite link still works.`;
  }
}

async function inviteToRoom(params: Record<string, unknown>): Promise<string> {
  const roomId = text(params.room_id);
  const role = (text(params.role) || "learner") as RoomInviteRole;
  if (!(TOOL_INVITE_ROLES as readonly string[]).includes(role)) {
    throw new Error("role must be learner or observer.");
  }
  const expiresInHours = integerParam(
    params.expires_in_hours,
    "expires_in_hours",
    INVITE_DEFAULT_HOURS,
    INVITE_MAX_HOURS,
  );
  const maxUses = integerParam(
    params.max_uses,
    "max_uses",
    INVITE_DEFAULT_USES,
    ROOM_MAX_MEMBERS,
  );
  const openingMessage = boundedText(
    params.opening_message,
    "opening_message",
    ROOM_MESSAGE_MAX_CHARS,
  );

  let snapshot: RoomViewerSnapshot;
  let created = false;
  if (roomId) {
    snapshot = await roomCall("open that room", () => getRoom(roomId));
    if (!snapshot.permissions.canInvite) {
      throw new Error(
        snapshot.room.status === "ended"
          ? `Could not create an invite: “${snapshot.room.title}” has ended. Offer to open a new room instead.`
          : `Could not create an invite: the learner's ${snapshot.viewer.role} role in “${snapshot.room.title}” cannot invite people. Ask the room's host for a link, or offer to open a new room.`,
      );
    }
    if (!snapshot.permissions.inviteRoles.includes(role)) {
      throw new Error(
        `Could not create an invite: the learner can only invite ${snapshot.permissions.inviteRoles.join(" or ")} members to “${snapshot.room.title}”.`,
      );
    }
  } else {
    const title = boundedText(params.title, "title", ROOM_TITLE_MAX_CHARS);
    if (!title) {
      throw new Error(
        "A title is required to open a new study room. Agree on one with the learner, or pass room_id from room_list.",
      );
    }
    const topic = boundedText(params.topic, "topic", ROOM_TEXT_MAX_CHARS);
    const goal = boundedText(params.goal, "goal", ROOM_TEXT_MAX_CHARS);
    snapshot = await roomCall("open a study room", () =>
      createRoom({ title, topic, goal }),
    );
    created = true;
  }

  const roomLine = `Room: ${roomLink(snapshot.room.id, snapshot.room.title)}${created ? " (new room; the learner is the host)" : ""}`;
  let invite: { invite: RoomInviteSummary; token: string };
  try {
    invite = await createRoomInvite(snapshot.room.id, {
      role,
      expiresInHours,
      maxUses,
    });
  } catch (error) {
    const reason = roomFailureMessage(error, "create the invite link");
    throw new Error(
      created
        ? `${reason}\n\nThe room itself was created and the learner can open it here: ${roomLink(snapshot.room.id, snapshot.room.title)}`
        : reason,
    );
  }

  const opening = await postOpeningMessage(snapshot, openingMessage);
  const url = absoluteInviteUrl(invite.token);
  const uses = invite.invite.maxUses;
  return [
    "## Study room invite ready",
    "",
    roomLine,
    `Invite link (${invite.invite.role}): ${url}`,
    `Expires: ${formatExpiry(invite.invite)} · Up to ${uses} ${uses === 1 ? "person" : "people"} can join with it`,
    ...(opening ? [opening] : []),
    "",
    "The learner sends this link themselves, by message, email, or however they usually talk. Keating has not contacted anyone and never will. Anyone holding the link can join until it expires or runs out of uses, so share it only with the people they mean to invite. Invites can be revoked from the room's invite panel.",
  ].join("\n");
}

async function listLearnerRooms(): Promise<string> {
  const rooms = await roomCall("list study rooms", () => listRooms());
  if (!rooms.length) {
    return "The learner has no study rooms yet. If they want to talk something through with another person, offer to open one with room_invite once they agree.";
  }
  return [
    "## Study rooms",
    "",
    ...rooms.map((room) => {
      const context = room.lessonTitle ?? room.courseTitle;
      return [
        `- ${roomLink(room.id, room.title)}`,
        `${room.role}`,
        room.status === "ended" ? "ended" : "open",
        `${room.memberCount} ${room.memberCount === 1 ? "member" : "members"}`,
        ...(context ? [`course: ${context}`] : []),
        ...(room.topic ? [`topic: ${room.topic.slice(0, 160)}`] : []),
        `\`${room.id}\``,
      ].join(" · ");
    }),
  ].join("\n");
}

export function createRoomTools(): AgentTool[] {
  return [
    createTool(
      "room_list",
      "List the Keating study rooms the signed-in learner belongs to, with their role, status, and room id. Use it before inviting someone to an existing room. Reads only the learner's own room memberships.",
      {},
      () => listLearnerRooms(),
    ),
    createTool(
      "room_invite",
      "Create an invite link so the learner can bring a colleague or study partner into a Keating study room to talk a topic through together. Only call this after the learner explicitly agrees to invite someone. Pass room_id to invite into an existing room (from room_list); without room_id a new room is opened first from a title, topic, and goal agreed with the learner. Returns a link the learner sends themselves; Keating never contacts the invitee. Never invent names or email addresses, and never put private chat content in opening_message without the learner's agreement.",
      {
        room_id: {
          type: "string",
          description:
            "Existing room id from room_list. Omit to open a new room.",
        },
        title: {
          type: "string",
          description: `Agreed title for a new room (max ${ROOM_TITLE_MAX_CHARS} characters). Required when room_id is omitted.`,
        },
        topic: {
          type: "string",
          description: "What the room will discuss, for a new room.",
        },
        goal: {
          type: "string",
          description:
            "What the learner and invitee want to come away with, for a new room.",
        },
        role: {
          type: "string",
          enum: [...TOOL_INVITE_ROLES],
          description:
            "learner can post; observer can only read. Default learner.",
        },
        expires_in_hours: {
          type: "integer",
          description: `Hours until the link expires, 1 to ${INVITE_MAX_HOURS}. Default ${INVITE_DEFAULT_HOURS}.`,
        },
        max_uses: {
          type: "integer",
          description: `How many people may join with the link, 1 to ${ROOM_MAX_MEMBERS}. Default ${INVITE_DEFAULT_USES}.`,
        },
        opening_message: {
          type: "string",
          description:
            "Optional first message posted in the room as the learner, so the invitee lands in context. Use only wording the learner has approved.",
        },
      },
      (params) => inviteToRoom(params),
    ),
  ];
}
