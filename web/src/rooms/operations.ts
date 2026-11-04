/**
 * Authoritative study-room operation engine. The server calls
 * `applyRoomOperation` inside a per-room lock; the result names the messages
 * the operation created or changed so realtime patches stay small.
 *
 * Visibility is decided here, never by the model: whispers and drafts reach
 * hosts and teachers only, hidden messages become tombstones for everyone
 * else, private conversation offers reach only the addressed learner, and
 * invite token hashes never leave the server.
 */
import { learningSourceHash } from "@keating/learner-contracts";
import {
  facilitatorIsFresh,
  KEATING_DISPLAY_NAME,
  ROOM_MAX_MESSAGES,
  ROOM_MAX_TRANSCRIPT_CHARS,
  ROOM_MAX_PRIVATE_FORK_OFFERS,
  ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER,
  ROOM_MESSAGE_WINDOW,
  ROOM_TURN_LEASE_MS,
  roleCanOversee,
  roomPrivateForkProposalSchema,
  roomPrivateForkSourceSchema,
  roomSchema,
  turnLeaseExpired,
  type Room,
  type RoomDraft,
  type RoomInviteRole,
  type RoomListItem,
  type RoomMember,
  type RoomMessage,
  type RoomOperation,
  type RoomPermissions,
  type RoomPrivateForkContext,
  type RoomPrivateForkProposal,
  type RoomPrivateForkSource,
  type RoomRealtimeMessage,
  type RoomViewerSnapshot,
} from "./contracts";

export class RoomOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class RoomAuthorizationError extends RoomOperationError {
  constructor(message: string, code = "room_forbidden") {
    super(message, code, 403);
  }
}

export class RoomConflictError extends RoomOperationError {
  constructor(message: string, code = "room_conflict") {
    super(message, code, 409);
  }
}

export class RoomNotFoundError extends RoomOperationError {
  constructor(message = "Room not found.", code = "room_not_found") {
    super(message, code, 404);
  }
}

export interface RoomOperationResult {
  room: Room;
  /** Messages created or changed, for realtime patches. */
  touchedMessageIds: string[];
  /** Members who lost access and should be disconnected. */
  removedAccountIds: string[];
}

const MAX_RESOLVED_DRAFTS = 50;
const MAX_PENDING_DRAFTS = 150;

export function findRoomMember(
  room: Pick<Room, "members">,
  accountId: string,
): RoomMember | undefined {
  return room.members.find((member) => member.accountId === accountId);
}

const RESERVED_DISPLAY_NAMES = new Set([KEATING_DISPLAY_NAME, "Room"].map((name) => name.toLowerCase()));
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Whether another member, Keating or the room itself already uses this name. Keating addresses people by name. */
function displayNameTaken(room: Pick<Room, "members">, accountId: string, displayName: string): boolean {
  const key = nameKey(displayName);
  return RESERVED_DISPLAY_NAMES.has(key) || room.members.some((member) => member.accountId !== accountId && nameKey(member.displayName) === key);
}

