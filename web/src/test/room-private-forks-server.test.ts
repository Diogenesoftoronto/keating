import { afterEach, describe, expect, test } from "bun:test";
import { learningSourceHash } from "@keating/learner-contracts";
import type { Peer } from "crossws";
import { getResponseHeader, H3Event } from "h3";
import { createStorage, type StorageValue } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import roomApi from "../../server/api/rooms/[...path]";
import { localCourseAccountIdFromSecret } from "../../server/utils/course-session";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";
import { broadcastRoomChange, broadcastRoomRemoved, connectRoomPeer } from "../../server/utils/room-realtime";
import { ROOM_REQUEST_MAX_BYTES } from "../../server/utils/room-request";
import {
  applyStoredRoomOperation,
  exportRoomTranscript,
  getRoomForAccount,
  getRoomPrivateForkContext,
  joinRoomThroughCourse,
  withRoomRepositoryStorage,
} from "../../server/utils/room-repository";
import {
  ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER,
  ROOM_MAX_PRIVATE_FORK_OFFERS,
  ROOM_TURN_LEASE_MS,
  roomSchema,
  type Room,
  type RoomMessage,
  type RoomOperation,
  type RoomOperationInput,
  type RoomPrivateForkContext,
  type RoomPrivateForkOffer,
  type RoomPrivateForkProposal,
  type RoomPrivateForkSource,
  type RoomRealtimeMessage,
  type RoomViewerSnapshot,
} from "../rooms/contracts";
import {
  applyRoomOperation,
  projectRoomForViewer,
  projectRoomState,
  RoomAuthorizationError,
  RoomConflictError,
  RoomNotFoundError,
  RoomOperationError,
} from "../rooms/operations";

const T0 = "2026-10-24T12:00:00.000Z";
const NOW = Date.parse(T0);
const FACILITATOR = "browser_private_fork";
const MODEL = "Deterministic test model";
const SOURCE = "msg_private_fork_source";
const SOURCE_BODY = "Two quarters have the same value as one half. Explain why.";
const QUOTE = "the same value as one half";
const UNTRUSTED_SEED = "PRIVATE_MODEL_SEED_MUST_NOT_ENTER_THE_ROOM";
let sequence = 0;
const connectedRooms = new Set<string>();
afterEach(() => {
  for (const roomId of connectedRooms) broadcastRoomRemoved(roomId);
  connectedRooms.clear();
});

function fixture(overrides: Partial<Room> = {}): Room {
  return roomSchema.parse({
    schemaVersion: 1, id: `room_private_fork_${++sequence}`, title: "Fractions together",
    topic: "Equivalent fractions", goal: "Explain equivalence", context: { objectives: ["Compare fractions"] },
    hostAccountId: "host", createdAt: T0, updatedAt: T0, revision: 0,
    members: [
      { accountId: "host", displayName: "Host", role: "host", joinedAt: T0, via: "created" },
      { accountId: "teacher", displayName: "Teacher", role: "teacher", joinedAt: T0 },
      { accountId: "maya", displayName: "Maya", role: "learner", joinedAt: T0 },
      { accountId: "sam", displayName: "Sam", role: "learner", joinedAt: T0 },
      { accountId: "observer", displayName: "Observer", role: "observer", joinedAt: T0 },
    ],
    messages: [], nextSeq: 1, settings: {}, turn: { status: "idle", consideredSeq: 0, throughSeq: 0 },
    ...overrides,
  });
}

function operation(room: Pick<Room, "id">, input: RoomOperationInput): RoomOperation {
  return { ...input, id: `op_private_fork_${++sequence}`, roomId: room.id } as RoomOperation;
}

function change(room: Room, actor: string, input: RoomOperationInput, now = T0): Room {
  return applyRoomOperation(room, actor, operation(room, input), now).room;
}

function publicMessage(seq: number, body: string, id = `msg_context_${seq}`): RoomMessage {
  return { id, seq, body, kind: "chat", audience: "room", authorAccountId: "maya", authorName: "Maya", authorRole: "learner", createdAt: T0 };
}

function sourced(room = fixture()): Room {
  return change(room, "maya", { type: "message.post", messageId: SOURCE, body: SOURCE_BODY });
}

function begin(room = sourced()): Room {
  const claimed = change(room, "host", { type: "facilitator.claim", facilitatorId: FACILITATOR, modelLabel: MODEL, takeOver: false });
  return change(claimed, "host", { type: "turn.begin", facilitatorId: FACILITATOR, turnId: `turn_private_fork_${++sequence}`, throughSeq: claimed.nextSeq - 1 });
}

const proposal = (patch: Partial<RoomPrivateForkProposal> = {}): RoomPrivateForkProposal => ({ learnerAccountId: "maya", sourceMessageId: SOURCE, selectedText: QUOTE, ...patch });

function completeInput(room: Room, patch: Partial<Extract<RoomOperationInput, { type: "turn.complete" }>> = {}): Extract<RoomOperationInput, { type: "turn.complete" }> {
  return { type: "turn.complete", facilitatorId: FACILITATOR, turnId: room.turn.turnId!, outcome: "offered-private", model: MODEL, privateFork: proposal(), ...patch };
}

function offered(room = begin()): Room {
  return change(room, "host", completeInput(room));
}

function held(mode: "review" | "paused" = "review"): Room {
  let room = sourced();
  if (mode === "review") room = change(room, "teacher", { type: "settings.update", patch: { replyReview: "teacher-approves" } });
  room = begin(room);
  if (mode === "paused") room = change(room, "teacher", { type: "settings.update", patch: { keating: "paused" } });
  return offered(room);
}

function storedOffer(index: number, patch: Partial<RoomPrivateForkOffer> = {}): RoomPrivateForkOffer {
  return { ...proposal(), id: `offer_capacity_${index}`, createdAt: T0, model: MODEL, status: "pending", selectedText: undefined, ...patch };
}

function connection(room: Room, accountId: string) {
  connectedRooms.add(room.id);
  const messages: RoomRealtimeMessage[] = [];
  const peer = { id: `peer_private_fork_${++sequence}`, send: (body: string) => messages.push(JSON.parse(body) as RoomRealtimeMessage), close() {} } as unknown as Peer;
  connectRoomPeer(room.id, accountId, peer, room);
  messages.length = 0;
  return messages;
}

const newStore = () => createStorage({ driver: memoryDriver() });
async function seed(store: ReturnType<typeof newStore>, room: Room) {
  await store.setItem(`room:${room.id}`, { room });
}

function contextRequest(roomId: string, body: BodyInit = JSON.stringify({ sourceMessageId: SOURCE }), headers: Record<string, string> = {}, identity = "2"): H3Event {
  return new H3Event(new Request(`https://keating.test/api/rooms/${roomId}/private-fork-context`, {
    method: "POST", body,
    headers: { "content-type": "application/json", cookie: `keating_course_account=${identity.repeat(32)}`, origin: "https://keating.test", ...headers },
  }));
}

async function withContextEndpoint(task: (room: Room, store: ReturnType<typeof newStore>) => Promise<void>, now = () => NOW): Promise<void> {
  const priorHosted = process.env.NOTORGANIC_ENABLED;
  const priorDev = process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
  process.env.NOTORGANIC_ENABLED = "false";
  delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
  setPublicAbuseStoreForTests(new MemoryPublicAbuseStore(now));
  try {
    const room = sourced();
    for (const [accountId, identity] of [["maya", "2"], ["sam", "3"]] as const) {
      const localId = await localCourseAccountIdFromSecret(identity.repeat(32));
      room.members.find((member) => member.accountId === accountId)!.accountId = localId;
      for (const message of room.messages) if (message.authorAccountId === accountId) message.authorAccountId = localId;
    }
    const store = newStore();
    await seed(store, room);
    await withRoomRepositoryStorage(store, () => task(room, store), { now });
  } finally {
    if (priorHosted === undefined) delete process.env.NOTORGANIC_ENABLED; else process.env.NOTORGANIC_ENABLED = priorHosted;
    if (priorDev === undefined) delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID; else process.env.KEATING_COURSES_DEV_ACCOUNT_ID = priorDev;
    setPublicAbuseStoreForTests();
  }
}

