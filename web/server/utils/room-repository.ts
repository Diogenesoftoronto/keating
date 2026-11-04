/**
 * Persistent study rooms. Rooms are account state next to courses, so they
 * share the `keating:courses` mount (already backed by a persistent volume in
 * hosted and desktop deployments) under `room*` keys.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Storage } from "unstorage";
import { z } from "zod";
import { courseRoleSchema } from "../../src/courses/contracts";
import { broadcastRoomChange } from "./room-realtime";
import {
  roomCreateInputSchema,
  roomInviteSchema,
  roomOperationSchema,
  roomSchema,
  roleCanOversee,
  ROOM_MAX_MEMBERS,
  ROOM_MAX_MESSAGES,
  type Room,
  type RoomContext,
  type RoomCreateInput,
  type RoomInviteRole,
  type RoomInvitePreview,
  type RoomInviteSummary,
  type RoomListItem,
  type RoomMessage,
  type RoomOperation,
  type RoomPrivateForkContext,
  type RoomPrivateForkSource,
  type RoomRole,
  type RoomViewerSnapshot,
} from "../../src/rooms/contracts";
import {
  applyRoomOperation,
  findRoomMember,
  invalidateRoomPrivateForks,
  permissionsForRoom,
  projectRoomForViewer,
  projectRoomPrivateForkContext,
  RoomAuthorizationError,
  RoomConflictError,
  RoomNotFoundError,
  roomListItem,
  roomMessagesBefore,
} from "../../src/rooms/operations";

const STORAGE = "keating:courses";
const MAX_APPLIED_OPERATIONS = 20_000;
const MAX_ROOMS_PER_INDEX = 500;
const MAX_BLOCKED_ACCOUNTS = 5_000;
const MAX_CACHED_ROOMS = 8;

const storedRoomRecordSchema = z.object({
  room: roomSchema,
  appliedOperationIds: z.array(z.string()).max(MAX_APPLIED_OPERATIONS).default([]),
  operationReceipts: z.array(z.object({ key: z.string().length(64), digest: z.string().length(64) })).max(MAX_APPLIED_OPERATIONS).default([]),
  blockedAccountIds: z.array(z.string().min(1).max(256)).max(MAX_BLOCKED_ACCOUNTS).default([]),
  memberRestrictions: z.array(z.object({
    accountId: z.string().min(1).max(256),
    role: z.enum(["teacher", "learner", "observer"]).optional(),
    muted: z.boolean().optional(),
  })).max(MAX_BLOCKED_ACCOUNTS).default([]),
});

interface StoredRoomRecord {
  room: Room;
  appliedOperationIds: string[];
  operationReceipts: Array<{ key: string; digest: string }>;
  blockedAccountIds: string[];
  memberRestrictions: Array<{ accountId: string; role?: RoomInviteRole; muted?: boolean }>;
}

interface RoomRepositoryGlobals {
  __keatingRoomLocks?: Map<string, Promise<void>>;
  __keatingRoomCache?: Map<string, Room>;
}

const globals = globalThis as typeof globalThis & RoomRepositoryGlobals;
const roomLocks = (globals.__keatingRoomLocks ??= new Map());
/** Latest saved room, for realtime checks that run several times a second. */
const roomCache = (globals.__keatingRoomCache ??= new Map());

export type RoomStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface RepositoryScope {
  storage: RoomStorage;
  locks: Map<string, Promise<void>>;
  cache: Map<string, Room>;
  now: () => number;
}
const repositoryScope = new AsyncLocalStorage<RepositoryScope>();

/** Inject the durable store at the same seam used in production, without global test mocks. */
export function withRoomRepositoryStorage<T>(
  store: RoomStorage,
  task: () => Promise<T>,
  options: { now?: () => number } = {},
): Promise<T> {
  return repositoryScope.run({ storage: store, locks: new Map(), cache: new Map(), now: options.now ?? Date.now }, task);
}