/** A unique, unreserved name for someone joining, numbering it on collision. */
export function availableDisplayName(room: Pick<Room, "members">, accountId: string, displayName: string): string {
  const base = displayName.trim().replace(/\s+/g, " ").slice(0, 110);
  if (!displayNameTaken(room, accountId, base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base} ${index}`;
    if (!displayNameTaken(room, accountId, candidate)) return candidate;
  }
}

function memberFor(room: Room, accountId: string): RoomMember {
  const member = findRoomMember(room, accountId);
  if (!member) throw new RoomAuthorizationError("You are not in this room.", "room_not_member");
  return member;
}

function requireOverseer(actor: RoomMember, action: string): void {
  if (!roleCanOversee(actor.role)) {
    throw new RoomAuthorizationError(`Only teachers can ${action}.`);
  }
}

function requireOpen(room: Room): void {
  if (room.status !== "open") {
    throw new RoomConflictError("This room has ended.", "room_ended");
  }
}

/**
 * Learners may run Keating only when teachers allow it and replies are not
 * under review: a reviewed draft must never be generated in a learner's
 * browser, and private teacher guidance is never sent to one.
 */
function canFacilitate(room: Room, member: RoomMember): boolean {
  if (member.muted) return false;
  if (roleCanOversee(member.role)) return true;
  return (
    room.settings.facilitators === "anyone" &&
    room.settings.replyReview === "off" &&
    member.role === "learner"
  );
}

function requireFacilitator(room: Room, actor: RoomMember, facilitatorId: string, now: number): void {
  if (
    room.facilitator?.accountId !== actor.accountId ||
    room.facilitator.facilitatorId !== facilitatorId ||
    !facilitatorIsFresh(room.facilitator, now) ||
    !canFacilitate(room, actor)
  ) {
    throw new RoomConflictError("Keating moved to another browser or its lease expired.", "room_facilitator_replaced");
  }
}

/** Keep derived ids inside the 96-character id contract. */
function derivedId(operationId: string, suffix: string): string {
  return `${operationId.slice(0, 96 - suffix.length - 1)}-${suffix}`;
}

function hasHistoryCapacity(room: Pick<Room, "messages">, adding = 0): boolean {
  if (room.messages.length >= ROOM_MAX_MESSAGES) return false;
  return room.messages.reduce((total, message) => total + message.body.length, adding) <= ROOM_MAX_TRANSCRIPT_CHARS;
}

function requireHistoryCapacity(room: Pick<Room, "messages">, adding = 0): void {
  if (!hasHistoryCapacity(room, adding)) {
    throw new RoomConflictError("This room reached its transcript limit. Open another room to continue.", "room_history_full");
  }
}

function appendMessage(
  room: Room,
  message: Omit<RoomMessage, "seq">,
  touched: string[],
): RoomMessage {
  if (room.messages.some((existing) => existing.id === message.id)) {
    throw new RoomConflictError("That message was already posted.", "room_message_exists");
  }
  requireHistoryCapacity(room, message.body.length);
  const created: RoomMessage = { ...message, seq: room.nextSeq };
  room.nextSeq += 1;
  room.messages.push(created);
  touched.push(created.id);
  return created;
}

function appendSystem(
  room: Room,
  operationId: string,
  body: string,
  now: string,
  touched: string[],
  audience: RoomMessage["audience"] = "room",
): void {
  // State and moderation changes still apply after the transcript fills.
  // Their notices must never displace the conversation they describe.
  if (!hasHistoryCapacity(room, body.length)) return;
  appendMessage(
    room,
    {
      id: derivedId(operationId, "sys"),
      kind: "system",
      authorName: "Room",
      authorRole: "system",
      body,
      createdAt: now,
      audience,
    },
    touched,
  );
}

function resetTurn(room: Room): void {
  room.turn = {
    ...room.turn,
    status: "idle",
    turnId: undefined,
    startedAt: undefined,
    leaseExpiresAt: undefined,
  };
}

function clearFacilitator(room: Room): void {
  room.facilitator = undefined;
  if (room.turn.status === "thinking") resetTurn(room);
}

function removeMember(room: Room, accountId: string): void {
  room.members = room.members.filter((member) => member.accountId !== accountId);
  if (room.facilitator?.accountId === accountId) clearFacilitator(room);
}

/** Restrict Keating's addressees to people actually in the room. */
function knownAddressees(room: Room, names: readonly string[] | undefined): string[] | undefined {
  if (!names?.length) return undefined;
  const known = new Set(room.members.map((member) => member.displayName.toLowerCase()));
  const filtered = [...new Set(names)].filter((name) => known.has(name.toLowerCase()));
  return filtered.length ? filtered : undefined;
}

function keatingMessage(
  id: string,
  body: string,
  now: string,
  meta: NonNullable<RoomMessage["keating"]>,
  addressedTo: string[] | undefined,
): Omit<RoomMessage, "seq"> {
  return {
    id,
    kind: "keating",
    authorName: KEATING_DISPLAY_NAME,
    authorRole: "keating",
    body,
    createdAt: now,
    audience: "room",
    keating: meta,
    ...(addressedTo ? { addressedTo } : {}),
  };
}

function trimResolvedDrafts(room: Room): void {
  const resolved = room.drafts.filter((draft) => draft.status !== "pending");
  if (resolved.length <= MAX_RESOLVED_DRAFTS) return;
  const drop = new Set(
    resolved.slice(0, resolved.length - MAX_RESOLVED_DRAFTS).map((draft) => draft.id),
  );
  room.drafts = room.drafts.filter((draft) => !drop.has(draft.id));
}

function privateForkRange(text: string, source: RoomPrivateForkSource): { start?: number; end?: number } | undefined {
  if (source.sourceHash !== undefined && source.sourceHash !== learningSourceHash(text)) return undefined;
  const quote = source.selectedText;
  if (quote === undefined) return source.start === undefined && source.end === undefined ? {} : undefined;
  if (!quote.trim()) return undefined;
  let { start, end } = source;
  if (start === undefined && end === undefined) {
    start = text.indexOf(quote);
    if (start < 0 || text.indexOf(quote, start + 1) >= 0) return undefined;
    end = start + quote.length;
  }
  const splitsSurrogate = (offset: number): boolean => {
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  };
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! < 0 || end! <= start! || end! > text.length ||
    splitsSurrogate(start!) || splitsSurrogate(end!) || text.slice(start, end) !== quote) return undefined;
  return { start, end };
}

function publicForkSource(room: Room, source: RoomPrivateForkSource, throughSeq = Infinity): RoomMessage | undefined {
  const message = room.messages.find((candidate) => candidate.id === source.sourceMessageId);
  if (!message || message.audience !== "room" || message.hidden ||
    (message.kind !== "chat" && message.kind !== "keating") || message.seq > throughSeq) return undefined;
  if (!privateForkRange(message.body, source)) return undefined;
  return message;
}

function privateForkIsValid(room: Room, proposal: RoomPrivateForkProposal): boolean {
  return findRoomMember(room, proposal.learnerAccountId)?.role === "learner" && Boolean(publicForkSource(room, proposal));
}

function requirePrivateFork(room: Room, proposal: RoomPrivateForkProposal, throughSeq = Infinity): RoomMessage {
  if (findRoomMember(room, proposal.learnerAccountId)?.role !== "learner") {
    throw new RoomConflictError("The private conversation must be offered to a current learner in this room.", "room_private_fork_target_invalid");
  }
  const source = publicForkSource(room, proposal, throughSeq);
  if (!source) {
    throw new RoomConflictError("That public message or selected passage is no longer available for a private conversation.", "room_private_fork_source_invalid");
  }
  return source;
}

/** Hide/removal/role changes revoke pending offers and review, without erasing local copies. */
export function invalidateRoomPrivateForks(room: Room, now: string): void {
  for (const offer of room.privateForkOffers) {
    if (offer.status === "pending" && !privateForkIsValid(room, offer)) {
      offer.status = "dismissed";
      offer.resolvedAt = now;
    }
  }
  for (const draft of room.drafts) {
    if (draft.status === "pending" && draft.privateFork && !privateForkIsValid(room, draft.privateFork)) {
      draft.status = "rejected";
      draft.resolvedAt = now;
    }
  }
  trimResolvedDrafts(room);
}

function appendPrivateForkOffer(room: Room, proposal: RoomPrivateForkProposal, id: string, model: string, now: string): void {
  const source = requirePrivateFork(room, proposal);
  proposal = { ...proposal, ...privateForkRange(source.body, proposal) };
  const pending = room.privateForkOffers.filter((offer) => offer.status === "pending");
  if (pending.some((offer) => offer.learnerAccountId === proposal.learnerAccountId &&
    offer.sourceMessageId === proposal.sourceMessageId && offer.selectedText === proposal.selectedText &&
    privateForkRange(source.body, offer)?.start === proposal.start &&
    privateForkRange(source.body, offer)?.end === proposal.end)) return;
  if (room.privateForkOffers.some((offer) => offer.id === id)) {
    throw new RoomConflictError("That private conversation offer id already exists.", "room_private_fork_exists");
  }
  if (pending.filter((offer) => offer.learnerAccountId === proposal.learnerAccountId).length >= ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER) {
    throw new RoomConflictError("This learner has too many pending private conversation offers. Open or dismiss one first.", "room_private_forks_full");
  }
  if (pending.length >= ROOM_MAX_PRIVATE_FORK_OFFERS) {
    throw new RoomConflictError("This room has too many pending private conversation offers. Open or dismiss one first.", "room_private_forks_full");
  }
  // Only resolved history may be removed; a pending offer is never silently displaced.
  while (room.privateForkOffers.length >= ROOM_MAX_PRIVATE_FORK_OFFERS) {
    const index = room.privateForkOffers.findIndex((offer) => offer.status !== "pending");
    if (index < 0) throw new RoomConflictError("Review pending private conversation offers first.", "room_private_forks_full");
    room.privateForkOffers.splice(index, 1);
  }
  room.privateForkOffers.push({ ...proposal, id, model, createdAt: now, status: "pending" });
}

/** The same public-only, anchored context is used for manual and suggested forks. */
export function projectRoomPrivateForkContext(room: Room, accountId: string, input: RoomPrivateForkSource): RoomPrivateForkContext {
  memberFor(room, accountId);
  const source = roomPrivateForkSourceSchema.parse(input);
  const anchor = publicForkSource(room, source);
  if (!anchor) throw new RoomConflictError("That public message or selected passage is no longer available for a private conversation.", "room_private_fork_source_invalid");
  const eligible = room.messages.filter((message) => message.seq <= anchor.seq &&
    message.audience === "room" && !message.hidden && (message.kind === "chat" || message.kind === "keating"))
    .sort((a, b) => a.seq - b.seq);
  const messages: RoomMessage[] = [];
  let chars = 0;
  for (let index = eligible.length - 1; index >= 0 && messages.length < 40; index -= 1) {
    const message = eligible[index]!;
    if (chars + message.body.length > 32_000) break;
    messages.unshift(structuredClone(message));
    chars += message.body.length;
  }
  return {
    roomId: room.id, roomTitle: room.title, topic: room.topic, goal: room.goal,
    context: structuredClone(room.context), revision: room.revision, sourceSeq: anchor.seq,
    ...source, ...privateForkRange(anchor.body, source), sourceHash: learningSourceHash(anchor.body), messages,
  };
}

export function hasPendingTurnRequest(room: Pick<Room, "turn">): boolean {
  // Completion clears only requests that existed when that turn began.
  return Boolean(room.turn.requestedAt);
}

export function applyRoomOperation(
  current: Room,
  actorAccountId: string,
  operation: RoomOperation,
  now = new Date().toISOString(),
): RoomOperationResult {
  if (operation.roomId !== current.id) {
    throw new RoomNotFoundError("The operation targets a different room.");
  }
  const next = structuredClone(current);
  const actor = memberFor(next, actorAccountId);
  const touched: string[] = [];
  const removed: string[] = [];
  const nowMs = Date.parse(now);
  invalidateRoomPrivateForks(next, now);

  switch (operation.type) {
    case "message.post": {
      requireOpen(next);
      if (actor.role === "observer") {
        throw new RoomAuthorizationError("Observers can read but not post.");
      }
      if (actor.muted) {
        throw new RoomAuthorizationError("A teacher has muted you in this room.", "room_muted");
      }
      if (
        operation.replyToId &&
        !next.messages.some(
          (message) => message.id === operation.replyToId && message.audience === "room",
        )
      ) {
        throw new RoomConflictError("The message you replied to is gone.");
      }
      appendMessage(
        next,
        {
          id: operation.messageId,
          kind: "chat",
          authorAccountId: actor.accountId,
          authorName: actor.displayName,
          authorRole: actor.role,
          body: operation.body,
          createdAt: now,
          audience: "room",
          ...(operation.replyToId ? { replyToId: operation.replyToId } : {}),
        },
        touched,
      );
      break;
    }
    case "whisper.post": {
      requireOpen(next);
      requireOverseer(actor, "guide Keating privately");
      appendMessage(
        next,
        {
          id: operation.messageId,
          kind: "whisper",
          authorAccountId: actor.accountId,
          authorName: actor.displayName,
          authorRole: actor.role,
          body: operation.body,
          createdAt: now,
          audience: "teachers",
        },
        touched,
      );
      break;
    }
    case "message.hide": {
      requireOverseer(actor, "hide messages");
      const message = next.messages.find((candidate) => candidate.id === operation.messageId);
      if (!message || message.kind === "system" || message.kind === "whisper") {
        throw new RoomConflictError("That message cannot be hidden.");
      }
      if (operation.hidden) message.hidden = { by: actor.accountId, at: now };
      else delete message.hidden;
      if (operation.hidden && next.turn.status === "thinking" && message.seq <= next.turn.throughSeq) resetTurn(next);
      touched.push(message.id);
      break;
    }
    case "member.mute": {
      requireOverseer(actor, "mute participants");
      const target = memberFor(next, operation.accountId);
      if (roleCanOversee(target.role)) {
        throw new RoomAuthorizationError("Teachers cannot be muted.");
      }
      if (target.muted === operation.muted) break;
      target.muted = operation.muted;
      if (target.muted && next.facilitator?.accountId === target.accountId) clearFacilitator(next);
      appendSystem(
        next,
        operation.id,
        `${actor.displayName} ${operation.muted ? "muted" : "unmuted"} ${target.displayName}.`,
        now,
        touched,
        "teachers",
      );
      break;
    }
    case "member.remove": {
      requireOverseer(actor, "remove participants");
      const target = memberFor(next, operation.accountId);
      if (target.accountId === actor.accountId) {
        throw new RoomConflictError("Leave the room instead of removing yourself.");
      }
      if (target.role === "host") {
        throw new RoomAuthorizationError("The host cannot be removed.");
      }
      if (target.role === "teacher" && actor.role !== "host") {
        throw new RoomAuthorizationError("Only the host can remove a teacher.");
      }
      removeMember(next, target.accountId);
      removed.push(target.accountId);
      appendSystem(
        next,
        operation.id,
        `${actor.displayName} removed ${target.displayName}.`,
        now,
        touched,
        "teachers",
      );
      break;
    }
    case "member.role": {
      if (actor.role !== "host") {
        throw new RoomAuthorizationError("Only the host can change roles.");
      }
      const target = memberFor(next, operation.accountId);
      if (target.role === "host") {
        throw new RoomAuthorizationError("The host role cannot be changed.");
      }
      if (target.role === operation.role) break;
      const lostOversight = roleCanOversee(target.role) && !roleCanOversee(operation.role);
      target.role = operation.role;
      if (operation.role === "teacher") target.muted = false;
      if (next.facilitator?.accountId === target.accountId && (lostOversight || !canFacilitate(next, target))) {
        clearFacilitator(next);
      }
      appendSystem(
        next,
        operation.id,
        `${target.displayName} is now ${operation.role === "observer" ? "an observer" : `a ${operation.role}`}.`,
        now,
        touched,
      );
      break;
    }
    case "member.rename": {
      if (nameKey(actor.displayName) === nameKey(operation.displayName)) break;
      if (displayNameTaken(next, actor.accountId, operation.displayName)) {
        throw new RoomConflictError("Someone in this room already uses that name. Choose another.", "room_name_taken");
      }
      actor.displayName = operation.displayName.trim().replace(/\s+/g, " ");
      if (next.facilitator?.accountId === actor.accountId) {
        next.facilitator.displayName = operation.displayName;
      }
      break;
    }
    case "member.leave": {
      if (actor.role === "host") {
        throw new RoomConflictError("The host cannot leave. End the room instead.");
      }
      removeMember(next, actor.accountId);
      removed.push(actor.accountId);
      appendSystem(next, operation.id, `${actor.displayName} left the room.`, now, touched);
      break;
    }
    case "room.update": {
      requireOverseer(actor, "edit the room");
      if (operation.patch.title !== undefined) next.title = operation.patch.title;
      if (operation.patch.topic !== undefined) next.topic = operation.patch.topic;
      if (operation.patch.goal !== undefined) next.goal = operation.patch.goal;
      break;
    }
    case "room.status": {
      requireOverseer(actor, "end or reopen the room");
      if (next.status === operation.status) break;
      next.status = operation.status;
      if (operation.status === "ended") resetTurn(next);
      appendSystem(
        next,
        operation.id,
        operation.status === "ended"
          ? `${actor.displayName} ended the session.`
          : `${actor.displayName} reopened the session.`,
        now,
        touched,
      );
      break;
    }
    case "settings.update": {
      requireOverseer(actor, "change room settings");
      const before = next.settings;
      next.settings = { ...before, ...operation.patch };
      const after = next.settings;
      if (
        next.facilitator &&
        !canFacilitate(next, memberFor(next, next.facilitator.accountId))
      ) {
        clearFacilitator(next);
      }
      // Learners should always know when Keating is held back or reviewed.
      const notices: string[] = [];
      if (before.keating !== after.keating) {
        notices.push(after.keating === "paused" ? "paused Keating" : "resumed Keating");
      }
      if (before.replyReview !== after.replyReview) {
        notices.push(
          after.replyReview === "teacher-approves"
            ? "turned on teacher review of Keating's replies"
            : "turned off teacher review of Keating's replies",
        );
      }
      if (before.participation !== after.participation) {
        notices.push(
          after.participation === "on-request"
            ? "set Keating to answer only when asked (mention @Keating)"
            : "let Keating join the conversation when it can help",
        );
      }
      if (notices.length) {
        appendSystem(next, operation.id, `${actor.displayName} ${notices.join(" and ")}.`, now, touched);
      }
      break;
    }
    case "facilitator.claim": {
      requireOpen(next);
      if (!canFacilitate(next, actor)) {
        throw new RoomAuthorizationError(
          next.settings.facilitators === "teachers"
            ? "Only teachers can run Keating in this room."
            : "Observers cannot run Keating.",
        );
      }
      const currentFacilitator = next.facilitator;
      if (
        currentFacilitator &&
        (currentFacilitator.accountId !== actor.accountId || currentFacilitator.facilitatorId !== operation.facilitatorId) &&
        facilitatorIsFresh(currentFacilitator, nowMs)
      ) {
        if (!operation.takeOver || !roleCanOversee(actor.role)) {
          throw new RoomConflictError(
            `Keating is already running from ${currentFacilitator.displayName}'s browser.`,
            "room_facilitator_busy",
          );
        }
      }
      const changed = currentFacilitator?.accountId !== actor.accountId ||
        currentFacilitator.facilitatorId !== operation.facilitatorId ||
        !facilitatorIsFresh(currentFacilitator, nowMs);
      if (changed && next.turn.status === "thinking") resetTurn(next);
      next.facilitator = {
        accountId: actor.accountId,
        facilitatorId: operation.facilitatorId,
        displayName: actor.displayName,
        modelLabel: operation.modelLabel,
        claimedAt: changed || !currentFacilitator ? now : currentFacilitator.claimedAt,
        heartbeatAt: now,
      };
      if (changed) {
        appendSystem(
          next,
          operation.id,
          `Keating is now running from ${actor.displayName}'s browser (${operation.modelLabel}).`,
          now,
          touched,
          "teachers",
        );
      }
      break;
    }
    case "facilitator.heartbeat": {
      requireOpen(next);
      requireFacilitator(next, actor, operation.facilitatorId, nowMs);
      next.facilitator!.heartbeatAt = now;
      if (operation.modelLabel) next.facilitator!.modelLabel = operation.modelLabel;
      break;
    }
    case "facilitator.release": {
      if (next.facilitator) {
        if (next.facilitator.accountId !== actor.accountId || next.facilitator.facilitatorId !== operation.facilitatorId) {
          throw new RoomConflictError("Keating moved to another browser.", "room_facilitator_replaced");
        }
        clearFacilitator(next);
      }
      break;
    }
    case "turn.begin": {
      requireOpen(next);
      requireFacilitator(next, actor, operation.facilitatorId, nowMs);
      requireHistoryCapacity(next);
      if (next.settings.keating !== "active") {
        throw new RoomConflictError("A teacher paused Keating.", "room_keating_paused");
      }
      if (next.drafts.filter((draft) => draft.status === "pending").length >= MAX_PENDING_DRAFTS) {
        throw new RoomConflictError("Review the pending replies before Keating takes another turn.", "room_drafts_full");
      }
      if (next.turn.status === "thinking" && !turnLeaseExpired(next.turn, nowMs)) {
        throw new RoomConflictError("Keating is already taking a turn.", "room_turn_busy");
      }
      const latestSeq = next.nextSeq - 1;
      if (operation.throughSeq > latestSeq) {
        throw new RoomConflictError("That turn reads messages that do not exist.");
      }
      if (operation.throughSeq <= next.turn.consideredSeq && !hasPendingTurnRequest(next)) {
        throw new RoomConflictError("Keating has already read those messages.", "room_turn_stale");
      }
      next.turn = {
        ...next.turn,
        status: "thinking",
        turnId: operation.turnId,
        startedAt: now,
        leaseExpiresAt: new Date(nowMs + ROOM_TURN_LEASE_MS).toISOString(),
        throughSeq: operation.throughSeq,
      };
      break;
    }
    case "turn.complete": {
      requireOpen(next);
      requireFacilitator(next, actor, operation.facilitatorId, nowMs);
      if (
        next.turn.status !== "thinking" ||
        next.turn.turnId !== operation.turnId ||
        turnLeaseExpired(next.turn, nowMs)
      ) {
        throw new RoomConflictError("This Keating turn is no longer current.", "room_turn_stale");
      }
      const startedAt = next.turn.startedAt;
      const meta = {
        turnId: operation.turnId,
        facilitatorAccountId: actor.accountId,
        // A learner's browser composed this reply and no teacher checked it, so
        // the room is told whose browser it came from.
        ...(roleCanOversee(actor.role) ? {} : { facilitatorName: actor.displayName }),
        model: operation.model,
        edited: false,
      };
      let outcome: NonNullable<Room["turn"]["lastOutcome"]>;
      const body = operation.body?.trim() ?? "";
      if (operation.outcome === "offered-private") {
        const parsed = roomPrivateForkProposalSchema.safeParse(operation.privateFork);
        if (!parsed.success) {
          throw new RoomConflictError("Choose a learner and a public message for the private conversation.", "room_private_fork_invalid");
        }
        const source = requirePrivateFork(next, parsed.data, next.turn.throughSeq);
        const proposal = { ...parsed.data, ...privateForkRange(source.body, parsed.data) };
        const hold: RoomDraft["reason"] | null = next.settings.keating === "paused"
          ? "paused" : next.settings.replyReview === "teacher-approves" ? "review" : null;
        // Model body/detail/addressees never seed a private conversation. The draft
        // contains only the exact public passage; opening fetches it fresh again.
        if (hold) {
          if (next.drafts.filter((draft) => draft.status === "pending").length >= MAX_PENDING_DRAFTS) {
            throw new RoomConflictError("Review the pending replies before Keating takes another turn.", "room_drafts_full");
          }
          next.drafts.push({
            id: derivedId(operation.id, "draft"), turnId: operation.turnId,
            body: proposal.selectedText ?? source.body,
            createdAt: now, facilitatorAccountId: actor.accountId,
            model: operation.model, reason: hold, status: "pending", privateFork: proposal,
          });
          outcome = { kind: "drafted", at: now };
        } else {
          appendPrivateForkOffer(next, proposal, derivedId(operation.id, "fork"), operation.model, now);
          outcome = { kind: "offered-private", at: now };
        }
      } else if (operation.outcome === "spoke" && !body) {
        outcome = { kind: "passed", at: now, detail: "Keating produced an empty message." };
      } else if (operation.outcome === "spoke" && next.status !== "open") {
        outcome = { kind: "failed", at: now, detail: "The room ended before Keating replied." };
      } else if (operation.outcome === "spoke") {
        const addressedTo = knownAddressees(next, operation.addressedTo);
        const hold: RoomDraft["reason"] | null =
          next.settings.keating === "paused"
            ? "paused"
            : next.settings.replyReview === "teacher-approves"
              ? "review"
              : null;
        if (hold) {
          if (next.drafts.filter((draft) => draft.status === "pending").length >= MAX_PENDING_DRAFTS) {
            throw new RoomConflictError("Review the pending replies before Keating takes another turn.", "room_drafts_full");
          }
          next.drafts.push({
            id: derivedId(operation.id, "draft"),
            turnId: operation.turnId,
            body,
            ...(addressedTo ? { addressedTo } : {}),
            createdAt: now,
            facilitatorAccountId: actor.accountId,
            model: operation.model,
            reason: hold,
            status: "pending",
          });
          outcome = { kind: "drafted", at: now };
        } else {
          appendMessage(next, keatingMessage(derivedId(operation.id, "msg"), body, now, meta, addressedTo), touched);
          outcome = { kind: "spoke", at: now };
        }
      } else {
        outcome = {
          kind: operation.outcome,
          at: now,
          ...(operation.outcome === "failed"
            ? { detail: "Keating could not complete this turn. Check the facilitator's model connection and try again." }
            : operation.detail ? { detail: operation.detail } : {}),
        };
      }
      const requestAnswered =
        next.turn.requestedAt &&
        startedAt &&
        Date.parse(next.turn.requestedAt) <= Date.parse(startedAt);
      resetTurn(next);
      next.turn.consideredSeq = Math.max(next.turn.consideredSeq, next.turn.throughSeq);
      next.turn.lastOutcome = outcome;
      if (requestAnswered) {
        next.turn.requestedAt = undefined;
        next.turn.requestedBy = undefined;
      }
      break;
    }
    case "turn.request": {
      requireOpen(next);
      requireOverseer(actor, "ask Keating to step in");
      if (next.settings.keating !== "active") {
        throw new RoomConflictError("Resume Keating before asking it to step in.", "room_keating_paused");
      }
      next.turn.requestedAt = now;
      next.turn.requestedBy = actor.accountId;
      break;
    }
    case "draft.resolve": {
      requireOverseer(actor, "review Keating's replies");
      const draft = next.drafts.find((candidate) => candidate.id === operation.draftId);
      if (!draft || draft.status !== "pending") {
        throw new RoomConflictError("That draft was already reviewed.", "room_draft_resolved");
      }
      if (operation.action === "approve") {
        requireOpen(next);
        if (draft.privateFork) {
          if (operation.body !== undefined) {
            throw new RoomConflictError("Private conversation offers use the public passage and cannot be edited. Reject this offer to choose another passage.", "room_private_fork_edit_forbidden");
          }
          appendPrivateForkOffer(next, draft.privateFork, derivedId(operation.id, "fork"), draft.model, now);
        } else {
          const body = operation.body?.trim() || draft.body;
          appendMessage(
            next,
            keatingMessage(
              derivedId(operation.id, "msg"),
              body,
              now,
              {
                turnId: draft.turnId,
                facilitatorAccountId: draft.facilitatorAccountId,
                model: draft.model,
                reviewedBy: actor.accountId,
                edited: body !== draft.body,
              },
              draft.addressedTo,
            ),
            touched,
          );
        }
      }
      draft.status = operation.action === "approve" ? "approved" : "rejected";
      draft.resolvedBy = actor.accountId;
      draft.resolvedAt = now;
      trimResolvedDrafts(next);
      break;
    }
    case "private-fork.resolve": {
      const offer = next.privateForkOffers.find((candidate) => candidate.id === operation.offerId);
      if (!offer || offer.learnerAccountId !== actor.accountId || actor.role !== "learner") {
        throw new RoomAuthorizationError("Only the addressed learner can open or dismiss this private conversation offer.", "room_private_fork_forbidden");
      }
      // Revalidation precedes acknowledgment, including for dismissed/replayed offers.
      requirePrivateFork(next, offer);
      if (offer.status !== "pending") {
        throw new RoomConflictError("This private conversation offer was already opened or dismissed.", "room_private_fork_resolved");
      }
      offer.status = operation.action === "open" ? "opened" : "dismissed";
      offer.resolvedAt = now;
      break;
    }
  }

  invalidateRoomPrivateForks(next, now);
  next.revision += 1;
  next.updatedAt = now;
  return { room: next, touchedMessageIds: touched, removedAccountIds: removed };
}

