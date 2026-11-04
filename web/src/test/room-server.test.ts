import { afterEach, describe, expect, test } from "bun:test";
import type { Peer } from "crossws";
import { H3Event } from "h3";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import roomApi from "../../server/api/rooms/[...path]";
import { roomSchema, type Room, type RoomOperation, type RoomOperationInput, type RoomRealtimeMessage, type RoomViewerSnapshot } from "../rooms/contracts";
import { applyRoomOperation } from "../rooms/operations";
import { broadcastRoomChange, broadcastRoomRemoved, connectRoomPeer, presentAccountIds, relayKeatingPreview, relayTyping } from "../../server/utils/room-realtime";
import { assertRoomRequestOrigin, readRoomBody, ROOM_REQUEST_MAX_BYTES } from "../../server/utils/room-request";
import { createRoom, currentRoom, joinRoomThroughCourse, withRoomRepositoryStorage } from "../../server/utils/room-repository";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";

let sequence = 0;
const cleanup = new Set<string>();
afterEach(() => { for (const roomId of cleanup) broadcastRoomRemoved(roomId); cleanup.clear(); });

function fixture(): Room {
  const now = new Date().toISOString();
  const roomId = `room_realtime_${++sequence}`;
  cleanup.add(roomId);
  return roomSchema.parse({
    schemaVersion: 1, id: roomId, title: "Realtime", hostAccountId: "host", createdAt: now, updatedAt: now, revision: 0,
    members: [
      { accountId: "host", displayName: "Teacher", role: "host", joinedAt: now },
      { accountId: "teacher", displayName: "Teacher Two", role: "teacher", joinedAt: now },
      { accountId: "learner", displayName: "Learner", role: "learner", joinedAt: now },
      { accountId: "observer", displayName: "Observer", role: "observer", joinedAt: now },
    ],
    messages: [], nextSeq: 1, settings: {}, turn: { status: "idle", consideredSeq: 0, throughSeq: 0 },
  });
}

function change(room: Room, actor: string, input: RoomOperationInput) {
  return applyRoomOperation(room, actor, { ...input, id: `op_realtime_${++sequence}`, roomId: room.id } as RoomOperation);
}

function connection(room: Room, accountId: string) {
  const messages: RoomRealtimeMessage[] = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const peer = {
    id: `peer_${++sequence}`,
    send(data: string) { messages.push(JSON.parse(data) as RoomRealtimeMessage); },
    close(code: number, reason: string) { closed.push({ code, reason }); },
  } as unknown as Peer;
  connectRoomPeer(room.id, accountId, peer, room);
  return { peer, messages, closed, clear: () => { messages.length = 0; } };
}

function thinking(room: Room): Room {
  const claimed = change(room, "host", { type: "facilitator.claim", facilitatorId: "browser_live", modelLabel: "m", takeOver: false }).room;
  const posted = change(claimed, "learner", { type: "message.post", messageId: "msg_question", body: "Help" }).room;
  return change(posted, "host", { type: "turn.begin", facilitatorId: "browser_live", turnId: "turn_live", throughSeq: posted.nextSeq - 1 }).room;
}

