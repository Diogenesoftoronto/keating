import { describe, expect, test } from "bun:test";
import { roomSchema, type RoomMessage, type RoomRealtimeMessage, type RoomViewerSnapshot } from "../rooms/contracts";
import { projectRoomForViewer } from "../rooms/operations";
import { INITIAL_ROOM_CLIENT_STATE, roomClientReducer, typingAccountIds, type RoomClientState } from "../rooms/room-state";

const T0 = "2026-10-24T12:00:00.000Z";
function message(seq: number, overrides: Partial<RoomMessage> = {}): RoomMessage {
  return { id: `msg_${seq}`, seq, kind: "chat", authorAccountId: "learner", authorName: "Maya", authorRole: "learner", audience: "room", body: `message ${seq}`, createdAt: T0, ...overrides };
}
function snapshot(revision = 1, role: "teacher" | "learner" = "teacher", id = "room_test"): RoomViewerSnapshot {
  const room = roomSchema.parse({
    schemaVersion: 1, id, title: "Group", hostAccountId: "host", createdAt: T0, updatedAt: T0, revision, settings: {},
    members: [
      { accountId: "host", displayName: "Host", role: "host", joinedAt: T0 },
      { accountId: "viewer", displayName: "Viewer", role, joinedAt: T0 },
      { accountId: "learner", displayName: "Maya", role: "learner", joinedAt: T0 },
    ],
    messages: [message(10)], nextSeq: 11, turn: { status: "thinking", turnId: "turn_one", throughSeq: 10, consideredSeq: 0 },
  });
  return projectRoomForViewer(room, "viewer");
}
function loaded(value = snapshot()): RoomClientState {
  return roomClientReducer(INITIAL_ROOM_CLIENT_STATE, { type: "snapshot", snapshot: value });
}
function socket(state: RoomClientState, message: RoomRealtimeMessage, at = 10): RoomClientState {
  return roomClientReducer(state, { type: "socket", message, at });
}
function patch(value: RoomViewerSnapshot, messages: RoomMessage[] = []): RoomRealtimeMessage {
  const { messages: _messages, ...room } = value.room;
  return { type: "room.patch", revision: value.room.revision, snapshot: { room, viewer: value.viewer, permissions: value.permissions }, messages };
}