// ─── Projection ─────────────────────────────────────────────────────────────

export function permissionsForRoom(
  room: Room,
  accountId: string,
  now = Date.now(),
): RoomPermissions {
  const member = memberFor(room, accountId);
  const oversee = roleCanOversee(member.role);
  const open = room.status === "open";
  const inviteRoles: RoomInviteRole[] = oversee
    ? member.role === "host"
      ? ["learner", "teacher", "observer"]
      : ["learner", "observer"]
    : room.settings.learnerInvites && member.role === "learner"
      ? ["learner"]
      : [];
  return {
    canPost: open && member.role !== "observer" && !member.muted,
    canOversee: oversee,
    canManageRoles: member.role === "host",
    canInvite: open && inviteRoles.length > 0,
    inviteRoles: open ? inviteRoles : [],
    canFacilitate: open && canFacilitate(room, member),
    isFacilitator:
      open && canFacilitate(room, member) && room.facilitator?.accountId === accountId && facilitatorIsFresh(room.facilitator, now),
  };
}

/** A message as one viewer may see it, or null when it is not theirs to see. */
export function projectRoomMessage(
  message: RoomMessage,
  viewer: RoomMember,
): RoomMessage | null {
  const oversee = roleCanOversee(viewer.role);
  if (message.audience === "teachers" && !oversee) return null;
  if (message.hidden && !oversee) {
    const { replyToId: _replyToId, addressedTo: _addressedTo, ...rest } = message;
    return { ...rest, body: "" };
  }
  return structuredClone(message);
}