describe("private fork operation authority and public source provenance", () => {
  test("a current turn creates one learner-addressed offer without publishing a message", () => {
    const current = begin();
    const result = applyRoomOperation(current, "host", operation(current, completeInput(current)), T0);
    expect(result.room.privateForkOffers).toHaveLength(1);
    expect(result.room.privateForkOffers[0]).toMatchObject({ ...proposal(), status: "pending", model: MODEL, createdAt: T0 });
    expect(result.room.privateForkOffers[0]!.id).toBeTruthy();
    expect(result.room.messages).toEqual(current.messages);
    expect(result.touchedMessageIds).toEqual([]);
    expect(result.room.nextSeq).toBe(current.nextSeq);
    expect(result.room.revision).toBe(current.revision + 1);
    expect(result.room.turn).toMatchObject({ status: "idle", consideredSeq: current.turn.throughSeq, lastOutcome: { kind: "offered-private" } });
    expect(current.privateForkOffers).toEqual([]);
  });

  test("a public Keating reply can anchor the offer too", () => {
    const source: RoomMessage = { ...publicMessage(1, SOURCE_BODY, SOURCE), kind: "keating", authorAccountId: undefined, authorName: "Keating", authorRole: "keating" };
    const room = offered(begin(fixture({ messages: [source], nextSeq: 2 })));
    expect(room.privateForkOffers[0]?.sourceMessageId).toBe(SOURCE);
  });

  test("an offer may use a whole message without a selected quote", () => {
    const current = begin();
    const next = change(current, "host", completeInput(current, { privateFork: proposal({ selectedText: undefined }) }));
    expect(next.privateForkOffers[0]).toMatchObject({ sourceMessageId: SOURCE, learnerAccountId: "maya" });
    expect(next.privateForkOffers[0]?.selectedText).toBeUndefined();
  });

  for (const actor of ["maya", "teacher", "observer"]) {
    test(`${actor} cannot complete a turn owned by the host's browser`, () => {
      const current = begin();
      expect(() => change(current, actor, completeInput(current))).toThrow(RoomOperationError);
    });
  }

  test("sibling tabs, replacement leases, wrong turn ids and expired turns reject completion", () => {
    const current = begin();
    expect(() => change(current, "host", completeInput(current, { facilitatorId: "browser_sibling" }))).toThrow(RoomOperationError);
    expect(() => change(current, "host", completeInput(current, { turnId: "turn_other" }))).toThrow(RoomConflictError);
    const replaced = change(current, "host", { type: "facilitator.claim", facilitatorId: "browser_sibling", modelLabel: MODEL, takeOver: true });
    expect(() => change(replaced, "host", completeInput(current))).toThrow(RoomOperationError);
    expect(() => change(current, "host", completeInput(current), new Date(NOW + ROOM_TURN_LEASE_MS + 1).toISOString())).toThrow(RoomOperationError);
    expect(current.privateForkOffers).toEqual([]);
  });

  for (const target of ["host", "teacher", "observer", "not_a_member"]) {
    test(`the current target must be a learner (${target})`, () => {
      const current = begin();
      expect(() => change(current, "host", completeInput(current, { privateFork: proposal({ learnerAccountId: target }) }))).toThrow(RoomOperationError);
    });
  }

  for (const kind of ["missing", "future", "hidden", "whisper", "system"] as const) {
    test(`rejects a ${kind} source, including teacher-readable private text`, () => {
      const current = begin();
      let invalid = structuredClone(current);
      if (kind === "missing") invalid.messages = [];
      if (kind === "future") invalid = change(current, "sam", { type: "message.post", messageId: "msg_after_begin", body: SOURCE_BODY });
      if (kind === "hidden") invalid = change(current, "teacher", { type: "message.hide", messageId: SOURCE, hidden: true });
      if (kind === "whisper") invalid.messages[0] = { ...invalid.messages[0]!, kind: "whisper", audience: "teachers", authorRole: "teacher" };
      if (kind === "system") invalid.messages[0] = { ...invalid.messages[0]!, kind: "system", authorRole: "system" };
      const sourceMessageId = kind === "future" ? "msg_after_begin" : SOURCE;
      expect(() => change(invalid, "host", completeInput(current, { privateFork: proposal({ sourceMessageId }) }))).toThrow(RoomOperationError);
      expect(invalid.privateForkOffers).toEqual([]);
    });
  }

  for (const selectedText of ["", "   ", "The same value as one half", "same value as one half, invented ending"]) {
    test(`rejects a non-exact or empty selection ${JSON.stringify(selectedText)}`, () => {
      const current = begin();
      expect(() => change(current, "host", completeInput(current, { privateFork: proposal({ selectedText }) }))).toThrow(RoomOperationError);
    });
  }

  test("a missing private-fork proposal is rejected atomically", () => {
    const current = begin();
    const before = structuredClone(current);
    expect(() => change(current, "host", completeInput(current, { privateFork: undefined }))).toThrow(RoomOperationError);
    expect(current).toEqual(before);
  });

  test("model-supplied seed text never becomes an offer or a held draft body", () => {
    for (const review of [false, true]) {
      let current = sourced();
      if (review) current = change(current, "host", { type: "settings.update", patch: { replyReview: "teacher-approves" } });
      current = begin(current);
      const next = change(current, "host", completeInput(current, {
        body: UNTRUSTED_SEED,
        detail: UNTRUSTED_SEED,
        privateFork: { ...proposal(), seed: UNTRUSTED_SEED } as RoomPrivateForkProposal,
      }));
      expect(JSON.stringify(next)).not.toContain(UNTRUSTED_SEED);
      expect(next.messages).toEqual(current.messages);
      if (review) expect(next.drafts[0]?.body).toContain(QUOTE);
    }
  });
});

describe("private fork review, deduplication and capacity", () => {
  for (const mode of ["review", "paused"] as const) {
    test(`${mode} holds a source-derived draft and approval creates only an offer`, () => {
      const current = held(mode);
      expect(current.privateForkOffers).toEqual([]);
      expect(current.drafts).toHaveLength(1);
      const draft = current.drafts[0]!;
      expect(draft).toMatchObject({ reason: mode, status: "pending", privateFork: proposal() });
      expect(draft.body).toContain(QUOTE);
      expect(current.turn.lastOutcome?.kind).toBe("drafted");
      expect(projectRoomForViewer(current, "teacher").room.drafts).toHaveLength(1);
      expect(projectRoomForViewer(current, "maya").room.drafts).toEqual([]);
      const next = change(current, "teacher", { type: "draft.resolve", draftId: draft.id, action: "approve" });
      expect(next.privateForkOffers).toHaveLength(1);
      expect(next.privateForkOffers[0]).toMatchObject({ ...proposal(), status: "pending" });
      expect(next.drafts[0]).toMatchObject({ status: "approved", resolvedBy: "teacher", resolvedAt: T0 });
      expect(next.messages).toEqual(current.messages);
      expect(projectRoomForViewer(next, "maya").room.privateForkOffers).toHaveLength(1);
      expect(projectRoomForViewer(next, "teacher").room.privateForkOffers).toEqual([]);
    });
  }

  test("teachers explicitly cannot edit a private-fork draft into arbitrary seed text", () => {
    const current = held();
    expect(() => change(current, "teacher", { type: "draft.resolve", draftId: current.drafts[0]!.id, action: "approve", body: UNTRUSTED_SEED })).toThrow(RoomConflictError);
    expect(current.drafts[0]?.status).toBe("pending");
    expect(current.privateForkOffers).toEqual([]);
  });

  test("rejecting a held proposal creates no offer or public message", () => {
    const current = held();
    const next = change(current, "teacher", { type: "draft.resolve", draftId: current.drafts[0]!.id, action: "reject" });
    expect(next.privateForkOffers).toEqual([]);
    expect(next.drafts[0]?.status).toBe("rejected");
    expect(next.messages).toEqual(current.messages);
  });

  test("repeated pending learner/source/quote proposals reuse the existing offer", () => {
    const current = offered();
    const requested = change(current, "teacher", { type: "turn.request" });
    const next = offered(begin(requested));
    expect(next.privateForkOffers).toEqual(current.privateForkOffers);
    expect(next.messages).toEqual(current.messages);
  });

  test("different learners or exact quotes remain distinct offers", () => {
    let current = offered();
    for (const nextProposal of [proposal({ learnerAccountId: "sam" }), proposal({ selectedText: "Two quarters" })]) {
      current = begin(change(current, "teacher", { type: "turn.request" }));
      current = change(current, "host", completeInput(current, { privateFork: nextProposal }));
    }
    expect(current.privateForkOffers).toHaveLength(3);
    expect(projectRoomForViewer(current, "maya").room.privateForkOffers).toHaveLength(2);
    expect(projectRoomForViewer(current, "sam").room.privateForkOffers).toHaveLength(1);
  });

  for (const capacity of ["per-learner", "total"] as const) {
    test(`${capacity} capacity refuses growth without evicting pending offers`, () => {
      const current = begin();
      const count = capacity === "total" ? ROOM_MAX_PRIVATE_FORK_OFFERS : ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER;
      if (capacity === "total") {
        for (let index = 0; index < 10; index += 1) current.members.push({ accountId: `capacity_learner_${index}`, displayName: `Learner ${index}`, role: "learner", joinedAt: T0, muted: false, via: "invite" });
      }
      current.privateForkOffers = Array.from({ length: count }, (_, index) => {
        const sourceMessageId = `msg_capacity_${index}`;
        current.messages.push(publicMessage(current.nextSeq++, SOURCE_BODY, sourceMessageId));
        return storedOffer(index, { sourceMessageId, ...(capacity === "total" ? { learnerAccountId: `capacity_learner_${index % 10}` } : {}) });
      });
      const before = structuredClone(current.privateForkOffers);
      expect(() => offered(current)).toThrow(RoomConflictError);
      expect(current.privateForkOffers).toEqual(before);
      expect(current.turn.status).toBe("thinking");
    });
  }

  test("deduplication still succeeds at the pending limit", () => {
    const current = begin();
    current.privateForkOffers = Array.from({ length: ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER }, (_, index) => storedOffer(index, { selectedText: index === 0 ? QUOTE : SOURCE_BODY.slice(0, index) }));
    const next = offered(current);
    expect(next.privateForkOffers).toEqual(current.privateForkOffers);
    expect(next.turn.status).toBe("idle");
  });

  test("approval rechecks capacity and preserves the pending draft when full", () => {
    const current = held();
    current.privateForkOffers = Array.from({ length: ROOM_MAX_PENDING_PRIVATE_FORKS_PER_LEARNER }, (_, index) => storedOffer(index, { selectedText: SOURCE_BODY.slice(0, index + 1) }));
    const before = structuredClone(current);
    expect(() => change(current, "teacher", { type: "draft.resolve", draftId: current.drafts[0]!.id, action: "approve" })).toThrow(RoomConflictError);
    expect(current).toEqual(before);
  });
});

