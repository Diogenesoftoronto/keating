import { describe, expect, test } from "bun:test";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { ROOM_MAX_MESSAGES, roomSchema, type RoomOperation, type RoomOperationInput } from "../rooms/contracts";
import {
  applyStoredRoomOperation, createRoom, createRoomInvite, currentRoom, deleteRoom,
  exportRoomTranscript, getRoomForAccount, getRoomMessagesBefore, joinRoomThroughCourse,
  joinRoomWithInvite, listRoomInvites, listRoomsForAccount, listRoomsForCourse, previewRoomInvite,
  revokeRoomInvite, withRoomRepositoryStorage,
} from "../../server/utils/room-repository";

const T0 = Date.parse("2026-10-24T12:00:00.000Z");
const newStore = () => createStorage({ driver: memoryDriver() });
let nextId = 0;
const operation = (roomId: string, input: RoomOperationInput, id = `op_${++nextId}`): RoomOperation => ({ ...input, roomId, id } as RoomOperation);
const change = (roomId: string, actor: string, input: RoomOperationInput) => applyStoredRoomOperation(actor, operation(roomId, input));
const linkedContext = { courseId: "course_test", courseTitle: "Fractions", objectives: ["Explain equivalence"] };

async function seedCourse(store: ReturnType<typeof newStore>, members = [
  { accountId: "host", role: "owner" }, { accountId: "teacher", role: "teacher" },
  { accountId: "learner", role: "student" }, { accountId: "other", role: "student" },
]) {
  await store.setItem("course:course_test", { course: { members: members.map((member) => ({ ...member, progress: { privateAnswer: "PRIVATE_COURSE_PROGRESS" } })) } });
}

