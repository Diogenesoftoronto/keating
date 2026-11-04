import type {
  RoomCreateInput,
  RoomInvitePreview,
  RoomInviteRole,
  RoomInviteSummary,
  RoomListItem,
  RoomMessage,
  RoomOperation,
  RoomOperationInput,
  RoomPrivateForkContext,
  RoomPrivateForkSource,
  RoomViewerSnapshot,
} from "./contracts";

export class RoomApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function roomJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/rooms${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body?.statusMessage ?? body?.message ?? `Room request failed (${response.status})`;
    throw new RoomApiError(message, response.status, body?.data?.code);
  }
  return body as T;
}

const room = (roomId: string) => `/${encodeURIComponent(roomId)}`;

export function randomOperationId(prefix = "op"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function listRooms(): Promise<RoomListItem[]> {
  return (await roomJson<{ rooms: RoomListItem[] }>("")).rooms;
}

export async function listCourseRooms(courseId: string): Promise<RoomListItem[]> {
  return (await roomJson<{ rooms: RoomListItem[] }>(`/course/${encodeURIComponent(courseId)}`)).rooms;
}

export function createRoom(input: RoomCreateInput): Promise<RoomViewerSnapshot> {
  return roomJson("", { method: "POST", body: JSON.stringify(input) });
}

export function getRoom(roomId: string): Promise<RoomViewerSnapshot> {
  return roomJson(room(roomId));
}

/** Fetch current, authorized public context before creating a private session. */
export function getRoomPrivateForkContext(
  roomId: string,
  source: RoomPrivateForkSource,
  options: { signal?: AbortSignal } = {},
): Promise<RoomPrivateForkContext> {
  return roomJson(`${room(roomId)}/private-fork-context`, {
    method: "POST",
    body: JSON.stringify(source),
    signal: options.signal,
  });
}

export function deleteRoom(roomId: string): Promise<{ deleted: true }> {
  return roomJson(room(roomId), { method: "DELETE" });
}

export function buildRoomOperation(roomId: string, input: RoomOperationInput): RoomOperation {
  return { ...input, id: randomOperationId(), roomId } as RoomOperation;
}

export function applyRoomOperation(
  roomId: string,
  input: RoomOperationInput | RoomOperation,
): Promise<RoomViewerSnapshot | { removed: true }> {
  const operation = "id" in input && "roomId" in input ? input : buildRoomOperation(roomId, input);
  return roomJson(`${room(roomId)}/operations`, {
    method: "POST",
    body: JSON.stringify(operation),
  });
}

/** Best-effort release while the page unloads; fetch may be cancelled there. */
export function releaseFacilitatorOnUnload(roomId: string, facilitatorId: string): void {
  const operation = buildRoomOperation(roomId, { type: "facilitator.release", facilitatorId });
  const body = JSON.stringify(operation);
  const url = `/api/rooms${room(roomId)}/operations`;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
    } catch {
      // Some browsers reject beacons while navigating; try keepalive below.
    }
  }
  void fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
}

export function getEarlierRoomMessages(
  roomId: string,
  beforeSeq: number,
  limit = 100,
): Promise<{ messages: RoomMessage[]; hasEarlierMessages: boolean }> {
  return roomJson(`${room(roomId)}/messages?before=${beforeSeq}&limit=${limit}`);
}

export function joinCourseRoom(
  roomId: string,
  courseId: string,
  displayName?: string,
): Promise<RoomViewerSnapshot> {
  return roomJson(`${room(roomId)}/join?courseId=${encodeURIComponent(courseId)}`, {
    method: "POST",
    body: JSON.stringify(displayName ? { displayName } : {}),
  });
}

export function previewRoomInvite(token: string): Promise<RoomInvitePreview> {
  return roomJson(`/invites/${encodeURIComponent(token)}`);
}

export function acceptRoomInvite(token: string, displayName?: string): Promise<RoomViewerSnapshot> {
  return roomJson(`/invites/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify(displayName ? { displayName } : {}),
  });
}

export async function listRoomInvites(roomId: string): Promise<RoomInviteSummary[]> {
  return (await roomJson<{ invites: RoomInviteSummary[] }>(`${room(roomId)}/invites`)).invites;
}

export function createRoomInvite(
  roomId: string,
  input: { role: RoomInviteRole; expiresInHours?: number; maxUses?: number },
): Promise<{ invite: RoomInviteSummary; token: string }> {
  return roomJson(`${room(roomId)}/invites`, { method: "POST", body: JSON.stringify(input) });
}

export function revokeRoomInvite(roomId: string, inviteId: string): Promise<{ revoked: true }> {
  return roomJson(`${room(roomId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export function roomTranscriptUrl(roomId: string): string {
  return `/api/rooms${room(roomId)}/transcript`;
}

export function roomInviteUrl(token: string, origin = window.location.origin): string {
  return new URL(`/rooms/join/${token}`, origin).toString();
}