async function storage(): Promise<RoomStorage> {
  return repositoryScope.getStore()?.storage ?? (await import("nitro/storage")).useStorage(STORAGE);
}

function nowMs(): number {
  return (repositoryScope.getStore()?.now ?? Date.now)();
}

function cacheRoom(room: Room): void {
  const cache = repositoryScope.getStore()?.cache ?? roomCache;
  cache.delete(room.id);
  // Large histories remain on disk, rather than occupying an unbounded process cache.
  if (JSON.stringify(room).length > 250_000) return;
  cache.set(room.id, structuredClone(room));
  while (cache.size > MAX_CACHED_ROOMS) cache.delete(cache.keys().next().value!);
}

export function randomRoomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

const roomKey = (roomId: string) => `room:${roomSchema.shape.id.parse(roomId)}`;
const courseIndexKey = (courseId: string) => `room-course:${roomSchema.shape.id.parse(courseId)}`;
const inviteIndexKey = (tokenHash: string) => `room-invite:${tokenHash}`;
async function accountIndexKey(accountId: string): Promise<string> {
  return `room-account:${await sha256(accountId)}`;
}

async function withRoomLock<T>(roomId: string, task: () => Promise<T>): Promise<T> {
  const locks = repositoryScope.getStore()?.locks ?? roomLocks;
  const previous = locks.get(roomId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(roomId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(roomId) === tail) locks.delete(roomId);
  }
}

async function loadRecord(roomId: string, synchronize = true): Promise<StoredRoomRecord | null> {
  const raw = await (await storage()).getItem(roomKey(roomId));
  if (!raw) {
    (repositoryScope.getStore()?.cache ?? roomCache).delete(roomId);
    return null;
  }
  const record = storedRoomRecordSchema.parse(raw);
  return synchronize ? synchronizeCourseMembers(record) : record;
}

// Read just course membership authority. Never project learner progress,
// consent, submissions, or private course records into a room.
const courseAuthoritySchema = z.object({ course: z.object({ members: z.array(z.object({
  accountId: z.string().min(1).max(256),
  role: courseRoleSchema,
})) }) });

async function synchronizeCourseMembers(record: StoredRoomRecord): Promise<StoredRoomRecord> {
  const { room } = record;
  const derived = room.members.filter((member) => member.via === "course" &&
    !record.memberRestrictions.some((restriction) => restriction.accountId === member.accountId && restriction.role));
  if (!room.context.courseId || derived.length === 0) return record;
  const raw = await (await storage()).getItem(`course:${roomSchema.shape.id.parse(room.context.courseId)}`);
  const members = raw ? courseAuthoritySchema.parse(raw).course.members : [];
  const roles = new Map(members.map((member) => [member.accountId, member.role]));
  const removed: string[] = [];
  let changed = false;
  for (const member of derived) {
    const courseRole = roles.get(member.accountId);
    if (!courseRole) {
      removed.push(member.accountId);
      changed = true;
    } else {
      const role = courseRole === "owner" || courseRole === "teacher" ? "teacher" : "learner";
      if (member.role !== role) {
        member.role = role;
        if (role === "teacher") member.muted = false;
        changed = true;
        if (room.facilitator?.accountId === member.accountId) room.facilitator = undefined;
      }
    }
  }
  if (!changed) return record;
  room.members = room.members.filter((member) => !removed.includes(member.accountId));
  if (room.facilitator && removed.includes(room.facilitator.accountId)) room.facilitator = undefined;
  if (!room.facilitator && room.turn.status === "thinking") {
    room.turn = { ...room.turn, status: "idle", turnId: undefined, startedAt: undefined, leaseExpiresAt: undefined };
  }
  room.revision += 1;
  room.updatedAt = new Date(nowMs()).toISOString();
  invalidateRoomPrivateForks(room, room.updatedAt);
  await saveRecord(record);
  broadcastRoomChange(room, [], removed);
  for (const accountId of removed) await removeFromIndex(await accountIndexKey(accountId), room.id);
  return record;
}