describe("room client reducer ordering and privacy", () => {
  test("rejects stale snapshots and patches without losing loaded earlier pages", () => {
    let state = loaded(snapshot(5));
    state = roomClientReducer(state, { type: "earlier", roomId: "room_test", revision: 5, messages: [message(1), message(2)], hasEarlierMessages: false });
    expect(roomClientReducer(state, { type: "snapshot", snapshot: snapshot(4) })).toBe(state);
    expect(socket(state, patch(snapshot(4), [message(20)]))).toBe(state);
    const next = snapshot(5);
    next.room.messages = [message(10, { body: "edited" }), message(11)];
    state = roomClientReducer(state, { type: "snapshot", snapshot: next });
    expect(state.snapshot?.room.messages.map((message) => message.seq)).toEqual([1, 2, 10, 11]);
    expect(state.snapshot?.room.messages.find((message) => message.seq === 10)?.body).toBe("edited");
    expect(state.snapshot?.hasEarlierMessages).toBe(false);
  });

  test("a catch-up snapshot drops cached history whose missed moderation cannot be checked", () => {
    let state = loaded(snapshot(5));
    state = roomClientReducer(state, { type: "earlier", revision: 5, messages: [message(1, { body: "Later hidden while offline" })], hasEarlierMessages: false });
    state = roomClientReducer(state, { type: "snapshot", snapshot: snapshot(6) });
    expect(state.snapshot?.room.messages.map((message) => message.seq)).toEqual([10]);
    expect(JSON.stringify(state)).not.toContain("Later hidden while offline");
  });

  test("out-of-order edits merge by id in seq order and clear the author's typing", () => {
    let state = loaded();
    state = socket(state, { type: "typing", roomId: "room_test", accountId: "learner" }, 100);
    state = socket(state, { type: "typing", roomId: "room_test", accountId: "host" }, 101);
    state = socket(state, patch(snapshot(2), [message(12), message(10, { body: "fixed" }), message(11)]));
    expect(state.snapshot?.room.messages.map((message) => message.seq)).toEqual([10, 11, 12]);
    expect(state.snapshot?.room.messages[0]?.body).toBe("fixed");
    expect(state.typing).toEqual({ host: 101 });
    expect(typingAccountIds(state, 102, "host")).toEqual([]);
    expect(typingAccountIds(state, 4102)).toEqual([]);
  });

  test("demotion discards every cached earlier page, hidden text, drafts, and private outcome detail", () => {
    const teacher = snapshot();
    teacher.room.messages = [
      message(1, { kind: "whisper", authorRole: "teacher", audience: "teachers", body: "Private guidance" }),
      message(2, { hidden: { by: "host", at: T0 }, body: "Hidden private text" }),
      message(10),
    ];
    teacher.room.drafts = [{ id: "draft_one", turnId: "turn_one", body: "Private draft", createdAt: T0, facilitatorAccountId: "viewer", model: "Model", reason: "review", status: "pending" }];
    teacher.room.turn.lastOutcome = { kind: "passed", at: T0, detail: "Private reason" };
    let state = loaded(teacher);
    state = socket(state, { type: "keating.preview", roomId: "room_test", turnId: "turn_one", text: "Private live draft" });
    const learner = snapshot(2, "learner");
    learner.room.settings.replyReview = "teacher-approves";
    state = roomClientReducer(state, { type: "snapshot", snapshot: learner });
    expect(state.snapshot?.room.messages.map((message) => message.seq)).toEqual([10]);
    expect(state.preview).toBeNull();
    expect(teacher.room.drafts[0]?.body).toBe("Private draft");
    expect(JSON.stringify(state)).not.toMatch(/Private guidance|Hidden private text|Private draft|Private reason|Private live draft/);
    // A late pagination response from before demotion cannot repopulate private pages.
    expect(roomClientReducer(state, { type: "earlier", roomId: "room_test", revision: 1, messages: teacher.room.messages, hasEarlierMessages: false })).toBe(state);
    expect(roomClientReducer(state, { type: "snapshot", snapshot: teacher })).toBe(state);
  });

  test("patch demotion also clears old private data even if its full snapshot is delayed", () => {
    const teacher = snapshot();
    teacher.room.messages.unshift(message(1, { kind: "whisper", audience: "teachers", body: "Secret" }));
    const state = socket(loaded(teacher), patch(snapshot(2, "learner")));
    expect(state.snapshot?.room.messages).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("Secret");
  });

  test("private pagination and hidden text are projected for the current viewer", () => {
    const state = roomClientReducer(loaded(snapshot(2, "learner")), {
      type: "earlier", revision: 2, messages: [
        message(1, { audience: "teachers", body: "Secret" }),
        message(2, { body: "Removed body", replyToId: "private_id", addressedTo: ["Private person"], hidden: { by: "host", at: T0 } }),
      ], hasEarlierMessages: false,
    });
    expect(state.snapshot?.room.messages.map((message) => message.seq)).toEqual([2, 10]);
    expect(state.snapshot?.room.messages[0]).toMatchObject({ body: "" });
    expect(JSON.stringify(state)).not.toMatch(/Secret|Removed body|Private person|private_id/);
  });

  test("removed is terminal until reset and drops all room data and transients", () => {
    let state = loaded();
    state = socket(state, { type: "presence", roomId: "room_test", accountIds: ["viewer"] });
    state = socket(state, { type: "typing", roomId: "room_test", accountId: "learner" });
    state = socket(state, { type: "keating.preview", roomId: "room_test", turnId: "turn_one", text: "Live" });
    state = socket(state, { type: "removed", roomId: "room_test" });
    expect(state).toEqual({ ...INITIAL_ROOM_CLIENT_STATE, roomId: "room_test", removed: true });
    expect(roomClientReducer(state, { type: "snapshot", snapshot: snapshot(999) })).toBe(state);
    expect(socket(state, { type: "presence", roomId: "room_test", accountIds: ["viewer"] })).toBe(state);
    expect(roomClientReducer(state, { type: "earlier", messages: [message(1)], hasEarlierMessages: false })).toBe(state);
    state = roomClientReducer(state, { type: "reset", roomId: "room_next" });
    expect(roomClientReducer(state, { type: "snapshot", snapshot: snapshot(0, "learner", "room_next") }).snapshot?.room.id).toBe("room_next");
  });

  test("rejects wrong-room snapshots, pages, removals, presence and previews", () => {
    const state = loaded();
    expect(roomClientReducer(state, { type: "snapshot", snapshot: snapshot(100, "teacher", "room_other") })).toBe(state);
    expect(socket(state, patch(snapshot(100, "teacher", "room_other")))).toBe(state);
    expect(roomClientReducer(state, { type: "earlier", roomId: "room_other", messages: [message(1)], hasEarlierMessages: false })).toBe(state);
    expect(socket(state, { type: "removed", roomId: "room_other" })).toBe(state);
    expect(socket(state, { type: "presence", roomId: "room_other", accountIds: ["outsider"] })).toBe(state);
    expect(socket(state, { type: "keating.preview", roomId: "room_other", turnId: "turn_one", text: "Wrong room" })).toBe(state);
  });

  test("previews require the active turn and current visibility on every frame and snapshot", () => {
    let state = loaded(snapshot(1, "learner"));
    expect(socket(state, { type: "keating.preview", roomId: "room_test", turnId: "old_turn", text: "Stale" })).toBe(state);
    state = socket(state, { type: "keating.preview", roomId: "room_test", turnId: "turn_one", text: "Visible" });
    expect(state.preview?.text).toBe("Visible");
    const held = snapshot(2, "learner");
    held.room.settings.keating = "paused";
    state = socket(state, patch(held));
    expect(state.preview).toBeNull();
    expect(socket(state, { type: "keating.preview", roomId: "room_test", turnId: "turn_one", text: "Hidden" })).toBe(state);
    held.room.settings.keating = "active";
    held.room.settings.replyReview = "teacher-approves";
    state = roomClientReducer(state, { type: "snapshot", snapshot: held });
    expect(socket(state, { type: "keating.preview", roomId: "room_test", turnId: "turn_one", text: "Hidden" })).toBe(state);
    const done = snapshot(3);
    done.room.turn.status = "idle";
    state = roomClientReducer(state, { type: "snapshot", snapshot: done });
    expect(socket(state, { type: "keating.preview", roomId: "room_test", turnId: "turn_one", text: "Late" })).toBe(state);
  });
});