describe("room repository concurrency and durability", () => {
  test("an index write failure rolls back the room and every partially written index", async () => {
    const store = newStore();
    await seedCourse(store);
    let failed = false;
    const failingStore = {
      ...store,
      setItem: async (...[key, value, options]: Parameters<typeof store.setItem>) => {
        if (!failed && key.startsWith("room-course:")) { failed = true; throw new Error("Injected index failure"); }
        await store.setItem(key, value, options);
      },
    };
    await withRoomRepositoryStorage(failingStore, async () => {
      await expect(createRoom("host", "Teacher", { title: "Rollback" }, linkedContext)).rejects.toThrow("Injected index failure");
      expect(await listRoomsForAccount("host")).toEqual([]);
      expect(await listRoomsForCourse("course_test", "host")).toEqual([]);
      expect((await store.getKeys()).filter((key) => key.startsWith("room:"))).toEqual([]);
      expect((await createRoom("host", "Teacher", { title: "Recovered" }, linkedContext)).room.title).toBe("Recovered");
    });
  });

  test("concurrent creations preserve every account and course index entry", async () => {
    const store = newStore();
    await seedCourse(store);
    await withRoomRepositoryStorage(store, async () => {
      const rooms = await Promise.all(Array.from({ length: 12 }, (_, index) => createRoom("host", "Teacher", { title: `Room ${index}` }, linkedContext)));
      expect((await listRoomsForAccount("host")).map((item) => item.id).sort()).toEqual(rooms.map((item) => item.room.id).sort());
      expect(await listRoomsForCourse("course_test", "learner")).toHaveLength(12);
    }, { now: () => T0 });
  });

  test("operation retries are account scoped, content bound, and survive repository restart", async () => {
    const store = newStore();
    let roomId = "";
    let post!: RoomOperation;
    await withRoomRepositoryStorage(store, async () => {
      roomId = (await createRoom("host", "Teacher", { title: "Retries" })).room.id;
      const invite = await createRoomInvite(roomId, "host", "learner", 1, 3);
      await joinRoomWithInvite(invite.token, "learner", "Learner");
      post = operation(roomId, { type: "message.post", messageId: "msg_once", body: "one" }, "op_shared");
      const results = await Promise.all([applyStoredRoomOperation("learner", post), applyStoredRoomOperation("learner", post)]);
      expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
      await expect(applyStoredRoomOperation("learner", { ...post, body: "different" } as RoomOperation)).rejects.toMatchObject({ code: "room_operation_reused" });
      expect((await applyStoredRoomOperation("host", operation(roomId, { type: "message.post", messageId: "msg_host", body: "host" }, "op_shared"))).applied).toBe(true);
    });
    await withRoomRepositoryStorage(store, async () => {
      expect((await applyStoredRoomOperation("learner", post)).applied).toBe(false);
      expect((await getRoomForAccount(roomId, "learner"))!.room.messages.filter((message) => message.id === "msg_once")).toHaveLength(1);
    });
  });

  test("removals persist across restart and block invites and course joins", async () => {
    const store = newStore();
    await seedCourse(store);
    let roomId = "";
    let token = "";
    await withRoomRepositoryStorage(store, async () => {
      roomId = (await createRoom("host", "Teacher", { title: "Moderation" }, linkedContext)).room.id;
      token = (await createRoomInvite(roomId, "host", "learner", 2, 10)).token;
      await joinRoomThroughCourse(roomId, "course_test", "learner", "Learner", "learner");
      await change(roomId, "host", { type: "member.remove", accountId: "learner" });
    });
    await withRoomRepositoryStorage(store, async () => {
      expect(await getRoomForAccount(roomId, "learner")).toBeNull();
      expect(await previewRoomInvite(token, "learner")).toBeNull();
      await expect(joinRoomWithInvite(token, "learner", "Again")).rejects.toMatchObject({ code: "room_removed" });
      await expect(joinRoomThroughCourse(roomId, "course_test", "learner", "Again", "teacher")).rejects.toMatchObject({ code: "room_removed" });
      expect(await listRoomsForAccount("learner")).toEqual([]);
      expect(await listRoomsForCourse("course_test", "learner")).toEqual([]);
    });
  });

  test("leaving cannot clear a mute or undo a host's role restriction with an older teacher invite", async () => {
    await withRoomRepositoryStorage(newStore(), async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Restrictions" })).room.id;
      const invite = await createRoomInvite(roomId, "host", "teacher", 1, 10);
      await joinRoomWithInvite(invite.token, "teacher", "Teacher Two");
      await change(roomId, "host", { type: "member.role", accountId: "teacher", role: "learner" });
      await change(roomId, "host", { type: "member.mute", accountId: "teacher", muted: true });
      const leave = operation(roomId, { type: "member.leave" });
      await applyStoredRoomOperation("teacher", leave);
      expect((await applyStoredRoomOperation("teacher", leave)).snapshot).toBeNull();
      expect(await previewRoomInvite(invite.token, "teacher")).toMatchObject({
        role: "teacher", effectiveRole: "learner", alreadyMember: false,
        hostName: "Teacher", teacherNames: [],
        settings: { replyReview: "off", participation: "facilitate", facilitators: "teachers" },
      });
      expect(await previewRoomInvite(invite.token, "host")).toMatchObject({ effectiveRole: "host", alreadyMember: true });
      const joined = await joinRoomWithInvite(invite.token, "teacher", "Returning");
      expect(joined?.snapshot.viewer).toMatchObject({ role: "learner", muted: true });
      expect(joined?.snapshot.permissions.canPost).toBe(false);
    });
  });

  test("a full operation history drops the oldest receipts instead of locking the room", async () => {
    const store = newStore();
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Bounded" })).room.id;
      const record = await store.getItem<any>(`room:${roomId}`);
      record.operationReceipts = Array.from({ length: 20_000 }, (_, index) => ({ key: index.toString(16).padStart(64, "0"), digest: "a".repeat(64) }));
      await store.setItem(`room:${roomId}`, record);
      await change(roomId, "host", { type: "room.update", patch: { title: "Still open" } });
      const trimmed = await store.getItem<any>(`room:${roomId}`);
      expect(trimmed.room.title).toBe("Still open");
      expect(trimmed.operationReceipts).toHaveLength(20_000);
      expect(trimmed.operationReceipts[0].key).toBe((1).toString(16).padStart(64, "0"));
      const indexKey = (await store.getKeys()).find((key) => key.startsWith("room-account:"))!;
      const ids = Array.from({ length: 500 }, (_, index) => `room_existing_${index}`);
      await store.setItem(indexKey, ids);
      await expect(createRoom("host", "Teacher", { title: "Overflow" })).rejects.toMatchObject({ code: "room_index_full" });
      expect(await store.getItem(indexKey)).toEqual(ids);
      expect((await store.getKeys()).filter((key) => key.startsWith("room:"))).toHaveLength(1);
    });
  });

  test("course creation and joining validate authoritative roles, including direct repository use", async () => {
    const store = newStore();
    await seedCourse(store);
    await withRoomRepositoryStorage(store, async () => {
      await expect(createRoom("learner", "Learner", { title: "Self promotion" }, linkedContext)).rejects.toMatchObject({ code: "room_course_forbidden" });
      const roomId = (await createRoom("host", "Teacher", { title: "Course" }, linkedContext)).room.id;
      const joined = await joinRoomThroughCourse(roomId, "course_test", "learner", "Learner", "teacher");
      expect(joined.snapshot.viewer.role).toBe("learner");
      await expect(joinRoomThroughCourse(roomId, "course_test", "outsider", "Outsider", "teacher")).rejects.toMatchObject({ statusCode: 404 });
      expect(JSON.stringify(joined.snapshot)).not.toContain("PRIVATE_COURSE_PROGRESS");
    });
  });

  test("course listings disclose public oversight and the role joining would actually grant", async () => {
    const store = newStore();
    await seedCourse(store, [
      { accountId: "host", role: "owner" }, { accountId: "teacher", role: "teacher" },
      { accountId: "assistant", role: "teacher" }, { accountId: "learner", role: "student" }, { accountId: "peer", role: "peer" },
    ]);
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("teacher", "Course Teacher", {
        title: "Public disclosure",
        settings: { replyReview: "teacher-approves", participation: "on-request", facilitators: "teachers" },
      }, linkedContext)).room.id;
      expect((await listRoomsForCourse("course_test", "host"))[0]).toMatchObject({ role: "teacher", joined: false });
      expect((await listRoomsForCourse("course_test", "assistant"))[0]).toMatchObject({ role: "teacher", joined: false });
      await joinRoomThroughCourse(roomId, "course_test", "host", "Course Owner", "teacher");
      await change(roomId, "teacher", { type: "whisper.post", messageId: "msg_disclosure_private", body: "PRIVATE_GUIDANCE" });
      const invite = await createRoomInvite(roomId, "teacher", "teacher", 1, 5);
      const listed = (await listRoomsForCourse("course_test", "learner"))[0]!;
      expect(listed).toMatchObject({
        id: roomId, role: "learner", joined: false, memberCount: 2,
        hostName: "Course Teacher", teacherNames: ["Course Owner"],
        settings: { replyReview: "teacher-approves", participation: "on-request", facilitators: "teachers" },
      });
      expect((await listRoomsForCourse("course_test", "peer"))[0]?.role).toBe("learner");
      expect((await listRoomsForCourse("course_test", "teacher"))[0]?.role).toBe("host");
      expect(await listRoomsForCourse("course_test", "outsider")).toEqual([]);
      expect(await previewRoomInvite(invite.token, "new")).toMatchObject({
        effectiveRole: "teacher", hostName: listed.hostName, teacherNames: listed.teacherNames, settings: listed.settings,
      });
      for (const value of [listed, await previewRoomInvite(invite.token, "new")]) {
        const json = JSON.stringify(value);
        expect(json).not.toContain("PRIVATE_COURSE_PROGRESS");
        expect(json).not.toContain("PRIVATE_GUIDANCE");
        expect(json).not.toContain("tokenHash");
        expect(json).not.toContain("memberRestrictions");
      }
      await joinRoomThroughCourse(roomId, "course_test", "learner", "Learner", "learner");
      await change(roomId, "teacher", { type: "member.role", accountId: "learner", role: "observer" });
      await change(roomId, "learner", { type: "member.leave" });
      expect((await listRoomsForCourse("course_test", "learner"))[0]).toMatchObject({ role: "observer", joined: false });
    });
  });

  test("course demotion/removal revokes derived authority but explicit room role grants survive", async () => {
    const store = newStore();
    await seedCourse(store);
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Live authority" }, linkedContext)).room.id;
      await joinRoomThroughCourse(roomId, "course_test", "teacher", "Course Teacher", "teacher");
      await joinRoomThroughCourse(roomId, "course_test", "learner", "Learner", "learner");
      await change(roomId, "host", { type: "member.role", accountId: "learner", role: "teacher" });
      await change(roomId, "teacher", { type: "facilitator.claim", facilitatorId: "browser_course", modelLabel: "m", takeOver: false });
      await seedCourse(store, [{ accountId: "host", role: "owner" }, { accountId: "teacher", role: "student" }]);
      const demoted = await getRoomForAccount(roomId, "teacher");
      expect(demoted?.viewer.role).toBe("learner");
      expect(demoted?.permissions.canOversee).toBe(false);
      expect(demoted?.room.facilitator).toBeUndefined();
      expect((await getRoomForAccount(roomId, "learner"))?.viewer.role).toBe("teacher");
      await seedCourse(store, [{ accountId: "host", role: "owner" }]);
      expect(await getRoomForAccount(roomId, "teacher")).toBeNull();
      expect((await currentRoom(roomId))?.members.some((member) => member.accountId === "teacher")).toBe(false);
      await expect(change(roomId, "teacher", { type: "room.update", patch: { title: "Unauthorized" } })).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});