async function courseRoleFor(courseId: string, accountId: string) {
  const raw = await (await storage()).getItem(`course:${roomSchema.shape.id.parse(courseId)}`);
  return raw ? courseAuthoritySchema.parse(raw).course.members.find((member) => member.accountId === accountId)?.role : undefined;
}

async function saveRecord(record: StoredRoomRecord): Promise<void> {
  const validated = storedRoomRecordSchema.parse(record);
  await (await storage()).setItem(roomKey(record.room.id), validated);
  cacheRoom(validated.room);
}

async function withIndexes<T>(keys: string[], task: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  const acquire = (index: number): Promise<T> => index === ordered.length
    ? task()
    : withRoomLock(`index:${ordered[index]}`, () => acquire(index + 1));
  return acquire(0);
}

async function saveWithIndexes(record: StoredRoomRecord, keys: string[]): Promise<void> {
  await withIndexes(keys, async () => {
    const indexes = await Promise.all(keys.map(async (key) => ({ key, ids: await readIndex(key) })));
    for (const { ids } of indexes) {
      if (!ids.includes(record.room.id) && ids.length >= MAX_ROOMS_PER_INDEX) {
        throw new RoomConflictError("This account or course has reached its room limit. Delete an older room first.", "room_index_full");
      }
    }
    const store = await storage();
    const previous = await store.getItem(roomKey(record.room.id));
    try {
      await saveRecord(record);
      for (const { key, ids } of indexes) await store.setItem(key, [...new Set([...ids, record.room.id])]);
    } catch (error) {
      // The fs adapter has no transaction primitive. Undo a failed request's
      // partial writes while still holding every affected index lock.
      await Promise.allSettled(indexes.map(({ key, ids }) => store.setItem(key, ids)));
      if (previous) await store.setItem(roomKey(record.room.id), previous).catch(() => undefined);
      else await store.removeItem(roomKey(record.room.id)).catch(() => undefined);
      (repositoryScope.getStore()?.cache ?? roomCache).delete(record.room.id);
      throw error;
    }
  });
}

async function removeFromIndex(key: string, roomId: string): Promise<void> {
  await withIndexes([key], async () => {
    const current = await readIndex(key);
    await (await storage()).setItem(key, current.filter((id) => id !== roomId));
  });
}

async function readIndex(key: string): Promise<string[]> {
  const ids = await (await storage()).getItem<string[]>(key);
  return Array.isArray(ids) ? [...new Set(ids.filter((id) => roomSchema.shape.id.safeParse(id).success))].slice(0, MAX_ROOMS_PER_INDEX) : [];
}

/** The cached room for realtime checks; falls back to storage. */
export async function currentRoom(roomId: string): Promise<Room | null> {
  const cached = (repositoryScope.getStore()?.cache ?? roomCache).get(roomId);
  if (cached && !cached.context.courseId) return cached;
  return withRoomLock(roomId, async () => (await loadRecord(roomId))?.room ?? null);
}

export async function listRoomsForAccount(accountId: string): Promise<RoomListItem[]> {
  const ids = await readIndex(await accountIndexKey(accountId));
  const items = await Promise.all(
    ids.map(async (roomId) => {
      return withRoomLock(roomId, async () => {
        const record = await loadRecord(roomId);
        return record && findRoomMember(record.room, accountId) ? roomListItem(record.room, accountId) : null;
      });
    }),
  );
  return sortedItems(items);
}

/** Rooms linked to a course. Callers must confirm course membership first. */
export async function listRoomsForCourse(courseId: string, accountId: string): Promise<RoomListItem[]> {
  const courseRole = await courseRoleFor(courseId, accountId);
  if (!courseRole) return [];
  const joiningRole = courseRole === "owner" || courseRole === "teacher" ? "teacher" : "learner";
  const ids = await readIndex(courseIndexKey(courseId));
  const items = await Promise.all(
    ids.map(async (roomId) => {
      return withRoomLock(roomId, async () => {
        const record = await loadRecord(roomId);
        if (!record || record.blockedAccountIds.includes(accountId) || record.room.context.courseId !== courseId) return null;
        const item = roomListItem(record.room, accountId);
        return item.joined ? item : {
          ...item,
          role: record.memberRestrictions.find((restriction) => restriction.accountId === accountId)?.role ?? joiningRole,
        };
      });
    }),
  );
  return sortedItems(items);
}

