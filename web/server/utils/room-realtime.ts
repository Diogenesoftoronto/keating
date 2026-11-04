/**
 * Study-room sockets. Every outgoing patch is projected per viewer, so private
 * teacher guidance, drafts, and hidden messages never reach a learner's
 * connection. Keating's live preview is relayed only from the current
 * facilitator, for the current turn, and only to viewers allowed to see it.
 */
import type { Peer } from "crossws";
import { facilitatorIsFresh, roleCanOversee, turnLeaseExpired, type Room, type RoomRealtimeMessage } from "../../src/rooms/contracts";
import { previewAudienceIncludes } from "../../src/rooms/facilitation";
import {
  findRoomMember,
  projectMessagesById,
  projectRoomState,
  permissionsForRoom,
  projectRoomForViewer,
} from "../../src/rooms/operations";

interface RoomRealtimePeer {
  peer: Peer;
  accountId: string;
  lastTypingAt: number;
  lastPreviewAt: number;
  canOversee?: boolean;
}

interface RoomRealtimeGlobals {
  __keatingRoomPeers?: Map<string, Map<string, RoomRealtimePeer>>;
}

const globals = globalThis as typeof globalThis & RoomRealtimeGlobals;
const roomPeers = (globals.__keatingRoomPeers ??= new Map());
const TYPING_INTERVAL_MS = 2_000;
const PREVIEW_INTERVAL_MS = 120;
const PREVIEW_MAX_CHARS = 8_000;

function send(peer: Peer, message: RoomRealtimeMessage): void {
  try {
    peer.send(JSON.stringify(message));
  } catch {
    // A closing socket is cleaned up by its close handler.
  }
}

function peersFor(roomId: string): Map<string, RoomRealtimePeer> {
  let peers = roomPeers.get(roomId);
  if (!peers) {
    peers = new Map();
    roomPeers.set(roomId, peers);
  }
  return peers;
}

export function presentAccountIds(roomId: string): string[] {
  const peers = roomPeers.get(roomId);
  return peers ? [...new Set([...peers.values()].map((connection) => connection.accountId))] : [];
}

function broadcastPresence(roomId: string): void {
  const peers = roomPeers.get(roomId);
  if (!peers) return;
  const message: RoomRealtimeMessage = { type: "presence", roomId, accountIds: presentAccountIds(roomId) };
  for (const connection of peers.values()) send(connection.peer, message);
}

export function connectRoomPeer(roomId: string, accountId: string, peer: Peer, room?: Room): void {
  const peers = peersFor(roomId);
  const own = [...peers.values()].filter((connection) => connection.accountId === accountId);
  if (own.length >= 4) {
    const oldest = own[0]!;
    peers.delete(oldest.peer.id);
    try { oldest.peer.close(4409, "Too many room connections"); } catch { /* Already closed. */ }
  }
  const member = room ? findRoomMember(room, accountId) : undefined;
  peers.set(peer.id, { peer, accountId, lastTypingAt: 0, lastPreviewAt: 0, canOversee: member ? roleCanOversee(member.role) : undefined });
  broadcastPresence(roomId);
}

export function disconnectRoomPeer(roomId: string, peer: Peer): void {
  const peers = roomPeers.get(roomId);
  if (!peers) return;
  peers.delete(peer.id);
  if (peers.size === 0) roomPeers.delete(roomId);
  else broadcastPresence(roomId);
}

/** Send each connected member their own view of what changed. */
export function broadcastRoomChange(
  room: Room,
  touchedMessageIds: readonly string[],
  removedAccountIds: readonly string[] = [],
): void {
  const peers = roomPeers.get(room.id);
  if (!peers) return;
  const removed = new Set(removedAccountIds);
  let presenceChanged = false;
  for (const [peerId, connection] of peers) {
    if (removed.has(connection.accountId) || !findRoomMember(room, connection.accountId)) {
      send(connection.peer, { type: "removed", roomId: room.id });
      peers.delete(peerId);
      presenceChanged = true;
      try {
        connection.peer.close(4403, "Removed from room");
      } catch {
        // Already closed.
      }
      continue;
    }
    const canOversee = roleCanOversee(findRoomMember(room, connection.accountId)!.role);
    if (connection.canOversee !== canOversee) {
      connection.canOversee = canOversee;
      // Replacing state lets clients discard earlier private pages on demotion.
      send(connection.peer, { type: "snapshot", snapshot: projectRoomForViewer(room, connection.accountId) });
      continue;
    }
    send(connection.peer, {
      type: "room.patch",
      revision: room.revision,
      snapshot: projectRoomState(room, connection.accountId),
      messages: projectMessagesById(room, connection.accountId, touchedMessageIds),
    });
  }
  if (peers.size === 0) roomPeers.delete(room.id);
  else if (presenceChanged) broadcastPresence(room.id);
}

/** Tell everyone a room is gone (deleted by its host). */
export function broadcastRoomRemoved(roomId: string): void {
  const peers = roomPeers.get(roomId);
  if (!peers) return;
  for (const connection of peers.values()) {
    send(connection.peer, { type: "removed", roomId });
    try {
      connection.peer.close(4404, "Room deleted");
    } catch {
      // Already closed.
    }
  }
  roomPeers.delete(roomId);
}

export function relayTyping(room: Room, peer: Peer): void {
  const peers = roomPeers.get(room.id);
  const connection = peers?.get(peer.id);
  if (!peers || !connection) return;
  const member = findRoomMember(room, connection.accountId);
  if (!member || member.role === "observer" || member.muted || room.status !== "open") return;
  const now = Date.now();
  if (now - connection.lastTypingAt < TYPING_INTERVAL_MS) return;
  connection.lastTypingAt = now;
  const message: RoomRealtimeMessage = { type: "typing", roomId: room.id, accountId: connection.accountId };
  for (const other of peers.values()) {
    if (other.accountId !== connection.accountId && findRoomMember(room, other.accountId)) send(other.peer, message);
  }
}

export function relayKeatingPreview(room: Room, peer: Peer, facilitatorId: string, turnId: string, text: string): void {
  const peers = roomPeers.get(room.id);
  const connection = peers?.get(peer.id);
  if (!peers || !connection) return;
  if (
    !room.facilitator ||
    room.facilitator.accountId !== connection.accountId ||
    room.facilitator.facilitatorId !== facilitatorId ||
    !findRoomMember(room, connection.accountId) ||
    !permissionsForRoom(room, connection.accountId).canFacilitate ||
    !facilitatorIsFresh(room.facilitator, Date.now()) ||
    room.status !== "open" ||
    room.turn.status !== "thinking" ||
    room.turn.turnId !== turnId ||
    turnLeaseExpired(room.turn, Date.now())
  ) {
    return;
  }
  const now = Date.now();
  if (now - connection.lastPreviewAt < PREVIEW_INTERVAL_MS) return;
  connection.lastPreviewAt = now;
  const message: RoomRealtimeMessage = {
    type: "keating.preview",
    roomId: room.id,
    turnId,
    text: text.slice(0, PREVIEW_MAX_CHARS),
  };
  for (const other of peers.values()) {
    if (other.peer.id === peer.id) continue;
    const viewer = findRoomMember(room, other.accountId);
    if (viewer && previewAudienceIncludes({ room, viewer })) send(other.peer, message);
  }
}