describe("room realtime privacy and authority", () => {
  test("patches project whispers, hidden bodies and drafts independently for each viewer", () => {
    const room = fixture();
    const host = connection(room, "host");
    const learner = connection(room, "learner");
    const observer = connection(room, "observer");
    host.clear(); learner.clear(); observer.clear();
    const whisper = change(room, "teacher", { type: "whisper.post", messageId: "msg_private", body: "PRIVATE_GUIDANCE" });
    broadcastRoomChange(whisper.room, whisper.touchedMessageIds);
    expect(JSON.stringify(host.messages)).toContain("PRIVATE_GUIDANCE");
    expect(JSON.stringify(learner.messages)).not.toContain("PRIVATE_GUIDANCE");
    expect(JSON.stringify(observer.messages)).not.toContain("PRIVATE_GUIDANCE");
    const posted = change(whisper.room, "learner", { type: "message.post", messageId: "msg_hidden", body: "HIDDEN_BODY" }).room;
    const hidden = change(posted, "host", { type: "message.hide", messageId: "msg_hidden", hidden: true });
    host.clear(); learner.clear(); observer.clear();
    broadcastRoomChange(hidden.room, hidden.touchedMessageIds);
    expect(JSON.stringify(host.messages)).toContain("HIDDEN_BODY");
    expect(JSON.stringify(learner.messages)).not.toContain("HIDDEN_BODY");
    const patch = learner.messages.find((message) => message.type === "room.patch");
    expect(patch?.type === "room.patch" && patch.messages[0]?.body).toBe("");
    const reviewed = change(hidden.room, "host", { type: "settings.update", patch: { replyReview: "teacher-approves" } }).room;
    const begun = thinking(reviewed);
    const drafted = change(begun, "host", { type: "turn.complete", facilitatorId: "browser_live", turnId: "turn_live", outcome: "spoke", body: "PRIVATE_DRAFT", model: "m" });
    host.clear(); learner.clear(); observer.clear();
    broadcastRoomChange(drafted.room, drafted.touchedMessageIds);
    expect(JSON.stringify(host.messages)).toContain("PRIVATE_DRAFT");
    expect(JSON.stringify(learner.messages)).not.toContain("PRIVATE_DRAFT");
    expect(JSON.stringify(observer.messages)).not.toContain("PRIVATE_DRAFT");
  });

  test("repository course authority refresh immediately reprojects or disconnects existing sockets", async () => {
    const store = createStorage({ driver: memoryDriver() });
    await store.setItem("course:course_live", { course: { members: [{ accountId: "host", role: "owner" }, { accountId: "teacher", role: "teacher" }] } });
    await withRoomRepositoryStorage(store, async () => {
      const roomId = (await createRoom("host", "Teacher", { title: "Course socket" }, { courseId: "course_live", objectives: [] })).room.id;
      cleanup.add(roomId);
      await joinRoomThroughCourse(roomId, "course_live", "teacher", "Course Teacher", "teacher");
      const teacher = connection((await currentRoom(roomId))!, "teacher");
      teacher.clear();
      await store.setItem("course:course_live", { course: { members: [{ accountId: "host", role: "owner" }, { accountId: "teacher", role: "student" }] } });
      await currentRoom(roomId);
      expect(teacher.messages[0]?.type).toBe("snapshot");
      expect(teacher.messages[0]?.type === "snapshot" && teacher.messages[0].snapshot.viewer.role).toBe("learner");
      teacher.clear();
      await store.setItem("course:course_live", { course: { members: [{ accountId: "host", role: "owner" }] } });
      await currentRoom(roomId);
      expect(teacher.messages[0]?.type).toBe("removed");
      expect(teacher.closed[0]?.code).toBe(4403);
    });
  });

  test("demotion replaces the socket snapshot and excludes previously privileged data", () => {
    const room = change(fixture(), "host", { type: "whisper.post", messageId: "msg_secret", body: "PRIVATE_GUIDANCE" }).room;
    const teacher = connection(room, "teacher");
    teacher.clear();
    const demoted = change(room, "host", { type: "member.role", accountId: "teacher", role: "learner" });
    broadcastRoomChange(demoted.room, demoted.touchedMessageIds);
    expect(teacher.messages[0]?.type).toBe("snapshot");
    expect(JSON.stringify(teacher.messages)).not.toContain("PRIVATE_GUIDANCE");
    expect(teacher.messages[0]?.type === "snapshot" && teacher.messages[0].snapshot.permissions.canOversee).toBe(false);
  });

  test("preview relay fences the browser and checks privacy, live membership, and both leases", () => {
    const room = thinking(fixture());
    const facilitator = connection(room, "host");
    const otherTab = connection(room, "host");
    const teacher = connection(room, "teacher");
    const learner = connection(room, "learner");
    teacher.clear(); learner.clear();
    relayKeatingPreview(room, otherTab.peer, "browser_old", "turn_live", "STALE_PREVIEW");
    expect(teacher.messages).toHaveLength(0);
    relayKeatingPreview(room, facilitator.peer, "browser_live", "turn_live", "PUBLIC_PREVIEW");
    expect(JSON.stringify(learner.messages)).toContain("PUBLIC_PREVIEW");
    const held = { ...room, settings: { ...room.settings, replyReview: "teacher-approves" as const } };
    teacher.clear(); learner.clear();
    const freshConnection = connection(held, "host");
    teacher.clear(); learner.clear();
    relayKeatingPreview(held, freshConnection.peer, "browser_live", "turn_live", "PRIVATE_PREVIEW");
    expect(JSON.stringify(teacher.messages)).toContain("PRIVATE_PREVIEW");
    expect(JSON.stringify(learner.messages)).not.toContain("PRIVATE_PREVIEW");
    teacher.clear(); learner.clear();
    const expired = { ...room, turn: { ...room.turn, leaseExpiresAt: new Date(Date.now() - 1).toISOString() } };
    relayKeatingPreview(expired, otherTab.peer, "browser_live", "turn_live", "EXPIRED_PREVIEW");
    expect(teacher.messages).toHaveLength(0);
    relayKeatingPreview({ ...room, status: "ended" }, otherTab.peer, "browser_live", "turn_live", "ENDED_PREVIEW");
    expect(teacher.messages).toHaveLength(0);
    relayKeatingPreview({ ...room, facilitator: { ...room.facilitator!, heartbeatAt: new Date(Date.now() - 60_000).toISOString() } }, otherTab.peer, "browser_live", "turn_live", "STALE_LEASE");
    expect(teacher.messages).toHaveLength(0);
  });

  test("removing a member closes every connection and removes their presence", () => {
    const room = fixture();
    const first = connection(room, "learner");
    const second = connection(room, "learner");
    const host = connection(room, "host");
    host.clear();
    const removed = change(room, "host", { type: "member.remove", accountId: "learner" });
    broadcastRoomChange(removed.room, removed.touchedMessageIds, removed.removedAccountIds);
    expect(first.closed[0]?.code).toBe(4403);
    expect(second.closed[0]?.code).toBe(4403);
    expect(presentAccountIds(room.id)).toEqual(["host"]);
    expect(host.messages.some((message) => message.type === "presence" && message.accountIds.includes("learner"))).toBe(false);
  });

  test("observers and muted members cannot type, and connection counts are bounded", () => {
    const room = fixture();
    const observer = connection(room, "observer");
    const learner = connection(room, "learner");
    const host = connection(room, "host");
    host.clear();
    relayTyping(room, observer.peer);
    const muted = change(room, "host", { type: "member.mute", accountId: "learner", muted: true }).room;
    relayTyping(muted, learner.peer);
    expect(host.messages).toHaveLength(0);
    const sockets = Array.from({ length: 5 }, () => connection(room, "teacher"));
    expect(sockets[0]?.closed[0]?.code).toBe(4409);
  });
});