describe("private fork invalidation and resolution", () => {
  const invalidations: Array<{ name: string; input: RoomOperationInput }> = [
    { name: "source moderation", input: { type: "message.hide", messageId: SOURCE, hidden: true } },
    { name: "learner removal", input: { type: "member.remove", accountId: "maya" } },
    { name: "learner promotion", input: { type: "member.role", accountId: "maya", role: "teacher" } },
    { name: "learner observer restriction", input: { type: "member.role", accountId: "maya", role: "observer" } },
  ];
  for (const { name, input } of invalidations) {
    test(`${name} makes existing offers and held proposals unusable`, () => {
      const pending = offered();
      const invalid = change(pending, "host", input);
      expect(() => change(invalid, "maya", { type: "private-fork.resolve", offerId: pending.privateForkOffers[0]!.id, action: "open" })).toThrow(RoomOperationError);
      const draftRoom = held();
      const invalidDraft = change(draftRoom, "host", input);
      const before = structuredClone(invalidDraft);
      expect(() => change(invalidDraft, "teacher", { type: "draft.resolve", draftId: draftRoom.drafts[0]!.id, action: "approve" })).toThrow(RoomOperationError);
      expect(invalidDraft).toEqual(before);
    });
  }

  for (const actor of ["host", "teacher", "sam", "observer"]) {
    test(`${actor} cannot resolve another learner's offer`, () => {
      const current = offered();
      for (const action of ["open", "dismiss"] as const) {
        expect(() => change(current, actor, { type: "private-fork.resolve", offerId: current.privateForkOffers[0]!.id, action })).toThrow(RoomAuthorizationError);
      }
      expect(current.privateForkOffers[0]?.status).toBe("pending");
    });
  }

  for (const action of ["open", "dismiss"] as const) {
    test(`only the addressed learner can ${action}, exactly once`, () => {
      const current = offered();
      const offerId = current.privateForkOffers[0]!.id;
      const next = change(current, "maya", { type: "private-fork.resolve", offerId, action });
      expect(next.privateForkOffers[0]).toMatchObject({ status: action === "open" ? "opened" : "dismissed", resolvedAt: T0 });
      expect(next.messages).toEqual(current.messages);
      expect(() => change(next, "maya", { type: "private-fork.resolve", offerId, action })).toThrow(RoomConflictError);
    });
  }
});

describe("private fork snapshots, realtime patches and transcript exports", () => {
  test("only the target learner receives offers in snapshots or realtime patches", () => {
    const current = begin();
    const viewers = ["maya", "sam", "host", "teacher", "observer"];
    const connections = viewers.map((accountId) => connection(current, accountId));
    const next = offered(current);
    const offer = next.privateForkOffers[0]!;
    broadcastRoomChange(next, []);
    viewers.forEach((accountId, index) => {
      const visible = accountId === "maya" ? [offer] : [];
      expect(projectRoomForViewer(next, accountId).room.privateForkOffers).toEqual(visible);
      expect(projectRoomState(next, accountId).room.privateForkOffers).toEqual(visible);
      const patch = connections[index]!.find((message) => message.type === "room.patch");
      expect(patch?.type).toBe("room.patch");
      if (patch?.type !== "room.patch") throw new Error("Expected a projected room patch");
      expect(patch.snapshot.room.privateForkOffers).toEqual(visible);
      expect(patch.messages).toEqual([]);
      if (accountId !== "maya") expect(JSON.stringify(patch)).not.toContain(offer.id);
    });
  });

  test("teachers see held proposals; learners see neither draft bodies nor routing", () => {
    const room = held();
    for (const accountId of ["maya", "sam", "observer"]) {
      const projected = projectRoomForViewer(room, accountId);
      expect(projected.room.drafts).toEqual([]);
      expect(JSON.stringify(projected)).not.toContain(room.drafts[0]!.id);
    }
    for (const accountId of ["host", "teacher"]) expect(projectRoomForViewer(room, accountId).room.drafts[0]?.privateFork).toMatchObject({ ...proposal(), start: SOURCE_BODY.indexOf(QUOTE), end: SOURCE_BODY.indexOf(QUOTE) + QUOTE.length });
  });

  test("transcript exports omit offers and held proposals for every viewer", async () => {
    const room = offered();
    const review = held();
    room.drafts = review.drafts;
    const store = newStore();
    await seed(store, room);
    await withRoomRepositoryStorage(store, async () => {
      for (const accountId of ["maya", "sam", "host", "teacher", "observer"]) {
        const transcript = await exportRoomTranscript(room.id, accountId);
        expect(transcript).toContain(SOURCE_BODY);
        expect(transcript).not.toContain(room.privateForkOffers[0]!.id);
        expect(transcript).not.toContain(room.drafts[0]!.id);
        // The safe draft body is a public quote, so it may appear once in its source.
        expect(transcript!.split(QUOTE).length - 1).toBe(1);
      }
    }, { now: () => NOW });
  });
});

