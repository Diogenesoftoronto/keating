/**
 * Study rooms: live group sessions where several learners work with one
 * Keating facilitator while teachers keep oversight.
 *
 * The server owns the room record and applies every operation. Keating itself
 * runs in one member's browser (the facilitator) because model credentials
 * never leave the browser; the facilitator reads the shared transcript, decides
 * whether to speak or pass, and reports the outcome back as an operation.
 */
import { z } from "zod";

const idSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Use letters, numbers, dashes, or underscores",
  );
const accountIdSchema = z.string().min(1).max(256);
const isoDateSchema = z.string().datetime({ offset: true });
const displayNameSchema = z.string().trim().min(1).max(120);

export const ROOM_MESSAGE_MAX_CHARS = 8_000;
export const ROOM_MAX_MESSAGES = 4_000;
export const ROOM_MAX_MEMBERS = 200;
export const ROOM_MAX_PRIVATE_FORK_OFFERS = 200;
export const ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER = 20;
/** Messages sent with a snapshot; older ones load page by page. */
export const ROOM_MESSAGE_WINDOW = 300;
/** A facilitator that stops heartbeating loses Keating after this long. */
export const ROOM_FACILITATOR_STALE_MS = 45_000;
/** A turn that never completes frees the room after this long. */
export const ROOM_TURN_LEASE_MS = 90_000;
export const KEATING_DISPLAY_NAME = "Keating";

export const roomRoleSchema = z.enum(["host", "teacher", "learner", "observer"]);
export type RoomRole = z.infer<typeof roomRoleSchema>;

export const roomInviteRoleSchema = z.enum(["teacher", "learner", "observer"]);
export type RoomInviteRole = z.infer<typeof roomInviteRoleSchema>;

export const roomMemberSchema = z.object({
  accountId: accountIdSchema,
  displayName: displayNameSchema,
  role: roomRoleSchema,
  joinedAt: isoDateSchema,
  muted: z.boolean().default(false),
  via: z.enum(["created", "invite", "course"]).default("invite"),
});
export type RoomMember = z.infer<typeof roomMemberSchema>;