function request(body?: BodyInit, headers: Record<string, string> = {}): H3Event {
  return new H3Event(new Request("https://keating.test/api/rooms", { method: "POST", body, headers }));
}

describe("room HTTP request boundaries", () => {
  test("the real API maps async teacher invite denial to 403 and malformed input to 400", async () => {
    const priorHosted = process.env.NOTORGANIC_ENABLED;
    const priorDev = process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
    process.env.NOTORGANIC_ENABLED = "false";
    delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
    setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
    const api = (identity: string, path: string, body: unknown) => roomApi(new H3Event(new Request(`https://keating.test/api/rooms${path}`, {
      method: "POST", headers: { "content-type": "application/json", cookie: `keating_course_account=${identity.repeat(32)}`, origin: "https://keating.test" }, body: JSON.stringify(body),
    })));
    try {
      await withRoomRepositoryStorage(createStorage({ driver: memoryDriver() }), async () => {
        const created = await api("1", "", { title: "HTTP" }) as RoomViewerSnapshot;
        const invitation = await api("1", `/${created.room.id}/invites`, { role: "teacher" }) as { token: string };
        await api("2", `/invites/${invitation.token}`, {});
        await expect(api("2", `/${created.room.id}/invites`, { role: "teacher" })).rejects.toMatchObject({ statusCode: 403, data: { code: "room_forbidden" } });
        await expect(api("1", `/${created.room.id}/invites`, { role: "learner", expiresInHours: 0 })).rejects.toMatchObject({ statusCode: 400 });
        await expect(api("1", "", { title: "Bad", lessonId: "lesson_without_course" })).rejects.toMatchObject({ statusCode: 400 });
      });
    } finally {
      if (priorHosted === undefined) delete process.env.NOTORGANIC_ENABLED; else process.env.NOTORGANIC_ENABLED = priorHosted;
      if (priorDev === undefined) delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID; else process.env.KEATING_COURSES_DEV_ACCOUNT_ID = priorDev;
      setPublicAbuseStoreForTests();
    }
  });

  test("same-origin and originless API requests work; foreign and opaque origins fail", () => {
    expect(() => assertRoomRequestOrigin(request(undefined, { origin: "https://keating.test" }))).not.toThrow();
    expect(() => assertRoomRequestOrigin(request())).not.toThrow();
    expect(() => assertRoomRequestOrigin(request(undefined, { origin: "https://evil.test" }))).toThrow(/same origin/);
    expect(() => assertRoomRequestOrigin(request(undefined, { origin: "null" }))).toThrow(/same origin/);
  });

  test("JSON accepts empty joins and rejects malformed or non-JSON input without reflection", async () => {
    expect(await readRoomBody(request())).toBeUndefined();
    expect(await readRoomBody(request('{"title":"Group"}', { "content-type": "application/json" }))).toEqual({ title: "Group" });
    await expect(readRoomBody(request("SECRET_BAD_JSON", { "content-type": "application/json" }))).rejects.toMatchObject({ statusCode: 400, statusMessage: "Invalid room JSON." });
    await expect(readRoomBody(request("title=Group", { "content-type": "text/plain" }))).rejects.toMatchObject({ statusCode: 415 });
  });

  test("body bounds cover declared lengths and streamed bytes", async () => {
    await expect(readRoomBody(request("{}", { "content-type": "application/json", "content-length": String(ROOM_REQUEST_MAX_BYTES + 1) }))).rejects.toMatchObject({ statusCode: 413 });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(ROOM_REQUEST_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    await expect(readRoomBody(request(stream, { "content-type": "application/json" }))).rejects.toMatchObject({ statusCode: 413 });
  });
});