describe("authoritative private fork context repository", () => {
  test("returns a bounded source-anchored public transcript without later or private state", async () => {
    const messages = Array.from({ length: 55 }, (_, index) => publicMessage(index + 1, `Public ${index}: ${"x".repeat(1_100)}`));
    messages[50] = { ...publicMessage(51, SOURCE_BODY, SOURCE), kind: "keating", authorRole: "keating", authorAccountId: undefined, authorName: "Keating" };
    messages[45] = { ...messages[45]!, kind: "whisper", audience: "teachers", body: "PRIVATE_TEACHER_GUIDANCE", authorRole: "teacher" };
    messages[46] = { ...messages[46]!, hidden: { by: "teacher", at: T0 }, body: "HIDDEN_BODY" };
    messages[47] = { ...messages[47]!, kind: "system", authorRole: "system", body: "SYSTEM_EVENT" };
    messages[51] = { ...messages[51]!, body: "LATER_PUBLIC_CONTRIBUTION" };
    const room = fixture({ messages, nextSeq: 56, privateForkOffers: [storedOffer(0)] });
    room.drafts = held().drafts;
    const store = newStore();
    await seed(store, room);
    await withRoomRepositoryStorage(store, async () => {
      const context = await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE, selectedText: QUOTE });
      expect(context).toMatchObject({ roomId: room.id, roomTitle: room.title, topic: room.topic, goal: room.goal, context: room.context, revision: room.revision, sourceSeq: 51, sourceMessageId: SOURCE, selectedText: QUOTE });
      expect(context.messages.length).toBeGreaterThan(0);
      expect(context.messages.length).toBeLessThanOrEqual(40);
      expect(context.messages.reduce((total, message) => total + message.body.length, 0)).toBeLessThanOrEqual(32_000);
      expect(context.messages.some((message) => message.id === SOURCE && message.body === SOURCE_BODY)).toBe(true);
      expect(context.messages.every((message) => message.seq <= 51 && message.audience === "room" && !message.hidden && (message.kind === "chat" || message.kind === "keating"))).toBe(true);
      expect(context.messages.map((message) => message.seq)).toEqual(context.messages.map((message) => message.seq).sort((a, b) => a - b));
      const serialized = JSON.stringify(context);
      for (const secret of ["PRIVATE_TEACHER_GUIDANCE", "HIDDEN_BODY", "SYSTEM_EVENT", "LATER_PUBLIC_CONTRIBUTION", room.drafts[0]!.id, room.privateForkOffers[0]!.id]) expect(serialized).not.toContain(secret);
      for (const key of ["drafts", "privateForkOffers", "invites"]) expect(key in context).toBe(false);
    }, { now: () => NOW });
  });

  test("the 40-message limit retains the selected anchor", async () => {
    const messages = Array.from({ length: 75 }, (_, index) => publicMessage(index + 1, `Short public message ${index}`));
    messages[60] = publicMessage(61, SOURCE_BODY, SOURCE);
    const room = fixture({ messages, nextSeq: 76 });
    const store = newStore();
    await seed(store, room);
    await withRoomRepositoryStorage(store, async () => {
      const context = await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE });
      expect(context.messages.length).toBeLessThanOrEqual(40);
      expect(context.messages.some((message) => message.id === SOURCE)).toBe(true);
      expect(context.messages.every((message) => message.seq <= 61)).toBe(true);
    }, { now: () => NOW });
  });

  test("manual context is a read: no revision, activity, offer or operation receipt changes", async () => {
    const room = sourced();
    const store = newStore();
    await seed(store, room);
    const before = await store.getItem(`room:${room.id}`);
    const keys = await store.getKeys();
    const activity = connection(room, "maya");
    let writes = 0;
    const originalSetItem = store.setItem.bind(store);
    store.setItem = async (...[key, value, options]: Parameters<typeof store.setItem>) => { writes += 1; return originalSetItem(key, value, options); };
    await withRoomRepositoryStorage(store, async () => {
      await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE, selectedText: QUOTE });
      await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE });
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
      expect(await store.getKeys()).toEqual(keys);
      expect(writes).toBe(0);
      expect(activity).toEqual([]);
      expect((await getRoomForAccount(room.id, "maya"))?.room).toMatchObject({ revision: room.revision, updatedAt: room.updatedAt, nextSeq: room.nextSeq, privateForkOffers: [] });
    }, { now: () => NOW + 60_000 });
  });

  test("missing rooms and nonmembers fail without leaking context", async () => {
    const room = sourced();
    const store = newStore();
    await seed(store, room);
    await withRoomRepositoryStorage(store, async () => {
      await expect(getRoomPrivateForkContext("room_missing", "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
      await expect(getRoomPrivateForkContext(room.id, "outsider", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
    }, { now: () => NOW });
  });

  test("freshly hidden sources and mismatching quotes cannot be forked", async () => {
    const room = sourced();
    const store = newStore();
    await seed(store, room);
    await withRoomRepositoryStorage(store, async () => {
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE, selectedText: "invented quote" })).rejects.toBeInstanceOf(RoomConflictError);
      await applyStoredRoomOperation("host", operation(room, { type: "message.hide", messageId: SOURCE, hidden: true }));
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomConflictError);
      await expect(getRoomPrivateForkContext(room.id, "host", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomConflictError);
    }, { now: () => NOW });
  });

  test("revoked course membership is checked fresh without persisting synchronization", async () => {
    const room = sourced();
    room.context.courseId = "course_private_fork";
    room.members.find((member) => member.accountId === "maya")!.via = "course";
    const store = newStore();
    await seed(store, room);
    await store.setItem("course:course_private_fork", { course: { members: [{ accountId: "host", role: "owner" }, { accountId: "maya", role: "student" }] } });
    await withRoomRepositoryStorage(store, async () => {
      await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE });
      const before = await store.getItem(`room:${room.id}`);
      await store.setItem("course:course_private_fork", { course: { members: [{ accountId: "host", role: "owner" }] } });
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
    }, { now: () => NOW });
  });

  for (const courseRole of ["teacher", "removed"] as const) {
    test(`course ${courseRole} changes invalidate pending proposals before resolution`, async () => {
      const room = offered();
      room.context.courseId = "course_private_fork";
      room.members.find((member) => member.accountId === "maya")!.via = "course";
      room.drafts = held().drafts;
      const store = newStore();
      await seed(store, room);
      await store.setItem("course:course_private_fork", { course: { members: [{ accountId: "host", role: "owner" }, { accountId: "maya", role: "student" }] } });
      await withRoomRepositoryStorage(store, async () => {
        await getRoomForAccount(room.id, "maya");
        await store.setItem("course:course_private_fork", { course: { members: [
          { accountId: "host", role: "owner" }, ...(courseRole === "teacher" ? [{ accountId: "maya", role: "teacher" }] : []),
        ] } });
        await expect(applyStoredRoomOperation("maya", operation(room, { type: "private-fork.resolve", offerId: room.privateForkOffers[0]!.id, action: "open" }))).rejects.toBeInstanceOf(RoomOperationError);
        const persisted = (await store.getItem<{ room: Room }>(`room:${room.id}`))!.room;
        expect(persisted.privateForkOffers.every((offer) => offer.status !== "pending")).toBe(true);
        expect(persisted.drafts.every((draft) => draft.status !== "pending")).toBe(true);
        expect(persisted.messages).toEqual(room.messages);
      }, { now: () => NOW });
    });
  }

  test("a context read waits behind moderation under the room lock", async () => {
    const room = sourced();
    const store = newStore();
    await seed(store, room);
    let writeStarted!: () => void;
    let releaseWrite!: () => void;
    const started = new Promise<void>((resolve) => { writeStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const originalSetItem = store.setItem.bind(store);
    store.setItem = async (...[key, value, options]: Parameters<typeof store.setItem>) => {
      if (key === `room:${room.id}`) { writeStarted(); await gate; }
      return originalSetItem(key, value, options);
    };
    await withRoomRepositoryStorage(store, async () => {
      const moderation = applyStoredRoomOperation("host", operation(room, { type: "message.hide", messageId: SOURCE, hidden: true }));
      await started;
      const pending = getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE }).then(
        (context) => ({ context, error: undefined }),
        (error: unknown) => ({ context: undefined, error }),
      );
      try { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
      finally { releaseWrite(); }
      await moderation;
      const result = await pending;
      expect(result.context).toBeUndefined();
      expect(result.error).toBeInstanceOf(RoomConflictError);
    }, { now: () => NOW });
  });
});

