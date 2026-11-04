import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { learningSourceHash } from "@keating/learner-contracts";
import { IDBFactory } from "fake-indexeddb";
import { courseSchema, type CourseViewerSnapshot } from "../courses/contracts";
import { createLessonPrivateForkSessionAdapter, type LessonPrivateForkContext } from "../courses/private-fork-session";
import { buildSessionSnapshotRecord } from "../hooks/agent/session-snapshot";
import { SessionsStore, SettingsStore } from "../keating/app-storage";
import { FlueConversation } from "../keating/flue/conversation";
import { toModelMessages } from "../keating/flue/model-messages";
import { learningMessageSource } from "../keating/learning-intelligence/source-navigation";
import {
  createPrivateForkSessionWriter,
  isPrivateForkContextMessage,
  PRIVATE_FORK_CONTEXT_MAX_CHARS,
  PRIVATE_FORK_QUOTE_MAX_CHARS,
  type PrivateForkContextMessage,
  type PrivateForkSessionDependencies,
} from "../keating/private-fork-provenance";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";
import type { RoomMessage, RoomPrivateForkContext } from "../rooms/contracts";
import { createRoomPrivateForkSessionAdapter } from "../rooms/private-fork-session";
import type { SessionData } from "../types/session";

const TIME = "2026-10-24T12:00:00.000Z";
const NOW = Date.parse(TIME);
const MODEL: Model<Api> = {
  id: "private-fork-fixture", name: "Configured fixture model", api: "openai-completions", provider: "fixture",
  baseUrl: "https://model.invalid", reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const READING = "Before 🧠: kinetic energy depends on speed.\n\nKeep the original attribution.";
let originalIndexedDB: PropertyDescriptor | undefined;
let nextSession = 0;

beforeEach(() => {
  originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  nextSession = 0;
});
afterEach(() => {
  if (originalIndexedDB) Object.defineProperty(globalThis, "indexedDB", originalIndexedDB);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});

// Use independent store/backend instances against the same database to exercise
// durable reads, including separate writers standing in for separate tabs.
function openStores() {
  const sessions = new SessionsStore();
  const settings = new SettingsStore();
  const backend = new IndexedDBStorageBackend({
    dbName: "private-fork-session-test", version: 1,
    stores: [sessions.getConfig(), SessionsStore.getMetadataConfig(), settings.getConfig()],
  });
  sessions.setBackend(backend);
  settings.setBackend(backend);
  return { sessions, settings, backend };
}

function harness(overrides: Partial<PrivateForkSessionDependencies> = {}, stores = openStores()) {
  const calls = { init: 0, model: 0, ids: 0, notifications: 0 };
  const writer = createPrivateForkSessionWriter({
    init: async () => { calls.init++; },
    sessions: stores.sessions, settings: stores.settings,
    resolveModel: async () => { calls.model++; return structuredClone(MODEL); },
    thinkingLevel: () => "medium", now: () => NOW,
    newId: () => { calls.ids++; return `private_session_${++nextSession}`; },
    notify: () => { calls.notifications++; },
    ...overrides,
  });
  return { ...stores, calls, writer, room: createRoomPrivateForkSessionAdapter(writer) };
}

function message(id: string, seq: number, body: string, extra: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id, seq, body, kind: "chat", authorName: "Maya", authorRole: "learner",
    authorAccountId: "learner_maya", audience: "room", createdAt: TIME, ...extra,
  };
}

function roomContext(extra: Partial<RoomPrivateForkContext> = {}): RoomPrivateForkContext {
  return {
    roomId: "room_energy", roomTitle: "Energy discussion", topic: "Energy", goal: "Explain speed and energy",
    revision: 7, sourceMessageId: "message_anchor", sourceSeq: 2,
    selectedText: "kinetic energy", context: { objectives: ["Explain the relationship"] },
    messages: [
      message("message_before", 1, "What changes when speed doubles?", { authorName: "Rowan", authorRole: "teacher" }),
      message("message_anchor", 2, READING),
    ],
    ...extra,
  };
}

