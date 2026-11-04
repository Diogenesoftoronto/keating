import { describe, expect, test } from "bun:test";
import { ROOM_MAX_MESSAGES, roomSchema, type Room, type RoomOperation, type RoomOperationInput } from "../rooms/contracts";
import {
  applyRoomOperation,
  hasPendingTurnRequest,
  permissionsForRoom,
  projectRoomForViewer,
  projectRoomState,
  RoomAuthorizationError,
  RoomConflictError,
  roomListItem,
  roomMessagesBefore,
} from "../rooms/operations";

const T0 = "2026-10-24T12:00:00.000Z";
let counter = 0;

function at(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1_000).toISOString();
}

function room(overrides: Partial<Room> = {}): Room {
  return roomSchema.parse({
    schemaVersion: 1,
    id: "room_test",
    title: "Fractions study group",
    topic: "Equivalent fractions",
    goal: "",
    hostAccountId: "host",
    createdAt: T0,
    updatedAt: T0,
    revision: 0,
    status: "open",
    members: [
      { accountId: "host", displayName: "Ms Rivera", role: "host", joinedAt: T0, via: "created" },
      { accountId: "teach", displayName: "Mr Okafor", role: "teacher", joinedAt: T0 },
      { accountId: "maya", displayName: "Maya", role: "learner", joinedAt: T0 },
      { accountId: "sam", displayName: "Sam", role: "learner", joinedAt: T0 },
      { accountId: "obs", displayName: "Parent", role: "observer", joinedAt: T0 },
    ],
    messages: [],
    nextSeq: 1,
    settings: {},
    turn: { status: "idle", throughSeq: 0, consideredSeq: 0 },
    ...overrides,
  });
}

function op(input: RoomOperationInput): RoomOperation {
  counter += 1;
  return { ...input, id: `op_${counter}`, roomId: "room_test" } as RoomOperation;
}

function apply(current: Room, actor: string, input: RoomOperationInput, now = at(0)): Room {
  return applyRoomOperation(current, actor, op(input), now).room;
}

function post(current: Room, actor: string, body: string, now = at(0)): Room {
  counter += 1;
  return apply(current, actor, { type: "message.post", messageId: `msg_${counter}`, body }, now);
}

function facilitated(current = room(), now = at(0)): Room {
  return apply(current, "host", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "Test model", takeOver: false }, now);
}

function fullHistory(current = room()): Room {
  const messages: Room["messages"] = Array.from({ length: ROOM_MAX_MESSAGES }, (_, index) => ({
    id: `msg_history_${index}`, seq: index + 1, kind: "chat", authorAccountId: "maya",
    authorName: "Maya", authorRole: "learner", body: `Retained contribution ${index}`, createdAt: T0, audience: "room",
  }));
  return { ...current, messages, nextSeq: ROOM_MAX_MESSAGES + 1 };
}

describe("room messages", () => {
  test("posts are attributed, sequenced, and bump the revision", () => {
    const next = post(post(room(), "maya", "Is 2/4 the same as 1/2?"), "sam", "I think so");
    expect(next.messages.map((message) => [message.seq, message.authorName, message.authorRole])).toEqual([
      [1, "Maya", "learner"],
      [2, "Sam", "learner"],
    ]);
    expect(next.revision).toBe(2);
    expect(next.nextSeq).toBe(3);
  });

  test("observers and muted learners cannot post", () => {
    expect(() => post(room(), "obs", "hello")).toThrow(RoomAuthorizationError);
    const muted = apply(room(), "teach", { type: "member.mute", accountId: "sam", muted: true });
    expect(() => post(muted, "sam", "hello")).toThrow(/muted/);
    expect(permissionsForRoom(muted, "sam").canPost).toBe(false);
  });

  test("ended rooms reject posts and turns", () => {
    const ended = apply(room(), "host", { type: "room.status", status: "ended" });
    expect(() => post(ended, "maya", "still here?")).toThrow(RoomConflictError);
    expect(permissionsForRoom(ended, "host").canFacilitate).toBe(false);
  });

  test("duplicate message ids are rejected", () => {
    const first = apply(room(), "maya", { type: "message.post", messageId: "msg_dup", body: "one" });
    expect(() => apply(first, "maya", { type: "message.post", messageId: "msg_dup", body: "two" })).toThrow(RoomConflictError);
  });
});