function sortedItems(items: Array<RoomListItem | null>): RoomListItem[] {
  return items
    .filter((item): item is RoomListItem => item !== null)
    .sort((left, right) =>
      (left.status === right.status ? 0 : left.status === "open" ? -1 : 1) ||
      (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt),
    );
}

export async function createRoom(
  accountId: string,
  displayName: string,
  input: RoomCreateInput,
  context: RoomContext = { objectives: [] },
): Promise<RoomViewerSnapshot> {
  const parsed = roomCreateInputSchema.parse(input);
  if (context.courseId) {
    const role = await courseRoleFor(context.courseId, accountId);
    if (role !== "owner" && role !== "teacher") throw new RoomAuthorizationError("Only course teachers can open course-linked rooms.", "room_course_forbidden");
  }
  const now = new Date(nowMs()).toISOString();
  const roomId = randomRoomId("room");
  const room = roomSchema.parse({
    schemaVersion: 1,
    id: roomId,
    title: parsed.title,
    topic: parsed.topic,
    goal: parsed.goal,
    hostAccountId: accountId,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    status: "open",
    context,
    members: [
      { accountId, displayName, role: "host", joinedAt: now, muted: false, via: "created" },
    ],
    messages: [
      {
        id: randomRoomId("msg"),
        seq: 1,
        kind: "system",
        authorName: "Room",
        authorRole: "system",
        body: `${displayName} opened the room.`,
        createdAt: now,
        audience: "room",
      },
    ],
    nextSeq: 2,
    drafts: [],
    invites: [],
    settings: parsed.settings ?? {},
    turn: { status: "idle", throughSeq: 0, consideredSeq: 1 },
  });
  const keys = [await accountIndexKey(accountId)];
  if (context.courseId) keys.push(courseIndexKey(context.courseId));
  await saveWithIndexes({ room, appliedOperationIds: [], operationReceipts: [], blockedAccountIds: [], memberRestrictions: [] }, keys);
  return projectRoomForViewer(room, accountId);
}

export async function getRoomForAccount(
  roomId: string,
  accountId: string,
): Promise<RoomViewerSnapshot | null> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) return null;
    return projectRoomForViewer(record.room, accountId);
  });
}

export async function getRoomMessagesBefore(
  roomId: string,
  accountId: string,
  beforeSeq: number,
  limit: number,
): Promise<{ messages: RoomMessage[]; hasEarlierMessages: boolean } | null> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) return null;
    return roomMessagesBefore(record.room, accountId, beforeSeq, limit);
  });
}

/** Fetch fresh public context without recording an export, turn, or activity notice. */
export async function getRoomPrivateForkContext(
  roomId: string,
  accountId: string,
  source: RoomPrivateForkSource,
): Promise<RoomPrivateForkContext> {
  return withRoomLock(roomId, async () => {
    // This read intentionally skips the persisted membership synchronization used
    // by room snapshots. Check course authority directly so a context fetch alone
    // cannot change the room, its revision, or send an activity/peer notification.
    const record = await loadRecord(roomId, false);
    const member = record && findRoomMember(record.room, accountId);
    if (!record || !member || record.blockedAccountIds.includes(accountId)) throw new RoomNotFoundError();
    // Match synchronizeCourseMembers: a host-assigned room role is an independent
    // grant, while course-only membership (including mute-only restrictions) must
    // still be authorized by the current course. A grant never restores a member
    // who has left or been removed from the room.
    const courseDerived = member.via === "course" && !record.memberRestrictions.some(
      (restriction) => restriction.accountId === accountId && restriction.role,
    );
    if (courseDerived && record.room.context.courseId &&
      !await courseRoleFor(record.room.context.courseId, accountId)) throw new RoomNotFoundError();
    return projectRoomPrivateForkContext(record.room, accountId, source);
  });
}