function courseSnapshot(reading = READING): CourseViewerSnapshot {
  const course = courseSchema.parse({
    schemaVersion: 1, id: "course_energy", title: "Authoritative energy course", ownerAccountId: "teacher_rowan",
    createdAt: TIME, updatedAt: TIME, revision: 11, settings: {},
    modules: [{ id: "module_energy", title: "Motion", lessons: [{
      id: "lesson_speed", title: "Authoritative speed lesson", reading,
      summary: "PRIVATE_LESSON_SUMMARY", objectives: ["PRIVATE_OBJECTIVE"],
      exercise: { id: "exercise_speed", prompt: "PRIVATE_EXERCISE" },
    }] }],
    members: [{
      accountId: "learner_maya", displayName: "Maya", role: "student", joinedAt: TIME, teacherAccess: "full",
      progress: { activeLessonId: "lesson_speed", completedLessonIds: ["lesson_speed"], lastActiveAt: TIME },
    }],
    sharedNotes: [{ id: "note_private", lessonId: "lesson_speed", title: "PRIVATE_NOTE", text: "PRIVATE_NOTE_BODY", version: 1, updatedAt: TIME, updatedBy: "learner_maya" }],
    submissions: [{ id: "submission_private", lessonId: "lesson_speed", exerciseId: "exercise_speed", accountId: "learner_maya", answer: "PRIVATE_SUBMISSION", sharedWithPeers: true, version: 1, updatedAt: TIME }],
    comments: [{ id: "comment_private", accountId: "learner_maya", body: "PRIVATE_COURSE_COMMENT", createdAt: TIME }],
  });
  return {
    course, viewer: course.members[0]!,
    permissions: { canEditCourse: false, canInvite: false, canReview: false, canEditDeck: true, canRequestTeacherAccess: true },
  };
}

function lessonContext(reading = READING, extra: Partial<LessonPrivateForkContext> = {}): LessonPrivateForkContext {
  return {
    courseId: "course_energy", courseTitle: "Untrusted displayed course title", lessonId: "lesson_speed",
    lessonTitle: "Untrusted displayed lesson title", revision: 11, reading, selectedText: "kinetic energy", ...extra,
  };
}

function lessonAdapter(h: ReturnType<typeof harness>, snapshot = courseSnapshot()) {
  const reads: string[] = [];
  return {
    reads,
    create: createLessonPrivateForkSessionAdapter({ writer: h.writer, getCourse: async id => { reads.push(id); return snapshot; } }),
  };
}

async function load(id: string): Promise<SessionData> {
  const data = await openStores().sessions.loadSession(id);
  expect(data).not.toBeNull();
  if (!data) throw new Error(`Missing persisted session ${id}`);
  return data;
}

function imported(data: SessionData): PrivateForkContextMessage {
  expect(data.messages[0]?.role).toBe("user");
  expect(isPrivateForkContextMessage(data.messages[0])).toBe(true);
  return data.messages[0] as PrivateForkContextMessage;
}

function jsonRoundTrip<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

async function continueSession(id: string, text = "My own follow-up about speed") {
  const existing = await load(id);
  const ownTurn: AgentMessage = { role: "user", content: text, timestamp: NOW + 1_000 };
  const record = buildSessionSnapshotRecord({
    sessionId: id, createdAt: existing.createdAt, now: new Date(NOW + 1_000).toISOString(),
    model: existing.model, thinkingLevel: existing.thinkingLevel, messages: [...existing.messages, ownTurn],
    existing, ancestry: undefined,
  });
  await openStores().sessions.save(jsonRoundTrip(record.data), jsonRoundTrip(record.metadata));
  return load(id);
}

async function expectEmpty(h: ReturnType<typeof harness>) {
  expect(await h.sessions.list()).toEqual([]);
  expect(await h.sessions.getAllMetadata()).toEqual([]);
  expect(await h.settings.list()).toEqual([]);
  expect(h.calls.notifications).toBe(0);
}