describe("full transcript preservation", () => {
  const events: Array<{ name: string; actor: string; input: RoomOperationInput; verify: (next: Room) => void }> = [
    { name: "muting", actor: "host", input: { type: "member.mute", accountId: "sam", muted: true }, verify: (next) => expect(next.members.find((member) => member.accountId === "sam")?.muted).toBe(true) },
    { name: "removal", actor: "host", input: { type: "member.remove", accountId: "sam" }, verify: (next) => expect(next.members.some((member) => member.accountId === "sam")).toBe(false) },
    { name: "role changes", actor: "host", input: { type: "member.role", accountId: "sam", role: "observer" }, verify: (next) => expect(next.members.find((member) => member.accountId === "sam")?.role).toBe("observer") },
    { name: "leaving", actor: "sam", input: { type: "member.leave" }, verify: (next) => expect(next.members.some((member) => member.accountId === "sam")).toBe(false) },
    { name: "ending", actor: "host", input: { type: "room.status", status: "ended" }, verify: (next) => expect(next.status).toBe("ended") },
    { name: "pausing", actor: "host", input: { type: "settings.update", patch: { keating: "paused" } }, verify: (next) => expect(next.settings.keating).toBe("paused") },
    { name: "facilitator claims", actor: "host", input: { type: "facilitator.claim", facilitatorId: "browser_full", modelLabel: "m", takeOver: false }, verify: (next) => expect(next.facilitator?.facilitatorId).toBe("browser_full") },
  ];
  for (const { name, actor, input, verify } of events) {
    test(`${name} still applies without displacing any transcript message`, () => {
      const current = fullHistory();
      const history = JSON.stringify(current.messages);
      const result = applyRoomOperation(current, actor, op(input), T0);
      verify(result.room);
      expect(JSON.stringify(result.room.messages)).toBe(history);
      expect(result.room.nextSeq).toBe(current.nextSeq);
      expect(result.touchedMessageIds).toEqual([]);
      expect(result.room.revision).toBe(current.revision + 1);
    });
  }

  test("new posts and private guidance fail explicitly instead of dropping older contributions", () => {
    const current = fullHistory();
    expect(() => post(current, "maya", "Overflow")).toThrow(/transcript limit/);
    expect(() => apply(current, "host", { type: "whisper.post", messageId: "msg_overflow_whisper", body: "Overflow" })).toThrow(/transcript limit/);
    expect(current.messages[0]?.body).toBe("Retained contribution 0");
  });

  test("a full transcript refuses a new model turn before inference can start", () => {
    const current = fullHistory(facilitated());
    expect(() => apply(current, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_full_history", throughSeq: ROOM_MAX_MESSAGES })).toThrow(/transcript limit/);
    expect(current.turn.status).toBe("idle");
  });

  test("late Keating replies and draft approvals cannot evict existing history", () => {
    const begun = apply(post(facilitated(), "maya", "Help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_capacity", throughSeq: 2 });
    const current = fullHistory(begun);
    const history = JSON.stringify(current.messages);
    expect(() => apply(current, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_capacity", outcome: "spoke", body: "Overflow reply", model: "m" })).toThrow(/transcript limit/);
    const pending = fullHistory(room({ drafts: [{ id: "draft_capacity", turnId: "turn_draft", body: "Pending reply", createdAt: T0, facilitatorAccountId: "host", model: "m", reason: "review", status: "pending" }] }));
    expect(() => apply(pending, "host", { type: "draft.resolve", draftId: "draft_capacity", action: "approve" })).toThrow(/transcript limit/);
    expect(pending.drafts[0]?.status).toBe("pending");
    expect(JSON.stringify(current.messages)).toBe(history);
    expect(JSON.stringify(pending.messages)).toBe(history);
  });
});

describe("teacher oversight visibility", () => {
  test("whispers reach teachers only and never learners or observers", () => {
    const next = apply(room(), "teach", { type: "whisper.post", messageId: "msg_whisper", body: "Push Sam to explain why." });
    expect(projectRoomForViewer(next, "host").room.messages.map((message) => message.id)).toContain("msg_whisper");
    expect(projectRoomForViewer(next, "maya").room.messages).toHaveLength(0);
    expect(projectRoomForViewer(next, "obs").room.messages).toHaveLength(0);
  });

  test("learners cannot whisper", () => {
    expect(() => apply(room(), "maya", { type: "whisper.post", messageId: "msg_w", body: "psst" })).toThrow(RoomAuthorizationError);
  });

  test("hidden messages become empty tombstones for learners but stay readable to teachers", () => {
    const posted = apply(room(), "sam", { type: "message.post", messageId: "msg_rude", body: "something unkind" });
    const hidden = apply(posted, "teach", { type: "message.hide", messageId: "msg_rude", hidden: true });
    const learnerView = projectRoomForViewer(hidden, "maya").room.messages[0]!;
    expect(learnerView.body).toBe("");
    expect(learnerView.hidden).toBeDefined();
    expect(projectRoomForViewer(hidden, "teach").room.messages[0]!.body).toBe("something unkind");
    const restored = apply(hidden, "teach", { type: "message.hide", messageId: "msg_rude", hidden: false });
    expect(projectRoomForViewer(restored, "maya").room.messages[0]!.body).toBe("something unkind");
  });

  test("snapshots never include invite token hashes, and drafts are teacher-only", () => {
    const withInvite = room({
      invites: [{ id: "invite_a", role: "learner", createdBy: "host", createdAt: T0, expiresAt: at(3_600), maxUses: 5, uses: 0, tokenHash: "a".repeat(64) }],
      settings: roomSchema.shape.settings.parse({ replyReview: "teacher-approves" }),
    });
    const begun = apply(facilitated(post(withInvite, "maya", "help")), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_1", throughSeq: 2 });
    const drafted = apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_1", outcome: "spoke", body: "What do you notice about 2/4?", model: "Test model" });
    expect(JSON.stringify(projectRoomForViewer(drafted, "host"))).not.toContain("a".repeat(64));
    expect(projectRoomForViewer(drafted, "host").room.drafts).toHaveLength(1);
    expect(projectRoomForViewer(drafted, "maya").room.drafts).toHaveLength(0);
    expect("invites" in projectRoomState(drafted, "maya").room).toBe(false);
    const listed = roomListItem(drafted, "maya");
    expect(listed).toMatchObject({
      hostName: "Ms Rivera",
      teacherNames: ["Mr Okafor"],
      memberCount: 5,
      settings: { replyReview: "teacher-approves", participation: "facilitate", facilitators: "teachers" },
    });
    expect(JSON.stringify(listed)).not.toContain("a".repeat(64));
    expect(JSON.stringify(listed)).not.toContain("What do you notice about 2/4?");
  });

  test("learners do not see who is muted or why Keating passed", () => {
    const muted = apply(room(), "teach", { type: "member.mute", accountId: "sam", muted: true });
    const learnerSam = projectRoomForViewer(muted, "maya").room.members.find((member) => member.accountId === "sam")!;
    expect(learnerSam.muted).toBe(false);
    expect(projectRoomForViewer(muted, "sam").viewer.muted).toBe(true);
    const begun = apply(facilitated(post(muted, "maya", "hi")), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_p", throughSeq: 3 });
    const passed = apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_p", outcome: "passed", model: "m", detail: "Learners are working it out." });
    expect(projectRoomForViewer(passed, "teach").room.turn.lastOutcome?.detail).toBe("Learners are working it out.");
    expect(projectRoomForViewer(passed, "maya").room.turn.lastOutcome?.detail).toBeUndefined();
  });
});

describe("membership", () => {
  test("only the host changes roles, and teachers cannot be removed by teachers", () => {
    expect(() => apply(room(), "teach", { type: "member.role", accountId: "maya", role: "teacher" })).toThrow(RoomAuthorizationError);
    const promoted = apply(room(), "host", { type: "member.role", accountId: "maya", role: "teacher" });
    expect(permissionsForRoom(promoted, "maya").canOversee).toBe(true);
    expect(() => apply(promoted, "teach", { type: "member.remove", accountId: "maya" })).toThrow(/host/);
  });

  test("removal and leaving drop the member and report who lost access", () => {
    const result = applyRoomOperation(room(), "teach", op({ type: "member.remove", accountId: "sam" }), at(0));
    expect(result.removedAccountIds).toEqual(["sam"]);
    expect(result.room.members.some((member) => member.accountId === "sam")).toBe(false);
    expect(() => apply(room(), "host", { type: "member.leave" })).toThrow(/host cannot leave/);
  });

  test("invite roles follow the inviter's role", () => {
    expect(permissionsForRoom(room(), "host").inviteRoles).toEqual(["learner", "teacher", "observer"]);
    expect(permissionsForRoom(room(), "teach").inviteRoles).toEqual(["learner", "observer"]);
    expect(permissionsForRoom(room(), "maya").inviteRoles).toEqual([]);
    const open = apply(room(), "host", { type: "settings.update", patch: { learnerInvites: true } });
    expect(permissionsForRoom(open, "maya").inviteRoles).toEqual(["learner"]);
  });
});

describe("facilitator lease", () => {
  test("same-account tabs require explicit takeover and stale tabs cannot control the replacement", () => {
    const begun = apply(post(facilitated(), "maya", "help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_old", throughSeq: 2 });
    expect(() => apply(begun, "host", { type: "facilitator.claim", facilitatorId: "browser_other", modelLabel: "m", takeOver: false })).toThrow(/already running/);
    const taken = apply(begun, "host", { type: "facilitator.claim", facilitatorId: "browser_other", modelLabel: "m", takeOver: true }, at(1));
    expect(taken.turn.status).toBe("idle");
    expect(() => apply(taken, "host", { type: "facilitator.heartbeat", facilitatorId: "browser_test" }, at(2))).toThrow(RoomConflictError);
    expect(() => apply(taken, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_wrong", throughSeq: 2 }, at(2))).toThrow(RoomConflictError);
    expect(() => apply(taken, "host", { type: "facilitator.release", facilitatorId: "browser_test" }, at(2))).toThrow(RoomConflictError);
    expect(taken.facilitator?.facilitatorId).toBe("browser_other");
    const next = apply(taken, "host", { type: "turn.begin", facilitatorId: "browser_other", turnId: "turn_new", throughSeq: taken.nextSeq - 1 }, at(2));
    expect(() => apply(next, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_new", outcome: "spoke", body: "stale", model: "m" }, at(3))).toThrow(RoomConflictError);
  });

  test("an expired facilitator must claim again and cannot revive an old turn", () => {
    const begun = apply(post(facilitated(), "maya", "help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_old", throughSeq: 2 });
    expect(() => apply(begun, "host", { type: "facilitator.heartbeat", facilitatorId: "browser_test" }, at(46))).toThrow(RoomConflictError);
    expect(() => apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_old", outcome: "spoke", body: "late", model: "m" }, at(46))).toThrow(RoomConflictError);
    const reclaimed = apply(begun, "host", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false }, at(46));
    expect(reclaimed.turn.status).toBe("idle");
  });

  test("demotion discards privileged context even when learners can facilitate", () => {
    const open = apply(room(), "host", { type: "settings.update", patch: { facilitators: "anyone" } });
    const claimed = apply(open, "teach", { type: "facilitator.claim", facilitatorId: "browser_teacher", modelLabel: "m", takeOver: false });
    const begun = apply(post(claimed, "maya", "help"), "teach", { type: "turn.begin", facilitatorId: "browser_teacher", turnId: "turn_teacher", throughSeq: claimed.nextSeq });
    const demoted = apply(begun, "host", { type: "member.role", accountId: "teach", role: "learner" });
    expect(demoted.facilitator).toBeUndefined();
    expect(demoted.turn.status).toBe("idle");
    expect(() => apply(demoted, "teach", { type: "turn.complete", facilitatorId: "browser_teacher", turnId: "turn_teacher", outcome: "spoke", body: "old private context", model: "m" })).toThrow(RoomConflictError);
  });

  test("muting a learner also stops that learner's facilitator", () => {
    const open = apply(room(), "host", { type: "settings.update", patch: { facilitators: "anyone" } });
    const claimed = apply(open, "maya", { type: "facilitator.claim", facilitatorId: "browser_learner", modelLabel: "m", takeOver: false });
    const muted = apply(claimed, "teach", { type: "member.mute", accountId: "maya", muted: true });
    expect(muted.facilitator).toBeUndefined();
    expect(permissionsForRoom(muted, "maya").canFacilitate).toBe(false);
  });

  test("only allowed members can run Keating", () => {
    expect(() => apply(room(), "maya", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false })).toThrow(/Only teachers/);
    const anyone = apply(room(), "host", { type: "settings.update", patch: { facilitators: "anyone" } });
    expect(apply(anyone, "maya", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false }).facilitator?.accountId).toBe("maya");
    expect(() => apply(anyone, "obs", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false })).toThrow(RoomAuthorizationError);
  });

  test("learners lose the lease when teacher review turns on", () => {
    const anyone = apply(room(), "host", { type: "settings.update", patch: { facilitators: "anyone" } });
    const claimed = apply(anyone, "maya", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false });
    const reviewed = apply(claimed, "host", { type: "settings.update", patch: { replyReview: "teacher-approves" } });
    expect(reviewed.facilitator).toBeUndefined();
  });

  test("a fresh lease blocks others unless a teacher takes over; a stale lease does not", () => {
    const claimed = facilitated();
    expect(() => apply(claimed, "teach", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false }, at(5))).toThrow(/already running/);
    expect(apply(claimed, "teach", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: true }, at(5)).facilitator?.accountId).toBe("teach");
    expect(apply(claimed, "teach", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: false }, at(120)).facilitator?.accountId).toBe("teach");
  });

  test("heartbeats from a replaced facilitator are rejected", () => {
    const taken = apply(facilitated(), "teach", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: true }, at(5));
    expect(() => apply(taken, "host", { type: "facilitator.heartbeat", facilitatorId: "browser_test" }, at(6))).toThrow(/moved/);
  });
});

describe("Keating turns", () => {
  test("turn expiry rejects late completion even with a fresh facilitator heartbeat", () => {
    const begun = apply(post(facilitated(), "maya", "help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_expired", throughSeq: 2 });
    const beat = apply(begun, "host", { type: "facilitator.heartbeat", facilitatorId: "browser_test" }, at(40));
    const fresh = apply(beat, "host", { type: "facilitator.heartbeat", facilitatorId: "browser_test" }, at(80));
    expect(() => apply(fresh, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_expired", outcome: "spoke", body: "too late", model: "m" }, at(91))).toThrow(/no longer current/);
  });

  test("a teacher request arriving during a turn remains pending afterward", () => {
    const begun = apply(post(facilitated(), "maya", "help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_first", throughSeq: 2 }, at(1));
    const requested = apply(begun, "teach", { type: "turn.request" }, at(2));
    const completed = apply(requested, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_first", outcome: "passed", model: "m" }, at(3));
    expect(hasPendingTurnRequest(completed)).toBe(true);
    expect(apply(completed, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_requested", throughSeq: 2 }, at(4)).turn.status).toBe("thinking");
  });

  test("in-flight replies pause into private drafts, and failed turns store safe diagnostics", () => {
    const begun = apply(post(facilitated(), "maya", "help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_pause", throughSeq: 2 });
    const paused = apply(begun, "teach", { type: "settings.update", patch: { keating: "paused" } });
    const held = apply(paused, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_pause", outcome: "spoke", body: "private pending reply", model: "m" });
    expect(held.drafts[0]?.reason).toBe("paused");
    expect(JSON.stringify(projectRoomForViewer(held, "maya"))).not.toContain("private pending reply");
    const failed = apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_pause", outcome: "failed", model: "m", detail: "provider Authorization: secret-token" });
    expect(JSON.stringify(projectRoomForViewer(failed, "host"))).not.toContain("secret-token");
  });

  test("pending drafts are bounded without evicting a teacher's unreviewed work", () => {
    const pending = room({ settings: roomSchema.shape.settings.parse({ replyReview: "teacher-approves" }), drafts: Array.from({ length: 150 }, (_, index) => ({ id: `draft_${index}`, turnId: `turn_${index}`, body: "review me", facilitatorAccountId: "host", model: "m", createdAt: T0, reason: "review", status: "pending" })) });
    expect(() => apply(post(facilitated(pending), "maya", "help"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_full", throughSeq: 2 })).toThrow(/Review the pending/);
    expect(roomSchema.safeParse(pending).success).toBe(true);
  });

  test("hiding a source message cancels the in-flight reply that read it", () => {
    const posted = apply(facilitated(), "maya", { type: "message.post", messageId: "msg_hide_source", body: "hide this" });
    const begun = apply(posted, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_hidden", throughSeq: 2 });
    const hidden = apply(begun, "teach", { type: "message.hide", messageId: "msg_hide_source", hidden: true });
    expect(hidden.turn.status).toBe("idle");
  });

  test("a turn leases the room, posts Keating's reply, and records what it read", () => {
    const withMessages = post(post(facilitated(), "maya", "Is 2/4 the same as 1/2?"), "sam", "Maybe?");
    const begun = apply(withMessages, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_a", throughSeq: 3 });
    expect(begun.turn.status).toBe("thinking");
    expect(() => apply(begun, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_b", throughSeq: 3 })).toThrow(/already taking a turn/);
    const done = apply(begun, "host", {
      type: "turn.complete", facilitatorId: "browser_test",
      turnId: "turn_a",
      outcome: "spoke",
      body: "Maya, can you draw both? Sam, what do you notice?",
      addressedTo: ["Maya", "Sam", "Nobody"],
      model: "Test model",
    });
    const reply = done.messages.at(-1)!;
    expect(reply.kind).toBe("keating");
    expect(reply.addressedTo).toEqual(["Maya", "Sam"]);
    expect(reply.keating?.facilitatorAccountId).toBe("host");
    expect(done.turn).toMatchObject({ status: "idle", consideredSeq: 3 });
    expect(done.turn.lastOutcome?.kind).toBe("spoke");
  });

  test("Keating cannot re-read messages it already decided about", () => {
    const withMessage = post(facilitated(), "maya", "hello");
    const begun = apply(withMessage, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_a", throughSeq: 2 });
    const passed = apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_a", outcome: "passed", model: "m" });
    expect(() => apply(passed, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_b", throughSeq: 2 })).toThrow(/already read/);
  });

  test("a teacher request lets Keating take a turn without new messages", () => {
    const withMessage = post(facilitated(), "maya", "hello");
    const begun = apply(withMessage, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_a", throughSeq: 2 });
    const passed = apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_a", outcome: "passed", model: "m" }, at(1));
    const requested = apply(passed, "teach", { type: "turn.request" }, at(2));
    const again = apply(requested, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_b", throughSeq: 2 }, at(3));
    const answered = apply(again, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_b", outcome: "spoke", body: "Let's recap.", model: "m" }, at(4));
    expect(answered.turn.requestedAt).toBeUndefined();
  });

  test("a stale turn cannot complete after the lease moved", () => {
    const begun = apply(post(facilitated(), "maya", "hi"), "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_a", throughSeq: 2 });
    const taken = apply(begun, "teach", { type: "facilitator.claim", facilitatorId: "browser_test", modelLabel: "m", takeOver: true }, at(1));
    expect(taken.turn.status).toBe("idle");
    expect(() => apply(taken, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_a", outcome: "spoke", body: "late", model: "m" }, at(2))).toThrow(RoomConflictError);
  });

  test("paused Keating cannot start a turn", () => {
    const paused = apply(post(facilitated(), "maya", "hi"), "teach", { type: "settings.update", patch: { keating: "paused" } });
    expect(() => apply(paused, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_a", throughSeq: 3 })).toThrow(/paused/);
    expect(paused.messages.at(-1)?.body).toContain("paused Keating");
  });

  test("under teacher review, replies become drafts until approved, edited, or rejected", () => {
    const reviewed = apply(post(facilitated(), "maya", "What is 1/2 + 1/4?"), "host", { type: "settings.update", patch: { replyReview: "teacher-approves" } });
    const begun = apply(reviewed, "host", { type: "turn.begin", facilitatorId: "browser_test", turnId: "turn_a", throughSeq: reviewed.nextSeq - 1 });
    const drafted = apply(begun, "host", { type: "turn.complete", facilitatorId: "browser_test", turnId: "turn_a", outcome: "spoke", body: "It is 3/4.", model: "m" });
    expect(drafted.messages.some((message) => message.kind === "keating")).toBe(false);
    const draft = drafted.drafts[0]!;
    expect(draft).toMatchObject({ status: "pending", reason: "review" });

    const approved = apply(drafted, "teach", { type: "draft.resolve", draftId: draft.id, action: "approve", body: "Maya, what common denominator could help?" });
    const published = approved.messages.at(-1)!;
    expect(published).toMatchObject({ kind: "keating", body: "Maya, what common denominator could help?" });
    expect(published.keating).toMatchObject({ reviewedBy: "teach", edited: true });
    expect(() => apply(approved, "teach", { type: "draft.resolve", draftId: draft.id, action: "reject" })).toThrow(/already reviewed/);

    const rejected = apply(drafted, "teach", { type: "draft.resolve", draftId: draft.id, action: "reject" });
    expect(rejected.messages.some((message) => message.kind === "keating")).toBe(false);
    expect(rejected.drafts[0]!.status).toBe("rejected");
  });
});

describe("pagination", () => {
  test("earlier messages page backwards in seq order, skipping private ones for learners", () => {
    let current = room();
    for (let index = 0; index < 5; index += 1) current = post(current, "maya", `m${index}`);
    current = apply(current, "teach", { type: "whisper.post", messageId: "msg_private", body: "note" });
    current = post(current, "sam", "last");
    const page = roomMessagesBefore(current, "maya", 7, 3);
    expect(page.messages.map((message) => message.body)).toEqual(["m2", "m3", "m4"]);
    expect(page.hasEarlierMessages).toBe(true);
    const windowed = projectRoomForViewer(current, "maya", { window: 2 });
    expect(windowed.room.messages.map((message) => message.body)).toEqual(["m4", "last"]);
    expect(windowed.hasEarlierMessages).toBe(true);
  });
});