export interface StoredRoomOperationResult {
  room: Room;
  snapshot: RoomViewerSnapshot | null;
  applied: boolean;
  touchedMessageIds: string[];
  removedAccountIds: string[];
}

export async function applyStoredRoomOperation(
  accountId: string,
  operation: RoomOperation,
): Promise<StoredRoomOperationResult> {
  operation = roomOperationSchema.parse(operation);
  return withRoomLock(operation.roomId, async () => {
    const record = await loadRecord(operation.roomId);
    if (!record) throw new RoomNotFoundError();
    const key = await sha256(JSON.stringify([accountId, operation.id]));
    const digest = await sha256(JSON.stringify(operation));
    const receipt = record.operationReceipts.find((candidate) => candidate.key === key);
    if (receipt && receipt.digest !== digest) {
      throw new RoomConflictError("That operation id was used for a different change.", "room_operation_reused");
    }
    // A lost response to `member.leave` is safe to retry without restoring access.
    if (receipt || record.appliedOperationIds.includes(operation.id)) {
      const member = findRoomMember(record.room, accountId);
      if (!member && operation.type !== "member.leave") throw new RoomNotFoundError();
      return {
        room: record.room,
        snapshot: member ? projectRoomForViewer(record.room, accountId) : null,
        applied: false,
        touchedMessageIds: [],
        removedAccountIds: [],
      };
    }
    if (!findRoomMember(record.room, accountId)) throw new RoomNotFoundError();
    // Never evict successful operation keys: replaying an old moderation change
    // must not undo newer decisions. Heartbeats are lease refreshes, not history.
    const remember = operation.type !== "facilitator.heartbeat";
    if (remember && record.operationReceipts.length + record.appliedOperationIds.length >= MAX_APPLIED_OPERATIONS) {
      throw new RoomConflictError("This room reached its history limit. Open another room to continue.", "room_history_full");
    }
    if (operation.type === "member.remove" && !record.blockedAccountIds.includes(operation.accountId)) {
      if (record.blockedAccountIds.length >= MAX_BLOCKED_ACCOUNTS) {
        throw new RoomConflictError("This room reached its moderation history limit.", "room_activity_limit");
      }
      record.blockedAccountIds.push(operation.accountId);
    }
    const result = applyRoomOperation(record.room, accountId, operation, new Date(nowMs()).toISOString());
    if (operation.type === "member.role" || operation.type === "member.mute") {
      let restriction = record.memberRestrictions.find((candidate) => candidate.accountId === operation.accountId);
      if (!restriction) {
        if (record.memberRestrictions.length >= MAX_BLOCKED_ACCOUNTS) {
          throw new RoomConflictError("This room reached its moderation history limit.", "room_activity_limit");
        }
        restriction = { accountId: operation.accountId };
        record.memberRestrictions.push(restriction);
      }
      if (operation.type === "member.role") {
        restriction.role = operation.role;
        if (operation.role === "teacher") restriction.muted = false;
      } else restriction.muted = operation.muted;
    }
    await saveRecord({
      ...record,
      room: result.room,
      operationReceipts: remember ? [...record.operationReceipts, { key, digest }] : record.operationReceipts,
    });
    for (const removed of result.removedAccountIds) {
      await removeFromIndex(await accountIndexKey(removed), result.room.id);
    }
    return {
      room: result.room,
      snapshot: findRoomMember(result.room, accountId)
        ? projectRoomForViewer(result.room, accountId)
        : null,
      applied: true,
      touchedMessageIds: result.touchedMessageIds,
      removedAccountIds: result.removedAccountIds,
    };
  });
}