describe("room private continuation persistence", () => {
  test("imports attributed public context through the anchor, with exact provenance and no shared/private state", async () => {
    const configured = Object.assign(structuredClone(MODEL), {
      headers: { Authorization: "FIXTURE_ONLY_AUTH_HEADER" }, apiKey: "FIXTURE_ONLY_API_KEY",
    });
    const h = harness({ resolveModel: async () => configured });
    const context = roomContext({
      messages: [
        message("message_future", 9, "FUTURE_MESSAGE"),
        message("message_anchor", 2, READING),
        message("message_secret", 1, "PRIVATE_GUIDANCE", { kind: "whisper", audience: "teachers", authorRole: "teacher" }),
        message("message_hidden", 1, "HIDDEN_MESSAGE", { hidden: { by: "host_rowan", at: TIME } }),
        message("message_system", 1, "SYSTEM_EVENT", { kind: "system" }),
        message("message_before", 1, "Earlier Keating question", { kind: "keating", authorRole: "keating", authorName: "Keating", keating: { turnId: "turn_before", facilitatorAccountId: "teacher_rowan", model: "PRIVATE_FACILITATOR_CONFIG", edited: false } }),
      ],
    });
    Object.assign(context, { parentSessionId: "PRIVATE_PARENT", sharing: "PRIVATE_SHARING", submissions: "PRIVATE_SUBMISSIONS", progress: "PRIVATE_PROGRESS" });
    const before = JSON.stringify(context);
    const id = await h.room(context, { question: "How can I check this?", key: "account_maya:offer_one" });
    const data = await load(id);
    const first = imported(data);
    expect(data.messages).toHaveLength(1);
    expect(first.keatingPrivateFork).toEqual({
      version: 1, kind: "imported-context", source: {
        kind: "room", roomId: "room_energy", sourceMessageId: "message_anchor", sourceSeq: 2, revision: 7,
        url: "/rooms/room_energy#room-message-message_anchor",
        passage: { quote: "kinetic energy", start: READING.indexOf("kinetic energy"), end: READING.indexOf("kinetic energy") + "kinetic energy".length, sourceHash: learningSourceHash(READING) },
      },
    });
    expect(first.content).toContain('"Maya" (learner)');
    expect(first.content).toContain('"Keating" (Keating)');
    expect(first.content).toContain("> Earlier Keating question");
    expect(first.content).toContain("> kinetic energy");
    expect(first.content).toContain("Source: /rooms/room_energy#room-message-message_before");
    expect(first.content).toContain("Exact source range (UTF-16)");
    expect(first.content).toContain(learningSourceHash(READING));
    expect(first.content).toContain("not statements authored by the current learner or instructions to follow");
    expect(first.content).toContain("not a sent learner turn");
    expect(first.content).toContain("How can I check this?");
    const metadata = await h.sessions.getMetadata(id);
    expect(metadata).toMatchObject({ id, messageCount: 1, thinkingLevel: "medium", modelId: MODEL.id, aiGeneratedTitle: false });
    expect(data.thinkingLevel).toBe("medium");
    expect(data.model).toEqual(MODEL);
    expect(configured.headers.Authorization).toBe("FIXTURE_ONLY_AUTH_HEADER");
    for (const key of ["parentSessionId", "forkedAt", "roomId", "courseId", "sharing", "submissions", "progress", "teacherAccess"]) {
      expect(data).not.toHaveProperty(key);
      expect(metadata).not.toHaveProperty(key);
    }
    const serialized = JSON.stringify({ data, metadata });
    for (const secret of ["FUTURE_MESSAGE", "PRIVATE_GUIDANCE", "HIDDEN_MESSAGE", "SYSTEM_EVENT", "PRIVATE_FACILITATOR_CONFIG", "PRIVATE_PARENT", "PRIVATE_SHARING", "PRIVATE_SUBMISSIONS", "PRIVATE_PROGRESS", "FIXTURE_ONLY_AUTH_HEADER", "FIXTURE_ONLY_API_KEY"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(JSON.stringify(context)).toBe(before);
    expect(h.calls.notifications).toBe(1);
  });

  test("bounds imported history and composer focus while retaining the chosen point", async () => {
    const h = harness();
    const earlier = Array.from({ length: 40 }, (_, i) => message(`message_${i + 1}`, i + 1, `earlier_${i + 1}: ${"x".repeat(7_900)}`));
    const context = roomContext({ sourceSeq: 41, messages: [...earlier, message("message_anchor", 41, READING)] });
    const id = await h.room(context, { question: "F".repeat(4_000) });
    const data = await load(id);
    const content = imported(data).content as string;
    expect(content.length).toBeLessThanOrEqual(PRIVATE_FORK_CONTEXT_MAX_CHARS);
    expect(data.title.length).toBeLessThanOrEqual(160);
    expect(content).toContain("earlier loaded message(s) omitted");
    expect(content).not.toContain("> earlier_1:");
    expect(content).toContain("> earlier_40:");
    expect(content).toContain("> kinetic energy");
    expect(content).not.toContain("F".repeat(2_001));
    expect(content).not.toContain("x".repeat(2_001));
  });

  const invalidRooms: [string, (context: RoomPrivateForkContext) => void][] = [
    ["missing anchor", c => { c.messages = c.messages.filter(m => m.id !== c.sourceMessageId); }],
    ["duplicate anchor", c => { c.messages.push(structuredClone(c.messages[1]!)); }],
    ["hidden anchor", c => { c.messages[1]!.hidden = { by: "host_rowan", at: TIME }; }],
    ["private anchor", c => { c.messages[1]!.audience = "teachers"; }],
    ["whisper anchor", c => { c.messages[1]!.kind = "whisper"; }],
    ["system anchor", c => { c.messages[1]!.kind = "system"; }],
    ["stale sequence", c => { c.sourceSeq++; }],
    ["stale selected text", c => { c.selectedText = "text removed since selection"; }],
    ["ambiguous selected text", c => { c.messages[1]!.body = "kinetic energy and kinetic energy"; }],
    ["duplicate previous identity", c => { c.messages.unshift(structuredClone(c.messages[0]!)); }],
    ["duplicate previous sequence", c => { c.messages.unshift(message("message_other", 1, "Another speaker")); }],
    ["empty selection", c => { c.selectedText = "  "; }],
    ["stale source hash", c => { c.sourceHash = learningSourceHash(`${READING} changed`); }],
    ["mismatched offsets", c => { c.start = 0; c.end = "kinetic energy".length; }],
    ["unsafe source identifier", c => { c.roomId = "../other"; }],
    ["invalid revision", c => { c.revision = -1; }],
  ];
  test.each(invalidRooms)("rejects %s before writing or resolving a model", async (_name, change) => {
    const h = harness();
    const context = roomContext();
    change(context);
    await expect(h.room(context, { key: "offer_invalid" })).rejects.toThrow();
    await expectEmpty(h);
    expect(h.calls.model).toBe(0);
  });

  test("repeated room quotes require an exact range and matching full-source hash", async () => {
    const h = harness();
    const body = "🧠 kinetic energy; then kinetic energy again";
    const start = body.lastIndexOf("kinetic energy");
    const context = roomContext({ messages: [message("message_anchor", 2, body)], start, end: start + 14, sourceHash: learningSourceHash(body) });
    const data = await load(await h.room(context));
    expect(imported(data).keatingPrivateFork.source.passage).toEqual({ quote: "kinetic energy", start, end: start + 14, sourceHash: learningSourceHash(body) });
    await expect(h.room({ ...context, sourceHash: learningSourceHash(`${body}!`) }, { key: "stale_hash" })).rejects.toThrow("changed");
    expect(await h.sessions.list()).toEqual([data.id]);
    expect(await h.settings.list()).toEqual([]);
  });
});

describe("durable private branch identity and failures", () => {
  test("a stable key reopens an appended branch across writers and later room revisions without resetting it", async () => {
    const h = harness();
    const key = "account_maya:offer_stable";
    const id = await h.room(roomContext(), { key });
    const continued = await continueSession(id);
    const next = harness({ resolveModel: async () => { throw new Error("Reopen must not need a model"); } });
    expect(await next.room(roomContext({ revision: 8 }), { key, question: "Different composer focus" })).toBe(id);
    expect(await load(id)).toEqual(continued);
    expect(next.calls.ids).toBe(0);
    expect(next.calls.notifications).toBe(0);
    expect((await next.sessions.getMetadata(id))?.messageCount).toBe(2);
    expect(await h.room(roomContext())).not.toBe(id);
  });

  test("a key cannot reopen a different source, passage, or changed original text", async () => {
    const h = harness();
    const key = "account_maya:offer_identity";
    const id = await h.room(roomContext(), { key });
    const continued = await continueSession(id);
    const changedBody = roomContext();
    changedBody.messages[1]!.body += " changed";
    const changedPassage = roomContext({ selectedText: "speed" });
    const changedSource = roomContext({ sourceMessageId: "message_other", messages: [message("message_other", 2, READING)] });
    for (const context of [changedBody, changedPassage, changedSource]) {
      await expect(h.room(context, { key })).rejects.toThrow("different source");
    }
    expect(await load(id)).toEqual(continued);
    expect(await h.sessions.list()).toEqual([id]);
  });

  test("concurrent calls on one writer converge on one persisted session and one notification", async () => {
    const h = harness();
    const ids = await Promise.all(Array.from({ length: 12 }, () => h.room(roomContext(), { key: "same_key" })));
    expect(new Set(ids).size).toBe(1);
    expect(await h.sessions.list()).toEqual([ids[0]!]);
    expect(await h.sessions.getAllMetadata()).toHaveLength(1);
    expect(h.calls.model).toBe(1);
    expect(h.calls.ids).toBe(1);
    expect(h.calls.notifications).toBe(1);
  });

  test("without cross-tab locks a delayed competing writer never overwrites a continued branch", async () => {
    const storesA = openStores(), storesB = openStores();
    let releaseModel!: () => void;
    let enteredModel!: () => void;
    const modelGate = new Promise<void>(resolve => { releaseModel = resolve; });
    const modelEntered = new Promise<void>(resolve => { enteredModel = resolve; });
    const a = harness({}, storesA);
    const b = harness({ resolveModel: async () => { enteredModel(); await modelGate; return structuredClone(MODEL); } }, storesB);
    const key = "account_maya:racing_offer";
    // B has already observed the missing mapping before A creates and continues.
    const pending = b.room(roomContext(), { key });
    await modelEntered;
    const firstId = await a.room(roomContext(), { key });
    const continued = await continueSession(firstId, "CONTINUATION_MUST_SURVIVE_RACE");
    releaseModel();
    const secondId = await pending;
    expect(secondId).not.toBe(firstId);
    expect(await load(firstId)).toEqual(continued);
    expect((await load(secondId)).messages).toHaveLength(1);
    expect(await storesA.sessions.list()).toHaveLength(2);
    expect(await a.room(roomContext(), { key })).toBe(secondId);
    expect(await load(firstId)).toEqual(continued);
  });

  test("a failed real paired save leaves no mapping or half-session, and the same key can retry", async () => {
    const stores = openStores();
    let fail = true;
    const h = harness({ sessions: {
      loadSession: id => stores.sessions.loadSession(id),
      save: async (data, metadata) => {
        if (fail) {
          fail = false;
          // Inject the failure after the first real IndexedDB write, proving
          // transaction rollback rather than substituting an in-memory store.
          await stores.backend.transaction(["sessions", "sessions-metadata"], "readwrite", async tx => {
            await tx.set("sessions", data.id, data);
            throw new Error("Injected session save failure");
          });
        }
        await stores.sessions.save(data, metadata);
      },
    } }, stores);
    await expect(h.room(roomContext(), { key: "retry_offer" })).rejects.toThrow("Injected session save failure");
    await expectEmpty(h);
    const id = await h.room(roomContext(), { key: "retry_offer" });
    expect((await load(id)).messages).toHaveLength(1);
    expect(await h.sessions.list()).toEqual([id]);
    expect(await h.settings.list()).toHaveLength(1);
    expect(h.calls.notifications).toBe(1);
  });

  test.each(["missing model setup", "invalid resolved model"])("%s saves neither session nor mapping", async problem => {
    const h = harness({ resolveModel: async () => {
      if (problem === "missing model setup") throw new Error("Connect a model first");
      return { ...MODEL, id: "" };
    } });
    await expect(h.room(roomContext(), { key: "model_failure" })).rejects.toThrow();
    await expectEmpty(h);
    expect(h.calls.ids).toBe(0);
  });
});

describe("lesson private continuation source validation", () => {
  test("uses fresh authoritative reading/titles and persists only the selected source, without course writes or private metadata", async () => {
    const h = harness();
    const snapshot = courseSnapshot();
    const before = JSON.stringify(snapshot);
    const adapter = lessonAdapter(h, snapshot);
    const context = lessonContext();
    Object.assign(context, { parentSessionId: "PRIVATE_PARENT", sharing: "PRIVATE_SHARING", progress: "PRIVATE_PROGRESS" });
    const id = await adapter.create(context, { key: "account_maya:lesson_speed", question: "Help me reason through it" });
    const data = await load(id);
    const first = imported(data);
    expect(adapter.reads).toEqual(["course_energy"]);
    expect(data.messages).toHaveLength(1);
    expect(first.keatingPrivateFork.source).toEqual({
      kind: "lesson", courseId: "course_energy", lessonId: "lesson_speed", revision: 11, field: "reading",
      url: "/courses/course_energy?lesson=lesson_speed#lesson-reading-lesson_speed",
      passage: { quote: "kinetic energy", start: READING.indexOf("kinetic energy"), end: READING.indexOf("kinetic energy") + 14, sourceHash: learningSourceHash(READING) },
    });
    expect(first.content).toContain("Authoritative energy course");
    expect(first.content).toContain("Authoritative speed lesson");
    expect(first.content).toContain("> kinetic energy");
    expect(first.content).toContain("[Open lesson reading](/courses/course_energy?lesson=lesson_speed#lesson-reading-lesson_speed)");
    expect(first.content).not.toContain("Untrusted displayed");
    const metadata = await h.sessions.getMetadata(id);
    const serialized = JSON.stringify({ data, metadata });
    for (const secret of ["PRIVATE_LESSON_SUMMARY", "PRIVATE_OBJECTIVE", "PRIVATE_EXERCISE", "PRIVATE_NOTE", "PRIVATE_NOTE_BODY", "PRIVATE_SUBMISSION", "PRIVATE_COURSE_COMMENT", "PRIVATE_PARENT", "PRIVATE_SHARING", "PRIVATE_PROGRESS", "teacherAccess", "completedLessonIds", "sharedWithPeers"]) {
      expect(serialized).not.toContain(secret);
    }
    for (const key of ["parentSessionId", "forkedAt", "courseId", "lessonId", "progress", "submissions", "sharing"]) {
      expect(data).not.toHaveProperty(key);
      expect(metadata).not.toHaveProperty(key);
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  const invalidLessons: [string, (context: LessonPrivateForkContext, snapshot: CourseViewerSnapshot) => void][] = [
    ["stale course revision", (_c, s) => { s.course.revision++; }],
    ["changed exact reading", (_c, s) => { s.course.modules[0]!.lessons[0]!.reading += " "; }],
    ["missing course identity", (_c, s) => { s.course.id = "course_other"; }],
    ["missing lesson", (_c, s) => { s.course.modules[0]!.lessons = []; }],
    ["duplicate lesson", (_c, s) => { s.course.modules[0]!.lessons.push(structuredClone(s.course.modules[0]!.lessons[0]!)); }],
    ["stale selected text", c => { c.selectedText = "an old removed selection"; }],
    ["stale full-source hash", c => { c.sourceHash = learningSourceHash(`${READING} changed`); }],
    ["wrong source range", c => { c.start = 0; c.end = 14; }],
    ["partial source range", c => { c.start = READING.indexOf("kinetic energy"); }],
    ["range without selected text", c => { delete c.selectedText; c.start = 0; c.end = 3; }],
    ["empty selected text", c => { c.selectedText = "\n "; }],
    ["fractional revision", c => { c.revision = 1.5; }],
    ["unsafe lesson identifier", c => { c.lessonId = "../lesson"; }],
  ];
  test.each(invalidLessons)("rejects %s without persisting a session or touching branch mappings", async (_name, change) => {
    const h = harness();
    const context = lessonContext(), snapshot = courseSnapshot();
    change(context, snapshot);
    await expect(lessonAdapter(h, snapshot).create(context, { key: "lesson_invalid" })).rejects.toThrow();
    await expectEmpty(h);
    expect(h.calls.model).toBe(0);
  });

  test("rechecks the displayed revision after an in-flight authoritative read", async () => {
    const h = harness();
    const snapshot = courseSnapshot();
    const context = lessonContext();
    const adapter = createLessonPrivateForkSessionAdapter({ writer: h.writer, getCourse: async () => {
      snapshot.course.revision++;
      context.revision = snapshot.course.revision;
      return snapshot;
    } });
    await expect(adapter(context)).rejects.toThrow("course has changed");
    await expectEmpty(h);
  });

  test("a fresh course read failure cannot create or map a private session", async () => {
    const h = harness();
    const adapter = createLessonPrivateForkSessionAdapter({ writer: h.writer, getCourse: async () => { throw new Error("Course unavailable"); } });
    await expect(adapter(lessonContext(), { key: "offline_lesson" })).rejects.toThrow("Course unavailable");
    await expectEmpty(h);
  });

  test("repeated lesson quotations use exact UTF-16 offsets and a full reading hash", async () => {
    const h = harness();
    const reading = "🧠 energy; e\u0301; energy 🧪";
    const adapter = lessonAdapter(h, courseSnapshot(reading));
    const context = lessonContext(reading, { selectedText: "energy" });
    await expect(adapter.create(context)).rejects.toThrow("ambiguous");
    const start = reading.lastIndexOf("energy");
    const data = await load(await adapter.create({ ...context, start, end: start + 6, sourceHash: learningSourceHash(reading) }));
    expect(imported(data).keatingPrivateFork.source.passage).toEqual({ quote: "energy", start, end: start + 6, sourceHash: learningSourceHash(reading) });
  });

  test.each([
    { name: "start within an emoji", selectedText: "\udca1", start: 2, end: 3 },
    { name: "end within an emoji", selectedText: "\ud83d", start: 1, end: 2 },
  ])("rejects a source range whose $name splits a surrogate pair", async ({ selectedText, start, end }) => {
    const h = harness();
    const reading = "A💡B";
    await expect(lessonAdapter(h, courseSnapshot(reading)).create(lessonContext(reading, { selectedText, start, end, sourceHash: learningSourceHash(reading) }))).rejects.toThrow("source range");
    await expectEmpty(h);
  });

  test("a whole emoji and a combining-character quote preserve original code-unit offsets", async () => {
    const h = harness();
    const reading = "A💡 e\u0301 B";
    const selectedText = "💡 e\u0301", start = 1, end = start + selectedText.length;
    const data = await load(await lessonAdapter(h, courseSnapshot(reading)).create(lessonContext(reading, { selectedText, start, end })));
    expect(imported(data).keatingPrivateFork.source.passage).toEqual({ quote: selectedText, start, end, sourceHash: learningSourceHash(reading) });
  });

  test("a full long reading is bounded without splitting an emoji or hashing only the excerpt", async () => {
    const h = harness();
    const reading = `${"a".repeat(PRIVATE_FORK_QUOTE_MAX_CHARS - 1)}💡TRAILING_UNIMPORTED_READING`;
    const data = await load(await lessonAdapter(h, courseSnapshot(reading)).create(lessonContext(reading, { selectedText: undefined })));
    const passage = imported(data).keatingPrivateFork.source.passage;
    expect(passage).toEqual({ quote: "a".repeat(PRIVATE_FORK_QUOTE_MAX_CHARS - 1), start: 0, end: PRIVATE_FORK_QUOTE_MAX_CHARS - 1, sourceHash: learningSourceHash(reading), truncated: true });
    expect(imported(data).content).not.toContain("TRAILING_UNIMPORTED_READING");
    expect((imported(data).content as string).length).toBeLessThanOrEqual(PRIVATE_FORK_CONTEXT_MAX_CHARS);
  });

  test("an 8,000-character selection with many blank paragraphs remains valid quoted context", async () => {
    const h = harness();
    const reading = "a\n\n".repeat(2_666) + "ab";
    expect(reading.length).toBe(PRIVATE_FORK_QUOTE_MAX_CHARS);
    const data = await load(await lessonAdapter(h, courseSnapshot(reading)).create(lessonContext(reading, { selectedText: reading })));
    expect(imported(data).keatingPrivateFork.source.passage.quote).toBe(reading);
    expect(imported(data).content).toContain("> a\n>\n> a");
    expect((imported(data).content as string).length).toBeLessThanOrEqual(PRIVATE_FORK_CONTEXT_MAX_CHARS);
  });

  test("a stable lesson key reopens continued work after unrelated course revision changes", async () => {
    const h = harness();
    const key = "account_maya:lesson_reading";
    const id = await lessonAdapter(h).create(lessonContext(), { key });
    const continued = await continueSession(id);
    const nextSnapshot = courseSnapshot();
    nextSnapshot.course.revision++;
    const next = lessonAdapter(h, nextSnapshot);
    expect(await next.create(lessonContext(READING, { revision: 12 }), { key })).toBe(id);
    expect(await load(id)).toEqual(continued);
    await expect(next.create(lessonContext(READING, { revision: 12, selectedText: "speed" }), { key })).rejects.toThrow("different source");
    expect(await load(id)).toEqual(continued);
  });
});

describe("product serialization and imported-context assessment boundary", () => {
  test.each(["room", "lesson"] as const)("%s context survives JSON, real storage, snapshot persistence, Flue restore and provider conversion", async kind => {
    const h = harness();
    const id = kind === "room" ? await h.room(roomContext()) : await lessonAdapter(h).create(lessonContext());
    const original = await load(id);
    const marker = jsonRoundTrip(imported(original).keatingPrivateFork);
    const record = buildSessionSnapshotRecord({
      sessionId: id, createdAt: original.createdAt, now: TIME, model: original.model,
      thinkingLevel: original.thinkingLevel, messages: jsonRoundTrip(original.messages), existing: jsonRoundTrip(original), ancestry: undefined,
    });
    await openStores().sessions.save(jsonRoundTrip(record.data), jsonRoundTrip(record.metadata));
    const restored = await load(id);
    let inferenceCalls = 0;
    const conversation = new FlueConversation({ sessionId: id, streamFn: () => {
      inferenceCalls++;
      throw new Error("Restoring private context must not run inference");
    }, initialState: {
      model: restored.model, thinkingLevel: restored.thinkingLevel, messages: restored.messages,
    } }, "https://bundle.invalid/never-executed.js");
    expect(conversation.context.messages).toEqual(restored.messages);
    expect(conversation.context.messages[0]).not.toBe(restored.messages[0]);
    expect(isPrivateForkContextMessage(conversation.context.messages[0])).toBe(true);
    const providerMessages = jsonRoundTrip(toModelMessages(conversation.context.messages));
    expect(providerMessages).toHaveLength(1);
    expect(providerMessages[0]).toMatchObject({ role: "user", content: imported(original).content, keatingPrivateFork: marker });
    expect(learningMessageSource(id, conversation.context.messages[0], 0)).toBeNull();
    expect(imported(restored).keatingPrivateFork).toEqual(marker);
    expect(await load(id)).toEqual(restored);
    expect(conversation.context.isStreaming).toBe(false);
    expect(inferenceCalls).toBe(0);
  });

  test("only explicit versioned metadata excludes a message; copied text prefixes remain learner evidence", async () => {
    const h = harness();
    const id = await h.room(roomContext());
    const first = imported(await load(id));
    const ownMessage = { role: "user", timestamp: NOW + 1, content: first.content };
    expect(isPrivateForkContextMessage(ownMessage)).toBe(false);
    expect(learningMessageSource(id, ownMessage, 1)?.text).toBe(first.content as string);
    const damaged = { ...ownMessage, content: "Other learners' imported words", keatingPrivateFork: { version: 1, kind: "imported-context", source: null } };
    expect(isPrivateForkContextMessage(damaged)).toBe(true);
    expect(learningMessageSource(id, jsonRoundTrip(damaged), 0)).toBeNull();
    for (const marker of [undefined, null, {}, { version: 2, kind: "imported-context" }, { version: 1, kind: "something-else" }]) {
      const ordinary = { ...ownMessage, keatingPrivateFork: marker };
      expect(isPrivateForkContextMessage(ordinary)).toBe(false);
      expect(learningMessageSource(id, ordinary, 1)?.text).toBe(first.content as string);
    }
    const continued = await continueSession(id, "I think energy scales with squared speed");
    expect(learningMessageSource(id, continued.messages[0], 0)).toBeNull();
    expect(learningMessageSource(id, continued.messages[1], 1)?.text).toBe("I think energy scales with squared speed");
  });
});