export const roomSettingsSchema = z.object({
  /** Teachers can pause Keating without ending the room. */
  keating: z.enum(["active", "paused"]).default("active"),
  /**
   * `facilitate`: Keating reads every message and decides when to step in.
   * `on-request`: Keating only takes a turn when someone mentions it or a
   * teacher asks it to step in.
   */
  participation: z.enum(["facilitate", "on-request"]).default("facilitate"),
  /** Hold Keating's replies until a teacher approves them. */
  replyReview: z.enum(["off", "teacher-approves"]).default("off"),
  /** Who may run Keating from their browser (and spend their model access). */
  facilitators: z.enum(["teachers", "anyone"]).default("teachers"),
  /** Let learners create learner invitations. */
  learnerInvites: z.boolean().default(false),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

/** Course context captured when a course-linked room is created. */
export const roomContextSchema = z.object({
  courseId: idSchema.optional(),
  courseTitle: z.string().trim().max(240).optional(),
  lessonId: idSchema.optional(),
  lessonTitle: z.string().trim().max(240).optional(),
  lessonSummary: z.string().trim().max(2_000).optional(),
  objectives: z.array(z.string().trim().min(1).max(1_000)).max(16).default([]),
});
export type RoomContext = z.infer<typeof roomContextSchema>;

export const roomAuthorRoleSchema = z.enum([
  "host",
  "teacher",
  "learner",
  "observer",
  "keating",
  "system",
]);
export type RoomAuthorRole = z.infer<typeof roomAuthorRoleSchema>;

export const roomMessageSchema = z.object({
  id: idSchema,
  seq: z.number().int().positive(),
  /**
   * `chat`: a person speaking to the room. `keating`: a published Keating
   * reply. `whisper`: private teacher guidance for Keating. `system`: joins,
   * departures, and room state changes.
   */
  kind: z.enum(["chat", "keating", "whisper", "system"]),
  authorAccountId: accountIdSchema.optional(),
  authorName: displayNameSchema,
  authorRole: roomAuthorRoleSchema,
  body: z.string().max(ROOM_MESSAGE_MAX_CHARS),
  createdAt: isoDateSchema,
  /** `teachers` messages are visible to hosts and teachers only. */
  audience: z.enum(["room", "teachers"]).default("room"),
  replyToId: idSchema.optional(),
  /** Display names a Keating message was directed at. */
  addressedTo: z.array(displayNameSchema).max(32).optional(),
  keating: z
    .object({
      turnId: idSchema,
      facilitatorAccountId: accountIdSchema,
      model: z.string().max(160),
      reviewedBy: accountIdSchema.optional(),
      edited: z.boolean().default(false),
    })
    .optional(),
  hidden: z.object({ by: accountIdSchema, at: isoDateSchema }).optional(),
});
export type RoomMessage = z.infer<typeof roomMessageSchema>;

/** An exact point in the public conversation, optionally narrowed to a quote. */
export const roomPrivateForkSourceSchema = z.object({
  sourceMessageId: idSchema,
  selectedText: z.string().min(1).max(ROOM_MESSAGE_MAX_CHARS)
    .refine((text) => text.trim().length > 0, "Choose a nonempty passage")
    .optional(),
  /** Exact UTF-16 range when the same quotation occurs more than once. */
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional(),
  sourceHash: z.string().min(1).max(128).optional(),
});
export type RoomPrivateForkSource = z.infer<typeof roomPrivateForkSourceSchema>;

/** The model chooses routing and a public source, never private seed text. */
export const roomPrivateForkProposalSchema = roomPrivateForkSourceSchema.extend({
  learnerAccountId: accountIdSchema,
});
export type RoomPrivateForkProposal = z.infer<typeof roomPrivateForkProposalSchema>;

export const roomPrivateForkOfferSchema = roomPrivateForkProposalSchema.extend({
  id: idSchema,
  createdAt: isoDateSchema,
  model: z.string().trim().min(1).max(160),
  status: z.enum(["pending", "opened", "dismissed"]).default("pending"),
  resolvedAt: isoDateSchema.optional(),
});
export type RoomPrivateForkOffer = z.infer<typeof roomPrivateForkOfferSchema>;

/** A Keating reply held for teacher review. Only teachers can see drafts. */
export const roomDraftSchema = z.object({
  id: idSchema,
  turnId: idSchema,
  body: z.string().min(1).max(ROOM_MESSAGE_MAX_CHARS),
  addressedTo: z.array(displayNameSchema).max(32).optional(),
  createdAt: isoDateSchema,
  facilitatorAccountId: accountIdSchema,
  model: z.string().max(160),
  reason: z.enum(["review", "paused"]),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  resolvedBy: accountIdSchema.optional(),
  resolvedAt: isoDateSchema.optional(),
  /** Approval sends an offer only to this learner, rather than a room reply. */
  privateFork: roomPrivateForkProposalSchema.optional(),
});
export type RoomDraft = z.infer<typeof roomDraftSchema>;

export const roomFacilitatorSchema = z.object({
  accountId: accountIdSchema,
  /** Per-tab lease identity. Account identity alone cannot fence sibling tabs. */
  facilitatorId: idSchema,
  displayName: displayNameSchema,
  modelLabel: z.string().trim().min(1).max(160),
  claimedAt: isoDateSchema,
  heartbeatAt: isoDateSchema,
});
export type RoomFacilitator = z.infer<typeof roomFacilitatorSchema>;

export const roomTurnOutcomeSchema = z.object({
  kind: z.enum(["spoke", "passed", "drafted", "offered-private", "failed"]),
  at: isoDateSchema,
  /** Pass reasons and failure text; teachers only. */
  detail: z.string().max(500).optional(),
});
export type RoomTurnOutcome = z.infer<typeof roomTurnOutcomeSchema>;

export const roomTurnSchema = z.object({
  status: z.enum(["idle", "thinking"]).default("idle"),
  turnId: idSchema.optional(),
  startedAt: isoDateSchema.optional(),
  leaseExpiresAt: isoDateSchema.optional(),
  /** Highest message seq the in-flight turn is reading. */
  throughSeq: z.number().int().nonnegative().default(0),
  /** Highest message seq Keating has already decided about. */
  consideredSeq: z.number().int().nonnegative().default(0),
  /** A teacher asked Keating to step in now. */
  requestedAt: isoDateSchema.optional(),
  requestedBy: accountIdSchema.optional(),
  lastOutcome: roomTurnOutcomeSchema.optional(),
});
export type RoomTurn = z.infer<typeof roomTurnSchema>;

export const roomInviteSchema = z.object({
  id: idSchema,
  role: roomInviteRoleSchema,
  createdBy: accountIdSchema,
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  maxUses: z.number().int().positive().max(ROOM_MAX_MEMBERS),
  uses: z.number().int().nonnegative(),
  tokenHash: z.string().length(64),
  revokedAt: isoDateSchema.optional(),
});
export type RoomInvite = z.infer<typeof roomInviteSchema>;
export type RoomInviteSummary = Omit<RoomInvite, "tokenHash">;

export const roomSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  title: z.string().trim().min(1).max(160),
  topic: z.string().trim().max(2_000).default(""),
  goal: z.string().trim().max(2_000).default(""),
  hostAccountId: accountIdSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  revision: z.number().int().nonnegative(),
  status: z.enum(["open", "ended"]).default("open"),
  context: roomContextSchema.default({ objectives: [] }),
  members: z.array(roomMemberSchema).min(1).max(ROOM_MAX_MEMBERS),
  messages: z.array(roomMessageSchema).max(ROOM_MAX_MESSAGES).default([]),
  nextSeq: z.number().int().positive().default(1),
  drafts: z.array(roomDraftSchema).max(200).default([]),
  invites: z.array(roomInviteSchema).max(200).default([]),
  /** Projected only to the addressed learner, including when a teacher views. */
  privateForkOffers: z.array(roomPrivateForkOfferSchema).max(ROOM_MAX_PRIVATE_FORK_OFFERS).default([]),
  settings: roomSettingsSchema,
  facilitator: roomFacilitatorSchema.optional(),
  turn: roomTurnSchema,
});
export type Room = z.infer<typeof roomSchema>;