function visibleMessages(room: Room, viewer: RoomMember): RoomMessage[] {
  const visible: RoomMessage[] = [];
  for (const message of room.messages) {
    const projected = projectRoomMessage(message, viewer);
    if (projected) visible.push(projected);
  }
  return visible;
}

function projectMember(member: RoomMember, viewer: RoomMember): RoomMember {
  if (member.accountId === viewer.accountId || roleCanOversee(viewer.role)) {
    return structuredClone(member);
  }
  return { ...structuredClone(member), muted: false };
}

export function projectRoomState(
  room: Room,
  viewerAccountId: string,
  now = Date.now(),
): Extract<RoomRealtimeMessage, { type: "room.patch" }>["snapshot"] {
  const viewer = memberFor(room, viewerAccountId);
  const oversee = roleCanOversee(viewer.role);
  const { invites: _invites, messages: _messages, ...rest } = structuredClone(room);
  const turn = oversee
    ? rest.turn
    : {
        ...rest.turn,
        requestedBy: undefined,
        lastOutcome: rest.turn.lastOutcome
          ? { kind: rest.turn.lastOutcome.kind, at: rest.turn.lastOutcome.at }
          : undefined,
      };
  return {
    room: {
      ...rest,
      members: room.members.map((member) => projectMember(member, viewer)),
      drafts: oversee ? rest.drafts : [],
      privateForkOffers: rest.privateForkOffers.filter((offer) =>
        offer.learnerAccountId === viewerAccountId && viewer.role === "learner" && privateForkIsValid(room, offer)),
      turn,
    },
    viewer: structuredClone(viewer),
    permissions: permissionsForRoom(room, viewerAccountId, now),
  };
}