export interface CreatedRoomInvite {
  invite: RoomInviteSummary;
  token: string;
}

function summarizeInvite(invite: Room["invites"][number]): RoomInviteSummary {
  const { tokenHash: _tokenHash, ...summary } = invite;
  return summary;
}

export async function createRoomInvite(
  roomId: string,
  accountId: string,
  role: RoomInviteRole,
  expiresInHours: number,
  maxUses: number,
): Promise<CreatedRoomInvite> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) throw new RoomNotFoundError();
    const permissions = permissionsForRoom(record.room, accountId);
    if (!permissions.inviteRoles.includes(role)) {
      throw new RoomAuthorizationError(
        role === "teacher"
          ? "Only the host can invite teachers."
          : "You cannot invite people to this room.",
      );
    }
    const token = randomToken();
    const created = new Date(nowMs());
    const invite = roomInviteSchema.parse({
      id: randomRoomId("invite"),
      role,
      createdBy: accountId,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + expiresInHours * 3_600_000).toISOString(),
      maxUses: Math.min(maxUses, ROOM_MAX_MEMBERS),
      uses: 0,
      tokenHash: await sha256(token),
    });
    // Keep the newest invites; expired and revoked ones age out first.
    const live = record.room.invites.filter(
      (candidate) => !candidate.revokedAt && candidate.uses < candidate.maxUses && Date.parse(candidate.expiresAt) > nowMs(),
    );
    const kept = [...live, invite].slice(-200);
    const keptIds = new Set(kept.map((candidate) => candidate.id));
    const removed = record.room.invites.filter((candidate) => !keptIds.has(candidate.id));
    record.room.invites = kept;
    await saveRecord(record);
    for (const candidate of removed) await (await storage()).removeItem(inviteIndexKey(candidate.tokenHash));
    await (await storage()).setItem(inviteIndexKey(invite.tokenHash), { roomId, inviteId: invite.id });
    return { invite: summarizeInvite(invite), token };
  });
}

export async function listRoomInvites(roomId: string, accountId: string): Promise<RoomInviteSummary[]> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) throw new RoomNotFoundError();
    const member = findRoomMember(record.room, accountId)!;
    const all = record.room.invites.map(summarizeInvite);
    // Learners who may invite see only the links they made themselves.
    const visible = roleCanOversee(member.role) ? all : all.filter((invite) => invite.createdBy === accountId);
    return visible.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function revokeRoomInvite(roomId: string, accountId: string, inviteId: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) throw new RoomNotFoundError();
    const member = findRoomMember(record.room, accountId)!;
    const invite = record.room.invites.find((candidate) => candidate.id === inviteId);
    if (!invite) throw new RoomNotFoundError("Invitation not found.", "room_invite_not_found");
    if (!roleCanOversee(member.role) && invite.createdBy !== accountId) {
      throw new RoomAuthorizationError("You cannot revoke this invitation.");
    }
    if (invite.revokedAt) return;
    invite.revokedAt = new Date(nowMs()).toISOString();
    await saveRecord(record);
    await (await storage()).removeItem(inviteIndexKey(invite.tokenHash));
  });
}

interface ResolvedInvite {
  record: StoredRoomRecord;
  invite: Room["invites"][number];
  tokenHash: string;
}

async function resolveInvite(token: string, synchronize = false): Promise<ResolvedInvite | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const pointer = await (await storage()).getItem<{ roomId?: unknown; inviteId?: unknown }>(inviteIndexKey(tokenHash));
  if (!pointer || !roomSchema.shape.id.safeParse(pointer.roomId).success) return null;
  const record = await loadRecord(pointer.roomId as string, synchronize);
  if (!record) return null;
  const invite = record.room.invites.find((candidate) => candidate.tokenHash === tokenHash && candidate.id === pointer.inviteId);
  if (
    !invite ||
    invite.revokedAt ||
    invite.uses >= invite.maxUses ||
    Date.parse(invite.expiresAt) <= nowMs() ||
    record.room.status !== "open" ||
    !findRoomMember(record.room, invite.createdBy) ||
    !permissionsForRoom(record.room, invite.createdBy, nowMs()).inviteRoles.includes(invite.role)
  ) {
    return null;
  }
  return { record, invite, tokenHash };
}

