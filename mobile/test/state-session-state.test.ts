import { describe, expect, test } from "bun:test";
import type { ChatMessage, ChatSession, PersistedAppState } from "../src/lib/types";
import {
  activeSessionOf,
  artifactTitle,
  buildUserMessage,
  liveQuizMarkdown,
  normalizeState,
  retryPlan,
  titleAfterUserMessage,
  titleFromFirstMessage,
  withActiveSession,
  withGeneratedArtifact,
  withLiveConversation,
  withLiveQuiz,
  withMessageFeedback,
  withoutArtifact,
  withoutSession,
  withSavedAssistantArtifact,
  withSessionFirst,
} from "../src/state/session-state";

const session = (id: string, messages: ChatMessage[] = []): ChatSession => ({ id, title: id, createdAt: 1, updatedAt: 1, messages });
const user = (id: string, content = id): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const assistant = (id: string, content = id, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", content, createdAt: 2, ...extra });

function state(sessions: ChatSession[], overrides: Partial<PersistedAppState> = {}): PersistedAppState {
  return {
    schemaVersion: 4,
    sessions,
    activeSessionId: sessions[0].id,
    artifacts: [],
    providerSettings: { provider: "openai", model: "m", baseUrl: "u", temperature: 0.5 } as PersistedAppState["providerSettings"],
    learnerFeedback: { helpful: 0, missed: 0 },
    ...overrides,
  };
}

describe("normalizeState", () => {
  test("creates a fresh lesson for a missing candidate", () => {
    const fresh = normalizeState(null);
    expect(fresh.sessions).toHaveLength(1);
    expect(fresh.activeSessionId).toBe(fresh.sessions[0].id);
    expect(fresh.schemaVersion).toBe(4);
  });

  test("adds a lesson to an empty session list and keeps the rest of the state", () => {
    const next = normalizeState(state([session("a")], { sessions: [], artifacts: [] }));
    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).toBe(next.sessions[0].id);
  });

  test("repoints a stale active id at the first session and repairs missing fields", () => {
    const broken = { ...state([session("a"), session("b")]), activeSessionId: "gone", artifacts: undefined, learnerFeedback: undefined, providerSettings: undefined } as unknown as PersistedAppState;
    const next = normalizeState(broken);
    expect(next.activeSessionId).toBe("a");
    expect(next.artifacts).toEqual([]);
    expect(next.learnerFeedback).toEqual({ helpful: 0, missed: 0 });
    expect(next.providerSettings).toBeDefined();
  });

  test("keeps a valid active session", () => {
    expect(normalizeState({ ...state([session("a"), session("b")]), activeSessionId: "b" }).activeSessionId).toBe("b");
  });
});

describe("titles", () => {
  test("collapses whitespace, truncates at 48 characters and falls back for blanks", () => {
    expect(titleFromFirstMessage("  hello\n  world ")).toBe("hello world");
    expect(titleFromFirstMessage("x".repeat(60))).toBe(`${"x".repeat(47)}…`);
    expect(titleFromFirstMessage("x".repeat(48))).toBe("x".repeat(48));
    expect(titleFromFirstMessage("   ")).toBe("New lesson");
  });

  test("names only an empty lesson from its first message or attachment", () => {
    const attachment = { id: "f", kind: "document", name: "notes.txt", mimeType: "text/plain", size: 1 } as const;
    expect(titleAfterUserMessage(session("s"), "Limits", [])).toBe("Limits");
    expect(titleAfterUserMessage(session("s"), "", [attachment as never])).toBe("notes.txt");
    expect(titleAfterUserMessage(session("s"), "", [])).toBe("Attached lesson");
    expect(titleAfterUserMessage(session("s", [user("u")]), "later", [])).toBe("s");
  });

  test("artifact titles use the first non-empty heading line, truncated, else the kind default", () => {
    expect(artifactTitle(assistant("a", "\n## Plan A\nbody"), "note")).toBe("Plan A");
    expect(artifactTitle(assistant("a", "y".repeat(70)), "note")).toBe(`${"y".repeat(63)}…`);
    expect(artifactTitle(assistant("a", ""), "study-plan")).toBe("Study plan");
    expect(artifactTitle(assistant("a", ""), "quiz")).toBe("Practice quiz");
    expect(artifactTitle(assistant("a", ""), "note")).toBe("Saved note");
  });
});