export function projectRoomForViewer(
  room: Room,
  viewerAccountId: string,
  options: { window?: number; now?: number } = {},
): RoomViewerSnapshot {
  const state = projectRoomState(room, viewerAccountId, options.now);
  const visible = visibleMessages(room, state.viewer);
  const window = options.window ?? ROOM_MESSAGE_WINDOW;
  const messages = visible.slice(-window);
  return {
    ...state,
    room: { ...state.room, messages },
    hasEarlierMessages: visible.length > messages.length,
  };
}

export function projectMessagesById(
  room: Room,
  viewerAccountId: string,
  messageIds: readonly string[],
): RoomMessage[] {
  const viewer = findRoomMember(room, viewerAccountId);
  if (!viewer || messageIds.length === 0) return [];
  const wanted = new Set(messageIds);
  return room.messages
    .filter((message) => wanted.has(message.id))
    .map((message) => projectRoomMessage(message, viewer))
    .filter((message): message is RoomMessage => message !== null);
}

/** Older messages for infinite scroll, newest-last. */
export function roomMessagesBefore(
  room: Room,
  viewerAccountId: string,
  beforeSeq: number,
  limit = 100,
): { messages: RoomMessage[]; hasEarlierMessages: boolean } {
  const viewer = memberFor(room, viewerAccountId);
  const earlier = visibleMessages(room, viewer).filter((message) => message.seq < beforeSeq);
  const messages = earlier.slice(-limit);
  return { messages, hasEarlierMessages: earlier.length > messages.length };
}

