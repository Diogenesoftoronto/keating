import { createError, defineWebSocketHandler, getQuery, toResponse } from "h3";
import type {
  RoomClientSocketMessage,
  RoomRealtimeMessage,
} from "../../../src/rooms/contracts";
import { roomSchema } from "../../../src/rooms/contracts";
import { findRoomMember, projectRoomForViewer } from "../../../src/rooms/operations";
import { NotOrganicOperationalError } from "../../../src/notorganic-provider/server";
import { requireCourseProductSession } from "../../utils/course-session";
import { consumePublicRateLimit } from "../../utils/public-abuse";
import { assertRoomRequestOrigin } from "../../utils/room-request";
import {
  connectRoomPeer,
  disconnectRoomPeer,
  relayKeatingPreview,
  relayTyping,
} from "../../utils/room-realtime";
import { currentRoom, getRoomForAccount } from "../../utils/room-repository";

const MAX_CLIENT_MESSAGE_CHARS = 16_000;
// Per-connection token bucket, checked before any room load. Clients send at
// most ~7 previews a second plus typing and a periodic ping.
const FRAME_BURST = 30;
const FRAMES_PER_SECOND = 10;

function send(peer: { send(data: unknown): unknown }, message: RoomRealtimeMessage): void {
  peer.send(JSON.stringify(message));
}

function parseClientMessage(text: string): RoomClientSocketMessage | null {
  if (text.length > MAX_CLIENT_MESSAGE_CHARS) return null;
  try {
    const value = JSON.parse(text) as Partial<RoomClientSocketMessage>;
    if (!value || typeof value !== "object") return null;
    if (value.type === "typing") return { type: "typing" };
    if (
      value.type === "keating.preview" &&
      typeof value.facilitatorId === "string" &&
      roomSchema.shape.id.safeParse(value.facilitatorId).success &&
      typeof value.turnId === "string" &&
      roomSchema.shape.id.safeParse(value.turnId).success &&
      typeof value.text === "string"
    ) {
      return { type: "keating.preview", facilitatorId: value.facilitatorId, turnId: value.turnId, text: value.text };
    }
  } catch {
    // Not a room message.
  }
  return null;
}

export default defineWebSocketHandler((event) => {
  let authorized: { roomId: string; accountId: string } | undefined;
  let tokens = FRAME_BURST;
  let refilledAt = Date.now();
  const takeFrame = () => {
    const now = Date.now();
    tokens = Math.min(FRAME_BURST, tokens + ((now - refilledAt) / 1000) * FRAMES_PER_SECOND);
    refilledAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  // Nitro resolves the hooks before CrossWS performs the upgrade. A rejected
  // factory loses its hooks; return HTTP failures from the upgrade hook instead.
  return {
    async upgrade() {
      try {
        assertRoomRequestOrigin(event);
        const session = await requireCourseProductSession(event);
        const roomId = getQuery(event).roomId;
        if (!roomSchema.shape.id.safeParse(roomId).success) {
          throw createError({ statusCode: 400, statusMessage: "roomId is required." });
        }
        const id = roomId as string;
        await consumePublicRateLimit(event, { bucket: "room-socket", key: session.accountId, limit: 120, windowSeconds: 60 });
        const snapshot = await getRoomForAccount(id, session.accountId);
        if (!snapshot) throw createError({ statusCode: 404, statusMessage: "Room not found." });
        authorized = { roomId: id, accountId: session.accountId };
        // Session adapters can stage cookies and other headers during authorization.
        return { headers: event.res.headers };
      } catch (error) {
        const failure = error instanceof NotOrganicOperationalError
          ? createError({ statusCode: error.statusCode, statusMessage: "Room account authorization is unavailable. Try again." })
          : error;
        return toResponse(failure, event, { silent: true });
      }
    },
    async open(peer) {
      if (!authorized) {
        peer.close(4403, "Room authorization required");
        return;
      }
      const { roomId: id, accountId } = authorized;
      // A member can be removed or demoted between upgrade authorization and open.
      const room = await currentRoom(id);
      if (!room || !findRoomMember(room, accountId)) {
        send(peer, { type: "removed", roomId: id });
        peer.close(4403, "Not a room member");
        return;
      }
      const latest = projectRoomForViewer(room, accountId);
      connectRoomPeer(id, accountId, peer, room);
      send(peer, { type: "snapshot", snapshot: latest });
    },
    async message(peer, message) {
      if (!authorized) {
        peer.close(4403, "Room authorization required");
        return;
      }
      const { roomId: id, accountId } = authorized;
      if (!takeFrame()) return;
      const text = message.text();
      const room = await currentRoom(id);
      if (!room || !findRoomMember(room, accountId)) {
        send(peer, { type: "removed", roomId: id });
        peer.close(4403, "Not a room member");
        return;
      }
      if (text === "ping") {
        peer.send("pong");
        return;
      }
      const parsed = parseClientMessage(text);
      if (!parsed) {
        send(peer, {
          type: "error",
          code: "room_realtime_read_only",
          message: "Send room changes through the authenticated operations endpoint.",
        });
        return;
      }
      if (parsed.type === "typing") relayTyping(room, peer);
      else relayKeatingPreview(room, peer, parsed.facilitatorId, parsed.turnId, parsed.text);
    },
    close(peer) {
      if (authorized) disconnectRoomPeer(authorized.roomId, peer);
    },
  };
});