describe("private fork context follows independent room role grants", () => {
  const courseId = "course_private_fork_grants";
  const courseKey = `course:${courseId}`;

  async function courseMembers(store: ReturnType<typeof newStore>, includeMaya: boolean) {
    await store.setItem(courseKey, { course: { members: [
      { accountId: "host", role: "owner" }, ...(includeMaya ? [{ accountId: "maya", role: "student" }] : []),
    ] } });
  }

  async function joinedCourseRoom(store: ReturnType<typeof newStore>): Promise<Room> {
    const room = fixture({ context: { courseId, objectives: ["Compare fractions"] } });
    room.members = room.members.filter((member) => member.accountId !== "maya");
    await seed(store, room);
    await courseMembers(store, true);
    const joined = await joinRoomThroughCourse(room.id, courseId, "maya", "Maya", "learner");
    expect(joined.snapshot.viewer).toMatchObject({ accountId: "maya", role: "learner", via: "course" });
    return (await applyStoredRoomOperation("maya", operation(room, { type: "message.post", messageId: SOURCE, body: SOURCE_BODY }))).room;
  }

  async function offerThroughRepository(room: Room, learnerAccountId = "maya"): Promise<Room> {
    let current = (await applyStoredRoomOperation("host", operation(room, { type: "facilitator.claim", facilitatorId: FACILITATOR, modelLabel: MODEL, takeOver: false }))).room;
    current = (await applyStoredRoomOperation("host", operation(current, { type: "turn.begin", facilitatorId: FACILITATOR, turnId: `turn_course_grant_${++sequence}`, throughSeq: current.nextSeq - 1 }))).room;
    return (await applyStoredRoomOperation("host", operation(current, completeInput(current, { privateFork: proposal({ learnerAccountId }) })))).room;
  }

  test("an explicit learner grant survives course removal for snapshots, manual context, offer targeting and resolution", async () => {
    const store = newStore();
    let room!: Room;
    await withRoomRepositoryStorage(store, async () => {
      room = await joinedCourseRoom(store);
      room = (await applyStoredRoomOperation("host", operation(room, { type: "member.role", accountId: "maya", role: "learner" }))).room;
      expect((await store.getItem<{ memberRestrictions: unknown[] }>(`room:${room.id}`))!.memberRestrictions).toContainEqual({ accountId: "maya", role: "learner" });
      await courseMembers(store, false);
    }, { now: () => NOW });
    await withRoomRepositoryStorage(store, async () => {
      const before = await store.getItem(`room:${room.id}`);
      const activity = connection(room, "host");
      const context = await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE, selectedText: QUOTE });
      expect(context).toMatchObject({ roomId: room.id, sourceMessageId: SOURCE, selectedText: QUOTE });
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
      expect(activity).toEqual([]);
      const snapshot = await getRoomForAccount(room.id, "maya");
      expect(snapshot?.viewer).toMatchObject({ role: "learner", via: "course" });
      expect(snapshot?.permissions.canPost).toBe(true);
      room = await offerThroughRepository(room);
      expect(room.privateForkOffers).toHaveLength(1);
      expect(room.privateForkOffers[0]).toMatchObject({ learnerAccountId: "maya", status: "pending" });
      const resolved = await applyStoredRoomOperation("maya", operation(room, { type: "private-fork.resolve", offerId: room.privateForkOffers[0]!.id, action: "open" }));
      expect(resolved.applied).toBe(true);
      expect(resolved.snapshot?.room.privateForkOffers[0]?.status).toBe("opened");
    }, { now: () => NOW + 1_000 });
  });

  test("an explicit teacher grant survives course removal for context and oversight but cannot resolve another learner's offer", async () => {
    const store = newStore();
    await withRoomRepositoryStorage(store, async () => {
      let room = await joinedCourseRoom(store);
      room = (await applyStoredRoomOperation("host", operation(room, { type: "member.role", accountId: "maya", role: "teacher" }))).room;
      expect((await store.getItem<{ memberRestrictions: unknown[] }>(`room:${room.id}`))!.memberRestrictions).toContainEqual({ accountId: "maya", role: "teacher", muted: false });
      await courseMembers(store, false);
      const before = await store.getItem(`room:${room.id}`);
      const activity = connection(room, "host");
      expect(await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).toMatchObject({ roomId: room.id, sourceMessageId: SOURCE });
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
      expect(activity).toEqual([]);
      const snapshot = await getRoomForAccount(room.id, "maya");
      expect(snapshot?.viewer).toMatchObject({ role: "teacher", via: "course" });
      expect(snapshot?.permissions.canOversee).toBe(true);
      const guidance = await applyStoredRoomOperation("maya", operation(room, { type: "whisper.post", messageId: "msg_explicit_teacher_guidance", body: "Ask Sam for a diagram." }));
      expect(guidance.room.messages.at(-1)).toMatchObject({ kind: "whisper", audience: "teachers", authorAccountId: "maya" });
      room = await offerThroughRepository(guidance.room, "sam");
      await expect(applyStoredRoomOperation("maya", operation(room, { type: "private-fork.resolve", offerId: room.privateForkOffers[0]!.id, action: "open" }))).rejects.toBeInstanceOf(RoomAuthorizationError);
      const resolved = await applyStoredRoomOperation("sam", operation(room, { type: "private-fork.resolve", offerId: room.privateForkOffers[0]!.id, action: "dismiss" }));
      expect(resolved.room.privateForkOffers[0]?.status).toBe("dismissed");
    }, { now: () => NOW });
  });

  test("course removal without a room role grant revokes context, snapshot and operation access", async () => {
    const store = newStore();
    await withRoomRepositoryStorage(store, async () => {
      const room = await offerThroughRepository(await joinedCourseRoom(store));
      await courseMembers(store, false);
      const before = await store.getItem(`room:${room.id}`);
      const activity = connection(room, "host");
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
      expect(activity).toEqual([]);
      expect(await getRoomForAccount(room.id, "maya")).toBeNull();
      await expect(applyStoredRoomOperation("maya", operation(room, { type: "message.post", messageId: "msg_revoked_course", body: "No longer a member" }))).rejects.toBeInstanceOf(RoomNotFoundError);
      await expect(applyStoredRoomOperation("maya", operation(room, { type: "private-fork.resolve", offerId: room.privateForkOffers[0]!.id, action: "open" }))).rejects.toBeInstanceOf(RoomNotFoundError);
    }, { now: () => NOW });
  });

  test("a mute-only room restriction does not preserve course-derived access after removal", async () => {
    const store = newStore();
    await withRoomRepositoryStorage(store, async () => {
      let room = await joinedCourseRoom(store);
      room = (await applyStoredRoomOperation("host", operation(room, { type: "member.mute", accountId: "maya", muted: true }))).room;
      expect((await store.getItem<{ memberRestrictions: unknown[] }>(`room:${room.id}`))!.memberRestrictions).toEqual([{ accountId: "maya", muted: true }]);
      expect(await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).toMatchObject({ sourceMessageId: SOURCE });
      await courseMembers(store, false);
      const before = await store.getItem(`room:${room.id}`);
      const activity = connection(room, "host");
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
      expect(activity).toEqual([]);
      expect(await getRoomForAccount(room.id, "maya")).toBeNull();
      await expect(applyStoredRoomOperation("maya", operation(room, { type: "message.post", messageId: "msg_muted_revoked_course", body: "No independent grant" }))).rejects.toBeInstanceOf(RoomNotFoundError);
    }, { now: () => NOW });
  });

  test("durable room removal overrides an explicit grant across restart, including a stale retained roster row", async () => {
    const store = newStore();
    let room!: Room;
    let offerId = "";
    let grantedMember!: Room["members"][number];
    await withRoomRepositoryStorage(store, async () => {
      room = await joinedCourseRoom(store);
      room = (await applyStoredRoomOperation("host", operation(room, { type: "member.role", accountId: "maya", role: "learner" }))).room;
      await courseMembers(store, false);
      expect(await getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).toMatchObject({ sourceMessageId: SOURCE });
      room = await offerThroughRepository(room);
      offerId = room.privateForkOffers[0]!.id;
      grantedMember = structuredClone(room.members.find((member) => member.accountId === "maya")!);
      room = (await applyStoredRoomOperation("host", operation(room, { type: "member.remove", accountId: "maya" }))).room;
      const record = await store.getItem<{ blockedAccountIds: string[]; memberRestrictions: unknown[] }>(`room:${room.id}`);
      expect(record!.blockedAccountIds).toContain("maya");
      expect(record!.memberRestrictions).toContainEqual({ accountId: "maya", role: "learner" });
    }, { now: () => NOW });
    await withRoomRepositoryStorage(store, async () => {
      const before = await store.getItem(`room:${room.id}`);
      const activity = connection(room, "host");
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
      expect(await store.getItem(`room:${room.id}`)).toEqual(before);
      expect(activity).toEqual([]);
      expect(await getRoomForAccount(room.id, "maya")).toBeNull();
      await expect(applyStoredRoomOperation("maya", operation(room, { type: "private-fork.resolve", offerId, action: "open" }))).rejects.toBeInstanceOf(RoomNotFoundError);
      await courseMembers(store, true);
      await expect(joinRoomThroughCourse(room.id, courseId, "maya", "Returning Maya", "learner")).rejects.toMatchObject({ code: "room_removed" });
      // The durable block must also dominate a stale retained room roster entry.
      const retained = (await store.getItem<{ room: Room; blockedAccountIds: string[] }>(`room:${room.id}`))!;
      retained.room.members.push(grantedMember);
      await store.setItem(`room:${room.id}`, retained);
    }, { now: () => NOW + 1_000 });
    await withRoomRepositoryStorage(store, async () => {
      const blockedBefore = await store.getItem(`room:${room.id}`);
      await expect(getRoomPrivateForkContext(room.id, "maya", { sourceMessageId: SOURCE })).rejects.toBeInstanceOf(RoomNotFoundError);
      expect(await store.getItem(`room:${room.id}`)).toEqual(blockedBefore);
    }, { now: () => NOW + 1_000 });
  });
});