export function roomListItem(room: Room, accountId: string): RoomListItem {
  const member = findRoomMember(room, accountId);
  const lastMessage = [...room.messages]
    .reverse()
    .find((message) => message.audience === "room" && message.kind !== "system");
  return {
    id: room.id,
    title: room.title,
    topic: room.topic,
    role: member?.role ?? "learner",
    status: room.status,
    memberCount: room.members.length,
    hostName: room.members.find((candidate) => candidate.role === "host")?.displayName ?? "The host",
    teacherNames: room.members.filter((candidate) => candidate.role === "teacher").map((candidate) => candidate.displayName),
    settings: {
      replyReview: room.settings.replyReview,
      participation: room.settings.participation,
      facilitators: room.settings.facilitators,
    },
    ...(room.context.courseId ? { courseId: room.context.courseId } : {}),
    ...(room.context.courseTitle ? { courseTitle: room.context.courseTitle } : {}),
    ...(room.context.lessonTitle ? { lessonTitle: room.context.lessonTitle } : {}),
    ...(room.facilitator && facilitatorIsFresh(room.facilitator, Date.now())
      ? { facilitatorName: room.facilitator.displayName }
      : {}),
    ...(lastMessage ? { lastMessageAt: lastMessage.createdAt } : {}),
    updatedAt: room.updatedAt,
    joined: Boolean(member),
  };
}

export function parseStoredRoom(raw: unknown): Room {
  return roomSchema.parse(raw);
}