describe("session selection and ordering", () => {
  test("activeSessionOf falls back to the first session", () => {
    const s = state([session("a"), session("b")]);
    expect(activeSessionOf({ ...s, activeSessionId: "b" }).id).toBe("b");
    expect(activeSessionOf({ ...s, activeSessionId: "zzz" }).id).toBe("a");
  });

  test("withSessionFirst prepends and activates; withActiveSession only activates", () => {
    const s = state([session("a")]);
    const next = withSessionFirst(s, session("n"));
    expect(next.sessions.map((entry) => entry.id)).toEqual(["n", "a"]);
    expect(next.activeSessionId).toBe("n");
    expect(withActiveSession(s, "q").activeSessionId).toBe("q");
  });

  test("withoutSession moves the active id, drops its artifacts, and never leaves zero lessons", () => {
    const s = state([session("a"), session("b")], {
      activeSessionId: "a",
      artifacts: [{ id: "x", sessionId: "a" }, { id: "y", sessionId: "b" }] as never,
    });
    const next = withoutSession(s, "a");
    expect(next.sessions.map((entry) => entry.id)).toEqual(["b"]);
    expect(next.activeSessionId).toBe("b");
    expect(next.artifacts.map((artifact) => artifact.id)).toEqual(["y"]);
    expect(withoutSession(s, "b").activeSessionId).toBe("a");
    const replaced = withoutSession(state([session("only")]), "only", () => session("fresh"));
    expect(replaced.sessions.map((entry) => entry.id)).toEqual(["fresh"]);
    expect(replaced.activeSessionId).toBe("fresh");
  });
});