describe("private fork exact UTF-16 source anchors", () => {
  const repeatedBody = "🧠 echo / echo 🌱";
  const repeatedQuote = "echo";
  const repeatedHash = learningSourceHash(repeatedBody);
  const uniqueStart = SOURCE_BODY.indexOf(QUOTE);
  const uniqueEnd = uniqueStart + QUOTE.length;
  const withSource = (body: string) => fixture({ messages: [publicMessage(1, body, SOURCE)], nextSeq: 2 });

  for (const start of [repeatedBody.indexOf(repeatedQuote), repeatedBody.lastIndexOf(repeatedQuote)]) {
    test(`an exact repeated quotation at UTF-16 offset ${start} anchors the intended occurrence`, async () => {
      const current = begin(withSource(repeatedBody));
      const source: RoomPrivateForkSource = { sourceMessageId: SOURCE, selectedText: repeatedQuote, start, end: start + repeatedQuote.length, sourceHash: repeatedHash };
      const next = change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }));
      expect(next.privateForkOffers[0]).toMatchObject({ ...source, learnerAccountId: "maya", status: "pending" });
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        const context = await getRoomPrivateForkContext(current.id, "maya", source);
        expect(context).toMatchObject(source);
        expect(context.messages.find((message) => message.id === SOURCE)?.body.slice(context.start!, context.end!)).toBe(repeatedQuote);
      }, { now: () => NOW });
    });
  }

  for (const { body, selectedText } of [
    { body: repeatedBody, selectedText: repeatedQuote },
    { body: "aaaa", selectedText: "aaa" },
  ]) {
    test(`a repeated quote ${JSON.stringify(selectedText)} without offsets is ambiguous, including overlapping matches`, async () => {
      const current = begin(withSource(body));
      const source = { sourceMessageId: SOURCE, selectedText };
      expect(() => change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }))).toThrow(RoomConflictError);
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        await expect(getRoomPrivateForkContext(current.id, "maya", source)).rejects.toBeInstanceOf(RoomConflictError);
      }, { now: () => NOW });
    });
  }

  const invalidRanges: Array<{ name: string; patch: Partial<RoomPrivateForkSource> }> = [
    { name: "only start", patch: { start: uniqueStart } },
    { name: "only end", patch: { end: uniqueEnd } },
    { name: "offsets without selectedText", patch: { selectedText: undefined, start: uniqueStart, end: uniqueEnd } },
    { name: "negative start", patch: { start: -1, end: uniqueEnd } },
    { name: "negative end", patch: { start: uniqueStart, end: -1 } },
    { name: "fractional start", patch: { start: uniqueStart + 0.5, end: uniqueEnd } },
    { name: "fractional end", patch: { start: uniqueStart, end: uniqueEnd + 0.5 } },
    { name: "end after the message", patch: { start: uniqueStart, end: SOURCE_BODY.length + 1 } },
    { name: "start after the message", patch: { start: SOURCE_BODY.length + 1, end: SOURCE_BODY.length + 2 } },
    { name: "reversed range", patch: { start: uniqueEnd, end: uniqueStart } },
    { name: "empty range", patch: { start: uniqueStart, end: uniqueStart } },
    { name: "range whose text does not match", patch: { start: uniqueStart + 1, end: uniqueEnd + 1 } },
  ];
  for (const { name, patch } of invalidRanges) {
    test(`rejects ${name} through completion and context boundaries`, async () => {
      const current = begin();
      const before = structuredClone(current);
      const source: RoomPrivateForkSource = { sourceMessageId: SOURCE, selectedText: QUOTE, ...patch };
      expect(() => change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }))).toThrow(RoomOperationError);
      expect(current).toEqual(before);
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        // Invalid numeric shapes may be rejected by the source schema itself.
        await expect(getRoomPrivateForkContext(current.id, "maya", source)).rejects.toThrow();
      }, { now: () => NOW });
    });
  }

  for (const { start, end, explicit } of [
    { start: 1, end: 2, explicit: true }, { start: 2, end: 3, explicit: true },
    { start: 1, end: 2, explicit: false }, { start: 2, end: 3, explicit: false },
  ]) {
    test(`rejects a surrogate-pair split at ${explicit ? "explicit" : "inferred"} UTF-16 range [${start}, ${end})`, async () => {
      const body = "a🧠b";
      const source: RoomPrivateForkSource = { sourceMessageId: SOURCE, selectedText: body.slice(start, end), ...(explicit ? { start, end } : {}) };
      const current = begin(withSource(body));
      expect(() => change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }))).toThrow(RoomConflictError);
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        await expect(getRoomPrivateForkContext(current.id, "maya", source)).rejects.toBeInstanceOf(RoomConflictError);
      }, { now: () => NOW });
    });
  }

  for (const { start, end } of [{ start: 1, end: 3 }, { start: 0, end: 4 }]) {
    test(`accepts intact Unicode and edge bounds at UTF-16 range [${start}, ${end})`, async () => {
      const body = "a🧠b";
      const source: RoomPrivateForkSource = { sourceMessageId: SOURCE, selectedText: body.slice(start, end), start, end, sourceHash: learningSourceHash(body) };
      const current = begin(withSource(body));
      const next = change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }));
      expect(next.privateForkOffers[0]).toMatchObject(source);
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        expect(await getRoomPrivateForkContext(current.id, "maya", source)).toMatchObject(source);
      }, { now: () => NOW });
    });
  }

  for (const selectedText of [QUOTE, undefined]) {
    const kind = selectedText === undefined ? "whole-message" : "selected";
    test(`accepts a matching full-source hash for ${kind} context and returns canonical anchors`, async () => {
      const current = begin();
      const source = { sourceMessageId: SOURCE, selectedText, sourceHash: learningSourceHash(SOURCE_BODY) };
      const next = change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }));
      expect(next.privateForkOffers[0]).toMatchObject(source);
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        const context = await getRoomPrivateForkContext(current.id, "maya", source);
        expect(context).toMatchObject(source);
        if (selectedText === undefined) {
          expect(context.start).toBeUndefined();
          expect(context.end).toBeUndefined();
        } else {
          expect(context).toMatchObject({ start: uniqueStart, end: uniqueEnd });
          expect(next.privateForkOffers[0]).toMatchObject({ start: uniqueStart, end: uniqueEnd });
        }
      }, { now: () => NOW });
    });

    test(`rejects a stale full-source hash for a ${kind} source`, async () => {
      const current = begin();
      // The selected quotation is unchanged; the rest of the revision differs.
      const source = { sourceMessageId: SOURCE, selectedText, sourceHash: learningSourceHash(SOURCE_BODY + " ") };
      expect(() => change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }))).toThrow(RoomConflictError);
      const store = newStore();
      await seed(store, current);
      await withRoomRepositoryStorage(store, async () => {
        await expect(getRoomPrivateForkContext(current.id, "maya", source)).rejects.toBeInstanceOf(RoomConflictError);
      }, { now: () => NOW });
    });
  }

  test("context computes the full source hash and canonical range when the caller omits them", async () => {
    const current = sourced();
    const store = newStore();
    await seed(store, current);
    await withRoomRepositoryStorage(store, async () => {
      expect(await getRoomPrivateForkContext(current.id, "maya", { sourceMessageId: SOURCE, selectedText: QUOTE })).toMatchObject({ selectedText: QUOTE, start: uniqueStart, end: uniqueEnd, sourceHash: learningSourceHash(SOURCE_BODY) });
      const whole = await getRoomPrivateForkContext(current.id, "maya", { sourceMessageId: SOURCE });
      expect(whole.sourceHash).toBe(learningSourceHash(SOURCE_BODY));
      expect(whole.start).toBeUndefined();
      expect(whole.end).toBeUndefined();
    }, { now: () => NOW });
  });

  test("same-text occurrences are distinct offers while the same exact range deduplicates", () => {
    let current = begin(withSource(repeatedBody));
    const firstStart = repeatedBody.indexOf(repeatedQuote);
    const secondStart = repeatedBody.lastIndexOf(repeatedQuote);
    const offerIds: string[] = [];
    for (const start of [firstStart, secondStart, firstStart]) {
      const source = { sourceMessageId: SOURCE, selectedText: repeatedQuote, start, end: start + repeatedQuote.length, sourceHash: repeatedHash };
      current = change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }));
      if (offerIds.length === 0) offerIds.push(current.privateForkOffers[0]!.id);
      else if (offerIds.length === 1) offerIds.push(current.privateForkOffers[1]!.id);
      current = begin(change(current, "teacher", { type: "turn.request" }));
    }
    expect(current.privateForkOffers.map((offer) => offer.start)).toEqual([firstStart, secondStart]);
    expect(current.privateForkOffers.map((offer) => offer.id)).toEqual(offerIds);
    expect(new Set(offerIds).size).toBe(2);
  });

  for (const explicitFirst of [false, true]) {
    test(`inferred and explicit forms of one unique range deduplicate (${explicitFirst ? "explicit" : "inferred"} first)`, () => {
      let current = begin();
      const inferred = proposal();
      const explicit = proposal({ start: uniqueStart, end: uniqueEnd, sourceHash: learningSourceHash(SOURCE_BODY) });
      const forms = explicitFirst ? [explicit, inferred] : [inferred, explicit];
      current = change(current, "host", completeInput(current, { privateFork: forms[0] }));
      const offers = structuredClone(current.privateForkOffers);
      current = begin(change(current, "teacher", { type: "turn.request" }));
      current = change(current, "host", completeInput(current, { privateFork: forms[1] }));
      expect(current.privateForkOffers).toEqual(offers);
      expect(current.privateForkOffers[0]).toMatchObject({ selectedText: QUOTE, start: uniqueStart, end: uniqueEnd });
    });
  }

  test("held drafts preserve the second occurrence and hash through approval and reject a stale revision", () => {
    let current = change(withSource(repeatedBody), "teacher", { type: "settings.update", patch: { replyReview: "teacher-approves" } });
    current = begin(current);
    const start = repeatedBody.lastIndexOf(repeatedQuote);
    const source = { sourceMessageId: SOURCE, selectedText: repeatedQuote, start, end: start + repeatedQuote.length, sourceHash: repeatedHash };
    current = change(current, "host", completeInput(current, { privateFork: { ...source, learnerAccountId: "maya" } }));
    expect(current.privateForkOffers).toEqual([]);
    expect(current.drafts[0]?.privateFork).toMatchObject(source);
    const stale = structuredClone(current);
    stale.messages.find((message) => message.id === SOURCE)!.body += " ";
    expect(() => change(stale, "teacher", { type: "draft.resolve", draftId: current.drafts[0]!.id, action: "approve" })).toThrow(RoomOperationError);
    expect(stale.privateForkOffers).toEqual([]);
    const approved = change(current, "teacher", { type: "draft.resolve", draftId: current.drafts[0]!.id, action: "approve" });
    expect(approved.privateForkOffers).toHaveLength(1);
    expect(approved.privateForkOffers[0]).toMatchObject({ ...source, learnerAccountId: "maya" });
    expect(approved.messages).toEqual(current.messages);
  });
});