describe("room invitations and private history", () => {
  test("invite consumption is serialized, bounded, and cannot promote an existing member", async () => {
    await withRoomRepositoryStorage(newStore(), async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Invites" })).room.id;
      const once = await createRoomInvite(roomId, "host", "learner", 1, 1);
      const joined = await Promise.all([joinRoomWithInvite(once.token, "one", "One"), joinRoomWithInvite(once.token, "two", "Two")]);
      expect(joined.filter(Boolean)).toHaveLength(1);
      const learner = joined[0] ? "one" : "two";
      const teachers = await createRoomInvite(roomId, "host", "teacher", 1, 2);
      expect(await previewRoomInvite(teachers.token, learner)).toMatchObject({ role: "teacher", effectiveRole: "learner", alreadyMember: true });
      expect((await joinRoomWithInvite(teachers.token, learner, "Existing"))?.snapshot.viewer.role).toBe("learner");
      await expect(createRoomInvite(roomId, learner, "teacher", 1, 1)).rejects.toMatchObject({ statusCode: 403 });
      await joinRoomWithInvite(teachers.token, "teacher", "Teacher Two");
      await expect(createRoomInvite(roomId, "teacher", "teacher", 1, 1)).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  test("expiry, revocation, ended rooms, and lost issuer permissions invalidate links", async () => {
    let now = T0;
    await withRoomRepositoryStorage(newStore(), async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Expiry", settings: { learnerInvites: true } })).room.id;
      const invite = await createRoomInvite(roomId, "host", "learner", 1, 10);
      await joinRoomWithInvite(invite.token, "learner", "Learner");
      const delegated = await createRoomInvite(roomId, "learner", "learner", 2, 10);
      await change(roomId, "host", { type: "settings.update", patch: { learnerInvites: false } });
      expect(await previewRoomInvite(delegated.token, "new")).toBeNull();
      const revoked = await createRoomInvite(roomId, "host", "learner", 2, 10);
      await revokeRoomInvite(roomId, "host", revoked.invite.id);
      expect(await joinRoomWithInvite(revoked.token, "new", "New")).toBeNull();
      now += 3_600_001;
      expect(await previewRoomInvite(invite.token, "new")).toBeNull();
      const ended = await createRoomInvite(roomId, "host", "learner", 2, 10);
      await change(roomId, "host", { type: "room.status", status: "ended" });
      expect(await previewRoomInvite(ended.token, "new")).toBeNull();
    }, { now: () => now });
  });

  test("discarded invites remove their durable token indexes and room deletion cleans retained keys", async () => {
    const store = newStore();
    let now = T0;
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Cleanup" })).room.id;
      await createRoomInvite(roomId, "host", "learner", 1, 10);
      now += 3_600_001;
      await createRoomInvite(roomId, "host", "learner", 1, 10);
      expect((await store.getKeys()).filter((key) => key.startsWith("room-invite:"))).toHaveLength(1);
      await deleteRoom(roomId, "host");
      expect((await store.getKeys()).filter((key) => key.startsWith("room:") || key.startsWith("room-invite:"))).toEqual([]);
      expect(await currentRoom(roomId)).toBeNull();
    }, { now: () => now });
  });

  test("a full set of live invites rejects new links instead of evicting existing ones", async () => {
    const store = newStore();
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Invites" })).room.id;
      const teacherInvite = await createRoomInvite(roomId, "host", "teacher", 1, 10);
      for (let index = 1; index < 200; index++) await createRoomInvite(roomId, "host", "learner", 1, 10);
      await expect(createRoomInvite(roomId, "host", "learner", 1, 10)).rejects.toMatchObject({ code: "room_invite_limit" });
      expect((await listRoomInvites(roomId, "host")).some((invite) => invite.id === teacherInvite.invite.id)).toBe(true);
    });
  });

  test.each(["invite", "course"] as const)("joining through %s preserves the entire full transcript", async (via) => {
    const store = newStore();
    await seedCourse(store);
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "History" }, linkedContext)).room.id;
      const invite = await createRoomInvite(roomId, "host", "learner", 1, 10);
      const record = await store.getItem<any>(`room:${roomId}`);
      const message = record.room.messages[0];
      record.room.messages = Array.from({ length: ROOM_MAX_MESSAGES }, (_, index) => ({
        ...message, id: `msg_history_${index}`, seq: index + 1,
        kind: "chat", authorRole: "host", authorAccountId: "host", body: `Retained transcript message ${index}`,
      }));
      record.room.nextSeq = ROOM_MAX_MESSAGES + 1;
      const originalHistory = structuredClone(record.room.messages);
      const originalRevision = record.room.revision;
      await store.setItem(`room:${roomId}`, record);
      if (via === "invite") await joinRoomWithInvite(invite.token, "learner", "Learner");
      else await joinRoomThroughCourse(roomId, "course_test", "learner", "Learner", "learner");
      const saved = await currentRoom(roomId);
      expect(saved?.messages).toHaveLength(ROOM_MAX_MESSAGES);
      expect(saved?.messages).toEqual(originalHistory);
      expect(saved?.nextSeq).toBe(ROOM_MAX_MESSAGES + 1);
      expect(saved?.members.some((member) => member.accountId === "learner")).toBe(true);
      expect(saved?.revision).toBe(originalRevision + 1);
      expect(await exportRoomTranscript(roomId, "learner")).toContain("Retained transcript message 0");
      expect(roomSchema.safeParse(saved).success).toBe(true);
    });
  });

  test("snapshots, older pages and transcripts all use the same privacy projection", async () => {
    await withRoomRepositoryStorage(newStore(), async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Privacy" })).room.id;
      const invite = await createRoomInvite(roomId, "host", "learner", 1, 5);
      await joinRoomWithInvite(invite.token, "learner", "Learner");
      await change(roomId, "host", { type: "whisper.post", messageId: "msg_guidance", body: "PRIVATE_GUIDANCE" });
      await change(roomId, "host", { type: "message.post", messageId: "msg_hidden", body: "HIDDEN_BODY" });
      await change(roomId, "host", { type: "message.hide", messageId: "msg_hidden", hidden: true });
      const snapshot = await getRoomForAccount(roomId, "learner");
      const earlier = await getRoomMessagesBefore(roomId, "learner", 999, 200);
      const transcript = await exportRoomTranscript(roomId, "learner");
      for (const value of [snapshot, earlier, transcript]) {
        expect(JSON.stringify(value)).not.toContain("PRIVATE_GUIDANCE");
        expect(JSON.stringify(value)).not.toContain("HIDDEN_BODY");
        expect(JSON.stringify(value)).not.toContain("tokenHash");
        expect(JSON.stringify(value)).not.toContain("blockedAccountIds");
      }
      expect(await exportRoomTranscript(roomId, "host")).toContain("PRIVATE_GUIDANCE");
    });
  });
});