/** What a member receives: invites stay server-side; drafts are teacher-only. */
export type RoomView = Omit<Room, "invites">;

export interface RoomPermissions {
  canPost: boolean;
  canOversee: boolean;
  canManageRoles: boolean;
  canInvite: boolean;
  inviteRoles: RoomInviteRole[];
  canFacilitate: boolean;
  isFacilitator: boolean;
}

export interface RoomViewerSnapshot {
  room: RoomView;
  viewer: RoomMember;
  permissions: RoomPermissions;
  /** Older messages exist before the first one in `room.messages`. */
  hasEarlierMessages: boolean;
}

/** Public context through the chosen point, fetched fresh before a local fork. */
export interface RoomPrivateForkContext extends RoomPrivateForkSource {
  roomId: string;
  roomTitle: string;
  topic: string;
  goal: string;
  context: RoomContext;
  revision: number;
  sourceSeq: number;
  /** Public, unhidden chat and Keating messages only; none after sourceSeq. */
  messages: RoomMessage[];
}

/** Public context shown before joining through an invite or a course. */
export interface RoomJoinDisclosure {
  memberCount: number;
  hostName: string;
  /** Teachers other than the host, to avoid repeating the host in copy. */
  teacherNames: string[];
  settings: Pick<RoomSettings, "replyReview" | "participation" | "facilitators">;
}

export interface RoomListItem extends RoomJoinDisclosure {
  id: string;
  title: string;
  topic: string;
  role: RoomRole;
  status: Room["status"];
  courseId?: string;
  courseTitle?: string;
  lessonTitle?: string;
  facilitatorName?: string;
  lastMessageAt?: string;
  updatedAt: string;
  /** Present on course listings for course members who have not joined yet. */
  joined: boolean;
}

/** What the join page shows before anyone accepts an invitation. */
export interface RoomInvitePreview extends RoomJoinDisclosure {
  roomTitle: string;
  topic: string;
  role: RoomInviteRole;
  /** Current membership or durable host restriction takes precedence over the link. */
  effectiveRole: RoomRole;
  courseTitle?: string;
  expiresAt: string;
  alreadyMember: boolean;
}

export const roomCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  topic: z.string().trim().max(2_000).default(""),
  goal: z.string().trim().max(2_000).default(""),
  courseId: idSchema.optional(),
  lessonId: idSchema.optional(),
  settings: roomSettingsSchema.partial().optional(),
  displayName: displayNameSchema.optional(),
});
export type RoomCreateInput = z.input<typeof roomCreateInputSchema>;

const operationBaseSchema = z.object({
  id: idSchema,
  roomId: idSchema,
});

const messageBodySchema = z.string().trim().min(1).max(ROOM_MESSAGE_MAX_CHARS);

