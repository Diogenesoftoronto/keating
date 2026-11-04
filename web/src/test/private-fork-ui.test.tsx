import { ImportedPrivateForkContext, privateForkSourceLink } from "../components/private-fork/ImportedPrivateForkContext";
import { RoomDraftReview, RoomKeatingPanel } from "../components/rooms/RoomKeatingPanel";
import { roomSchema, type RoomDraft } from "../rooms/contracts";
import type { PrivateForkProvenance, PrivateForkSeed, PrivateForkSessionOptions } from "../keating/private-fork-provenance";
import { textOf } from "./helpers/room-ui-mount";
import { LessonPrivateFork, type LessonPrivateForkNavigation } from "../components/private-fork/LessonPrivateFork";
import { exactLessonReadingTarget, lessonReadingSourceIssue, LessonReadingSourceReturn, LessonReadingUnavailable, resolveLessonReadingContext } from "../components/private-fork/LessonReadingSourceReturn";
import { allCourseLessons } from "../courses/contracts";
import { createLessonPrivateForkSessionAdapter, type LessonPrivateForkContext } from "../courses/private-fork-session";
import { resolveLessonContext } from "../pages/course-workspace/model";
import { courseWorkspaceReducer, INITIAL_WORKSPACE_STATE } from "../pages/course-workspace/state";
import { deskFixture } from "./course-outline-fixtures";
import { renderWithRouter } from "./course-render";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Api, Model } from "@earendil-works/pi-ai";
import { learningSourceHash } from "@keating/learner-contracts";
import { PrivateForkPanel, exactPrivateForkPassage, rawPassageFromTextarea } from "../components/private-fork/PrivateForkPanel";
import { RoomPrivateFork, RoomPrivateForkOffers, roomPrivateOfferKey, type RoomPrivateForkDependencies } from "../components/rooms/RoomPrivateFork";
import { RoomMessageItem } from "../components/rooms/RoomTranscript";
import { roomSourceReturnState } from "../components/rooms/RoomSourceReturn";
import { createPrivateForkSessionWriter, type PrivateForkContextMessage } from "../keating/private-fork-provenance";
import { createRoomPrivateForkSessionAdapter } from "../rooms/private-fork-session";
import type { RoomMember, RoomMessage, RoomOperationInput, RoomPrivateForkContext, RoomPrivateForkOffer, RoomViewerSnapshot } from "../rooms/contracts";
import type { SessionData } from "../types/session";
import { mountRoomUi, settle } from "./helpers/room-ui-mount";