describe("private fork operation receipts across repository restart", () => {
  test("concurrent private-offer completion applies once and a restart preserves its content-bound receipt", async () => {
    const current = begin();
    const store = newStore();
    await seed(store, current);
    const completion = operation(current, completeInput(current));
    let persisted: StorageValue = null;
    let offerId = "";
    await withRoomRepositoryStorage(store, async () => {
      const results = await Promise.all([applyStoredRoomOperation("host", completion), applyStoredRoomOperation("host", completion)]);
      expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
      for (const result of results) {
        expect(result.room.privateForkOffers).toHaveLength(1);
        expect(result.room.revision).toBe(current.revision + 1);
        expect(result.room.messages).toEqual(current.messages);
        expect(result.touchedMessageIds).toEqual([]);
      }
      offerId = results[0]!.room.privateForkOffers[0]!.id;
      persisted = await store.getItem(`room:${current.id}`);
      expect((await store.getItem<{ operationReceipts: unknown[] }>(`room:${current.id}`))!.operationReceipts).toHaveLength(1);
    }, { now: () => NOW });
    // A new scope discards repository locks/cache while retaining the durable store.
    await withRoomRepositoryStorage(store, async () => {
      const replay = await applyStoredRoomOperation("host", completion);
      expect(replay.applied).toBe(false);
      expect(replay.room.privateForkOffers.map((offer) => offer.id)).toEqual([offerId]);
      expect(replay.room.revision).toBe(current.revision + 1);
      expect(replay.touchedMessageIds).toEqual([]);
      await expect(applyStoredRoomOperation("host", { ...completion, privateFork: proposal({ learnerAccountId: "sam" }) } as RoomOperation)).rejects.toMatchObject({ code: "room_operation_reused" });
      expect(await store.getItem(`room:${current.id}`)).toEqual(persisted);
      expect((await getRoomForAccount(current.id, "maya"))!.room.privateForkOffers.map((offer) => offer.id)).toEqual([offerId]);
    }, { now: () => NOW + ROOM_TURN_LEASE_MS + 1 });
  });

  for (const action of ["open", "dismiss"] as const) {
    test(`a private-fork ${action} retry survives restart and cannot be reused by another account`, async () => {
      const current = offered();
      const store = newStore();
      await seed(store, current);
      const resolution = operation(current, { type: "private-fork.resolve", offerId: current.privateForkOffers[0]!.id, action });
      let persisted: StorageValue = null;
      await withRoomRepositoryStorage(store, async () => {
        const results = await Promise.all([applyStoredRoomOperation("maya", resolution), applyStoredRoomOperation("maya", resolution)]);
        expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
        expect(results.every((result) => result.room.revision === current.revision + 1)).toBe(true);
        expect(results[0]!.room.privateForkOffers[0]).toMatchObject({ status: action === "open" ? "opened" : "dismissed", resolvedAt: T0 });
        persisted = await store.getItem(`room:${current.id}`);
      }, { now: () => NOW });
      await withRoomRepositoryStorage(store, async () => {
        const retry = await applyStoredRoomOperation("maya", resolution);
        expect(retry.applied).toBe(false);
        expect(retry.room.messages).toEqual(current.messages);
        expect(retry.touchedMessageIds).toEqual([]);
        await expect(applyStoredRoomOperation("maya", { ...resolution, action: action === "open" ? "dismiss" : "open" } as RoomOperation)).rejects.toMatchObject({ code: "room_operation_reused" });
        await expect(applyStoredRoomOperation("host", resolution)).rejects.toBeInstanceOf(RoomAuthorizationError);
        expect(await store.getItem(`room:${current.id}`)).toEqual(persisted);
        expect((await store.getItem<{ operationReceipts: unknown[] }>(`room:${current.id}`))!.operationReceipts).toHaveLength(1);
      }, { now: () => NOW + 60_000 });
    });
  }

  test("a retried private-draft approval never duplicates an offer after restart", async () => {
    const current = held();
    const store = newStore();
    await seed(store, current);
    const approval = operation(current, { type: "draft.resolve", draftId: current.drafts[0]!.id, action: "approve" });
    let persisted: StorageValue = null;
    await withRoomRepositoryStorage(store, async () => {
      const results = await Promise.all([applyStoredRoomOperation("teacher", approval), applyStoredRoomOperation("teacher", approval)]);
      expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
      expect(results[0]!.room.privateForkOffers).toHaveLength(1);
      expect(results[0]!.room.drafts[0]?.status).toBe("approved");
      expect(results[0]!.room.messages).toEqual(current.messages);
      persisted = await store.getItem(`room:${current.id}`);
    }, { now: () => NOW });
    await withRoomRepositoryStorage(store, async () => {
      const retry = await applyStoredRoomOperation("teacher", approval);
      expect(retry.applied).toBe(false);
      expect(retry.room.revision).toBe(current.revision + 1);
      expect(retry.room.privateForkOffers).toHaveLength(1);
      expect(retry.touchedMessageIds).toEqual([]);
      expect(await store.getItem(`room:${current.id}`)).toEqual(persisted);
    }, { now: () => NOW + 60_000 });
  });
});