export const roomOperationSchema = z.discriminatedUnion("type", [
  operationBaseSchema.extend({
    type: z.literal("message.post"),
    messageId: idSchema,
    body: messageBodySchema,
    replyToId: idSchema.optional(),
  }),
  operationBaseSchema.extend({
    type: z.literal("whisper.post"),
    messageId: idSchema,
    body: messageBodySchema,
  }),
  operationBaseSchema.extend({
    type: z.literal("message.hide"),
    messageId: idSchema,
    hidden: z.boolean(),
  }),
  operationBaseSchema.extend({
    type: z.literal("member.mute"),
    accountId: accountIdSchema,
    muted: z.boolean(),
  }),
  operationBaseSchema.extend({
    type: z.literal("member.remove"),
    accountId: accountIdSchema,
  }),
  operationBaseSchema.extend({
    type: z.literal("member.role"),
    accountId: accountIdSchema,
    role: roomInviteRoleSchema,
  }),
  operationBaseSchema.extend({
    type: z.literal("member.rename"),
    displayName: displayNameSchema,
  }),
  operationBaseSchema.extend({
    type: z.literal("member.leave"),
  }),
  operationBaseSchema.extend({
    type: z.literal("room.update"),
    patch: z.object({
      title: z.string().trim().min(1).max(160).optional(),
      topic: z.string().trim().max(2_000).optional(),
      goal: z.string().trim().max(2_000).optional(),
    }),
  }),
  operationBaseSchema.extend({
    type: z.literal("room.status"),
    status: z.enum(["open", "ended"]),
  }),
  operationBaseSchema.extend({
    type: z.literal("settings.update"),
    patch: roomSettingsSchema.partial(),
  }),
  operationBaseSchema.extend({
    type: z.literal("facilitator.claim"),
    facilitatorId: idSchema,
    modelLabel: z.string().trim().min(1).max(160),
    takeOver: z.boolean().default(false),
  }),
  operationBaseSchema.extend({
    type: z.literal("facilitator.heartbeat"),
    facilitatorId: idSchema,
    modelLabel: z.string().trim().min(1).max(160).optional(),
  }),
  operationBaseSchema.extend({
    type: z.literal("facilitator.release"),
    facilitatorId: idSchema,
  }),
  operationBaseSchema.extend({
    type: z.literal("turn.begin"),
    facilitatorId: idSchema,
    turnId: idSchema,
    throughSeq: z.number().int().nonnegative(),
  }),
  operationBaseSchema.extend({
    type: z.literal("turn.complete"),
    facilitatorId: idSchema,
    turnId: idSchema,
    outcome: z.enum(["spoke", "passed", "offered-private", "failed"]),
    body: z.string().trim().max(ROOM_MESSAGE_MAX_CHARS).optional(),
    addressedTo: z.array(displayNameSchema).max(32).optional(),
    model: z.string().trim().min(1).max(160),
    detail: z.string().trim().max(500).optional(),
    privateFork: roomPrivateForkProposalSchema.optional(),
  }),
  operationBaseSchema.extend({
    type: z.literal("turn.request"),
  }),
  operationBaseSchema.extend({
    type: z.literal("draft.resolve"),
    draftId: idSchema,
    action: z.enum(["approve", "reject"]),
    body: messageBodySchema.optional(),
  }),
  operationBaseSchema.extend({
    type: z.literal("private-fork.resolve"),
    offerId: idSchema,
    action: z.enum(["open", "dismiss"]),
  }),
]);
export type RoomOperation = z.infer<typeof roomOperationSchema>;
export type RoomOperationInput = RoomOperation extends infer Operation
  ? Operation extends RoomOperation
    ? Omit<Operation, "id" | "roomId">
    : never
  : never;

/**
 * Realtime traffic. State changes always travel through authenticated
 * operations; the socket only carries projections, presence, typing, and the
 * facilitator's live preview of Keating's reply.
 */
export type RoomRealtimeMessage =
  | { type: "snapshot"; snapshot: RoomViewerSnapshot }
  | {
      type: "room.patch";
      revision: number;
      snapshot: Omit<RoomViewerSnapshot, "room" | "hasEarlierMessages"> & {
        room: Omit<RoomView, "messages">;
      };
      /** New or changed messages, already projected for this viewer. */
      messages: RoomMessage[];
    }
  | { type: "removed"; roomId: string }
  | { type: "presence"; roomId: string; accountIds: string[] }
  | { type: "typing"; roomId: string; accountId: string }
  | { type: "keating.preview"; roomId: string; turnId: string; text: string }
  | { type: "error"; message: string; code?: string };

/** Messages the browser may send over the room socket. */
export type RoomClientSocketMessage =
  | { type: "typing" }
  | { type: "keating.preview"; facilitatorId: string; turnId: string; text: string };

export function roleCanOversee(role: RoomRole): boolean {
  return role === "host" || role === "teacher";
}

export function facilitatorIsFresh(
  facilitator: RoomFacilitator | undefined,
  now: number,
): facilitator is RoomFacilitator {
  return Boolean(
    facilitator &&
      now - Date.parse(facilitator.heartbeatAt) < ROOM_FACILITATOR_STALE_MS,
  );
}

export function turnLeaseExpired(turn: RoomTurn, now: number): boolean {
  return (
    turn.status === "thinking" &&
    (!turn.leaseExpiresAt || Date.parse(turn.leaseExpiresAt) <= now)
  );
}

/** Merge new or changed messages into a seq-ordered list. */
export function mergeRoomMessages(
  current: readonly RoomMessage[],
  incoming: readonly RoomMessage[],
): RoomMessage[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}