function teacherNames(room: Room): string[] {
  return room.members.filter((member) => member.role === "teacher").map((member) => member.displayName);
}

export async function previewRoomInvite(token: string, accountId: string): Promise<RoomInvitePreview | null> {
  const first = await resolveInvite(token);
  if (!first) return null;
  return withRoomLock(first.record.room.id, async () => {
    const resolved = await resolveInvite(token, true);
    if (!resolved) return null;
    if (resolved.record.blockedAccountIds.includes(accountId)) return null;
    const { room } = resolved.record;
    const host = room.members.find((member) => member.role === "host");
    const member = findRoomMember(room, accountId);
    const restriction = resolved.record.memberRestrictions.find((candidate) => candidate.accountId === accountId);
    return {
      roomTitle: room.title,
      topic: room.topic,
      role: resolved.invite.role,
      effectiveRole: member?.role ?? restriction?.role ?? resolved.invite.role,
      hostName: host?.displayName ?? "The host",
      teacherNames: teacherNames(room),
      memberCount: room.members.length,
      ...(room.context.courseTitle ? { courseTitle: room.context.courseTitle } : {}),
      settings: {
        replyReview: room.settings.replyReview,
        participation: room.settings.participation,
        facilitators: room.settings.facilitators,
      },
      expiresAt: resolved.invite.expiresAt,
      alreadyMember: Boolean(member),
    };
  });
}

function addMember(
  record: StoredRoomRecord,
  accountId: string,
  displayName: string,
  role: RoomRole,
  via: "invite" | "course",
  now: string,
): void {
  const { room } = record;
  if (room.members.length >= ROOM_MAX_MEMBERS) {
    throw new RoomConflictError("This room is full.", "room_full");
  }
  const restriction = record.memberRestrictions.find((candidate) => candidate.accountId === accountId);
  const joinedRole = restriction?.role ?? role;
  room.members.push({ accountId, displayName, role: joinedRole, joinedAt: now, muted: joinedRole === "teacher" ? false : restriction?.muted ?? false, via });
  // Joining remains possible at capacity; omit the notice rather than erase history.
  if (room.messages.length < ROOM_MAX_MESSAGES) {
    room.messages.push({
      id: randomRoomId("msg"),
      seq: room.nextSeq,
      kind: "system",
      authorName: "Room",
      authorRole: "system",
      body: `${displayName} joined as ${joinedRole === "observer" ? "an observer" : `a ${joinedRole}`}.`,
      createdAt: now,
      audience: "room",
    });
    room.nextSeq += 1;
  }
  room.revision += 1;
  room.updatedAt = now;
}

export interface RoomJoinResult {
  room: Room;
  snapshot: RoomViewerSnapshot;
  joined: boolean;
}

export async function joinRoomWithInvite(
  token: string,
  accountId: string,
  displayName: string,
): Promise<RoomJoinResult | null> {
  const first = await resolveInvite(token);
  if (!first) return null;
  return withRoomLock(first.record.room.id, async () => {
    const resolved = await resolveInvite(token, true);
    if (!resolved) return null;
    const { record, invite } = resolved;
    if (record.blockedAccountIds.includes(accountId)) {
      throw new RoomAuthorizationError("A teacher removed you from this room.", "room_removed");
    }
    if (findRoomMember(record.room, accountId)) {
      await saveWithIndexes(record, [await accountIndexKey(accountId)]);
      return { room: record.room, snapshot: projectRoomForViewer(record.room, accountId), joined: false };
    }
    addMember(record, accountId, displayName, invite.role, "invite", new Date(nowMs()).toISOString());
    invite.uses += 1;
    await saveWithIndexes(record, [await accountIndexKey(accountId)]);
    return { room: record.room, snapshot: projectRoomForViewer(record.room, accountId), joined: true };
  });
}