const at = "2026-10-25T12:00:00.000Z";
const text = "Before 🧠\r\n  repeat\r\nThen repeat: **exact**.  ";
const source: RoomMessage = { id: "message_source", seq: 2, kind: "chat", body: text, authorAccountId: "peer_1", authorName: "Peer", authorRole: "learner", audience: "room", createdAt: at };
const viewer: RoomMember = { accountId: "learner_1", displayName: "Learner", role: "learner", joinedAt: at, muted: false, via: "invite" };
const model: Model<Api> = { id: "chosen-model", name: "Learner chosen model", api: "openai-completions", provider: "fixture", baseUrl: "https://model.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 2_048 };
function snapshot(): RoomViewerSnapshot {
  return { viewer: { ...viewer }, permissions: { canPost: true, canOversee: false, canManageRoles: false, canInvite: false, inviteRoles: [], canFacilitate: false, isFacilitator: false }, hasEarlierMessages: false,
    room: { schemaVersion: 1, id: "room_1", title: "Study room", topic: "Proofs", goal: "Understand", hostAccountId: "host_1", createdAt: at, updatedAt: at, revision: 4, status: "open", context: { objectives: [] },
      members: [{ ...viewer }], messages: [{ ...source }], nextSeq: 3, drafts: [], privateForkOffers: [], settings: { keating: "active", participation: "facilitate", replyReview: "off", facilitators: "teachers", learnerInvites: false }, turn: { status: "idle", throughSeq: 0, consideredSeq: 0 } } };
}
function offer(extra: Partial<RoomPrivateForkOffer> = {}): RoomPrivateForkOffer {
  return { id: "offer_1", createdAt: at, model: "Room model", status: "pending", learnerAccountId: viewer.accountId, sourceMessageId: source.id, ...exactPrivateForkPassage(text, text.lastIndexOf("repeat"), text.lastIndexOf("repeat") + 6), ...extra };
}
function context(selection = exactPrivateForkPassage(text)): RoomPrivateForkContext {
  return { roomId: "room_1", roomTitle: "Study room", topic: "Proofs", goal: "Understand", revision: 4, context: { objectives: [] }, sourceMessageId: source.id, sourceSeq: source.seq, ...selection, messages: [{ ...source }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function persistence() {
  const sessions = new Map<string, SessionData>(), settings = new Map<string, unknown>();
  const calls = { model: 0, saves: 0 };
  const writer = createPrivateForkSessionWriter({
    init: async () => {}, sessions: { loadSession: async id => sessions.get(id) ?? null, save: async data => { calls.saves++; sessions.set(data.id, structuredClone(data)); } },
    settings: { get: async key => settings.get(key), set: async (key, value) => { settings.set(key, value); } },
    resolveModel: async () => { calls.model++; return model; }, thinkingLevel: () => "off", now: () => Date.parse(at), newId: () => `private_${sessions.size + 1}`, notify: () => {},
  });
  return { sessions, calls, createSession: createRoomPrivateForkSessionAdapter(writer) };
}
const questionField = (ui: ReturnType<typeof mountRoomUi>) => ui.all("textarea").find(node => node.props.maxLength === 2_000)!;

describe("exact private source choice", () => {
  test("textarea normalization maps back to original whitespace, duplicated quotes and UTF-16", () => {
    const display = text.replace(/\r\n|\r/g, "\n");
    const start = display.lastIndexOf("repeat");
    expect(rawPassageFromTextarea(text, display, start, start + 6)).toEqual({ selectedText: "repeat", start: text.lastIndexOf("repeat"), end: text.lastIndexOf("repeat") + 6, sourceHash: learningSourceHash(text) });
    expect(rawPassageFromTextarea(text, display, 0, display.length).selectedText).toBe(text);
    expect(() => rawPassageFromTextarea(text, "normalized or stale", 0, 4)).toThrow("Choose the passage again");
    expect(() => exactPrivateForkPassage(text, 8, 9)).toThrow("source range");
    expect(() => exactPrivateForkPassage("x".repeat(8001))).toThrow("8,000");
  });
  test("only active learners can branch unhidden public chat or Keating messages", () => {
    const render = (view: RoomViewerSnapshot, message = source) => renderToStaticMarkup(<RoomMessageItem snapshot={view} message={message} onContinuePrivately={() => {}} />);
    expect(render(snapshot())).toContain("Continue privately");
    expect(render(snapshot(), { ...source, kind: "keating" })).toContain("Continue privately");
    for (const message of [{ ...source, hidden: { by: "host_1", at } }, { ...source, kind: "whisper" as const, audience: "teachers" as const }, { ...source, kind: "system" as const }]) expect(render(snapshot(), message)).not.toContain("Continue privately");
    for (const role of ["host", "teacher", "observer"] as const) { const view = snapshot(); view.viewer.role = role; expect(render(view)).not.toContain("Continue privately"); }
    const removed = snapshot(); removed.room.members = []; expect(render(removed)).not.toContain("Continue privately");
  });
  test("long sources require an explicit passage; select and keyboard cancel are real controls", async () => {
    const ui = mountRoomUi(); let opened = 0, cancelled = 0;
    await ui.render(<PrivateForkPanel title="Private study" sourceText={"x".repeat(8001)} sourceLabel="Reading" sourceKind="lesson" onCancel={() => { cancelled++; }} onOpen={async () => { opened++; }} />);
    expect(ui.button("Open private Chat").props.disabled).toBe(true);
    const picker = ui.all("textarea").find(node => node.props.readOnly)!;
    picker.props.onSelect({ currentTarget: { value: "x".repeat(8001), selectionStart: 12, selectionEnd: 20 } }); await settle();
    expect(ui.button("Open private Chat").props.disabled).toBe(false); expect(opened).toBe(0);
    ui.all("section")[0]!.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    expect(cancelled).toBe(1); await ui.unmount();
  });
});

describe("room continuation controls use the production session adapter", () => {
  test("selected passage and question become saved context and Chat prefill without a sent turn", async () => {
    const ui = mountRoomUi(), saved = persistence(); const gets: unknown[] = [], launches: unknown[] = [], operations: unknown[] = [];
    const deps: RoomPrivateForkDependencies = { createSession: saved.createSession, getContext: async (_room, selection) => { gets.push(selection); return context(selection as ReturnType<typeof exactPrivateForkPassage>); } };
    await ui.render(<RoomPrivateFork snapshot={snapshot()} source={source} dependencies={deps} mutate={async op => { operations.push(op); }} onCancel={() => {}} onOpenChat={(...args) => { launches.push(args); }} />);
    expect(saved.calls.saves).toBe(0); expect(gets).toHaveLength(0);
    const display = text.replace(/\r\n/g, "\n"), start = display.lastIndexOf("repeat");
    ui.all("textarea").find(node => node.props.readOnly)!.props.onSelect({ currentTarget: { value: display, selectionStart: start, selectionEnd: start + 6 } });
    questionField(ui).props.onChange({ target: { value: " Why this second occurrence? " } }); await settle();
    ui.button("Open private Chat").props.onClick(); await settle();
    expect(gets).toEqual([{ sourceMessageId: source.id, ...exactPrivateForkPassage(text, text.lastIndexOf("repeat"), text.lastIndexOf("repeat") + 6) }]);
    expect(launches).toEqual([["private_1", "Why this second occurrence?"]]); expect(operations).toEqual([]);
    const session = saved.sessions.get("private_1")!;
    expect(session.messages).toHaveLength(1); expect(session.model.id).toBe("chosen-model");
    const imported = session.messages[0] as PrivateForkContextMessage;
    expect(imported.keatingPrivateFork.source.passage.quote).toBe("repeat");
    expect(imported.content).toContain("not a sent learner turn"); expect(imported.content).toContain("No question has been sent yet");
    expect(session).not.toHaveProperty("courseContext"); expect(saved.calls.saves).toBe(1); await ui.unmount();
  });
  test("source fetch errors stay in place and retry creates no premature history", async () => {
    const ui = mountRoomUi(), saved = persistence(); let attempts = 0;
    await ui.render(<RoomPrivateFork snapshot={snapshot()} source={source} dependencies={{ createSession: saved.createSession, getContext: async () => { if (++attempts === 1) throw new Error("Source no longer available. Choose again."); return context(); } }} mutate={async () => {}} onCancel={() => {}} onOpenChat={() => {}} />);
    ui.button("Open private Chat").props.onClick(); await settle(); expect(saved.calls.saves).toBe(0);
    expect(ui.text()).toContain("Source no longer available"); ui.button("Try again").props.onClick(); await settle(); expect(saved.calls.saves).toBe(1); await ui.unmount();
  });
  test.each(["cancel", "unmount", "hidden", "account", "membership"])("%s while loading prevents save and late navigation", async mode => {
    const ui = mountRoomUi(), pending = deferred<RoomPrivateForkContext>(), saved = persistence(); let launches = 0;
    const deps = { createSession: saved.createSession, getContext: async () => pending.promise };
    const view = snapshot();
    const render = (current: RoomViewerSnapshot) => <RoomPrivateFork snapshot={current} source={source} dependencies={deps} mutate={async () => {}} onCancel={() => {}} onOpenChat={() => { launches++; }} />;
    await ui.render(render(view)); ui.button("Open private Chat").props.onClick(); await settle();
    if (mode === "cancel") ui.button("Cancel").props.onClick();
    if (mode === "unmount") await ui.unmount();
    if (mode === "hidden") { view.room.messages[0]!.hidden = { by: "host_1", at }; await ui.render(render(view)); expect(ui.text()).not.toContain(text); }
    if (mode === "account") { view.viewer = { ...viewer, accountId: "different" }; await ui.render(render(view)); }
    if (mode === "membership") { view.room.members = []; await ui.render(render(view)); }
    pending.resolve(context()); await settle(); expect(saved.calls.saves).toBe(0); expect(launches).toBe(0); await ui.unmount();
  });
  test("cancel during persistence may finish saving but never acknowledges or launches", async () => {
    const ui = mountRoomUi(), saving = deferred<string>(); const operations: unknown[] = []; let launches = 0;
    const view = snapshot(); view.room.privateForkOffers = [offer()];
    await ui.render(<RoomPrivateFork snapshot={view} source={source} offer={offer()} dependencies={{ getContext: async () => context(), createSession: async () => saving.promise }} mutate={async op => { operations.push(op); }} onCancel={() => {}} onOpenChat={() => { launches++; }} />);
    ui.button("Open private Chat").props.onClick(); await settle(); ui.button("Cancel").props.onClick(); saving.resolve("saved"); await settle();
    expect(operations).toEqual([]); expect(launches).toBe(0); await ui.unmount();
  });
  test("a failed offer acknowledgement retries the same saved session", async () => {
    const ui = mountRoomUi(), saved = persistence(), view = snapshot(); view.room.privateForkOffers = [offer()];
    let acknowledgements = 0; const launches: string[] = [];
    await ui.render(<RoomPrivateFork snapshot={view} source={source} offer={offer()} dependencies={{ createSession: saved.createSession, getContext: async (_room, selection) => context(selection as ReturnType<typeof exactPrivateForkPassage>) }}
      mutate={async () => { if (++acknowledgements === 1) throw new Error("Connection lost. Try again."); }} onCancel={() => {}} onOpenChat={id => { launches.push(id); }} />);
    ui.button("Open private Chat").props.onClick(); await settle();
    expect(saved.calls.saves).toBe(1); expect(launches).toEqual([]); expect(ui.text()).toContain("Connection lost");
    ui.button("Try again").props.onClick(); await settle();
    expect(saved.calls.saves).toBe(1); expect(acknowledgements).toBe(2); expect(launches).toEqual(["private_1"]); await ui.unmount();
  });
});

describe("recipient-only model offers", () => {
  test("other learners and teachers never render another recipient's offer", () => {
    const view = snapshot(); view.room.privateForkOffers = [offer({ learnerAccountId: "other", selectedText: "SECRET_OFFER" })];
    const render = () => renderToStaticMarkup(<RoomPrivateForkOffers snapshot={view} mutate={async () => {}} onOpenChat={() => {}} />);
    expect(render()).toBe(""); view.room.privateForkOffers = [offer()]; view.viewer.role = "teacher"; expect(render()).toBe("");
  });
  test("review does not save; open fetches again, acknowledges; reopen preserves later history", async () => {
    const ui = mountRoomUi(), saved = persistence(), view = snapshot(); view.room.privateForkOffers = [offer()];
    const operations: RoomOperationInput[] = [], launches: unknown[] = []; let fetches = 0;
    const dependencies: RoomPrivateForkDependencies = { createSession: saved.createSession, getContext: async (_room, selection) => { fetches++; return context(selection as ReturnType<typeof exactPrivateForkPassage>); } };
    const render = () => <RoomPrivateForkOffers snapshot={view} dependencies={dependencies} mutate={async operation => { operations.push(operation); }} onOpenChat={(...args) => { launches.push(args); }} />;
    await ui.render(render()); expect(fetches).toBe(0); expect(saved.calls.saves).toBe(0);
    ui.button("Review private offer").props.onClick(); await settle(); expect(fetches).toBe(1); expect(saved.calls.saves).toBe(0); expect(launches).toHaveLength(0);
    ui.button("Open private Chat").props.onClick(); await settle(); expect(fetches).toBe(2);
    expect(operations).toEqual([{ type: "private-fork.resolve", offerId: "offer_1", action: "open" }]); expect(launches).toEqual([["private_1", ""]]);
    const session = saved.sessions.get("private_1")!; session.messages.push({ role: "user", content: "Later learner work", timestamp: Date.parse(at) + 1 });
    await ui.unmount(); view.room.privateForkOffers[0]!.status = "opened";
    await ui.render(render()); ui.button("Reopen private Chat").props.onClick(); await settle(); ui.button("Open private Chat").props.onClick(); await settle();
    expect(launches).toEqual([["private_1", ""], ["private_1", ""]]); expect(operations).toHaveLength(1); expect(saved.calls.saves).toBe(1); expect(saved.sessions.get("private_1")?.messages).toHaveLength(2);
    expect(roomPrivateOfferKey("learner_1", "room_1", "offer_1")).not.toBe(roomPrivateOfferKey("learner_2", "room_1", "offer_1")); await ui.unmount();
  });
  test("dismiss only resolves the addressed offer, without context fetch or persistence", async () => {
    const ui = mountRoomUi(), view = snapshot(), saved = persistence(); view.room.privateForkOffers = [offer()]; const operations: unknown[] = []; let fetches = 0;
    await ui.render(<RoomPrivateForkOffers snapshot={view} dependencies={{ createSession: saved.createSession, getContext: async () => { fetches++; return context(); } }} mutate={async op => { operations.push(op); }} onOpenChat={() => { throw new Error("must not launch"); }} />);
    ui.button("Dismiss offer").props.onClick(); await settle(); expect(operations).toEqual([{ type: "private-fork.resolve", offerId: "offer_1", action: "dismiss" }]); expect(fetches).toBe(0); expect(saved.calls.saves).toBe(0); await ui.unmount();
  });
  test("removed offer aborts in-flight source review and never reveals stale context", async () => {
    const ui = mountRoomUi(), view = snapshot(), loading = deferred<RoomPrivateForkContext>(); view.room.privateForkOffers = [offer()];
    const render = () => <RoomPrivateForkOffers snapshot={view} dependencies={{ getContext: async () => loading.promise, createSession: async () => { throw new Error("must not save"); } }} mutate={async () => {}} onOpenChat={() => {}} />;
    await ui.render(render()); ui.button("Review private offer").props.onClick(); await settle();
    view.room.privateForkOffers = []; await ui.render(render()); loading.resolve(context()); await settle(); expect(ui.text()).toBe(""); await ui.unmount();
  });
});

test("source return resolves an exact public message, exposes pagination, and refuses hidden or missing targets", () => {
  const view = snapshot();
  expect(roomSourceReturnState(view, "#room-message-message_source")).toEqual({ id: "message_source", state: "ready" });
  expect(roomSourceReturnState(view, "#room-message-earlier_id")?.state).toBe("unavailable");
  view.hasEarlierMessages = true; expect(roomSourceReturnState(view, "#room-message-earlier_id")?.state).toBe("earlier");
  view.room.messages[0]!.hidden = { by: "host_1", at }; expect(roomSourceReturnState(view, "#room-message-message_source")?.state).toBe("unavailable");
  expect(roomSourceReturnState(view, "#room-message-message_sourc")).not.toEqual({ id: "message_source", state: "ready" });
  expect(roomSourceReturnState(view, "#other-anchor")).toBeNull();
});


// Teacher review and imported-source presentation fixtures.
{
const at = "2026-10-25T12:00:00.000Z";
const learner: RoomMember = { accountId: "learner_1", displayName: "Priya", role: "learner", joinedAt: at, muted: false, via: "invite" };
const source: RoomMessage = {
  id: "message_1", seq: 5, kind: "chat", authorAccountId: "learner_2", authorName: "Omar",
  authorRole: "learner", body: "How does induction prove the next case?", createdAt: at, audience: "room",
};
const offerDraft: RoomDraft = {
  id: "draft_1", turnId: "turn_1", body: "PRIVATE OFFER PLACEHOLDER, NOT A ROOM REPLY",
  createdAt: at, facilitatorAccountId: "teacher_1", model: "Test model", reason: "review", status: "pending",
  privateFork: { learnerAccountId: learner.accountId, sourceMessageId: source.id, selectedText: "the next case" },
};
const roomProvenance: PrivateForkProvenance = {
  version: 1, kind: "imported-context",
  source: {
    kind: "room", roomId: "room_1", sourceMessageId: source.id, sourceSeq: source.seq, revision: 3,
    url: "/rooms/room_1#room-message-message_1",
    passage: { quote: source.body, start: 0, end: source.body.length, sourceHash: "hash" },
  },
};
const lessonProvenance: PrivateForkProvenance = {
  version: 1, kind: "imported-context",
  source: {
    kind: "lesson", courseId: "course_1", lessonId: "lesson_1", revision: 2, field: "reading",
    url: "/courses/course_1?lesson=lesson_1#lesson-reading-lesson_1",
    passage: { quote: "A reading passage", start: 0, end: 17, sourceHash: "hash" },
  },
};

describe("private-study offer review", () => {
  test("shows the recipient and exact source, and approves without a body or public-post action", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    try {
      await ui.render(<RoomDraftReview drafts={[offerDraft]} roomOpen members={[learner]} messages={[source]} mutate={async (operation) => { calls.push(operation); }} />);
      expect(ui.text()).toContain("1 private-study offer waiting for review");
      expect(ui.text()).toContain("For Priya");
      expect(ui.text()).toContain("View source from Omar");
      expect(ui.all("a")[0]!.props.href).toBe("#room-message-message_1");
      expect(textOf(ui.all("blockquote")[0]!)).toBe("the next case");
      expect(ui.all("textarea")).toHaveLength(0);
      expect(ui.text()).not.toContain(offerDraft.body);
      expect(ui.text()).not.toContain("Approve and post");
      expect(ui.all("button").some((button) => textOf(button) === "Edit")).toBe(false);
      ui.button("Approve private-study offer").props.onClick();
      await settle();
      expect(calls).toEqual([{ type: "draft.resolve", draftId: offerDraft.id, action: "approve" }]);
    } finally { await ui.unmount(); }
  });

  test("can reject in an ended room while approval is disabled", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    try {
      await ui.render(<RoomDraftReview drafts={[offerDraft]} roomOpen={false} mutate={async (operation) => { calls.push(operation); }} />);
      expect(ui.button("Approve private-study offer").props.disabled).toBe(true);
      expect(ui.button("Reject offer").props.disabled).toBe(false);
      ui.button("Reject offer").props.onClick();
      await settle();
      expect(calls).toEqual([{ type: "draft.resolve", draftId: offerDraft.id, action: "reject" }]);
    } finally { await ui.unmount(); }
  });

  test("failed approval shows an error and allows a body-free retry", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    try {
      await ui.render(<RoomDraftReview drafts={[offerDraft]} roomOpen mutate={async (operation) => {
        calls.push(operation);
        if (calls.length === 1) throw new Error("Connection lost. Try again.");
      }} />);
      ui.button("Approve private-study offer").props.onClick();
      await settle();
      expect(ui.text()).toContain("Connection lost. Try again.");
      expect(ui.all("p").some((node) => node.props.role === "alert")).toBe(true);
      expect(ui.button("Approve private-study offer").props.disabled).toBe(false);
      ui.button("Approve private-study offer").props.onClick();
      await settle();
      expect(calls).toEqual([
        { type: "draft.resolve", draftId: offerDraft.id, action: "approve" },
        { type: "draft.resolve", draftId: offerDraft.id, action: "approve" },
      ]);
    } finally { await ui.unmount(); }
  });

  test("missing, hidden and teacher-only source messages never create a guessed source link", () => {
    for (const messages of [[], [{ ...source, hidden: { by: "teacher_1", at } }], [{ ...source, audience: "teachers" as const }]]) {
      const html = renderToStaticMarkup(<RoomDraftReview drafts={[offerDraft]} roomOpen messages={messages} mutate={async () => {}} />);
      expect(html).toContain(learner.accountId);
      expect(html).toContain(source.id);
      expect(html).not.toContain("href=");
    }
  });

  test("mixed reviews keep ordinary reply editing and its edited approval payload", async () => {
    const ui = mountRoomUi();
    const calls: RoomOperationInput[] = [];
    const reply: RoomDraft = { ...offerDraft, id: "draft_reply", body: "A public reply.", privateFork: undefined };
    try {
      await ui.render(<RoomDraftReview drafts={[offerDraft, reply]} roomOpen mutate={async (operation) => { calls.push(operation); }} />);
      expect(ui.text()).toContain("1 reply and 1 private-study offer waiting for review");
      ui.button("Edit").props.onClick();
      await settle();
      expect(ui.all("textarea")).toHaveLength(1);
      ui.all("textarea")[0]!.props.onChange({ target: { value: "  What does the next case require?  " } });
      await settle();
      ui.button("Post edited reply").props.onClick();
      await settle();
      expect(calls).toEqual([{ type: "draft.resolve", draftId: reply.id, action: "approve", body: "What does the next case require?" }]);
    } finally { await ui.unmount(); }
  });

  test("the shared last-outcome label reveals no recipient, source or private detail", () => {
    const snapshot: RoomViewerSnapshot = {
      room: roomSchema.parse({
        schemaVersion: 1, id: "room_1", title: "Workshop", topic: "Induction", goal: "", hostAccountId: "teacher_1",
        createdAt: at, updatedAt: at, revision: 1, status: "open", context: { objectives: [] },
        members: [learner], messages: [], nextSeq: 1, drafts: [], invites: [], privateForkOffers: [], settings: {},
        turn: { status: "idle", throughSeq: 0, consideredSeq: 0, lastOutcome: { kind: "offered-private", at, detail: "SECRET recipient, source and learner answer" } },
      }),
      viewer: learner, hasEarlierMessages: false,
      permissions: { canPost: true, canOversee: true, canManageRoles: false, canInvite: false, inviteRoles: [], canFacilitate: false, isFacilitator: false },
    };
    const html = renderToStaticMarkup(<RoomKeatingPanel snapshot={snapshot} mutate={async () => {}} facilitator={{ status: "off", modelLabel: "", error: "", localPreview: null, start: async () => {}, stop: async () => {} }} />);
    expect(html).toContain("offered private study.");
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("Priya");
  });
});

describe("imported private-study context presentation", () => {
  test("keeps the entire original content in collapsed details, with original attribution and escaped markup", async () => {
    const ui = mountRoomUi();
    const content = `Imported source context\n\nOmar (learner):\n> ${source.body}\n<script>alert('source')</script>\n${"A long quotation. ".repeat(1_000)}\nEND OF ORIGINAL CONTEXT`;
    const original = structuredClone(roomProvenance);
    try {
      await ui.render(<ImportedPrivateForkContext provenance={roomProvenance} content={content} />);
      expect(ui.text()).toContain("Imported room context");
      expect(ui.text()).not.toContain("YOU");
      expect(ui.all("details")).toHaveLength(1);
      expect(ui.all("details")[0]!.props.open).toBeUndefined();
      expect(textOf(ui.all("pre")[0]!)).toBe(content);
      expect(ui.all("script")).toHaveLength(0);
      expect(roomProvenance).toEqual(original);
      const html = renderToStaticMarkup(<ImportedPrivateForkContext provenance={roomProvenance} content={content} />);
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
    } finally { await ui.unmount(); }
  });

  test("room and lesson links point to their recorded source with safe new-tab behavior", () => {
    for (const [provenance, href, label] of [
      [roomProvenance, "/rooms/room_1#room-message-message_1", "Return to source room"],
      [lessonProvenance, "/courses/course_1?lesson=lesson_1#lesson-reading-lesson_1", "Return to source lesson"],
    ] as const) {
      expect(privateForkSourceLink(provenance)).toMatchObject({ href, label });
      const html = renderToStaticMarkup(<ImportedPrivateForkContext provenance={provenance} content="Original source" />);
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    }
  });

  test("ignores unsafe persisted URLs and reconstructs only the validated app source", () => {
    for (const url of ["javascript:alert(1)", "//evil.example/source", "https://evil.example/source", "data:text/html,hi", "/rooms/some_other_room#wrong"]) {
      const provenance = { ...roomProvenance, source: { ...roomProvenance.source, url } };
      const html = renderToStaticMarkup(<ImportedPrivateForkContext provenance={provenance} content="Source" />);
      expect(privateForkSourceLink(provenance)?.href).toBe("/rooms/room_1#room-message-message_1");
      expect(html).not.toContain(url);
    }
  });

  test("damaged source metadata stays visibly imported, preserves content and has no link", () => {
    for (const source of [undefined, null, [], {}, { kind: "room" }, { kind: "room", roomId: "../escape", sourceMessageId: "message_1" }, { kind: "lesson", courseId: "course_1", lessonId: "lesson_1?redirect=evil", field: "reading" }, { kind: "lesson", courseId: "course_1", lessonId: "lesson_1", field: "secret" }]) {
      const provenance = { version: 1, kind: "imported-context", source };
      const html = renderToStaticMarkup(<ImportedPrivateForkContext provenance={provenance} content="Complete saved context" />);
      expect(html).toContain("Imported");
      expect(html).toContain("Complete saved context");
      expect(html).toContain("source link is unavailable");
      expect(html).not.toContain("href=");
      expect(privateForkSourceLink(provenance)).toBeNull();
    }
  });
});
}

// Lesson continuation and exact source-return fixtures.
{
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(reading = "Before 🧠.\r\n\r\nA repeated passage.\r\nA repeated passage.") {
  const snapshot = structuredClone(deskFixture().snapshot);
  const lesson = snapshot.course.modules[0]!.lessons[0]!;
  lesson.reading = reading;
  const context: LessonPrivateForkContext = {
    courseId: snapshot.course.id, courseTitle: snapshot.course.title,
    lessonId: lesson.id, lessonTitle: lesson.title, revision: snapshot.course.revision, reading,
  };
  const saved: Array<{ seed: PrivateForkSeed; options?: PrivateForkSessionOptions }> = [];
  const reads: string[] = [];
  const navigation: LessonPrivateForkNavigation[] = [];
  const createSession = createLessonPrivateForkSessionAdapter({
    getCourse: async (id) => { reads.push(id); return snapshot; },
    writer: async (seed, options) => { saved.push({ seed, options }); return "private_lesson_1"; },
  });
  const onNavigate = (destination: LessonPrivateForkNavigation) => { navigation.push(destination); };
  return { snapshot, context, saved, reads, navigation, createSession, onNavigate };
}

async function openPicker(ui: ReturnType<typeof mountRoomUi>) {
  ui.button("Continue privately").props.onClick();
  await settle();
}

describe("lesson private continuation", () => {
  test("saves the exact whole reading through the lesson adapter, then prefills Chat without changing the course", async () => {
    const h = fixture();
    const before = JSON.stringify(h.snapshot);
    const ui = mountRoomUi();
    try {
      await ui.render(<LessonPrivateFork context={h.context} createSession={h.createSession} onNavigate={h.onNavigate} />);
      expect(h.reads).toEqual([]);
      await openPicker(ui);
      expect(h.saved).toEqual([]);
      const question = ui.all("textarea").find((input) => !input.props.readOnly)!;
      question.props.onChange({ target: { value: "  Why does this follow?  " } });
      await settle();
      ui.button("Open private Chat").props.onClick();
      await settle();
      expect(h.reads).toEqual([h.context.courseId]);
      expect(h.saved).toHaveLength(1);
      expect(h.saved[0]!.seed.source).toEqual({
        kind: "lesson", courseId: h.context.courseId, lessonId: h.context.lessonId,
        revision: h.context.revision, field: "reading",
        url: `/courses/${h.context.courseId}?lesson=${h.context.lessonId}#lesson-reading-${h.context.lessonId}`,
        passage: { quote: h.context.reading, start: 0, end: h.context.reading.length, sourceHash: learningSourceHash(h.context.reading) },
      });
      expect(h.saved[0]!.options?.question).toBe("Why does this follow?");
      expect(h.navigation).toEqual([{ to: "/chat", search: { session: "private_lesson_1", ask: "Why does this follow?" } }]);
      expect(JSON.stringify(h.snapshot)).toBe(before);
      expect(h.saved[0]!.seed.content).not.toContain("The margin everyone");
    } finally { await ui.unmount(); }
  });

  test("keeps the selected occurrence and original UTF-16 offsets across emoji and CRLF", async () => {
    const h = fixture();
    const ui = mountRoomUi();
    try {
      await ui.render(<LessonPrivateFork context={h.context} createSession={h.createSession} onNavigate={h.onNavigate} />);
      await openPicker(ui);
      const source = ui.all("textarea").find((input) => input.props.readOnly)!;
      const text = "A repeated passage.";
      const start = source.props.value.lastIndexOf(text);
      source.props.onSelect({ currentTarget: { value: source.props.value, selectionStart: start, selectionEnd: start + text.length } });
      await settle();
      ui.button("Open private Chat").props.onClick();
      await settle();
      const originalStart = h.context.reading.lastIndexOf(text);
      expect(h.saved[0]!.seed.source.passage).toEqual({
        quote: text, start: originalStart, end: originalStart + text.length,
        sourceHash: learningSourceHash(h.context.reading),
      });
      expect(h.navigation).toEqual([{ to: "/chat", search: { session: "private_lesson_1" } }]);
    } finally { await ui.unmount(); }
  });

  test("requires an explicit passage for a reading above 8,000 characters", async () => {
    const h = fixture("Long reading. ".repeat(700));
    const ui = mountRoomUi();
    try {
      await ui.render(<LessonPrivateFork context={h.context} createSession={h.createSession} onNavigate={h.onNavigate} />);
      await openPicker(ui);
      expect(ui.button("Open private Chat").props.disabled).toBe(true);
      expect(h.reads).toEqual([]);
      const source = ui.all("textarea").find((input) => input.props.readOnly)!;
      source.props.onSelect({ currentTarget: { value: source.props.value, selectionStart: 0, selectionEnd: 13 } });
      await settle();
      expect(ui.button("Open private Chat").props.disabled).toBe(false);
      ui.button("Open private Chat").props.onClick();
      await settle();
      expect(h.saved[0]!.seed.source.passage.quote).toBe(h.context.reading.slice(0, 13));
    } finally { await ui.unmount(); }
  });

  test("shows authoritative revision failures and retries without navigating early", async () => {
    const h = fixture();
    h.snapshot.course.revision++;
    const ui = mountRoomUi();
    try {
      await ui.render(<LessonPrivateFork context={h.context} createSession={h.createSession} onNavigate={h.onNavigate} />);
      await openPicker(ui);
      ui.button("Open private Chat").props.onClick();
      await settle();
      expect(ui.text()).toContain("The course has changed");
      expect(h.saved).toEqual([]);
      expect(h.navigation).toEqual([]);
      h.snapshot.course.revision = h.context.revision;
      ui.button("Try again").props.onClick();
      await settle();
      expect(h.saved).toHaveLength(1);
      expect(h.navigation).toHaveLength(1);
    } finally { await ui.unmount(); }
  });

  test.each(["cancel", "unmount", "course", "lesson", "revision", "reading"] as const)(
    "suppresses late navigation after %s while a session is being saved",
    async (change) => {
      const h = fixture();
      const pending = deferred<string>();
      let calls = 0;
      const createSession = async () => { calls++; return pending.promise; };
      const ui = mountRoomUi();
      try {
        await ui.render(<LessonPrivateFork context={h.context} createSession={createSession} onNavigate={h.onNavigate} />);
        await openPicker(ui);
        ui.button("Open private Chat").props.onClick();
        ui.button("Open private Chat").props.onClick();
        await settle();
        expect(calls).toBe(1);
        expect(ui.button("Opening…").props.disabled).toBe(true);
        expect(h.navigation).toEqual([]);
        if (change === "cancel") {
          ui.button("Cancel").props.onClick();
          await settle();
        } else if (change === "unmount") {
          await ui.unmount();
        } else {
          const context = { ...h.context };
          if (change === "course") context.courseId = "other_course";
          if (change === "lesson") context.lessonId = "other_lesson";
          if (change === "revision") context.revision++;
          if (change === "reading") context.reading += " changed";
          await ui.render(<LessonPrivateFork context={context} createSession={createSession} onNavigate={h.onNavigate} />);
        }
        pending.resolve("private_late");
        await settle();
        expect(h.navigation).toEqual([]);
        if (change !== "unmount") expect(ui.button("Continue privately").props["aria-expanded"]).toBe(false);
      } finally { await ui.unmount(); }
    },
  );

  test("does not offer a fork for empty reading", async () => {
    const h = fixture(" \n ");
    const ui = mountRoomUi();
    try {
      await ui.render(<LessonPrivateFork context={h.context} createSession={h.createSession} onNavigate={h.onNavigate} />);
      expect(ui.all("button")).toEqual([]);
    } finally { await ui.unmount(); }
  });
});

describe("lesson source return", () => {
  test("keeps the explicit source through reducer snapshots and refuses fallback when it disappears", () => {
    const h = fixture();
    const second = allCourseLessons(h.snapshot.course)[1]!;
    second.reading = "A source in the second lesson.";
    h.snapshot.viewer.progress.activeLessonId = h.context.lessonId;
    const requestedLessonId = second.id;
    const derive = (state: typeof INITIAL_WORKSPACE_STATE) => resolveLessonReadingContext({
      course: state.snapshot?.course,
      lessons: state.snapshot ? allCourseLessons(state.snapshot.course) : [],
      activeLessonId: state.activeLessonId,
      requestedLessonId,
      hash: `lesson-reading-${requestedLessonId}`,
      viewerAccountId: state.snapshot?.viewer.accountId,
    });
    let state = { ...INITIAL_WORKSPACE_STATE, activeLessonId: requestedLessonId };
    expect(derive(state).lesson.activeLesson).toBeUndefined();
    state = courseWorkspaceReducer(state, { type: "snapshot.received", snapshot: h.snapshot });
    state = courseWorkspaceReducer(state, { type: "loading.finished" });
    expect(state.activeLessonId).toBe(requestedLessonId);
    expect(state.view).toBe("read");
    expect(derive(state).lesson.activeLesson?.id).toBe(requestedLessonId);
    expect(derive(state).sourceIssue).toBeUndefined();

    const removed = structuredClone(h.snapshot);
    removed.course.modules.forEach((module) => { module.lessons = module.lessons.filter((item) => item.id !== requestedLessonId); });
    removed.course.revision++;
    state = courseWorkspaceReducer(state, { type: "snapshot.received", snapshot: removed });
    expect(state.activeLessonId).toBe(requestedLessonId);
    expect(derive(state).lesson.activeLesson).toBeUndefined();
    expect(derive(state).sourceIssue).toContain("may have been removed");

    // An unknown source on first load follows the same strict path, even when
    // the viewer's saved progress and the first available lesson are valid.
    const unknown = courseWorkspaceReducer({ ...INITIAL_WORKSPACE_STATE, activeLessonId: requestedLessonId }, { type: "snapshot.received", snapshot: removed });
    expect(derive(unknown).lesson.activeLesson).toBeUndefined();
    expect(derive(unknown).returningToSource).toBe(true);

    state = courseWorkspaceReducer(state, { type: "lesson.selected", lessonId: h.context.lessonId, view: "read" });
    expect(derive(state).returningToSource).toBe(false);
    expect(derive(state).lesson.activeLesson?.id).toBe(h.context.lessonId);
  });

  test("selects the exact non-first lesson and refuses missing or duplicate identities", () => {
    const h = fixture();
    const lessons = allCourseLessons(h.snapshot.course);
    const second = lessons[1]!;
    second.reading = "The second lesson reading.";
    const target = exactLessonReadingTarget(lessons, second.id);
    const context = resolveLessonContext(h.snapshot.course, target ? [target] : [], second.id, h.snapshot.viewer.accountId);
    expect(context.activeLesson).toBe(second);
    expect(lessonReadingSourceIssue(lessons, second.id, `lesson-reading-${second.id}`)).toBeUndefined();
    const missing = exactLessonReadingTarget(lessons, "removed_lesson");
    expect(missing).toBeUndefined();
    expect(resolveLessonContext(h.snapshot.course, missing ? [missing] : [], "removed_lesson", h.snapshot.viewer.accountId).activeLesson).toBeUndefined();
    expect(exactLessonReadingTarget([...lessons, second], second.id)).toBeUndefined();
    expect(lessonReadingSourceIssue([...lessons, second], second.id, "")).toContain("uniquely");
    expect(lessonReadingSourceIssue(lessons, second.id, "lesson-reading-other")).toContain("does not identify");
    second.reading = "";
    expect(lessonReadingSourceIssue(lessons, second.id, "")).toContain("no reading now");
  });

  test("reveals and focuses the exact anchor only after the desk is ready, once per visit", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    const lookups: string[] = [];
    const scrolls: unknown[] = [];
    const focuses: unknown[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { getElementById: (id: string) => {
        lookups.push(id);
        return { scrollIntoView: (options: unknown) => scrolls.push(options), focus: (options: unknown) => focuses.push(options) };
      } },
    });
    const ui = mountRoomUi();
    try {
      await ui.render(<LessonReadingSourceReturn lessonId="lesson_second" hash="lesson-reading-lesson_second" ready={false} />);
      expect(lookups).toEqual([]);
      await ui.render(<LessonReadingSourceReturn lessonId="lesson_second" hash="lesson-reading-other" ready />);
      expect(lookups).toEqual([]);
      await ui.render(<LessonReadingSourceReturn lessonId="lesson_second" hash="lesson-reading-lesson_second" ready />);
      expect(lookups).toEqual(["lesson-reading-lesson_second"]);
      expect(scrolls).toEqual([{ block: "start", behavior: "instant" }]);
      expect(focuses).toEqual([{ preventScroll: true }]);
      await ui.render(<LessonReadingSourceReturn lessonId="lesson_second" hash="lesson-reading-lesson_second" ready={false} />);
      await ui.render(<LessonReadingSourceReturn lessonId="lesson_second" hash="lesson-reading-lesson_second" ready />);
      expect(scrolls).toHaveLength(1);
    } finally {
      await ui.unmount();
      if (original) Object.defineProperty(globalThis, "document", original);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  test("offers an honest unavailable state and a course link that clears the source request", async () => {
    const html = await renderWithRouter(<LessonReadingUnavailable courseId="course_outline" lessonId="removed_lesson" message="The linked lesson is unavailable. It may have been removed from this course." />);
    expect(html).toContain("Lesson reading unavailable");
    expect(html).toContain("may have been removed");
    expect(html).not.toContain("This course has no lessons");
    expect(html).toContain('href="/courses/course_outline"');
    expect(html).toContain('id="lesson-reading-removed_lesson"');
  });
});
}