describe("private fork context HTTP boundary", () => {
  test("the context endpoint rejects a declared body over the byte limit", async () => {
    await withContextEndpoint(async (room) => {
      await expect(roomApi(contextRequest(room.id, JSON.stringify({ sourceMessageId: SOURCE }), { "content-length": String(ROOM_REQUEST_MAX_BYTES + 1) }))).rejects.toMatchObject({ statusCode: 413, data: { code: "room_request_too_large" } });
    });
  });

  test("the context endpoint rejects and cancels an oversized stream despite a small declared length", async () => {
    await withContextEndpoint(async (room) => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(ROOM_REQUEST_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); },
        cancel() { cancelled = true; },
      });
      await expect(roomApi(contextRequest(room.id, stream, { "content-length": "2" }))).rejects.toMatchObject({ statusCode: 413, data: { code: "room_request_too_large" } });
      expect(cancelled).toBe(true);
    });
  });

  test("the context endpoint accepts valid JSON at the exact declared and streamed byte limit", async () => {
    await withContextEndpoint(async (room) => {
      const json = JSON.stringify({ sourceMessageId: SOURCE, selectedText: QUOTE });
      const bytes = new TextEncoder().encode(json + " ".repeat(ROOM_REQUEST_MAX_BYTES - json.length));
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, 32_000)); controller.enqueue(bytes.subarray(32_000)); controller.close(); } });
      const context = await roomApi(contextRequest(room.id, stream, { "content-length": String(ROOM_REQUEST_MAX_BYTES), "content-type": "application/json; charset=utf-8" })) as RoomPrivateForkContext;
      expect(context).toMatchObject({ roomId: room.id, sourceMessageId: SOURCE, selectedText: QUOTE });
      expect(context.messages.map((message) => message.id)).toEqual([SOURCE]);
    });
  });

  test("the context endpoint requires JSON media type even for a valid JSON body", async () => {
    await withContextEndpoint(async (room) => {
      await expect(roomApi(contextRequest(room.id, JSON.stringify({ sourceMessageId: SOURCE }), { "content-type": "text/plain" }))).rejects.toMatchObject({ statusCode: 415, data: { code: "room_invalid_request" } });
    });
  });

  test("the context endpoint rejects malformed JSON without reflecting its contents", async () => {
    await withContextEndpoint(async (room) => {
      await expect(roomApi(contextRequest(room.id, "PRIVATE_MALFORMED_JSON"))).rejects.toMatchObject({ statusCode: 400, statusMessage: "Invalid room JSON.", data: { code: "room_invalid_request" } });
    });
  });

  test("the actual context quota allows 60 per account per minute across rooms and preserves other buckets", async () => {
    let now = NOW;
    await withContextEndpoint(async (room, store) => {
      const otherRoom = { ...room, id: `room_private_fork_quota_${++sequence}` };
      await seed(store, otherRoom);
      const before = await store.getItem(`room:${room.id}`);
      const contexts: RoomPrivateForkContext[] = [];
      for (let index = 0; index < 60; index += 1) contexts.push(await roomApi(contextRequest(room.id)) as RoomPrivateForkContext);
      expect(contexts).toHaveLength(60);
      expect(contexts.every((context) => context.sourceMessageId === SOURCE && context.roomId === room.id)).toBe(true);
      const blocked = contextRequest(room.id);
      await expect(roomApi(blocked)).rejects.toMatchObject({ statusCode: 429 });
      expect(getResponseHeader(blocked, "Retry-After")).toBe("60");
      await expect(roomApi(contextRequest(otherRoom.id))).rejects.toMatchObject({ statusCode: 429 });
      const otherAccount = await roomApi(contextRequest(room.id, JSON.stringify({ sourceMessageId: SOURCE }), {}, "3")) as RoomPrivateForkContext;
      expect(otherAccount.roomId).toBe(room.id);
      // Exhausting context quota does not spend the account's room-operation bucket.
      const requestTurn = operation(room, { type: "message.post", messageId: "msg_after_context_quota", body: "Another public question" });
      const ownAccount = room.members.find((member) => member.accountId.startsWith("local_") && member.displayName === "Maya")!.accountId;
      const post = new H3Event(new Request(`https://keating.test/api/rooms/${room.id}/operations`, {
        method: "POST", headers: { "content-type": "application/json", cookie: `keating_course_account=${"2".repeat(32)}`, origin: "https://keating.test" }, body: JSON.stringify(requestTurn),
      }));
      expect((await store.getItem(`room:${room.id}`))).toEqual(before);
      const posted = await roomApi(post) as RoomViewerSnapshot;
      expect(posted.room.messages.at(-1)).toMatchObject({ id: "msg_after_context_quota", authorAccountId: ownAccount });
      now = NOW + 59_999;
      const almostReset = contextRequest(room.id);
      await expect(roomApi(almostReset)).rejects.toMatchObject({ statusCode: 429 });
      expect(getResponseHeader(almostReset, "Retry-After")).toBe("1");
      now = NOW + 60_000;
      const reset = await roomApi(contextRequest(room.id)) as RoomPrivateForkContext;
      expect(reset.roomId).toBe(room.id);
      expect(reset.messages.map((message) => message.id)).toEqual([SOURCE]);
    }, () => now);
  });

  test("the real POST API returns context directly and maps invalid, private and unauthorized sources", async () => {
    const priorHosted = process.env.NOTORGANIC_ENABLED;
    const priorDev = process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
    process.env.NOTORGANIC_ENABLED = "false";
    delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
    setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
    const api = (identity: string, path: string, body?: unknown, method = "POST", origin = "https://keating.test") => roomApi(new H3Event(new Request(`https://keating.test/api/rooms${path}`, {
      method, headers: { "content-type": "application/json", cookie: `keating_course_account=${identity.repeat(32)}`, origin },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    })));
    try {
      await withRoomRepositoryStorage(newStore(), async () => {
        const host = await api("1", "", { title: "Private fork API", topic: "Fractions" }) as RoomViewerSnapshot;
        const roomId = host.room.id;
        const invite = await api("1", `/${roomId}/invites`, { role: "learner", maxUses: 3 }) as { token: string };
        await api("2", `/invites/${invite.token}`, {});
        await api("3", `/invites/${invite.token}`, {});
        const post = operation(host.room, { type: "message.post", messageId: SOURCE, body: SOURCE_BODY });
        await api("2", `/${roomId}/operations`, post);
        const path = `/${roomId}/private-fork-context`;
        const context = await api("2", path, { sourceMessageId: SOURCE, selectedText: QUOTE, seed: UNTRUSTED_SEED }) as RoomPrivateForkContext;
        expect(context).toMatchObject({ roomId, roomTitle: "Private fork API", sourceMessageId: SOURCE, selectedText: QUOTE });
        expect(context.messages.some((message) => message.id === SOURCE && message.body === SOURCE_BODY)).toBe(true);
        expect(JSON.stringify(context)).not.toContain(UNTRUSTED_SEED);
        expect("snapshot" in context).toBe(false);
        await expect(api("4", path, { sourceMessageId: SOURCE, accountId: host.viewer.accountId })).rejects.toMatchObject({ statusCode: 404 });
        await expect(api("2", path, {})).rejects.toMatchObject({ statusCode: 400 });
        await expect(api("2", path, { sourceMessageId: SOURCE, selectedText: "" })).rejects.toMatchObject({ statusCode: 400 });
        await expect(api("2", path, { sourceMessageId: SOURCE, selectedText: "fabricated" })).rejects.toMatchObject({ statusCode: 409 });
        await expect(api("2", path, { sourceMessageId: "msg_nonexistent" })).rejects.toMatchObject({ statusCode: 409 });
        await expect(api("2", path, undefined, "GET")).rejects.toMatchObject({ statusCode: 405 });
        await expect(api("2", path, { sourceMessageId: SOURCE }, "POST", "https://foreign.test")).rejects.toMatchObject({ statusCode: 403 });
        await api("1", `/${roomId}/operations`, operation(host.room, { type: "whisper.post", messageId: "msg_api_whisper", body: "PRIVATE_API_GUIDANCE" }));
        await expect(api("2", path, { sourceMessageId: "msg_api_whisper" })).rejects.toMatchObject({ statusCode: 409 });
        await api("1", `/${roomId}/operations`, operation(host.room, { type: "message.hide", messageId: SOURCE, hidden: true }));
        await expect(api("2", path, { sourceMessageId: SOURCE })).rejects.toMatchObject({ statusCode: 409 });
      }, { now: () => NOW });
    } finally {
      if (priorHosted === undefined) delete process.env.NOTORGANIC_ENABLED; else process.env.NOTORGANIC_ENABLED = priorHosted;
      if (priorDev === undefined) delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID; else process.env.KEATING_COURSES_DEV_ACCOUNT_ID = priorDev;
      setPublicAbuseStoreForTests();
    }
  });
});