/** Course members join course-linked rooms without an invitation. */
export async function joinRoomThroughCourse(
  roomId: string,
  courseId: string,
  accountId: string,
  displayName: string,
  _role: Extract<RoomRole, "teacher" | "learner">,
): Promise<RoomJoinResult> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || record.room.context.courseId !== courseId) throw new RoomNotFoundError();
    const courseRole = await courseRoleFor(courseId, accountId);
    if (!courseRole) throw new RoomNotFoundError();
    const role = courseRole === "owner" || courseRole === "teacher" ? "teacher" : "learner";
    if (record.blockedAccountIds.includes(accountId)) {
      throw new RoomAuthorizationError("A teacher removed you from this room.", "room_removed");
    }
    if (findRoomMember(record.room, accountId)) {
      await saveWithIndexes(record, [await accountIndexKey(accountId)]);
      return { room: record.room, snapshot: projectRoomForViewer(record.room, accountId), joined: false };
    }
    if (record.room.status !== "open") throw new RoomConflictError("This room has ended.", "room_ended");
    addMember(record, accountId, displayName, role, "course", new Date(nowMs()).toISOString());
    await saveWithIndexes(record, [await accountIndexKey(accountId)]);
    return { room: record.room, snapshot: projectRoomForViewer(record.room, accountId), joined: true };
  });
}

export async function deleteRoom(roomId: string, accountId: string): Promise<Room> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) throw new RoomNotFoundError();
    if (record.room.hostAccountId !== accountId) {
      throw new RoomAuthorizationError("Only the host can delete this room.");
    }
    for (const invite of record.room.invites) await (await storage()).removeItem(inviteIndexKey(invite.tokenHash));
    for (const member of record.room.members) {
      await removeFromIndex(await accountIndexKey(member.accountId), roomId);
    }
    if (record.room.context.courseId) {
      await removeFromIndex(courseIndexKey(record.room.context.courseId), roomId);
    }
    await (await storage()).removeItem(roomKey(roomId));
    (repositoryScope.getStore()?.cache ?? roomCache).delete(roomId);
    return record.room;
  });
}

/** Markdown transcript of everything this viewer may see. */
export async function exportRoomTranscript(roomId: string, accountId: string): Promise<string | null> {
  return withRoomLock(roomId, async () => {
    const record = await loadRecord(roomId);
    if (!record || !findRoomMember(record.room, accountId)) return null;
    const { room } = record;
    const viewer = findRoomMember(room, accountId)!;
    const snapshot = projectRoomForViewer(room, accountId, { window: Number.MAX_SAFE_INTEGER });
    const lines = [`# ${room.title}`, ""];
    if (room.topic) lines.push(`Topic: ${room.topic}`, "");
    if (room.context.courseTitle) {
      lines.push(`Course: ${room.context.courseTitle}${room.context.lessonTitle ? ` — ${room.context.lessonTitle}` : ""}`, "");
    }
    lines.push(`Exported ${new Date().toISOString()} by ${viewer.displayName}.`, "");
    for (const message of snapshot.room.messages) {
      const at = message.createdAt.replace("T", " ").slice(0, 16);
      if (message.kind === "system") {
        lines.push(`*${at} — ${message.body}*`, "");
        continue;
      }
      if (message.hidden && !message.body) {
        lines.push(`*${at} — a message was hidden by a teacher*`, "");
        continue;
      }
      const label =
        message.kind === "whisper"
          ? `${message.authorName} → Keating (private guidance)`
          : message.kind === "keating"
            ? `Keating${message.keating?.reviewedBy ? " (teacher-reviewed)" : ""}`
            : `${message.authorName} (${message.authorRole})`;
      lines.push(`**${label}** · ${at}${message.hidden ? " · hidden from learners" : ""}`, "", message.body, "");
    }
    return lines.join("\n");
  });
}