describe("retry planning", () => {
  test("returns null when the lesson has no learner message", () => {
    expect(retryPlan(session("s", [assistant("a")]))).toBeNull();
  });

  test("cuts at the latest learner message", () => {
    const plan = retryPlan(session("s", [user("u1"), assistant("a1"), user("u2"), assistant("a2")]))!;
    expect(plan.messages.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
    expect(plan.replayEvents).toBeUndefined();
  });

  test("replays the newest assistant trace that committed a tool result", () => {
    const toolResult = { id: "e", occurredAt: "t", type: "tool-result", turnId: "t", sequence: 0, result: { toolCallId: "c", idempotencyKey: "k", status: "success", text: "{}" } } as never;
    const older = assistant("a1", "x", { agentEvents: [toolResult] });
    const failed = assistant("a2", "y", { agentEvents: [{ id: "e2", occurredAt: "t", type: "completed", turnId: "t", sequence: 0 }] as never });
    const plan = retryPlan(session("s", [user("u"), older, failed]))!;
    expect(plan.replayEvents).toEqual([toolResult]);
  });
});

describe("feedback", () => {
  const base = () => state([session("s", [user("u"), assistant("a")])]);

  test("returns null for an unknown message", () => {
    expect(withMessageFeedback(base(), "nope", "helpful")).toBeNull();
  });

  test("counts a first rating and stamps the message", () => {
    const next = withMessageFeedback(base(), "a", "helpful", 99)!;
    expect(next.learnerFeedback).toEqual({ helpful: 1, missed: 0 });
    expect(next.sessions[0].messages[1]).toMatchObject({ feedback: "helpful", feedbackAt: 99 });
  });

  test("moves a count from the previous rating without going negative", () => {
    const first = withMessageFeedback(base(), "a", "helpful", 1)!;
    const changed = withMessageFeedback(first, "a", "missed", 2)!;
    expect(changed.learnerFeedback).toEqual({ helpful: 0, missed: 1 });
    const drifted = withMessageFeedback({ ...first, learnerFeedback: { helpful: 0, missed: 0 } }, "a", "missed", 3)!;
    expect(drifted.learnerFeedback).toEqual({ helpful: 0, missed: 1 });
  });
});

describe("artifacts", () => {
  const base = () => state([session("s", [user("u"), assistant("a", "## Notes\nbody")])]);

  test("saves only assistant replies, once", () => {
    const next = withSavedAssistantArtifact(base(), "a", "note", "art-1", 5)!;
    expect(next.artifacts[0]).toEqual({ id: "art-1", sessionId: "s", messageId: "a", kind: "note", source: "assistant", title: "Notes", content: "## Notes\nbody", createdAt: 5 });
    expect(withSavedAssistantArtifact(next, "a", "note")).toBeNull();
    expect(withSavedAssistantArtifact(base(), "u", "note")).toBeNull();
    expect(withSavedAssistantArtifact(base(), "missing", "note")).toBeNull();
  });

  test("generated artifacts come from keating-core and go first", () => {
    const start = withSavedAssistantArtifact(base(), "a", "note", "old", 1)!;
    const next = withGeneratedArtifact(start, { kind: "quiz", topic: "T", title: "Quiz T", content: "c" }, "gen", 7);
    expect(next.artifacts.map((artifact) => artifact.id)).toEqual(["gen", "old"]);
    expect(next.artifacts[0]).toMatchObject({ source: "keating-core", topic: "T", kind: "quiz", createdAt: 7 });
  });

  test("withoutArtifact removes by id", () => {
    const start = withGeneratedArtifact(base(), { kind: "quiz", topic: "T", title: "t", content: "c" }, "gen", 1);
    expect(withoutArtifact(start, "gen").artifacts).toEqual([]);
  });
});

describe("live quiz", () => {
  const questions = [
    { question: " Q1? ", correctAnswer: " A ", explanation: " Because ", options: [" x ", " y "] },
    { question: "Q2?", correctAnswer: "B", explanation: "Why" },
  ];

  test("renders numbered markdown with optional option lists", () => {
    expect(liveQuizMarkdown(questions)).toBe([
      "## 1. Q1?\n\n- x\n- y\n\n**Answer:** A\n\n**Why:** Because",
      "## 2. Q2?\n\n**Answer:** B\n\n**Why:** Why",
    ].join("\n\n"));
  });

  test("needs a topic and at least two questions", () => {
    const s = state([session("s")]);
    expect(() => withLiveQuiz(s, "  ", questions)).toThrow("A Live quiz needs");
    expect(() => withLiveQuiz(s, "T", questions.slice(0, 1))).toThrow("A Live quiz needs");
  });

  test("attaches the quiz to the active lesson", () => {
    const next = withLiveQuiz(state([session("s")]), " Topic ", questions, "q1", 4);
    expect(next.artifacts[0]).toMatchObject({ id: "q1", sessionId: "s", kind: "quiz", source: "assistant", topic: "Topic", title: "Topic retrieval quiz", createdAt: 4 });
  });
});

describe("live conversation", () => {
  const s = () => state([session("a"), session("b")], { activeSessionId: "a" });
  let n = 0;
  const id = () => `m${++n}`;

  test("ignores empty turns", () => {
    expect(withLiveConversation(s(), [{ role: "user", text: "  " }], undefined)).toBeNull();
  });

  test("appends trimmed turns with increasing timestamps to the requested lesson", () => {
    n = 0;
    const next = withLiveConversation(s(), [{ role: "user", text: " hi " }, { role: "assistant", text: "yo" }, { role: "user", text: "" }], "b", 100, id)!;
    expect(next.sessions[1].messages).toEqual([
      { id: "m1", role: "user", content: "hi", createdAt: 100 },
      { id: "m2", role: "assistant", content: "yo", createdAt: 101 },
    ]);
    expect(next.sessions[1].updatedAt).toBe(102);
    expect(next.sessions[0].messages).toEqual([]);
  });

  test("falls back to the active lesson for an unknown session id", () => {
    n = 0;
    const next = withLiveConversation(s(), [{ role: "user", text: "hi" }], "ghost", 1, id)!;
    expect(next.sessions[0].messages).toHaveLength(1);
  });
});

describe("buildUserMessage", () => {
  test("includes attachments only when present", () => {
    expect(buildUserMessage("hi", [], 5, "m")).toEqual({ id: "m", role: "user", content: "hi", createdAt: 5 });
    const attachment = { id: "f", kind: "image", name: "p.png", mimeType: "image/png", size: 1 } as never;
    expect(buildUserMessage("hi", [attachment], 5, "m").attachments).toEqual([attachment]);
  });
});
